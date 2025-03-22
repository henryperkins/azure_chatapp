"""
auth_utils.py
------------
Centralized authentication utilities for the application.
Handles JWT token generation/validation and user authentication for both
HTTP and WebSocket connections.
"""
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Tuple, List
from urllib.parse import unquote

import jwt
from jwt import encode, decode
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError
from fastapi import HTTPException, Request, WebSocket, status, Depends
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db import get_async_session
from models.user import User, TokenBlacklist

logger = logging.getLogger(__name__)

# Token constants
JWT_SECRET: str = settings.JWT_SECRET
JWT_ALGORITHM = "HS256"

# In-memory revocation cache (backed by database)
REVOCATION_LIST = set()


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create a JWT access token.
    
    Args:
        data: Token payload data
        expires_delta: Optional expiration delta
        
    Returns:
        Encoded JWT token string
    """
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return encoded_jwt


async def verify_token(token: str, expected_type: Optional[str] = None, db: Optional[AsyncSession] = None) -> Dict[str, Any]:
    """
    Verify and decode a JWT token.
    
    Args:
        token: JWT token to verify
        expected_type: Optional token type to validate
        db: Optional database session for checking blacklisted tokens
        
    Returns:
        Decoded token payload
        
    Raises:
        HTTPException: If token validation fails
    """
    try:
        decoded = decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])

        # Validate token type if specified
        if expected_type and decoded.get("type") != expected_type:
            logger.warning(f"Token type mismatch. Expected {expected_type}, got {decoded.get('type')}")
            raise HTTPException(status_code=401, detail="Invalid token type")

        # Check if token is revoked in memory for quick check
        token_id = decoded.get("jti")
        if token_id in REVOCATION_LIST:
            logger.warning(f"Token ID '{token_id}' is revoked (in-memory)")
            raise HTTPException(status_code=401, detail="Token is revoked")
            
        # Check if token is in database blacklist (persistent across restarts)
        if db and token_id:
            query = select(TokenBlacklist).where(TokenBlacklist.jti == token_id)
            result = await db.execute(query)
            blacklisted = result.scalar_one_or_none()
            if blacklisted:
                # Add to in-memory list for future quick checks
                REVOCATION_LIST.add(token_id)
                logger.warning(f"Token ID '{token_id}' is revoked (database)")
                raise HTTPException(status_code=401, detail="Token is revoked")
                
        # Check token version if available
        token_version = decoded.get("version")
        username = decoded.get("sub")
        if db and token_version is not None and username:
            query = select(User).where(User.username == username)
            result = await db.execute(query)
            user = result.scalar_one_or_none()
            if user and (user.token_version is None or token_version < user.token_version):
                logger.warning(f"Token for user '{username}' has outdated version")
                raise HTTPException(status_code=401, detail="Token has been invalidated")

        return decoded

    except ExpiredSignatureError:
        logger.warning("Token has expired.")
        raise HTTPException(status_code=401, detail="Token has expired")
    except InvalidTokenError as e:
        logger.warning(f"Invalid token: {str(e)}")
        raise HTTPException(status_code=401, detail="Invalid token")


def revoke_token_id(token_id: str) -> None:
    """
    Add token_id (jti) to revocation list.
    
    Args:
        token_id: Token ID to revoke
    """
    REVOCATION_LIST.add(token_id)
    logger.info(f"Token ID '{token_id}' has been revoked and cannot be used.")


async def clean_expired_tokens(db: AsyncSession) -> int:
    """
    Clean up expired tokens from the database blacklist.
    
    Args:
        db: Database session
        
    Returns:
        Number of tokens deleted
    """
    # Get current time
    now = datetime.utcnow()
    
    # Delete expired tokens
    stmt = delete(TokenBlacklist).where(TokenBlacklist.expires < now)
    result = await db.execute(stmt)
    await db.commit()
    
    # Get the count of deleted rows
    deleted_count = result.rowcount
    
    if deleted_count > 0:
        logger.info(f"Cleaned up {deleted_count} expired blacklisted tokens")
    
    return deleted_count


async def load_revocation_list(db: AsyncSession) -> None:
    """
    Load active revoked tokens into memory on startup.
    
    Args:
        db: Database session
    """
    # Get current time
    now = datetime.utcnow()
    
    # Select non-expired tokens
    query = select(TokenBlacklist.jti).where(TokenBlacklist.expires >= now)
    result = await db.execute(query)
    
    # Add to in-memory list
    token_ids = [row[0] for row in result.fetchall()]
    REVOCATION_LIST.update(token_ids)
    
    logger.info(f"Loaded {len(token_ids)} active blacklisted tokens into memory")


def extract_token_from_request(request: Request) -> Optional[str]:
    """
    Extract JWT token from HTTP request.
    
    Args:
        request: FastAPI Request object
        
    Returns:
        Token string if found, None otherwise
    """
    # Try cookies first
    token = request.cookies.get("access_token")
    
    # Fallback to Authorization header
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header:
            parts = auth_header.split()
            if len(parts) == 2 and parts[0].lower() == "bearer":
                token = parts[1]
            
    return token


async def extract_token_from_websocket(websocket: WebSocket) -> Optional[str]:
    """
    Extract JWT token from WebSocket connection.
    
    Args:
        websocket: WebSocket connection
        
    Returns:
        Token string if found, None otherwise
    """
    # Try to get token from cookies
    token = None
    cookie_header = websocket.headers.get("cookie")
    
    cookie_header = websocket.headers.get("cookie") or ""
    cookies = {}
    
    try:
        for cookie in cookie_header.split("; "):
            if "=" not in cookie:
                continue  # Skip malformed cookies
            key, value = cookie.split("=", 1)
            cookies[key.strip().lower()] = unquote(value.strip())
        token = cookies.get("access_token")
    
    except Exception as e:
        logger.error(f"Error parsing cookies: {str(e)}")
        token = None
    
    # If no token in cookies, try query parameters
    if not token and "token" in websocket.query_params:
        token = websocket.query_params["token"]

    return token


async def get_user_from_token(
    token: str, 
    db: AsyncSession, 
    expected_type: Optional[str] = "access"
) -> User:
    """
    Get user from a token.
    
    Args:
        token: JWT token
        db: Database session
        expected_type: Expected token type
        
    Returns:
        User object
        
    Raises:
        HTTPException: For authentication failures
    """
    # Verify token
    decoded = await verify_token(token, expected_type, db)
    
    username = decoded.get("sub")
    if not username:
        logger.warning("Token missing 'sub' claim in payload")
        raise HTTPException(status_code=401, detail="Invalid token payload: missing subject")
        
    # Get user from database
    result = await db.execute(select(User).where(User.username == username))
    user = result.scalars().first()
    
    if not user:
        logger.warning(f"User with username '{username}' from token not found in database")
        raise HTTPException(status_code=401, detail="User not found")
        
    if not user.is_active:
        logger.warning(f"Attempt to use token for disabled account: {username}")
        raise HTTPException(status_code=403, detail="Account disabled")
    
    # Attach JWT claims to user object for access in logout and other functions
    user.jti = decoded.get("jti")
    user.exp = decoded.get("exp")
        
    return user


async def get_current_user_and_token(
    request: Request,
    db: AsyncSession = Depends(get_async_session)
) -> User:
    """
    FastAPI dependency that extracts and validates JWT token from request,
    then returns the authenticated user.
    
    Args:
        request: FastAPI Request object (injected)
        db: Database session (injected)
        
    Returns:
        User object if authentication successful
        
    Raises:
        HTTPException: For authentication failures
    """
    # Extract token from request
    token = extract_token_from_request(request)
    
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Get user from token
    user = await get_user_from_token(token, db)
    
    return user


async def authenticate_websocket(
    websocket: WebSocket, 
    db: AsyncSession
) -> Tuple[bool, Optional[User]]:
    """
    Authenticate a WebSocket connection.
    
    Args:
        websocket: WebSocket connection
        db: Database session
        
    Returns:
        Tuple of (success, user)
    """
    # Get token BEFORE accepting WebSocket
    token = await extract_token_from_websocket(websocket)
    
    if not token:
        logger.warning("WebSocket connection rejected: No token provided")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return False, None
    
    # Validate token and get user
    try:
        user = await get_user_from_token(token, db, "access")
        # Accept WebSocket only AFTER successful authentication
        await websocket.accept()
        return True, user
    except Exception as e:
        logger.warning(f"WebSocket authentication failed: {str(e)}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return False, None
