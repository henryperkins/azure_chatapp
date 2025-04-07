"""
auth.py
-------
Handles user login and registration using JWT-based authentication,
secure password hashing (bcrypt), session expiry logic, and token versioning.
"""

import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import OAuth2PasswordBearer
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
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 30))
REFRESH_TOKEN_EXPIRE_DAYS = 7


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

        # Early exit if all criteria met
        if has_upper and has_lower and has_digit and has_special:
            return

    # Determine which requirement failed
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
    Authenticates user, returns both access and refresh tokens.
    Sets both tokens in secure cookies with appropriate expiration.
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

    # Check password validity using bcrypt in a thread pool
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

    # Start transaction to safely update user & token version
    async with session.begin_nested():
        locked_user = await session.get(User, user.id, with_for_update=True)
        if not locked_user:
            raise HTTPException(status_code=500, detail="User lock failed")

        locked_user.last_login = datetime.utcnow()
        # Increment token_version or initialize it
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
        "User '%s' logged in successfully. Token IDs: %s (access), %s (refresh)",
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
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid refresh token")


@router.post("/refresh", response_model=LoginResponse)
async def refresh_token(
    response: Response,
    user: User = Depends(get_refresh_token_user),
    session: AsyncSession = Depends(get_async_session),
) -> LoginResponse:
    """
    Exchanges a valid refresh token for a new access token,
    rotating the user's token_version to invalidate old tokens.
    """
    username = user.username

    async with session.begin_nested():
        locked_user = await session.get(User, user.id, with_for_update=True)
        if not locked_user:
            raise HTTPException(
                status_code=500, detail="User lock failed during refresh"
            )

        locked_user.last_login = datetime.utcnow()
        # Increment token_version
        current_ts = int(datetime.utcnow().timestamp())
        locked_user.token_version = (
            locked_user.token_version + 1 if locked_user.token_version else current_ts
        )

        token_id = str(uuid.uuid4())
        expire_at = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
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

    logger.info("Refreshed token for user '%s' with token_id '%s'.", username, token_id)

    set_secure_cookie(
        response, "access_token", new_token, max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60
    )

    return LoginResponse(access_token=new_token, token_type="bearer")


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

    # Verify token and extract jti
    decoded = await verify_token(token, "refresh", session)
    token_id = decoded.get("jti")
    if not token_id:
        raise HTTPException(status_code=401, detail="Invalid token format")
    expires = decoded.get("exp")

    # Add token to blacklist
    blacklisted_token = TokenBlacklist(jti=token_id, expires=expires, user_id=user.id)
    session.add(blacklisted_token)

    # Invalidate all user tokens by incrementing token_version
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

    # Revoke the refresh token from in-memory map
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


def set_secure_cookie(response: Response, key: str, value: str, max_age: Optional[int] = None):
    # In development mode:
    # - We can't use SameSite="None" without Secure=True (browser restriction)
    # - But we may be on HTTP not HTTPS in development
    # Solution: Use SameSite="Lax" for all environments
    secure_cookie = settings.ENV == "production"
    samesite_mode = "lax"  # Using "lax" for all environments is more compatible
    
    # Handle localhost domain special case - omit domain for localhost
    cookie_domain = None if settings.COOKIE_DOMAIN == "localhost" else settings.COOKIE_DOMAIN
    
    response.set_cookie(
        key=key,
        value=value,
        httponly=True,
        secure=secure_cookie,
        samesite=samesite_mode,
        path="/",
        domain=cookie_domain,
        max_age=max_age
    )
