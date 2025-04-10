"""
auth_utils.py
-------------
Centralized authentication utilities for the application.
Handles JWT token generation/validation and user authentication for both
HTTP and WebSocket connections using cookie-based tokens only.
"""

import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Tuple
from uuid import UUID

from jwt import encode, decode
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError
from fastapi import HTTPException, Request, WebSocket, status, Depends
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db import get_async_session_context
from models.user import User, TokenBlacklist
from models.project import Project, ProjectUserAssociation

logger = logging.getLogger(__name__)

# Token constants
JWT_SECRET: str = settings.JWT_SECRET
JWT_ALGORITHM = "HS256"



def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create a JWT access token.
    """
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        )
    to_encode.update({"exp": expire})
    encoded_jwt = encode(
        to_encode,
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
        headers={
            "kid": settings.JWT_KEY_ID,  # Key rotation support (optional)
            "alg": JWT_ALGORITHM,
        },
    )
    logger.debug(
        f"Access token created for user: {data.get('sub')}, jti: {data.get('jti')}"
    )
    return encoded_jwt


async def verify_token(
    token: str,
    expected_type: Optional[str] = None,
    request: Optional[Request] = None,
) -> Dict[str, Any]:
    async with get_async_session_context() as db:
        """
        Verify and decode a JWT token from cookies.
        Enforces optional token type and checks if token is revoked.
        """
        decoded = None
        token_id = None

        try:
            decoded = decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])

            # If a specific token type is expected, confirm
            if expected_type and decoded.get("type") != expected_type:
                logger.warning(
                    f"Token type mismatch. Expected {expected_type}, got {decoded.get('type')}"
                )
                raise HTTPException(status_code=401, detail="Invalid token type")

            token_id = decoded.get("jti")
            if db and token_id:
                try:
                    query = select(
                        TokenBlacklist.jti,
                        TokenBlacklist.expires,
                        TokenBlacklist.token_type
                    ).where(TokenBlacklist.jti == token_id)
                    result = await db.execute(query)
                    blacklisted = result.scalar_one_or_none()
                except Exception as oe:
                    if "creation_reason" in str(oe):
                        query = select(TokenBlacklist.jti, TokenBlacklist.expires)
                        result = await db.execute(query)
                        blacklisted = result.scalar_one_or_none()
                    else:
                        raise
                    
                if blacklisted:
                    logger.warning(f"Token ID '{token_id}' is revoked (database)")
                    raise HTTPException(status_code=401, detail="Token is revoked")

            if not decoded.get("jti"):
                logger.warning("Token missing required jti claim")
                raise HTTPException(status_code=401, detail="Invalid token: missing jti")


            logger.debug(
                f"Token verification successful for jti: {token_id}, user: {username}"
            )
            return decoded

        except ExpiredSignatureError as exc:
            logger.warning("Token expired: jti=%s", token_id)
            raise HTTPException(
                status_code=401,
                detail="Token has expired - please refresh your session", 
                headers={"WWW-Authenticate": "Bearer"},
            ) from exc
        except InvalidTokenError as e:
            logger.warning("Invalid token - jti=%s, error=%s", token_id, str(e))
            raise HTTPException(status_code=401, detail="Invalid token") from e




async def clean_expired_tokens(db: AsyncSession) -> int:
    """
    Clean up expired tokens from the database and sync in-memory cache.
    """
    now = datetime.utcnow()

    # Delete from DB
    stmt = delete(TokenBlacklist).where(TokenBlacklist.expires < now)
    result = await db.execute(stmt)
    await db.commit()
    deleted_count = result.rowcount

    # Log token counts by type before cleanup
    token_count_query = select(
        TokenBlacklist.token_type, 
        func.count(TokenBlacklist.id)
    ).where(
        TokenBlacklist.expires >= now
    ).group_by(
        TokenBlacklist.token_type
    )
    token_counts = await db.execute(token_count_query)
    
    for token_type, count in token_counts:
        logger.info(f"Active blacklisted tokens of type '{token_type}': {count}")

    # Get active JTIs for the revocation list
    query = select(TokenBlacklist.jti).where(TokenBlacklist.expires >= now)
    result = await db.execute(query)
    valid_jtis = {row[0] for row in result.fetchall()}


    if deleted_count > 0:
        logger.info(f"Cleaned up {deleted_count} expired blacklisted tokens")
    return deleted_count




def extract_token(request_or_websocket):
    """Get JWT from cookies, works for both HTTP and WebSocket"""
    if isinstance(request_or_websocket, WebSocket):
        # Special handling for WebSocket cookie extraction
        cookie_header = request_or_websocket.headers.get("cookie", "")
        cookies = {
            c.split("=", 1)[0].strip(): c.split("=", 1)[1].strip()
            for c in cookie_header.split(";")
            if "=" in c
        }
        return cookies.get("access_token")
    return request_or_websocket.cookies.get("access_token")


async def get_user_from_token(
    token: str, db: AsyncSession, expected_type: Optional[str] = "access"
) -> User:
    """
    Retrieve a user object by validating a JWT token from cookies.
    """
    decoded = await verify_token(token, expected_type, None)

    username = decoded.get("sub")
    if not username:
        logger.warning("Token missing 'sub' claim")
        raise HTTPException(
            status_code=401, detail="Invalid token payload: missing subject"
        )

    result = await db.execute(select(User).where(User.username == username))
    user = result.scalars().first()

    if not user:
        logger.warning(f"User '{username}' from token not found in database")
        raise HTTPException(status_code=401, detail="User not found")

    if not user.is_active:
        logger.warning(f"Attempt to use token for disabled account: {username}")
        raise HTTPException(status_code=403, detail="Account disabled")

    token_version = decoded.get("version")
    # Only invalidate tokens if their version is LESS THAN the user's current version
    # This matches the behavior in verify_token and fixes the race condition
    if token_version is None or token_version < user.token_version:
        logger.critical(
            f"Token version mismatch for {username}: "
            f"token={token_version}, user={user.token_version}"
        )
        raise HTTPException(
            status_code=403,
            detail="Session invalidated - token version mismatch",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check last activity for sliding sessions
    if hasattr(user, "last_activity") and user.last_activity:
        inactive_duration = (datetime.utcnow() - user.last_activity).total_seconds()
        if inactive_duration > 86400:  # 1 day in seconds
            logger.warning(
                f"Session expired due to inactivity for {username}: "
                f"{inactive_duration} seconds since last activity"
            )
            raise HTTPException(
                status_code=401,
                detail="Session expired due to inactivity",
                headers={"WWW-Authenticate": "Bearer"},
            )

    user.jti = decoded.get("jti")
    user.exp = decoded.get("exp")
    user.active_project_id = decoded.get("project_context")

    return user


async def get_current_user_and_token(
    request: Request
) -> User:
    async with get_async_session_context() as db:
        """
        FastAPI dependency that extracts and validates a token from cookies, returning the user.
        """
        token = extract_token(request)
        if not token:
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated",
                headers={"WWW-Authenticate": "Bearer"},
            )

        user = await get_user_from_token(token, db)
    return user


async def authenticate_websocket(
    websocket: WebSocket, db: AsyncSession
) -> Tuple[bool, Optional[User]]:
    """
    Authenticate a WebSocket connection by extracting the access token cookie.
    """
    # Add special handling for browser clients
    user_agent = websocket.headers.get("user-agent", "").lower()
    is_browser = any(s in user_agent for s in ["mozilla", "webkit", "chrome"])
    
    if is_browser:
        token = extract_token(websocket)
    else:
        # Non-browser clients can send token directly
        token = await websocket.receive_text()
    if not token:
        logger.warning("WebSocket connection rejected: No cookie token provided")
        try:
            if websocket.client_state != websocket.client_state.DISCONNECTED:
                await websocket.close()
        except Exception as e:
            logger.error(f"Error closing websocket: {e}")
        return False, None

    try:
        user = await get_user_from_token(token, db, "access")
        logger.info(f"WebSocket authenticated for user: {user.id} ({user.username})")
        return True, user
    except Exception as e:
        logger.warning(f"WebSocket authentication failed: {str(e)}")
        try:
            if websocket.client_state != websocket.client_state.DISCONNECTED:
                await websocket.close()
        except Exception as close_err:
            logger.error(f"Error closing websocket: {close_err}")
        return False, None
