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
    encoded_jwt = encode(
        to_encode, 
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
        headers={
            "kid": settings.JWT_KEY_ID,  # Key rotation support
            "alg": JWT_ALGORITHM
        }
    )
    logger.debug(f"Access token created for user: {data.get('sub')}, expires in {expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)}, jti: {data.get('jti')}")
    return encoded_jwt


async def verify_token(token: str, expected_type: Optional[str] = None, db: Optional[AsyncSession] = None, request: Optional[Request] = None) -> Dict[str, Any]:
    """
    Verify and decode a JWT token with enhanced debugging.

    Args:
        token: JWT token to verify
        expected_type: Optional token type to validate 
        db: Optional database session for checking blacklisted tokens

    Returns:
        Decoded token payload

    Raises:
        HTTPException: If token validation fails
    """
    # Add additional logging for debugging
    if request:
        logger.debug(f"Verifying token from source: {token[:10]}... (cookie: {'access_token' in request.cookies})")
    # Initialize variables that may be referenced in error handling
    decoded = None
    token_id = None
    
    try:
        decoded = decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])

        # Validate token type if specified
        if expected_type and decoded.get("type") != expected_type:
            logger.warning(f"Token type mismatch. Expected {expected_type}, got {decoded.get('type')}. Token type: {decoded.get('type')}, Expected type: {expected_type}")
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

        # Validate required JWT claims
        if not decoded.get("jti"):
            logger.warning("Token missing required jti claim")
            raise HTTPException(status_code=401, detail="Invalid token: missing jti")

        # Check token version if available
        token_version = decoded.get("version")
        username = decoded.get("sub")
        if db and username:
            query = select(User).where(User.username == username)
            result = await db.execute(query)
            user = result.scalar_one_or_none()
            if user:
                current_version = user.token_version or 0
                if token_version is None or token_version < current_version:
                    logger.warning(f"Token version mismatch for {username}: "
                                  f"Token version {token_version} < "
                                  f"User version {current_version}")
                    raise HTTPException(status_code=401, detail="Token has been invalidated")

        logger.debug(f"Token verification successful for jti: {token_id}, user: {username}")
        return decoded

    except ExpiredSignatureError:
        now = datetime.utcnow().timestamp()
        exp_time = decoded.get('exp') if decoded else None
        diff = now - exp_time if exp_time else None
        logger.warning(
            f"Token expired - jti: {token_id}, "
            f"exp: {exp_time}, now: {now}, "
            f"diff: {diff}s" if diff is not None else "diff: N/A"
        )
        raise HTTPException(status_code=401, detail="Token has expired")
    except InvalidTokenError as e:
        logger.warning(
            f"Invalid token - jti: {token_id}, error: {str(e)}, "
            f"headers: {decoded.get('headers') if decoded else 'N/A'}, "
            f"payload: {decoded.get('payload') if decoded else 'N/A'}"
        )
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
    """Clean up expired tokens from the database and in-memory cache."""
    global REVOCATION_LIST
    now = datetime.utcnow()

    # Delete expired tokens from database
    stmt = delete(TokenBlacklist).where(TokenBlacklist.expires < now)
    result = await db.execute(stmt)
    await db.commit()
    deleted_count = result.rowcount

    # Get current valid blacklist entries for in-memory cache update
    query = select(TokenBlacklist.jti).where(TokenBlacklist.expires >= now)
    result = await db.execute(query)
    valid_jtis = {row[0] for row in result.fetchall()}
    
    # Update in-memory list to match database (removes expired entries)
    REVOCATION_LIST = valid_jtis
    
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


def extract_token(request_or_websocket):
    """Extract token from HTTP request or WebSocket connection with proper priority"""
    # First check cookies for ALL requests
    if hasattr(request_or_websocket, "cookies"):
        token = request_or_websocket.cookies.get("access_token")
        if token:
            return token
    
    # Then check Authorization header
    auth_header = request_or_websocket.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        return auth_header[7:]  # Remove "Bearer " prefix
    
    # Finally check query params for WebSockets
    if isinstance(request_or_websocket, WebSocket):
        return request_or_websocket.query_params.get("token")
    
    return None


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
    token = extract_token(request)

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
    token = extract_token(websocket)

    if not token:
        logger.warning("WebSocket connection rejected: No token provided")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        logger.debug("WebSocket connection rejected - No token. Headers: %s, Query Params: %s", websocket.headers, websocket.query_params)
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
