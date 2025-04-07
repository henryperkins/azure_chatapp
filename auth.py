"""
auth.py
-------
Handles user login and registration using purely cookie-based authentication,
secure password hashing (bcrypt), session expiry logic, and token versioning.
"""

import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

import bcrypt
from config import settings
from db import get_async_session
from models.user import User, TokenBlacklist
from utils.auth_utils import (
    clean_expired_tokens,
    get_user_from_token,
    get_current_user_and_token,
    create_access_token,
    revoke_token_id,
    verify_token,
)

logger = logging.getLogger(__name__)

router = APIRouter()

ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 30))
REFRESH_TOKEN_EXPIRE_DAYS = 1  # Reduced from 7 to 1 day for better security


class UserCredentials(BaseModel):
    """Authentication credentials (username and password)."""

    username: str
    password: str


class LoginResponse(BaseModel):
    """Response model for login endpoint."""

    access_token: str
    token_type: str


def validate_password(password: str):
    """
    Validates password meets security requirements in a single pass:
    - At least 12 chars
    - Contains upper, lower, digit, special char
    """
    if len(password) < 12:
        raise ValueError("Password must be at least 12 characters")

    special_chars = "!@#$%^&*()_+-=[]{}|;:,.<>?~"
    has_upper = has_lower = has_digit = has_special = False

    for char in password:
        if char.isupper():
            has_upper = True
        elif char.islower():
            has_lower = True
        elif char.isdigit():
            has_digit = True
        elif char in special_chars:
            has_special = True

        if has_upper and has_lower and has_digit and has_special:
            return

    if not has_upper:
        raise ValueError("Password must contain uppercase letters")
    if not has_lower:
        raise ValueError("Password must contain lowercase letters")
    if not has_digit:
        raise ValueError("Password must contain numbers")
    if not has_special:
        raise ValueError("Password must contain at least one special character")


@router.post("/register", response_model=dict)
async def register_user(
    creds: UserCredentials, session: AsyncSession = Depends(get_async_session)
) -> dict:
    """
    Registers a new user with a hashed password, enforcing password policy.
    """
    lower_username = creds.username.lower()
    validate_password(creds.password)

    existing_user = (
        (await session.execute(select(User).where(User.username == lower_username)))
        .scalars()
        .first()
    )
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already taken")

    hashed_pw = bcrypt.hashpw(creds.password.encode("utf-8"), bcrypt.gensalt()).decode(
        "utf-8"
    )

    user = User(username=lower_username, password_hash=hashed_pw, is_active=True)
    session.add(user)
    await session.commit()
    await session.refresh(user)

    user.last_login = datetime.utcnow()
    session.add(user)
    await session.commit()

    logger.info("User registered successfully: %s", lower_username)
    return {"message": f"User '{lower_username}' registered successfully"}


@router.post("/login", response_model=LoginResponse)
async def login_user(
    response: Response,
    creds: UserCredentials,
    session: AsyncSession = Depends(get_async_session),
) -> LoginResponse:
    """
    Authenticates user, returns access and refresh tokens,
    and sets them in secure HTTP-only cookies.
    """
    lower_username = creds.username.lower()
    result = await session.execute(select(User).where(User.username == lower_username))
    user = result.scalars().first()
    if not user:
        logger.warning("Login attempt for non-existent user: %s", lower_username)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not user.is_active:
        logger.warning("Login attempt for disabled account: %s", lower_username)
        raise HTTPException(
            status_code=403, detail="Account disabled. Contact support."
        )

    # Check password with bcrypt in executor
    try:
        valid_password = await asyncio.get_event_loop().run_in_executor(
            None,
            bcrypt.checkpw,
            creds.password.encode("utf-8"),
            user.password_hash.encode("utf-8"),
        )
    except ValueError as exc:
        logger.error("Corrupted password hash for user '%s': %s", lower_username, exc)
        raise HTTPException(
            status_code=400,
            detail="Corrupted password hash. Please reset account.",
        ) from exc

    if not valid_password:
        logger.warning("Failed login attempt for user: %s", lower_username)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Start transaction to safely update user & token_version
    async with session.begin_nested():
        locked_user = await session.get(User, user.id, with_for_update=True)
        if not locked_user:
            raise HTTPException(status_code=500, detail="User lock failed")

        locked_user.last_login = datetime.utcnow()
        # Bump token_version
        current_ts = int(datetime.utcnow().timestamp())
        locked_user.token_version = (
            locked_user.token_version + 1 if locked_user.token_version else current_ts
        )

        # Access token
        token_id = str(uuid.uuid4())
        expire_at = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        access_payload = {
            "sub": locked_user.username,
            "exp": expire_at,
            "iat": datetime.utcnow(),
            "jti": token_id,
            "type": "access",
            "version": locked_user.token_version,
            "user_id": locked_user.id,
        }
        access_token = create_access_token(access_payload)

        # Refresh token
        refresh_token_id = str(uuid.uuid4())
        refresh_expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
        refresh_payload = {
            "sub": locked_user.username,
            "exp": refresh_expire,
            "iat": datetime.utcnow(),
            "jti": refresh_token_id,
            "type": "refresh",
            "version": locked_user.token_version,
            "user_id": locked_user.id,
        }
        refresh_token = create_access_token(refresh_payload)

        await session.commit()

    # Clean up expired tokens in background
    await clean_expired_tokens(session)

    # Set secure cookies for both tokens
    set_secure_cookie(
        response, "access_token", access_token, max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60
    )
    set_secure_cookie(
        response,
        "refresh_token",
        refresh_token,
        max_age=60 * 60 * 24 * REFRESH_TOKEN_EXPIRE_DAYS,
    )

    logger.info(
        "User '%s' logged in. Token IDs: %s (access), %s (refresh)",
        lower_username,
        token_id,
        refresh_token_id,
    )

    return LoginResponse(access_token=access_token, token_type="bearer")


async def get_refresh_token_user(
    request: Request, session: AsyncSession = Depends(get_async_session)
) -> User:
    """
    Dependency that extracts a refresh token from cookies
    and returns the associated user.
    """
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="Refresh token missing")
    try:
        return await get_user_from_token(token, session, "refresh")
    except Exception as e:
        error_detail = "Invalid refresh token"
        if "expired" in str(e):
            error_detail = "Refresh token expired - please login again"
        elif "version" in str(e):
            error_detail = "Token version mismatch - session invalidated"
        elif "revoked" in str(e):
            error_detail = "Token revoked - please login again"
        raise HTTPException(
            status_code=401, detail=error_detail, headers={"WWW-Authenticate": "Bearer"}
        )


@router.post("/refresh", response_model=LoginResponse)
async def refresh_token(
    request: Request,
    response: Response,
    user: User = Depends(get_refresh_token_user),
    session: AsyncSession = Depends(get_async_session),
) -> LoginResponse:
    """
    Exchanges a valid refresh token for a new access token,
    rotating the user's token_version to invalidate old tokens.
    """
    username = user.username
    try:
        async with session.begin_nested():
            locked_user = await session.get(User, user.id, with_for_update=True)
            if not locked_user:
                raise HTTPException(
                    status_code=500,
                    detail="User lock failed during refresh",
                    headers={"WWW-Authenticate": "Bearer"},
                )

            # Update last activity for sliding session
            locked_user.last_login = datetime.utcnow()
            locked_user.last_activity = datetime.utcnow()

            # Always bump token version on refresh
            current_ts = int(datetime.utcnow().timestamp())
            locked_user.token_version = (
                locked_user.token_version + 1
                if locked_user.token_version
                else current_ts
            )

            token_id = str(uuid.uuid4())
            expire_at = datetime.utcnow() + timedelta(
                minutes=ACCESS_TOKEN_EXPIRE_MINUTES
            )
            payload = {
                "sub": username,
                "exp": expire_at,
                "iat": datetime.utcnow(),
                "jti": token_id,
                "type": "access",
                "version": locked_user.token_version,
                "user_id": locked_user.id,
            }
            new_token = create_access_token(payload)
            await session.commit()

            # Check if the refresh token is nearing expiration and renew if necessary
            refresh_token = request.cookies.get("refresh_token")
            if refresh_token:
                try:
                    decoded = await verify_token(refresh_token, "refresh", session)
                    if decoded and "exp" in decoded:
                        # Calculate time until expiration
                        expires_at = datetime.fromtimestamp(decoded["exp"])
                        time_remaining = expires_at - datetime.utcnow()
                        # Renew refresh token if it expires in less than 6 hours
                        if time_remaining < timedelta(hours=6):
                            new_refresh_token_id = str(uuid.uuid4())
                            new_refresh_expire = datetime.utcnow() + timedelta(
                                days=REFRESH_TOKEN_EXPIRE_DAYS
                            )
                            new_refresh_payload = {
                                "sub": username,
                                "exp": new_refresh_expire,
                                "iat": datetime.utcnow(),
                                "jti": new_refresh_token_id,
                                "type": "refresh",
                                "version": locked_user.token_version,
                                "user_id": locked_user.id,
                            }
                            new_refresh_token = create_access_token(new_refresh_payload)
                            set_secure_cookie(
                                response,
                                "refresh_token",
                                new_refresh_token,
                                max_age=60 * 60 * 24 * REFRESH_TOKEN_EXPIRE_DAYS,
                            )
                            # Invalidate the old refresh token
                            revoke_token_id(decoded["jti"])
                            blacklisted = TokenBlacklist(
                                jti=decoded["jti"],
                                expires=decoded["exp"],
                                user_id=user.id,
                            )
                            session.add(blacklisted)
                            await session.commit()
                except Exception as e:
                    logger.error("Error during refresh token renewal: %s", e)

        logger.info("Refreshed token for user '%s', token_id '%s'.", username, token_id)

        set_secure_cookie(
            response,
            "access_token",
            new_token,
            max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        )

        return LoginResponse(access_token=new_token, token_type="bearer")
    except Exception as e:
        logger.error("Error during token refresh: %s", e)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/token-info")
async def get_token_info(
    current_user: User = Depends(get_current_user_and_token),
) -> dict:
    """Returns token metadata including expiry time."""
    return {
        "authenticated": True,
        "username": current_user.username,
        "user_id": current_user.id,
        "expires_at": (
            datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        ).isoformat(),
        "version": current_user.token_version,
    }


@router.get("/verify")
async def verify_auth_status(
    current_user: User = Depends(get_current_user_and_token),
) -> dict:
    """Verifies valid authentication state."""
    return {
        "authenticated": True,
        "username": current_user.username,
        "user_id": current_user.id,
    }


@router.get("/ws-token")
async def get_websocket_token(
    current_user: User = Depends(get_current_user_and_token),
    session: AsyncSession = Depends(get_async_session),
) -> dict:
    """
    Generates a short-lived token specifically for WebSocket authentication.
    """
    token_id = str(uuid.uuid4())
    expire_at = datetime.utcnow() + timedelta(minutes=5)  # Short-lived token

    payload = {
        "sub": current_user.username,
        "exp": expire_at,
        "iat": datetime.utcnow(),
        "jti": token_id,
        "type": "ws",
        "version": current_user.token_version,
        "user_id": current_user.id,
    }

    ws_token = create_access_token(payload)

    return {
        "token": ws_token,
        "expires_at": expire_at.isoformat(),
        "version": current_user.token_version,
    }


@router.post("/logout")
async def logout_user(
    request: Request,
    response: Response,
    user: User = Depends(get_refresh_token_user),
    session: AsyncSession = Depends(get_async_session),
) -> dict:
    """
    Invalidates refresh token and increments token_version to invalidate
    *all* existing tokens. Clears auth cookies.
    """
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="Refresh token missing")

    decoded = await verify_token(token, "refresh", session)
    token_id = decoded.get("jti")
    if not token_id:
        raise HTTPException(status_code=401, detail="Invalid token format")
    expires = decoded.get("exp")

    # Add token to blacklist
    blacklisted_token = TokenBlacklist(jti=token_id, expires=expires, user_id=user.id)
    session.add(blacklisted_token)

    # Invalidate all user tokens
    try:
        async with session.begin_nested():
            current_timestamp = int(datetime.utcnow().timestamp())
            await session.execute(
                text(
                    "UPDATE users SET token_version = COALESCE(token_version, :ts) + 1 WHERE id = :uid"
                ),
                {"uid": user.id, "ts": current_timestamp},
            )
            await session.commit()
    except Exception as e:
        logger.error("Failed to update token version during logout: %s", e)
        raise HTTPException(status_code=500, detail="Failed to invalidate session")

    revoke_token_id(token_id)

    logger.info(
        "User %s logged out. Refresh token %s invalidated; token_version incremented.",
        user.username,
        token_id,
    )

    # Expire cookies
    set_secure_cookie(response, "access_token", "", max_age=0)
    set_secure_cookie(response, "refresh_token", "", max_age=0)

    return {"status": "logged out"}


def set_secure_cookie(
    response: Response, key: str, value: str, max_age: Optional[int] = None
):
    """
    Sets a secure HTTP-only cookie with explicit expiration to ensure persistence across browser sessions.
    
    Args:
        response: FastAPI response object
        key: Cookie name
        value: Cookie value
        max_age: Maximum age in seconds (None means the cookie persists until browser close)
    """
    # Calculate expires datetime if max_age is provided
    # Setting max_age alone is sufficient; FastAPI will handle the expires conversion
    response.set_cookie(
        key=key,
        value=value,
        httponly=True,
        secure=True,  # Only sent over HTTPS
        samesite="strict",  # No cross-site usage
        path="/",
        max_age=max_age,
    )
