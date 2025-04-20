"""
auth_utils.py
-------------
Centralized authentication utilities for the application.
Handles JWT token creation/verification, blacklisted token cleanup,
and user authentication via HTTP or WebSocket using cookie-based tokens.
"""

import logging
from datetime import datetime
from typing import Optional, Dict, Any, Tuple

import jwt
from jwt import PyJWTError, ExpiredSignatureError, InvalidTokenError
from fastapi import HTTPException, Request, status
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db import get_async_session_context
from models.user import User, TokenBlacklist

logger = logging.getLogger(__name__)

# -----------------------------------------------------------------------------
# JWT Configuration
# -----------------------------------------------------------------------------
JWT_SECRET: str = settings.JWT_SECRET
JWT_ALGORITHM = "HS256"


# -----------------------------------------------------------------------------
# Token Creation
# -----------------------------------------------------------------------------
def create_access_token(data: dict) -> str:
    """
    Encodes a JWT token from the given payload `data`.
    Assumes 'data' already contains all necessary claims, including 'exp'.
    """
    token = jwt.encode(
        data,
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
        headers={
            "kid": settings.JWT_KEY_ID,  # For key rotation if desired
            "alg": JWT_ALGORITHM,
        },
    )
    logger.debug(
        "Created token with jti=%s for sub=%s, type=%s",
        data.get("jti"),
        data.get("sub"),
        data.get("type"),
    )
    return token


# -----------------------------------------------------------------------------
# Token Verification & Blacklist Checking
# -----------------------------------------------------------------------------
async def verify_token(
    token: str,
    expected_type: Optional[str] = None,
    request: Optional[Request] = None,
) -> Dict[str, Any]:
    """
    Verifies and decodes a JWT token.
    - Checks if token is blacklisted.
    - Optionally enforces a specific token type (e.g., 'access', 'refresh').
    - Raises HTTPException(401) if invalid, expired, or revoked.
    """
    decoded = None
    token_id = None
    start_time = datetime.utcnow()

    try:
        if settings.DEBUG:
            logger.debug(
                f"Verifying token (expected_type={expected_type}): {token[:20]}..."
            )

        decoded = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        token_id = decoded.get("jti")
        token_type = decoded.get("type", "unknown")
        username = decoded.get("sub", "unknown")
        expires_at = datetime.utcfromtimestamp(decoded["exp"]) if decoded.get("exp") else None

        if settings.DEBUG:
            logger.debug(
                f"Token details - jti: {token_id}, type: {token_type}, "
                f"user: {username}, expires: {expires_at}"
            )

        # If a specific token type is expected, confirm it
        if expected_type and token_type != expected_type:
            logger.warning(
                f"Token type mismatch. Expected '{expected_type}', got '{token_type}'"
            )
            raise HTTPException(status_code=401, detail="Invalid token type")

        if not token_id:
            logger.warning("Token missing required 'jti' claim")
            raise HTTPException(status_code=401, detail="Invalid token: missing jti")

        # Check if token is blacklisted
        async with get_async_session_context() as db:
            query = select(TokenBlacklist).where(TokenBlacklist.jti == token_id)
            result = await db.execute(query)
            blacklisted = result.scalar_one_or_none()
            if blacklisted:
                logger.warning(f"Token ID '{token_id}' is revoked (blacklisted)")
                raise HTTPException(status_code=401, detail="Token is revoked")

        if settings.DEBUG:
            duration = (datetime.utcnow() - start_time).total_seconds() * 1000
            logger.debug(
                f"Token verification successful for jti={token_id}, "
                f"user={username} (took {duration:.2f}ms)"
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
        logger.warning("Invalid token jti=%s, error=%s", token_id, str(e))
        raise HTTPException(status_code=401, detail="Invalid token") from e
    except PyJWTError as e:
        logger.error("JWT error for jti=%s: %s", token_id, str(e))
        raise HTTPException(status_code=401, detail="Token error") from e


# -----------------------------------------------------------------------------
# Token Blacklist Cleanup
# -----------------------------------------------------------------------------
async def clean_expired_tokens(db: AsyncSession) -> int:
    """
    Removes expired tokens from the blacklist table,
    returning the number of records deleted.
    Also logs a summary of active blacklisted tokens by type.
    """
    now = datetime.utcnow()

    # Delete expired blacklist entries
    stmt = delete(TokenBlacklist).where(TokenBlacklist.expires < now)
    result = await db.execute(stmt)
    await db.commit()
    deleted_count = result.rowcount or 0

    # Log active token counts by type
    token_count_query = (
        select(TokenBlacklist.token_type, func.count(TokenBlacklist.id))  # pylint: disable=not-callable
        .where(TokenBlacklist.expires >= now)
        .group_by(TokenBlacklist.token_type)
    )
    token_counts = await db.execute(token_count_query)
    for token_type, count in token_counts:
        logger.info(f"Active blacklisted tokens of type '{token_type}': {count}")

    if deleted_count > 0:
        logger.info(f"Cleaned up {deleted_count} expired blacklisted tokens.")
    return deleted_count


# -----------------------------------------------------------------------------
# Cookie Extraction for HTTP / WebSocket
# -----------------------------------------------------------------------------
def extract_token(request_or_websocket):
    """
    Retrieves the 'access_token' from cookies.
    Works with both HTTP (Request) and WebSocket objects.
    """
    if hasattr(request_or_websocket, "cookies"):
        # Likely an HTTP Request
        return request_or_websocket.cookies.get("access_token")
    if hasattr(request_or_websocket, "headers"):
        # WebSocket scenario
        cookie_header = request_or_websocket.headers.get("cookie", "")
        cookies = {}
        for c in cookie_header.split(";"):
            if "=" in c:
                k, v = c.split("=", 1)
                cookies[k.strip()] = v.strip()
        return cookies.get("access_token")
    return None  # Fallback for unexpected types


# -----------------------------------------------------------------------------
# User Retrieval via Token
# -----------------------------------------------------------------------------
async def get_user_from_token(
    token: str,
    db: AsyncSession,
    expected_type: Optional[str] = "access",
) -> User:
    """
    Decodes the given JWT, checks optional token type,
    then loads the associated user from the database.
    Raises 401 if user not found or token is invalid/expired/revoked.
    """
    decoded = await verify_token(token, expected_type)

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

    # Check session inactivity if relevant
    if hasattr(user, "last_activity") and user.last_activity:
        inactive_duration = (datetime.utcnow() - user.last_activity).total_seconds()
        if inactive_duration > 86400:  # 1 day in seconds
            logger.warning(
                f"Session expired due to inactivity for {username} "
                f"({inactive_duration} seconds since last activity)."
            )
            raise HTTPException(
                status_code=401,
                detail="Session expired due to inactivity",
                headers={"WWW-Authenticate": "Bearer"},
            )

    # Inject token details into the user object if needed
    user.jti = decoded.get("jti")
    user.exp = decoded.get("exp")
    user.active_project_id = decoded.get("project_context")

    return user


# -----------------------------------------------------------------------------
# FastAPI Dependency for HTTP Endpoints
# -----------------------------------------------------------------------------
async def get_current_user_and_token(request: Request) -> Tuple[User, str]:
    """
    FastAPI dependency that extracts an 'access_token' from the request cookies,
    verifies it, loads the corresponding user, and returns both.
    """
    token = extract_token(request)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    async with get_async_session_context() as db:
        user = await get_user_from_token(token, db)
    return user, token
