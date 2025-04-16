"""
auth.py
-------
Remediated authentication module with refined token/session mechanisms,
reduced duplication, environment-based default admin, and a simple rate-limiter.
"""

import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import bcrypt
from config import settings
from db import get_async_session, get_async_session_context
from models.user import User, TokenBlacklist
from utils.auth_utils import (
    clean_expired_tokens,
    get_user_from_token,
    get_current_user_and_token,
    create_access_token,
    verify_token,
)

logger = logging.getLogger(__name__)

# -----------------------------------------------------------------------------
# Global/Environment Settings
# -----------------------------------------------------------------------------
AUTH_DEBUG = os.getenv("AUTH_DEBUG", "True").lower() == "true"

DEFAULT_ADMIN = {
    "username": os.getenv("DEFAULT_ADMIN_USERNAME", "admin"),
    "password": os.getenv("DEFAULT_ADMIN_PASSWORD", "Admin123!@#dev"),
}

ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 30))
REFRESH_TOKEN_EXPIRE_DAYS = 1  # Reduced from 7 to 1 day for better security

router = APIRouter()


# -----------------------------------------------------------------------------
# Cookie Settings
# -----------------------------------------------------------------------------
class CookieSettings:
    """
    Centralized cookie configuration based on environment and domain.
    Adjust fields as needed for production vs. local testing.
    """

    def __init__(self, env: str, cookie_domain: str | None):
        self.env = env
        self.cookie_domain = cookie_domain

    @property
    def secure(self) -> bool:
        # Use secure cookies only in production (HTTPS)
        # For development, we might need non-secure cookies to work with HTTP
        return self.env == "production"

    def domain(self, hostname: str | None) -> str | None:
        # More comprehensive check for local environments
        if (
            not hostname
            or hostname in {"localhost", "127.0.0.1"}
            or hostname.startswith("192.168.")
            or hostname.startswith("10.")
        ):
            return None

        # For custom domain environments like Azure, we may need to be more flexible
        if "." not in hostname:
            return None

        return self.cookie_domain

    def same_site(
        self, hostname: str | None, key: str
    ) -> Literal["lax", "strict", "none"] | None:
        # For access and refresh tokens, allow 'none' in development for more flexible testing
        if self.env != "production" and key in ["access_token", "refresh_token"]:
            return "none" if not self.secure else "lax"

        # Default to 'lax' for production which balances security and usability
        # Use 'none' in development for easier testing across domains
        if settings.DEBUG and key in ["access_token", "refresh_token"]:
            return "none"
        return "lax"  # Default to lax for production


cookie_settings = CookieSettings(settings.ENV, settings.COOKIE_DOMAIN)

# -----------------------------------------------------------------------------
# Simple In-Memory Rate Limiter for Demonstration
# -----------------------------------------------------------------------------
LOGIN_ATTEMPTS = {}
MAX_ATTEMPTS = 5
WINDOW_SECONDS = 300  # 5 minutes


async def rate_limit_login(request: Request, username: str):
    """
    Simple in-memory rate limiter for login.
    - Key: (client IP + username)
    - Clears stale attempts outside the 5-minute window.
    """
    client_ip = request.client.host if request.client else "unknown"
    key = f"{client_ip}:{username}"
    now = datetime.now().timestamp()

    # Remove old attempts
    attempts = [ts for ts in LOGIN_ATTEMPTS.get(key, []) if now - ts < WINDOW_SECONDS]
    attempts.append(now)
    LOGIN_ATTEMPTS[key] = attempts

    if len(attempts) > MAX_ATTEMPTS:
        logger.warning(
            f"Rate limit exceeded for user '{username}' from IP '{client_ip}'."
        )
        raise HTTPException(
            status_code=429, detail="Too many login attempts. Please wait."
        )


# -----------------------------------------------------------------------------
# Common Helpers
# -----------------------------------------------------------------------------
def naive_utc_now() -> datetime:
    """Return the current time in UTC without tzinfo (naive)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def build_jwt_payload(
    user: User,
    token_type: Literal["access", "refresh", "ws"],
    expires_delta: timedelta,
    jti: str | None = None,
) -> dict[str, Any]:
    """
    Creates a standard JWT payload with consistent fields.
    """
    jti = jti or str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    return {
        "sub": user.username,
        "user_id": user.id,
        "type": token_type,
        "version": user.token_version,  # Might be None for newly registered users
        "iat": now,
        "exp": now + expires_delta,
        "jti": jti,
    }


def set_secure_cookie(
    response: Response, key: str, value: str, max_age: int, request: Request
):
    """
    Sets a secure HTTP-only cookie based on environment.
    Single method to avoid duplication of cookie logic.
    """
    hostname = request.url.hostname or ""
    domain = None
    secure = cookie_settings.secure
    samesite = cookie_settings.same_site(hostname, key)

    # If SameSite=None is chosen, the cookie must be Secure, or modern browsers will reject it.
    if samesite == "none":
        secure = True

    # In development or testing environments, we typically don't use HTTPS,
    # but if SameSite=None is set, we override secure to True above to avoid rejection.
    if settings.ENV != "production" and samesite != "none":
        secure = False

    if AUTH_DEBUG:
        logger.debug(
            f"Set cookie [{key}] -> domain={domain}, secure={secure}, samesite={samesite}, max_age={max_age}, hostname={hostname}"
        )

    try:
        response.set_cookie(
            key=key,
            value=value,
            max_age=max_age,
            path="/",
            domain=domain,
            secure=secure,
            httponly=True,
            samesite=samesite,
        )

        # For development environments, try setting a fallback cookie without domain
        if settings.ENV != "production" and domain:
            response.set_cookie(
                key=f"{key}_fallback",
                value=value,
                max_age=max_age,
                path="/",
                domain=None,
                secure=secure,
                httponly=True,
                samesite=samesite,
            )
    except Exception as e:
        logger.error(f"Error setting cookie {key}: {str(e)}")


# -----------------------------------------------------------------------------
# Default Admin Creation
# -----------------------------------------------------------------------------
async def create_default_user():
    """Create a default admin user if no users exist, using env-based credentials."""
    try:
        logger.info("Checking for default user creation...")
        async with get_async_session_context() as session:
            result = await session.execute(select(User).limit(1))
            if result.scalars().first() is None:
                logger.info("No users found. Creating default admin user.")

                hashed_pw = bcrypt.hashpw(
                    DEFAULT_ADMIN["password"].encode("utf-8"), bcrypt.gensalt()
                ).decode("utf-8")

                admin_user = User(
                    username=DEFAULT_ADMIN["username"].lower(),
                    password_hash=hashed_pw,
                    is_active=True,
                    role="admin",
                )
                session.add(admin_user)
                await session.commit()

                logger.info(
                    f"Default admin user '{DEFAULT_ADMIN['username']}' created."
                )
                logger.info(
                    f"DEV LOGIN -> username={DEFAULT_ADMIN['username']}, "
                    f"password={DEFAULT_ADMIN['password']}"
                )
            else:
                logger.debug("Users already exist, skipping default admin creation.")
    except Exception as e:
        logger.error(f"Failed to create default user: {str(e)}")


# -----------------------------------------------------------------------------
# Models
# -----------------------------------------------------------------------------
class UserCredentials(BaseModel):
    """Authentication credentials (username and password)."""

    username: str
    password: str


class TokenRequest(BaseModel):
    """Request model for manually setting cookies."""

    access_token: str
    refresh_token: str = ""


class LoginResponse(BaseModel):
    """Response model for login endpoint with optional fields for fallback cases."""

    access_token: str
    token_type: str
    refresh_token: str | None = None
    message: str | None = None


# -----------------------------------------------------------------------------
# Password Validation
# -----------------------------------------------------------------------------
def validate_password(password: str):
    """
    Validates password meets security requirements:
    - At least 12 chars
    - Contains upper, lower, digit, special char
    """
    if len(password) < 12:
        raise ValueError("Password must be at least 12 characters.")

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
        raise ValueError("Password must contain uppercase letters.")
    if not has_lower:
        raise ValueError("Password must contain lowercase letters.")
    if not has_digit:
        raise ValueError("Password must contain numbers.")
    if not has_special:
        raise ValueError("Password must contain at least one special character.")


# -----------------------------------------------------------------------------
# Registration Endpoint
# -----------------------------------------------------------------------------
@router.post("/register", response_model=dict)
async def register_user(
    creds: UserCredentials, session: AsyncSession = Depends(get_async_session)
) -> dict[str, str]:
    """
    Registers a new user with hashed password and password policy enforcement.
    """
    lower_username = creds.username.lower()
    validate_password(creds.password)

    existing_user = (
        (await session.execute(select(User).where(User.username == lower_username)))
        .scalars()
        .first()
    )
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already taken.")

    hashed_pw = bcrypt.hashpw(creds.password.encode("utf-8"), bcrypt.gensalt()).decode(
        "utf-8"
    )

    user = User(username=lower_username, password_hash=hashed_pw, is_active=True)
    session.add(user)
    await session.commit()
    await session.refresh(user)

    user.last_login = naive_utc_now()
    session.add(user)
    await session.commit()

    logger.info("User registered successfully: %s", lower_username)
    return {"message": f"User '{lower_username}' registered successfully."}


# -----------------------------------------------------------------------------
# Login Endpoint
# -----------------------------------------------------------------------------
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
    await rate_limit_login(request, creds.username)

    lower_username = creds.username.lower()
    
    # Move all database operations into a single transaction block
    async with session.begin():
        # Get user with row lock to prevent concurrent updates
        result = await session.execute(
            select(User)
            .where(User.username == lower_username)
            .with_for_update()
        )
        user = result.scalars().first()
        
        if not user:
            logger.warning("Login attempt for non-existent user: %s", lower_username)
            raise HTTPException(status_code=401, detail="Invalid credentials.")

        if not user.is_active:
            logger.warning("Login attempt for disabled account: %s", lower_username)
            raise HTTPException(
                status_code=403, detail="Account disabled. Contact support."
            )

        # Password verification with timing and better error handling
        verify_start = datetime.now(timezone.utc)
        try:
            valid_password = await asyncio.get_event_loop().run_in_executor(
                None,
                bcrypt.checkpw,
                creds.password.encode("utf-8"),
                user.password_hash.encode("utf-8"),
            )
            verify_duration = (datetime.now(timezone.utc) - verify_start).total_seconds()
            logger.debug(
                f"Password verification took {verify_duration:.3f}s for user {lower_username}"
            )
        except ValueError as exc:
            logger.error("Corrupted password hash for user '%s': %s", lower_username, exc)
            raise HTTPException(
                status_code=400, detail="Corrupted password hash. Please reset account."
            ) from exc

        if not valid_password:
            logger.warning("Failed login for user: %s", lower_username)
            # Add small delay to prevent timing attacks
            await asyncio.sleep(0.5)
            raise HTTPException(status_code=401, detail="Invalid credentials.")

        # Update user last login
        user.last_login = naive_utc_now()

    # Generate access token
    access_payload = build_jwt_payload(
        locked_user,
        token_type="access",
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    access_token = create_access_token(access_payload)

    # Generate refresh token
    refresh_payload = build_jwt_payload(
        locked_user,
        token_type="refresh",
        expires_delta=timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )
    refresh_token = create_access_token(refresh_payload)

    # Clean up expired tokens (optional background process)
    await clean_expired_tokens(session)

    # Set cookies with type-safe settings
    try:
        # Use the unified set_secure_cookie method for consistency
        set_secure_cookie(
            response,
            "access_token",
            access_token,
            ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            request,
        )
        set_secure_cookie(
            response,
            "refresh_token",
            refresh_token,
            60 * 60 * 24 * REFRESH_TOKEN_EXPIRE_DAYS,
            request,
        )

        logger.debug(f"Cookies set via set_secure_cookie for {lower_username}")
    except Exception as e:
        logger.error(f"Failed to set cookies for {lower_username}: {str(e)}")
        # Fallback to returning tokens in response body while maintaining LoginResponse type
        return LoginResponse(
            access_token=access_token,
            token_type="bearer",
            refresh_token=refresh_token,
            message="Login successful but cookies could not be set",
        )

    logger.info("User '%s' logged in. Access & refresh tokens issued.", lower_username)
    return LoginResponse(
        access_token=access_token, token_type="bearer", refresh_token=refresh_token
    )


# -----------------------------------------------------------------------------
# Token Refresh Mechanism
# -----------------------------------------------------------------------------
async def get_refresh_token_user(
    request: Request, session: AsyncSession = Depends(get_async_session)
) -> User:
    """
    Dependency to extract refresh token from cookies and return the associated user.
    """
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="Refresh token missing.")

    try:
        return await get_user_from_token(token, session, "refresh")
    except Exception as e:
        error_detail = "Invalid refresh token."
        if "expired" in str(e):
            error_detail = "Refresh token expired - please login again."
        elif "version" in str(e):
            error_detail = "Token version mismatch - session invalidated."
        elif "revoked" in str(e):
            error_detail = "Token revoked - please login again."

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
    optionally rotating the refresh token if nearing expiration.
    """
    refresh_token_cookie = request.cookies.get("refresh_token")
    if not refresh_token_cookie:
        raise HTTPException(status_code=401, detail="No refresh token cookie found.")

    try:
        async with session.begin():
            locked_user = await session.get(User, user.id, with_for_update=True)
            if not locked_user:
                raise HTTPException(status_code=500, detail="User lock failed.")

            locked_user.last_login = naive_utc_now()
            locked_user.last_activity = naive_utc_now()

        # Create new access token
        access_payload = build_jwt_payload(
            locked_user,
            token_type="access",
            expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        )
        new_access_token = create_access_token(access_payload)

        # Check if refresh token is close to expiring
        decoded = await verify_token(refresh_token_cookie, "refresh", request)
        expires_at = datetime.fromtimestamp(decoded["exp"], tz=timezone.utc)
        time_remaining = expires_at - datetime.now(timezone.utc)

        if time_remaining < timedelta(hours=6):
            # If we haven't updated token_version recently, do so
            current_ts = int(datetime.now(timezone.utc).timestamp())
            old_version = locked_user.token_version
            if not old_version or (current_ts - old_version) > 300:
                locked_user.token_version = current_ts
                logger.info(
                    f"User '{locked_user.username}' token_version updated from "
                    f"{old_version} to {locked_user.token_version}"
                )

            # Issue a new refresh token
                new_refresh_payload = build_jwt_payload(
                    locked_user,
                    token_type="refresh",
                    expires_delta=timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
                )
                new_refresh_token = create_access_token(new_refresh_payload)

                # Replace refresh cookie
                set_secure_cookie(
                    response,
                    "refresh_token",
                    new_refresh_token,
                    max_age=60 * 60 * 24 * REFRESH_TOKEN_EXPIRE_DAYS,
                    request=request,
                )

                # Blacklist the old refresh token
                # Convert timestamp to naive datetime
                exp_datetime = datetime.fromtimestamp(decoded["exp"], tz=timezone.utc)
                exp_naive = exp_datetime.replace(tzinfo=None)

                blacklisted = TokenBlacklist(
                    jti=decoded["jti"],
                    expires=exp_naive,
                    user_id=locked_user.id,
                    token_type="refresh",
                    creation_reason="refresh_rotation",
                )
                session.add(blacklisted)
                await session.commit()

        set_secure_cookie(
            response,
            "access_token",
            new_access_token,
            max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            request=request,
        )
        logger.info("Refreshed token for user '%s'.", locked_user.username)

        return LoginResponse(access_token=new_access_token, token_type="bearer")

    except Exception as e:
        logger.error("Error during token refresh: %s", e)
        raise HTTPException(status_code=500, detail="Internal server error.")


# -----------------------------------------------------------------------------
# Token Info & Verification
# -----------------------------------------------------------------------------
@router.get("/token-info")
async def get_token_info(
    current_user: User = Depends(get_current_user_and_token),
) -> dict[str, Any]:
    """Returns token metadata, e.g., expiry time."""
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


# WebSocket token endpoint removed - using HTTP only


# -----------------------------------------------------------------------------
# Testing Utilities
# -----------------------------------------------------------------------------
@router.get("/debug/auth-log", response_model=dict)
async def get_auth_debug_info():
    """Returns the current authentication debug info. Not exposed in production."""
    if settings.ENV == "production":
        raise HTTPException(status_code=404)
    return {
        "auth_debug_enabled": AUTH_DEBUG,
        "refresh_token_expire_days": REFRESH_TOKEN_EXPIRE_DAYS,
        "access_token_expire_minutes": ACCESS_TOKEN_EXPIRE_MINUTES,
        "cookie_domain": settings.COOKIE_DOMAIN,
        "environment": settings.ENV,
    }


@router.get("/api/auth/settings/token-expiry", response_model=dict)
async def get_token_expiry_settings() -> dict[str, int]:
    """Exposes token expiration settings to the frontend."""
    return {
        "access_token_expire_minutes": ACCESS_TOKEN_EXPIRE_MINUTES,
        "refresh_token_expire_days": REFRESH_TOKEN_EXPIRE_DAYS,
    }


@router.get("/test-cookie")
async def test_cookie(request: Request, response: Response) -> dict[str, str]:
    """Sets a test cookie for debugging cookie behavior."""
    set_secure_cookie(response, "test_cookie", "works", max_age=30, request=request)
    return {"status": "cookie set"}


@router.get("/timestamp")
async def get_server_time() -> dict[str, float]:
    """Returns the current server timestamp (UTC)."""
    return {"serverTimestamp": datetime.now(timezone.utc).timestamp()}


@router.get("/apple-touch-icon.png")
@router.get("/apple-touch-icon-precomposed.png")
async def ignore_apple_touch_icon():
    """Prevent 404s from iOS icon requests"""
    return Response(status_code=204)


# -----------------------------------------------------------------------------
# Set Cookies Endpoint
# -----------------------------------------------------------------------------
@router.post("/set-cookies")
async def set_cookies_endpoint(
    request: Request, response: Response, token_req: TokenRequest
):
    """
    Manually sets authentication tokens in secure cookies.
    Used by frontend when automatic cookie setting fails.
    """
    logger.info(
        f"Manual cookie set request from: {request.client.host if request.client else 'unknown'}, hostname: {request.url.hostname}"
    )

    # Try both approaches - standard secure cookies and fallback non-secure cookies
    try:
        # Standard secure cookie setting
        set_secure_cookie(
            response,
            "access_token",
            token_req.access_token,
            max_age=60 * ACCESS_TOKEN_EXPIRE_MINUTES,
            request=request,
        )

        if token_req.refresh_token:
            set_secure_cookie(
                response,
                "refresh_token",
                token_req.refresh_token,
                max_age=60 * 60 * 24 * REFRESH_TOKEN_EXPIRE_DAYS,
                request=request,
            )

        # Also set a third-party cookie flag to help client detect support
        response.set_cookie(
            key="cookie_support_check",
            value="1",
            max_age=300,
            path="/",
            httponly=False,
        )
    except Exception as e:
        logger.error(f"Error in manual cookie setting: {str(e)}")
        return {"status": "error", "message": str(e)}

    return {"status": "cookies set successfully"}


# -----------------------------------------------------------------------------
# Logout
# -----------------------------------------------------------------------------
@router.post("/logout")
async def logout_user(
    request: Request,
    response: Response,
    user: User = Depends(get_refresh_token_user),
    session: AsyncSession = Depends(get_async_session),
) -> dict[str, str]:
    """
    Invalidates the refresh token and increments token_version
    to invalidate *all* existing tokens. Clears auth cookies.
    """
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="Refresh token missing.")

    decoded = await verify_token(token, "refresh", request)
    token_id = decoded.get("jti")
    if not token_id:
        raise HTTPException(status_code=401, detail="Invalid token format.")
    expires_timestamp = decoded.get("exp")
    if expires_timestamp is not None:
        expires_datetime = datetime.fromtimestamp(
            float(expires_timestamp), tz=timezone.utc
        )
    else:
        expires_datetime = datetime.now(timezone.utc) + timedelta(days=1)

    # Blacklist the token - convert to naive datetime if necessary
    if expires_datetime.tzinfo is not None:
        # Convert timezone-aware datetime to naive datetime in UTC
        expires_naive = expires_datetime.replace(tzinfo=None)
    else:
        expires_naive = expires_datetime

    blacklisted_token = TokenBlacklist(
        jti=token_id,
        expires=expires_naive,
        user_id=user.id,
        token_type="refresh",
        creation_reason="logout",
    )
    session.add(blacklisted_token)

    # Token version increment
    async with session.begin_nested():
        locked_user = await session.get(User, user.id, with_for_update=True)
        if locked_user:
            current_ts = int(datetime.now(timezone.utc).timestamp())
            old_version = locked_user.token_version
            locked_user.token_version = current_ts
            logger.info(
                f"User '{locked_user.username}' token_version updated from {old_version} to {current_ts} on logout."
            )

    # Clear cookies
    set_secure_cookie(response, "access_token", "", 0, request)
    set_secure_cookie(response, "refresh_token", "", 0, request)

    logger.info(
        "User '%s' logged out. Refresh token %s invalidated; token_version incremented.",
        user.username,
        token_id,
    )
    return {"status": "logged out"}
