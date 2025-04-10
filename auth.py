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
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
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

@router.get("/settings/token-expiry", response_model=dict)
async def get_token_expiry_settings() -> dict[str,int]:
    """
    Expose token expiration settings to the frontend.
    """
    return {
        "access_token_expire_minutes": ACCESS_TOKEN_EXPIRE_MINUTES,
        "refresh_token_expire_days": REFRESH_TOKEN_EXPIRE_DAYS,
    }

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
) -> dict[str, str]:
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

    # Convert UTC timezone-aware datetime to naive datetime for DB compatibility
    now_utc = datetime.now(timezone.utc)
    naive_now = now_utc.replace(tzinfo=None)  # Remove timezone info
    
    user.last_login = naive_now
    session.add(user)
    await session.commit()

    logger.info("User registered successfully: %s", lower_username)
    return {"message": f"User '{lower_username}' registered successfully"}


@router.post("/login", response_model=LoginResponse)
async def login_user(
    request: Request,
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

        # Use current time without timezone information for DB compatibility
        # Get current UTC time with timezone info
        now_utc = datetime.now(timezone.utc)
        locked_user.last_login = datetime.utcnow()
        # Update token version using current timestamp only if >5 min since last change
        current_ts = int(now_utc.timestamp())
        old_version = locked_user.token_version
        if not old_version or (current_ts - old_version) > 300:  # 5 minute window
            locked_user.token_version = current_ts
        logger.info(
            f"User '{lower_username}' token_version updated from {old_version} to {locked_user.token_version}"
        )

        await session.commit()

        # Generate tokens after successful commit
        token_id = str(uuid.uuid4())
        expire_at = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        access_payload = {
            "sub": locked_user.username,
            "exp": expire_at,
            "iat": datetime.now(timezone.utc),
            "jti": token_id,
            "type": "access",
            "version": locked_user.token_version,
            "user_id": locked_user.id,
        }
        access_token = create_access_token(access_payload)

        refresh_token_id = str(uuid.uuid4())
        refresh_expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
        refresh_payload = {
            "sub": locked_user.username,
            "exp": refresh_expire,
            "iat": datetime.now(timezone.utc),
            "jti": refresh_token_id,
            "type": "refresh",
            "version": locked_user.token_version,
            "user_id": locked_user.id,
        }
        refresh_token = create_access_token(refresh_payload)

    # Clean up expired tokens in background
    await clean_expired_tokens(session)

    # Set secure cookies for both tokens
    set_secure_cookie(
        response, "access_token", access_token, 
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        request=request
    )
    set_secure_cookie(
        response,
        "refresh_token",
        refresh_token,
        max_age=60 * 60 * 24 * REFRESH_TOKEN_EXPIRE_DAYS,
        request=request
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
    # Log detailed token version info at start of refresh
    try:
        refresh_token = request.cookies.get("refresh_token")
        if refresh_token:
            decoded = await verify_token(refresh_token, "refresh", request)
            logger.info(
                f"Token refresh requested for user '{user.username}', "
                f"refresh token version: {decoded.get('version')}, "
                f"current DB token version: {user.token_version}"
            )
    except Exception as e:
        logger.warning(f"Error logging refresh token details: {e}")
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
            # Convert UTC timezone-aware datetime to naive datetime for DB compatibility
            now_utc = datetime.now(timezone.utc)
            naive_now = now_utc.replace(tzinfo=None)  # Remove timezone info
            
            locked_user.last_login = naive_now
            locked_user.last_activity = naive_now

            token_id = str(uuid.uuid4())
            expire_at = datetime.now(timezone.utc) + timedelta(
                minutes=ACCESS_TOKEN_EXPIRE_MINUTES
            )
            payload = {
                "sub": username,
                "exp": expire_at,
                "iat": datetime.now(timezone.utc),
                "jti": token_id,
                "type": "access",
                "version": locked_user.token_version,  # Use existing version
                "user_id": locked_user.id,
            }
            new_token = create_access_token(payload)
            await session.commit()

            # Check if the refresh token is nearing expiration and renew if necessary
            refresh_token = request.cookies.get("refresh_token")
            if refresh_token:
                try:
                    decoded = await verify_token(refresh_token, "refresh", request)
                    if decoded and "exp" in decoded:
                        # Calculate time until expiration
                        expires_at = datetime.fromtimestamp(decoded["exp"])
                        time_remaining = expires_at - datetime.now(timezone.utc)
                        # Renew refresh token if it expires in less than 6 hours
                        if time_remaining < timedelta(hours=6):
                            new_refresh_token_id = str(uuid.uuid4())
                            new_refresh_expire = datetime.now(timezone.utc) + timedelta(
                                days=REFRESH_TOKEN_EXPIRE_DAYS
                            )
                            
                            # Determine time since last login
                            time_since_login = None
                            if locked_user.last_login:
                                time_since_login = datetime.now(timezone.utc) - locked_user.last_login
                                
                            # Only increment version if more than 5 minutes have passed since last version change
                            current_ts = int(datetime.now(timezone.utc).timestamp())
                            old_version = locked_user.token_version
                            if not old_version or (current_ts - old_version) > 300:  # 5 minute window
                                locked_user.token_version = current_ts
                            logger.info(
                                f"User '{username}' token_version updated from {old_version} to {locked_user.token_version}"
                            )
                            await session.flush()
                            await session.commit()  # Ensure new version is saved

                            new_refresh_payload = {
                                "sub": username,
                                "exp": new_refresh_expire,
                                "iat": datetime.now(timezone.utc),
                                "jti": new_refresh_token_id,
                                "type": "refresh",
                                "version": locked_user.token_version,  # Use new version
                                "user_id": locked_user.id,
                            }
                            new_refresh_token = create_access_token(new_refresh_payload)
                            set_secure_cookie(
                                response,
                                "refresh_token",
                                new_refresh_token,
                                max_age=60 * 60 * 24 * REFRESH_TOKEN_EXPIRE_DAYS,
                                request=request
                            )
                            # Invalidate the old refresh token
                            revoke_token_id(decoded["jti"])
                            blacklisted = TokenBlacklist(
                                jti=decoded["jti"],
                                expires=decoded["exp"],
                                user_id=user.id,
                                token_type="refresh",
                                creation_reason="refresh_rotation"
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
            request=request
        )

        return LoginResponse(access_token=new_token, token_type="bearer")
    except Exception as e:
        logger.error("Error during token refresh: %s", e)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/token-info")
async def get_token_info(
    current_user: User = Depends(get_current_user_and_token),
) -> dict[str, Any]:
    """Returns token metadata including expiry time."""
    return {
        "authenticated": True,
        "username": current_user.username,
        "user_id": current_user.id,
        "expires_at": (
            datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        ).isoformat(),
        "version": current_user.token_version,
    }


@router.get("/verify")
async def verify_auth_status(
    current_user: User = Depends(get_current_user_and_token),
) -> dict[str, Any]:
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
) -> dict[str, Any]:
    """
    Generates a short-lived token specifically for WebSocket authentication.
    """
    token_id = str(uuid.uuid4())
    expire_at = datetime.now(timezone.utc) + timedelta(minutes=5)  # Short-lived token

    payload = {
        "sub": current_user.username,
        "exp": expire_at,
        "iat": datetime.now(timezone.utc),
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


@router.get("/test-cookie")
async def test_cookie(request: Request, response: Response) -> dict[str, str]:
    set_secure_cookie(response, "test_cookie", "works", max_age=30, request=request)
    return {"status": "cookie set"}

@router.get("/timestamp")
async def get_server_time() -> dict[str, float]:
    return {"serverTimestamp": datetime.now(timezone.utc).timestamp()}

@router.post("/logout")
async def logout_user(
    request: Request,
    response: Response,
    user: User = Depends(get_refresh_token_user),
    session: AsyncSession = Depends(get_async_session),
) -> dict[str, str]:
    """
    Invalidates refresh token and increments token_version to invalidate
    *all* existing tokens. Clears auth cookies.
    """
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="Refresh token missing")

    decoded = await verify_token(token, "refresh", request)
    token_id = decoded.get("jti")
    if not token_id:
        raise HTTPException(status_code=401, detail="Invalid token format")
    expires = decoded.get("exp")

    # Add token to blacklist
    blacklisted_token = TokenBlacklist(
        jti=token_id, 
        expires=expires, 
        user_id=user.id,
        token_type="refresh",
        creation_reason="logout"
    )
    session.add(blacklisted_token)

    # Invalidate all user tokens
    try:
        async with session.begin_nested():
            current_ts = int(datetime.now(timezone.utc).timestamp())
            locked_user = await session.get(User, user.id, with_for_update=True)
            if locked_user:
                locked_user.token_version = current_ts
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
    set_secure_cookie(response, "access_token", "", max_age=0, request=request)
    set_secure_cookie(response, "refresh_token", "", max_age=0, request=request)

    return {"status": "logged out"}


def set_secure_cookie(
    response: Response, key: str, value: str, max_age: int | None = None,
    request: Request | None = None
):
    """
    Sets a secure HTTP-only cookie with explicit expiration to ensure persistence across browser sessions.
    
    Args:
        response: FastAPI response object
        key: Cookie name
        value: Cookie value
        max_age: Maximum age in seconds (None means the cookie persists until browser close)
        request: Optional request object to get host from headers
    """
    cookie_kwargs = {
        "key": key,
        "value": value,
        "httponly": True,
        "secure": (False if request and request.url.hostname in ["localhost","127.0.0.1"] else settings.ENV == "production"),
        "samesite": "lax",  # Use lax for better cross-site compatibility
        "path": "/",        # Always set path to root to ensure cookies work across all pages
        "max_age": max_age if max_age is not None else 60 * 60 * 24 * 30,  # Default 30 days if not specified
    }

    # IMPORTANT: Do NOT set domain for typical single-domain applications
    # Setting domain can cause issues with cookie persistence during navigation
    # Only set domain for subdomain/cross-domain scenarios, and only when required

    # Convert and validate cookie parameters with strict typing
    key = str(cookie_kwargs["key"])
    value = str(cookie_kwargs["value"])
    httponly = True if cookie_kwargs.get("httponly", True) else False
    secure = True if cookie_kwargs.get("secure", settings.ENV == "production") else False
    
    # Handle samesite with type casting
    samesite_val = cookie_kwargs.get("samesite", "lax")
    samesite: Literal['lax', 'strict', 'none'] = cast(
        Literal['lax', 'strict', 'none'],
        samesite_val.lower() if isinstance(samesite_val, str) and samesite_val.lower() in ['lax', 'strict', 'none']
        else 'lax'
    )
    
    # Handle path and max_age with proper types
    path = str(cookie_kwargs["path"]) if cookie_kwargs.get("path") else None
    
    # Handle max_age with explicit None check and safe conversion
    max_age = None
    if "max_age" in cookie_kwargs and cookie_kwargs["max_age"] is not None:
        try:
            max_age = int(cookie_kwargs["max_age"])
        except (ValueError, TypeError):
            max_age = None
    
    # Handle domain with whitelist approach
    domain = None
    allowed_domains = ["put.photo", settings.COOKIE_DOMAIN]
    if settings.COOKIE_DOMAIN and settings.ENV == "production":
        domain = settings.COOKIE_DOMAIN
    elif request and request.headers.get("host"):
        host = request.headers.get("host").split(":")[0]
        if host in allowed_domains:
            domain = host
    
    # Call set_cookie with validated parameters
    response.set_cookie(
        key=key,
        value=value,
        max_age=max_age,
        path=path,
        domain=domain,
        secure=secure,
        httponly=httponly,
        samesite=samesite
    )
