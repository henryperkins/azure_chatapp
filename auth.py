"""
auth.py
-------
Remediated authentication module with refined token/session mechanisms,
reduced duplication, environment-based default admin, and a simple rate-limiter.
Corrected cookie settings for development environment.
"""

import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import bcrypt
from config import settings  # Use settings directly from config
from db import get_async_session, get_async_session_context
from models.user import User, TokenBlacklist
from utils.auth_utils import (
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

# Use expiration times directly from settings if available, else use defaults
ACCESS_TOKEN_EXPIRE_MINUTES = getattr(settings, "ACCESS_TOKEN_EXPIRE_MINUTES", 30)
REFRESH_TOKEN_EXPIRE_DAYS = getattr(
    settings, "REFRESH_TOKEN_EXPIRE_DAYS", 1
)  # Defaulting to 1 day

router = APIRouter()


# -----------------------------------------------------------------------------
# Cookie Settings
# -----------------------------------------------------------------------------
class CookieSettings:
    """
    Centralized cookie configuration based on environment and domain.
    Adjusts secure and samesite flags for production vs. local testing.
    """

    def __init__(self, env: str, cookie_domain: Optional[str]):
        self.env = env
        self.cookie_domain = cookie_domain

    def get_attributes(self, request: Request) -> dict[str, Any]:
        """
        Determines cookie attributes based on request and environment.
        Returns a dictionary with 'secure', 'domain', 'samesite'.
        """
        hostname = request.url.hostname
        scheme = request.url.scheme

        # Default to secure settings (for production)
        secure = True
        samesite: Literal["lax", "strict", "none"] = "lax"  # Default to lax
        domain = self.cookie_domain  # Use configured domain by default

        # --- Adjust for Development/HTTP ---
        is_local_dev = (
            self.env != "production"
            and scheme == "http"
            and (
                not hostname
                or hostname in {"localhost", "127.0.0.1"}
                or hostname.startswith("192.168.")
                or hostname.startswith("10.")
            )
        )

        if is_local_dev:
            secure = False  # Cannot use Secure flag over HTTP
            samesite = "lax"  # Lax is suitable and required for non-secure
            domain = None  # Don't set domain for localhost

        # If explicitly configured domain, use it (unless local dev override)
        elif self.cookie_domain:
            domain = self.cookie_domain
        # Heuristic for other domains (e.g., Azure deployment names)
        elif hostname and "." in hostname and not is_local_dev:
            if hostname in settings.ALLOWED_HOSTS:
                domain = hostname
            else:
                domain = self.cookie_domain

        # Final check: SameSite=None REQUIRES Secure=True
        if samesite == "none" and not secure:
            logger.warning("SameSite=None requires Secure=True. Forcing SameSite=Lax.")
            samesite = "lax"

        return {"secure": secure, "domain": domain, "samesite": samesite}


cookie_config_helper = CookieSettings(settings.ENV, settings.COOKIE_DOMAIN)

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
    # Development check - skip rate limiting if DEBUG is True
    if settings.DEBUG:
        if AUTH_DEBUG:
            logger.debug("Skipping rate limit check in development mode.")
        return

    client_ip = request.client.host if request.client else "unknown"
    key = f"{client_ip}:{username}"
    now = datetime.now().timestamp()

    # Remove old attempts
    attempts = [ts for ts in LOGIN_ATTEMPTS.get(key, []) if now - ts < WINDOW_SECONDS]
    attempts.append(now)
    LOGIN_ATTEMPTS[key] = attempts

    if len(attempts) > MAX_ATTEMPTS:
        logger.warning(
            "Rate limit exceeded for user '%s' from IP '%s'.", username, client_ip
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
    jti: Optional[str] = None,
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
        "version": user.token_version or 0,  # Ensure version is present
        "iat": now,
        "exp": now + expires_delta,
        "jti": jti,
    }


def set_secure_cookie(
    response: Response, key: str, value: str, max_age: Optional[int], request: Request
):
    """
    Sets a secure HTTP-only cookie based on environment.
    Uses CookieSettings helper to determine attributes.
    """
    cookie_attrs = cookie_config_helper.get_attributes(request)
    secure = cookie_attrs["secure"]
    domain = cookie_attrs["domain"]
    samesite = cookie_attrs["samesite"]

    if AUTH_DEBUG:
        logger.debug(
            "Setting cookie [%s] -> domain=%s, secure=%s, samesite=%s, max_age=%s, httponly=True",
            key,
            domain,
            secure,
            samesite,
            max_age,
        )

    try:
        response.set_cookie(
            key=key,
            value=value,
            max_age=max_age,  # Can be None for session cookies
            expires=max_age if max_age is not None and max_age > 0 else None,
            path="/",
            domain=domain,
            secure=secure,
            httponly=True,
            samesite=samesite,
        )
    except Exception as e:
        logger.error("Error setting cookie %s: %s", key, str(e))
        raise HTTPException(status_code=500, detail=f"Failed to set cookie: {key}")


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
                    token_version=0,  # Initialize token version
                )
                session.add(admin_user)
                await session.commit()

                logger.info(
                    "Default admin user '%s' created.", DEFAULT_ADMIN["username"]
                )
                # Avoid logging password in production logs, even if default
                if settings.DEBUG:
                    logger.info(
                        "DEV LOGIN -> username=%s, password=%s",
                        DEFAULT_ADMIN["username"],
                        DEFAULT_ADMIN["password"],
                    )
            else:
                logger.debug("Users already exist, skipping default admin creation.")
    except Exception as e:
        logger.error("Failed to create default user: %s", str(e))


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
    token_type: str = "bearer"
    refresh_token: Optional[str] = None
    username: Optional[str] = None
    message: Optional[str] = None
    token_version: Optional[int] = None


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
@router.post("/register", response_model=LoginResponse)
async def register_user(
    request: Request,
    response: Response,
    creds: UserCredentials,
    session: AsyncSession = Depends(get_async_session),
) -> LoginResponse:
    """
    Registers a new user with hashed password and password policy enforcement.
    Returns access and refresh tokens for immediate login.
    """
    lower_username = creds.username.strip().lower()
    if not lower_username:
        raise HTTPException(status_code=400, detail="Username cannot be empty.")

    try:
        validate_password(creds.password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    async with session.begin():
        existing_user = (
            (await session.execute(select(User).where(User.username == lower_username)))
            .scalars()
            .first()
        )
        if existing_user:
            raise HTTPException(status_code=400, detail="Username already taken.")

        hashed_pw = bcrypt.hashpw(
            creds.password.encode("utf-8"), bcrypt.gensalt()
        ).decode("utf-8")

        user = User(
            username=lower_username,
            password_hash=hashed_pw,
            is_active=True,
            token_version=0,  # Initialize token version
            last_login=naive_utc_now(),  # Set initial last_login
        )
        session.add(user)
        await session.flush()
        await session.refresh(user)

    # Generate tokens like a login flow and set cookies
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    refresh_token_expires = timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    access_payload = build_jwt_payload(user, "access", access_token_expires)
    access_token = create_access_token(access_payload)

    refresh_payload = build_jwt_payload(user, "refresh", refresh_token_expires)
    refresh_token = create_access_token(refresh_payload)

    set_secure_cookie(
        response,
        "access_token",
        access_token,
        int(access_token_expires.total_seconds()),
        request,
    )
    set_secure_cookie(
        response,
        "refresh_token",
        refresh_token,
        int(refresh_token_expires.total_seconds()),
        request,
    )

    logger.info("User registered and logged in: %s", lower_username)
    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        username=lower_username,
        token_version=user.token_version,
        message=f"User '{lower_username}' registered successfully",
    )


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
    # Rate limit check (bypassed in DEBUG)
    await rate_limit_login(request, creds.username)
    lower_username = creds.username.strip().lower()

    async with session.begin():
        result = await session.execute(
            select(User).where(User.username == lower_username).with_for_update()
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

        verify_start = datetime.now(timezone.utc)
        try:
            valid_password = await asyncio.get_event_loop().run_in_executor(
                None,
                bcrypt.checkpw,
                creds.password.encode("utf-8"),
                user.password_hash.encode("utf-8"),
            )
            verify_duration = (
                datetime.now(timezone.utc) - verify_start
            ).total_seconds()
            logger.debug(
                "Password verification took %.3fs for user %s",
                verify_duration,
                lower_username,
            )
        except ValueError as exc:
            logger.error(
                "Corrupted password hash for user '%s': %s", lower_username, exc
            )
            raise HTTPException(
                status_code=400, detail="Corrupted password hash. Please reset account."
            ) from exc

        if not valid_password:
            logger.warning("Failed login for user: %s", lower_username)
            await asyncio.sleep(0.5)  # Small delay
            raise HTTPException(status_code=401, detail="Invalid credentials.")

        # Update last login
        user.last_login = naive_utc_now()
        if user.token_version is None:
            user.token_version = 0
            logger.warning(
                "User '%s' had NULL token_version, setting to 0.", user.username
            )

    # Generate tokens
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    refresh_token_expires = timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    access_payload = build_jwt_payload(user, "access", access_token_expires)
    access_token = create_access_token(access_payload)

    refresh_payload = build_jwt_payload(user, "refresh", refresh_token_expires)
    refresh_token = create_access_token(refresh_payload)

    try:
        set_secure_cookie(
            response,
            "access_token",
            access_token,
            int(access_token_expires.total_seconds()),
            request,
        )
        set_secure_cookie(
            response,
            "refresh_token",
            refresh_token,
            int(refresh_token_expires.total_seconds()),
            request,
        )
        logger.debug("Cookies set for user %s.", lower_username)
    except Exception as e:
        logger.error("Failed to set cookies for %s: %s", lower_username, str(e))
        # Fallback: return tokens in body
        return LoginResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            username=lower_username,
            token_version=user.token_version,
            message="Login successful but cookie setting failed server-side.",
        )

    logger.info("User '%s' logged in. Access & refresh tokens issued.", lower_username)
    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        username=lower_username,
        token_version=user.token_version,
        message="Login successful",
    )


# -----------------------------------------------------------------------------
# Token Refresh Mechanism
# -----------------------------------------------------------------------------
async def get_refresh_token_user(
    request: Request, session: AsyncSession = Depends(get_async_session)
) -> User:
    """
    Dependency to extract refresh token from cookies and return the associated user.
    Raises HTTPException if invalid.
    """
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(
            status_code=401,
            detail="Refresh token missing.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        # Expect 'refresh' type specifically
        return await get_user_from_token(token, session, "refresh")
    except HTTPException as e:
        error_detail = "Invalid or expired refresh token."
        if "expired" in str(e.detail).lower():
            error_detail = "Refresh token expired - please login again."
        elif "version mismatch" in str(e.detail).lower():
            error_detail = (
                "Session invalidated (version mismatch) - please login again."
            )
        elif "revoked" in str(e.detail).lower():
            error_detail = "Token revoked - please login again."
        elif "type mismatch" in str(e.detail).lower():
            error_detail = "Invalid token type used for refresh."
        raise HTTPException(
            status_code=e.status_code,
            detail=error_detail,
            headers={"WWW-Authenticate": "Bearer"},
        ) from e
    except Exception as e:
        logger.error(
            "Unexpected error getting user from refresh token: %s", e, exc_info=True
        )
        raise HTTPException(
            status_code=500,
            detail="Error validating refresh token.",
            headers={"WWW-Authenticate": "Bearer"},
        )


@router.post("/refresh", response_model=LoginResponse)
async def refresh_token(
    request: Request,
    response: Response,
    user: User = Depends(get_refresh_token_user),
    session: AsyncSession = Depends(get_async_session),
) -> LoginResponse:
    """
    Exchanges a valid refresh token for a new access token.
    Does NOT rotate refresh token by default (simplifies logic with short expiry).
    Updates last_activity timestamp.
    """
    refresh_token_cookie = request.cookies.get("refresh_token")  # Already validated
    if not refresh_token_cookie:
        raise HTTPException(
            status_code=401, detail="Refresh token cookie inconsistency."
        )

    new_access_token = ""
    try:
        async with session.begin():
            locked_user = await session.get(User, user.id, with_for_update=True)
            if not locked_user:
                raise HTTPException(
                    status_code=404, detail="User not found during refresh lock."
                )
            if not locked_user.is_active:
                raise HTTPException(
                    status_code=403, detail="Account disabled during refresh."
                )

            if locked_user.token_version is None:
                locked_user.token_version = 0
                logger.warning(
                    "User '%s' had NULL token_version during refresh, setting to 0.",
                    locked_user.username,
                )

            # Update last_activity
            locked_user.last_activity = naive_utc_now()

            # Create new access token
            access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
            access_payload = build_jwt_payload(
                locked_user, "access", access_token_expires
            )
            new_access_token = create_access_token(access_payload)

        # Set new access token cookie
        set_secure_cookie(
            response,
            "access_token",
            new_access_token,
            int(access_token_expires.total_seconds()),
            request,
        )

        logger.info("Refreshed access token for user '%s'.", locked_user.username)
        return LoginResponse(
            access_token=new_access_token,
            username=locked_user.username,
            token_version=locked_user.token_version,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Error during token refresh for user '%s': %s",
            user.username,
            e,
            exc_info=True,
        )
        raise HTTPException(
            status_code=500, detail="Internal server error during token refresh."
        )


# -----------------------------------------------------------------------------
# Token Info & Verification
# -----------------------------------------------------------------------------
class VerifyResponse(BaseModel):
    authenticated: bool
    username: Optional[str] = None
    user_id: Optional[int] = None
    token_version: Optional[int] = None


@router.get("/verify", response_model=VerifyResponse)
async def verify_auth_status(
    current_user_and_token: tuple[User, str] = Depends(get_current_user_and_token),
) -> VerifyResponse:
    """
    Verifies valid authentication state using an access token.
    """
    user, _ = current_user_and_token
    return VerifyResponse(
        authenticated=True,
        username=user.username,
        user_id=user.id,
        token_version=user.token_version,
    )


# -----------------------------------------------------------------------------
# Testing Utilities (Conditional Compilation for Security)
# -----------------------------------------------------------------------------
if settings.DEBUG:

    @router.get("/debug/auth-log", response_model=dict, include_in_schema=False)
    async def get_auth_debug_info(request: Request):
        """Returns the current authentication debug info. Development only."""
        attrs = cookie_config_helper.get_attributes(request)
        return {
            "auth_debug_enabled": AUTH_DEBUG,
            "refresh_token_expire_days": REFRESH_TOKEN_EXPIRE_DAYS,
            "access_token_expire_minutes": ACCESS_TOKEN_EXPIRE_MINUTES,
            "cookie_domain_config": settings.COOKIE_DOMAIN,
            "environment": settings.ENV,
            "request_hostname": request.url.hostname,
            "request_scheme": request.url.scheme,
            "calculated_cookie_domain": attrs.get("domain"),
            "calculated_cookie_secure": attrs.get("secure"),
            "calculated_cookie_samesite": attrs.get("samesite"),
        }

    @router.get("/test-cookie", include_in_schema=False)
    async def test_cookie(request: Request, response: Response) -> dict[str, str]:
        """Sets a test cookie for debugging cookie behavior. Development only."""
        set_secure_cookie(
            response, key="test_dev_cookie", value="works", max_age=60, request=request
        )
        return {"status": "test_dev_cookie set"}


# -----------------------------------------------------------------------------
# Token Expiry Settings Endpoint (Always available)
# -----------------------------------------------------------------------------
class TokenExpirySettings(BaseModel):
    access_token_expire_minutes: int
    refresh_token_expire_days: int


@router.get("/settings/token-expiry", response_model=TokenExpirySettings)
async def get_token_expiry_settings() -> TokenExpirySettings:
    """Exposes token expiration settings to the frontend."""
    return TokenExpirySettings(
        access_token_expire_minutes=ACCESS_TOKEN_EXPIRE_MINUTES,
        refresh_token_expire_days=REFRESH_TOKEN_EXPIRE_DAYS,
    )


# -----------------------------------------------------------------------------
# Server Time & CSRF Endpoints (Always available)
# -----------------------------------------------------------------------------
@router.get("/timestamp", response_model=dict[str, float])
async def get_server_time() -> dict[str, float]:
    """Returns the current server timestamp (UTC seconds since epoch)."""
    return {"serverTimestamp": datetime.now(timezone.utc).timestamp()}


@router.get("/csrf", response_model=dict[str, str])
async def get_csrf_token(request: Request, response: Response):
    """
    Returns a dummy CSRF token.
    Actual CSRF protection should be handled by middleware if needed.
    This endpoint helps satisfy frontend expectations but provides minimal security itself.
    """
    csrf_token = str(uuid.uuid4())
    if AUTH_DEBUG:
        logger.debug("Providing dummy CSRF token for frontend.")
    return {"token": csrf_token}


# Ignore common browser/device requests to prevent 404s in logs
@router.get("/apple-touch-icon.png", include_in_schema=False)
@router.get("/apple-touch-icon-precomposed.png", include_in_schema=False)
@router.get("/favicon.ico", include_in_schema=False)
async def ignore_common_requests():
    """Prevent 404s from common browser icon/metadata requests."""
    return Response(status_code=204)


# -----------------------------------------------------------------------------
# Set Cookies Endpoint (Potentially Deprecated if backend sets cookies reliably)
# -----------------------------------------------------------------------------
@router.post("/set-cookies", include_in_schema=False)
async def set_cookies_endpoint(
    request: Request, response: Response, token_req: TokenRequest
):
    """
    Manually sets authentication tokens in cookies.
    SECURITY RISK: Should ideally not be used if backend `Set-Cookie` works.
    This bypasses HttpOnly if called from JS trying to set auth tokens.
    Kept for possible fallback scenarios but use with extreme caution.
    """
    logger.warning(
        "Manual cookie set request received from: %s. "
        "This endpoint bypasses HttpOnly protection and is a potential security risk.",
        request.client.host if request.client else "unknown",
    )

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    refresh_token_expires = timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    cookie_attrs = cookie_config_helper.get_attributes(request)

    try:
        response.set_cookie(
            key="access_token",
            value=token_req.access_token,
            max_age=int(access_token_expires.total_seconds()),
            path="/",
            domain=cookie_attrs["domain"],
            secure=cookie_attrs["secure"],
            httponly=False,  # Cannot be HttpOnly if set via JS request body
            samesite=cookie_attrs["samesite"],
        )
        logger.warning("Set non-HttpOnly access_token via /set-cookies endpoint.")

        if token_req.refresh_token:
            response.set_cookie(
                key="refresh_token",
                value=token_req.refresh_token,
                max_age=int(refresh_token_expires.total_seconds()),
                path="/",
                domain=cookie_attrs["domain"],
                secure=cookie_attrs["secure"],
                httponly=False,  # Cannot be HttpOnly either
                samesite=cookie_attrs["samesite"],
            )
            logger.warning("Set non-HttpOnly refresh_token via /set-cookies endpoint.")

    except Exception as e:
        logger.error("Error in manual cookie setting via endpoint: %s", str(e))
        return {"status": "error", "message": str(e)}

    return {"status": "non-HttpOnly cookies attempted to be set"}


# -----------------------------------------------------------------------------
# Logout
# -----------------------------------------------------------------------------
@router.post("/logout", response_model=dict[str, str])
async def logout_user(
    request: Request,
    response: Response,
    user: User = Depends(
        get_refresh_token_user
    ),  # Uses refresh token for logout validation
    session: AsyncSession = Depends(get_async_session),
) -> dict[str, str]:
    """
    Invalidates the current session by incrementing token_version.
    Clears authentication cookies.
    Optionally blacklists the specific refresh token used.
    """
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="Refresh token missing for logout.")

    try:
        # Verify the token again to get jti + expiry for blacklisting
        decoded = await verify_token(token, "refresh", request)
        token_id = decoded.get("jti")
        expires_timestamp = decoded.get("exp")
    except HTTPException as e:
        logger.warning(
            "Logout attempt with invalid/expired refresh token (cleanup anyway): %s",
            e.detail,
        )
        token_id = None
        expires_timestamp = None
    except Exception as e:
        logger.error(
            "Unexpected error verifying token during logout: %s", str(e), exc_info=True
        )
        token_id = None
        expires_timestamp = None

    async with session.begin():
        locked_user = await session.get(User, user.id, with_for_update=True)
        if not locked_user:
            logger.error("User %s not found during logout lock.", user.id)
            raise HTTPException(status_code=404, detail="User not found during logout.")

        old_version = locked_user.token_version or 0
        locked_user.token_version = old_version + 1
        logger.info(
            "User '%s' token_version incremented from %d to %d on logout.",
            locked_user.username,
            old_version,
            locked_user.token_version,
        )

        # Optionally blacklist this refresh token
        if token_id and expires_timestamp:
            try:
                exp_datetime = datetime.fromtimestamp(
                    float(expires_timestamp), tz=timezone.utc
                )
                exp_naive = exp_datetime.replace(tzinfo=None)

                blacklisted_token = TokenBlacklist(
                    jti=token_id,
                    expires=exp_naive,
                    user_id=locked_user.id,
                    token_type="refresh",
                    creation_reason="logout",
                )
                session.add(blacklisted_token)
                logger.debug("Blacklisted refresh token %s on logout.", token_id)
            except Exception as bl_err:
                logger.error(
                    "Failed to blacklist token %s during logout: %s", token_id, bl_err
                )

    # Clear cookies by setting max_age=0
    set_secure_cookie(response, "access_token", "", 0, request)
    set_secure_cookie(response, "refresh_token", "", 0, request)

    logger.info("User '%s' logged out successfully.", user.username)
    return {"status": "logged out"}
