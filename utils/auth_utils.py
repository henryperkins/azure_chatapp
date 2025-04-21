"""
auth_utils.py
-------------
Centralized authentication utilities for the application.
Handles JWT token creation/verification, blacklisted token cleanup,
and user authentication via HTTP or WebSocket using cookie-based tokens.
Includes improved logging, diagnostics, and detailed error messages.
"""

import logging
from datetime import datetime
from typing import Optional, Dict, Any, Tuple

import jwt
from jwt import PyJWTError, ExpiredSignatureError, InvalidTokenError
from fastapi import HTTPException, Request, status, Depends
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from db import get_async_session

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
    try:
        token = jwt.encode(
            data,
            JWT_SECRET,
            algorithm=JWT_ALGORITHM,
            headers={
                "kid": getattr(settings, "JWT_KEY_ID", None),
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
    except Exception as exc:
        logger.error("Failed to create JWT: %s", exc)
        raise


# -----------------------------------------------------------------------------
# Token Verification & Blacklist Checking
# -----------------------------------------------------------------------------
async def verify_token(
    token: str,
    expected_type: Optional[str] = None,
    request: Optional[Request] = None,
    db_session: Optional[AsyncSession] = None
) -> Dict[str, Any]:
    """
    Verifies and decodes a JWT token.
    - Checks if token is blacklisted.
    - Optionally enforces a specific token type (e.g., 'access', 'refresh').
    - Raises HTTPException(401) if invalid, expired, or revoked.
    - Can reuse an existing database session if provided.
    Provides detailed logging for all stages.
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
        expires_at = (
            datetime.utcfromtimestamp(decoded["exp"]) if decoded.get("exp") else None
        )

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

        # Check if token is blacklisted - using the provided session if available
        if db_session:
            query = select(TokenBlacklist).where(TokenBlacklist.jti == token_id)
            result = await db_session.execute(query)
            blacklisted = result.scalar_one_or_none()
        else:
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
    except Exception as e:
        logger.exception(
            "Unexpected error during token verification for jti=%s", token_id
        )
        raise HTTPException(status_code=500, detail="Token verification failed") from e


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
        select(TokenBlacklist.token_type, func.count(TokenBlacklist.id))
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
def extract_token(request_or_websocket, token_type="access"):
    """
    Retrieves the specified token type from cookies.
    Works with both HTTP (Request) and WebSocket objects.

    Args:
        request_or_websocket: The request or websocket object
        token_type: The type of token to extract ('access' or 'refresh')
    """
    cookie_name = f"{token_type}_token"

    if hasattr(request_or_websocket, "cookies"):
        # Likely an HTTP Request
        return request_or_websocket.cookies.get(cookie_name)
    if hasattr(request_or_websocket, "headers"):
        # WebSocket scenario
        cookie_header = request_or_websocket.headers.get("cookie", "")
        cookies = {}
        for c in cookie_header.split(";"):
            if "=" in c:
                k, v = c.split("=", 1)
                cookies[k.strip()] = v.strip()
        return cookies.get(cookie_name)
    return None  # Fallback for unexpected types


async def get_user_from_token(
    token: str,
    db: AsyncSession,
    *,
    request: Request | None = None,
    expected_type: str = "access",
) -> User:
    """
    Retrieve and verify a JWT token, then load the user from the database.

    :param token: The raw JWT token string extracted from headers or cookies.
    :param db: The SQLAlchemy AsyncSession to use for DB operations.
    :param request: (Optional) The FastAPI Request object, if needed during token verification.
    :param expected_type: The expected token type (e.g. "access" or "refresh").
    :return: The authenticated User instance.
    :raises HTTPException: If the token is invalid, expired, revoked, or the user is not found/disabled.
    """
    if not token:
        logger.warning(f"No {expected_type} token found in request")
        raise HTTPException(
            status_code=401,
            detail=f"Missing {expected_type} token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Verify token and decode payload
    decoded = await verify_token(token, expected_type, request, db_session=db)
    if not decoded:
        logger.warning("Token verification failed or token was None")
        raise HTTPException(
            status_code=401,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    username = decoded.get("sub")
    if not username:
        logger.warning("Token missing 'sub' (subject) claim")
        raise HTTPException(
            status_code=401,
            detail="Invalid token payload: missing subject",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Fetch user from DB
    result = await db.execute(select(User).where(User.username == username))
    user = result.scalars().first()

    if not user:
        logger.warning(f"User '{username}' from token not found in database")
        raise HTTPException(
            status_code=401,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        logger.warning(f"Attempt to use token for disabled account: {username}")
        raise HTTPException(
            status_code=403,
            detail="Account disabled",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check session inactivity if relevant
    if hasattr(user, "last_activity") and user.last_activity:
        inactive_duration = (datetime.utcnow() - user.last_activity).total_seconds()
        if inactive_duration > 86400:  # 1 day in seconds
            logger.warning(
                f"Session expired due to inactivity for {username}; "
                f"{inactive_duration:.0f} seconds since last activity."
            )
            raise HTTPException(
                status_code=401,
                detail="Session expired due to inactivity",
                headers={"WWW-Authenticate": "Bearer"},
            )

    # Optionally attach token metadata to the user object
    user.jti = decoded.get("jti")
    user.exp = decoded.get("exp")
    user.active_project_id = decoded.get("project_context")

    return user


async def get_current_user_and_token(request: Request) -> Tuple[User, str]:
    """
    FastAPI dependency that:
      1. Extracts an 'access' token from the request (cookies or headers).
      2. Verifies it and loads the corresponding user.
      3. Returns a tuple of (User, token).
    """
    token = extract_token(request)
    if not token:
        logger.warning("Access token not found in request")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Use a single DB session context for token verification + user load
    async with get_async_session_context() as db:
        user = await get_user_from_token(
            token=token, db=db, request=request, expected_type="access"
        )

    return user, token
