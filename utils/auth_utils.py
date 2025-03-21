"""
auth_utils.py
------------
Centralized authentication utilities for the application.
Handles JWT token generation/validation and user authentication for both
HTTP and WebSocket connections.
"""
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Tuple
from urllib.parse import unquote

import jwt
from fastapi import HTTPException, Request, WebSocket, status, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.user import User
from utils.db_utils import get_async_session

logger = logging.getLogger(__name__)

# Token constants
JWT_SECRET: str = settings.JWT_SECRET
JWT_ALGORITHM = "HS256"

# Basic in-memory revocation list. In production, consider a DB or Redis.
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
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return encoded_jwt


def verify_token(token: str, expected_type: Optional[str] = None) -> Dict[str, Any]:
    """
    Verify and decode a JWT token.
    
    Args:
        token: JWT token to verify
        expected_type: Optional token type to validate
        
    Returns:
        Decoded token payload
        
    Raises:
        HTTPException: If token validation fails
    """
    try:
        decoded = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])

        # Validate token type if specified
        if expected_type and decoded.get("type") != expected_type:
            logger.warning(f"Token type mismatch. Expected {expected_type}, got {decoded.get('type')}")
            raise HTTPException(status_code=401, detail="Invalid token type")

        # Check if token is revoked
        token_id = decoded.get("jti")
        if token_id in REVOCATION_LIST:
            logger.warning(f"Token ID '{token_id}' is revoked")
            raise HTTPException(status_code=401, detail="Token is revoked")

        return decoded

    except jwt.ExpiredSignatureError:
        logger.warning("Token has expired.")
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError as e:
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
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split("Bearer ")[1]
            
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
    
    if cookie_header:
        try:
            cookies = {}
            for c in cookie_header.split("; "):
                if '=' in c:
                    k, v = c.split('=', 1)
                    cookies[k.strip()] = unquote(v.strip())
            token = cookies.get("access_token")
        except Exception as e:
            logger.error(f"Failed to parse cookies: {str(e)}")
    
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
    decoded = verify_token(token, expected_type)
    
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
    await websocket.accept()
    
    # Get token
    token = await extract_token_from_websocket(websocket)
    
    if not token:
        logger.warning("WebSocket connection rejected: No token provided")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return False, None
    
    # Validate token and get user
    try:
        user = await get_user_from_token(token, db, "access")
        return True, user
    except Exception as e:
        logger.warning(f"WebSocket authentication failed: {str(e)}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return False, None
