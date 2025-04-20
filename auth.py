import asyncio
import logging
import os
import uuid
import bcrypt

from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional, Tuple, Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings  # Use settings directly from config
from db import get_async_session, get_async_session_context
from models.user import User, TokenBlacklist
from utils.auth_utils import (
    get_user_from_token,
    get_current_user_and_token,
    create_access_token,
    verify_token,
)
from utils.auth_utils import clean_expired_tokens  # If used for scheduled cleanup

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
REFRESH_TOKEN_EXPIRE_DAYS = getattr(settings, "REFRESH_TOKEN_EXPIRE_DAYS", 1)

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

        # Default to secure settings
        secure = True
        samesite: Literal["lax", "strict", "none"] = "lax"
        domain = self.cookie_domain

        # Adjust for local dev
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
            secure = False
            samesite = "none" if settings.DEBUG else "lax"
            domain = None
        elif self.cookie_domain:
            domain = self.cookie_domain
        elif hostname and "." in hostname and not is_local_dev:
            if hostname in settings.ALLOWED_HOSTS:
                domain = hostname
            else:
                domain = self.cookie_domain

        # Ensure SameSite=None is only used with Secure
        if samesite == "none" and not secure:
            logger.warning("SameSite=None requires Secure=True. Forcing Lax instead.")
            samesite = "lax"

        return {"secure": secure, "domain": domain, "samesite": samesite}


cookie_config_helper = CookieSettings(settings.ENV, settings.COOKIE_DOMAIN)

def set_secure_cookie(
    response: Response,
    key: str,
    value: str,
    max_age: Optional[int],
    request: Request
):
    """Sets a secure HttpOnly cookie with consistent environment-based config."""
    cookie_attrs = cookie_config_helper.get_attributes(request)
    secure = cookie_attrs["secure"]
    domain = cookie_attrs["domain"]
    samesite = cookie_attrs["samesite"]

    if AUTH_DEBUG:
        logger.debug(
            "Setting cookie [%s]: domain=%s, secure=%s, samesite=%s, max_age=%s, httpOnly=True",
            key, domain, secure, samesite, max_age
        )

    try:
        response.set_cookie(
            key=key,
            value=value,
            max_age=max_age if max_age else None,
            expires=max_age if max_age else None,
            path="/",
            domain=domain,
            secure=secure,
            httponly=True,
            samesite=samesite,
        )
    except Exception as e:
        logger.error("Failed to set cookie %s: %s", key, str(e))
        raise HTTPException(status_code=500, detail=f"Failed to set cookie: {key}")


# -----------------------------------------------------------------------------
# Simple In-Memory Rate Limiter
# -----------------------------------------------------------------------------
LOGIN_ATTEMPTS = {}
MAX_ATTEMPTS = 5
WINDOW_SECONDS = 300  # 5 minutes

async def rate_limit_login(request: Request, username: str):
    """
    In-memory rate limiter for login attempts.
    Skips if in DEBUG mode.
    """
    if settings.DEBUG:
        if AUTH_DEBUG:
            logger.debug("Skipping rate-limit in development (DEBUG).")
        return

    client_ip = request.client.host if request.client else "unknown"
    key = f"{client_ip}:{username}"
    now = datetime.now().timestamp()

    # Prune old attempts
    attempts = [ts for ts in LOGIN_ATTEMPTS.get(key, []) if now - ts < WINDOW_SECONDS]
    attempts.append(now)
    LOGIN_ATTEMPTS[key] = attempts

    if len(attempts) > MAX_ATTEMPTS:
        logger.warning("Rate limit exceeded for user '%s' from IP '%s'.", username, client_ip)
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Please wait before trying again."
        )


# -----------------------------------------------------------------------------
# Common Helpers
# -----------------------------------------------------------------------------
def naive_utc_now() -> datetime:
    """UTC now, naive datetime."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def build_jwt_payload(
    user: User,
    token_type: Literal["access", "refresh", "ws"],
    expires_delta: timedelta,
    jti: Optional[str] = None,
) -> dict[str, Any]:
    """
    Builds the JWT payload with required claims.
    """
    jti = jti or str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    return {
        "sub": user.username,
        "user_id": user.id,
        "type": token_type,
        "version": user.token_version or 0,
        "iat": now,
        "exp": now + expires_delta,
        "jti": jti,
    }


# -----------------------------------------------------------------------------
# Default Admin Creation
# -----------------------------------------------------------------------------
async def create_default_user():
    """
    Creates a default admin user if the database has no users.
    """
    try:
        logger.info("Checking for default user creation...")
        async with get_async_session_context() as session:
            result = await session.execute(select(User).limit(1))
            if not result.scalars().first():
                logger.info("No users found. Creating default admin user.")
                hashed_pw = bcrypt.hashpw(
                    DEFAULT_ADMIN["password"].encode("utf-8"),
                    bcrypt.gensalt()
                ).decode("utf-8")

                admin_user = User(
                    username=DEFAULT_ADMIN["username"].lower(),
                    password_hash=hashed_pw,
                    is_active=True,
                    role="admin",
                    token_version=0,
                )
                session.add(admin_user)
                await session.commit()

                logger.info("Default admin user '%s' created.", DEFAULT_ADMIN["username"])
                if settings.DEBUG:
                    logger.info(
                        "DEV LOGIN -> username=%s password=%s",
                        DEFAULT_ADMIN["username"],
                        DEFAULT_ADMIN["password"]
                    )
            else:
                logger.debug("Users exist, skipping default admin creation.")
    except Exception as e:
        logger.error("Failed to create default user: %s", str(e))


# -----------------------------------------------------------------------------
# Pydantic Models
# -----------------------------------------------------------------------------
class UserCredentials(BaseModel):
    username: str
    password: str

class TokenRequest(BaseModel):
    access_token: str
    refresh_token: str = ""

class LoginResponse(BaseModel):
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
    Enforces:
    - length >= 12
    - uppercase, lowercase, digit, special char
    """
    if len(password) < 12:
        raise ValueError("Password must be at least 12 characters.")
    special_chars = "!@#$%^&*()_+-=[]{}|;:,.<>?~"
    has_upper = has_lower = has_digit = has_special = False
    for c in password:
        if c.isupper():
            has_upper = True
        elif c.islower():
            has_lower = True
        elif c.isdigit():
            has_digit = True
        elif c in special_chars:
            has_special = True
        if has_upper and has_lower and has_digit and has_special:
            return

    if not has_upper:
        raise ValueError("Password must contain uppercase.")
    if not has_lower:
        raise ValueError("Password must contain lowercase.")
    if not has_digit:
        raise ValueError("Password must contain digits.")
    if not has_special:
        raise ValueError("Password must contain a special character.")


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
    Creates new user, enforces password policy, returns tokens in cookies.
    """
    lower_username = creds.username.strip().lower()
    if not lower_username:
        raise HTTPException(status_code=400, detail="Username cannot be empty.")

    try:
        validate_password(creds.password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    existing_user = (
        (await session.execute(select(User).where(User.username == lower_username)))
        .scalars()
        .first()
    )
    if existing_user:
        logger.warning("User registration attempt with taken username: %s", lower_username)
        raise HTTPException(status_code=400, detail="Username already taken.")

    hashed_pw = bcrypt.hashpw(creds.password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    new_user = User(
        username=lower_username,
        password_hash=hashed_pw,
        is_active=True,
        token_version=0,
        last_login=naive_utc_now(),
    )
    session.add(new_user)
    await session.flush()
    await session.refresh(new_user)

    # Token issuance
    access_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    refresh_expires = timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    access_payload = build_jwt_payload(new_user, "access", access_expires)
    access_token = create_access_token(access_payload)

    refresh_payload = build_jwt_payload(new_user, "refresh", refresh_expires)
    refresh_token = create_access_token(refresh_payload)

    set_secure_cookie(response, "access_token", access_token, int(access_expires.total_seconds()), request)
    set_secure_cookie(response, "refresh_token", refresh_token, int(refresh_expires.total_seconds()), request)

    logger.info("User registered and logged in: %s", lower_username)
    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        username=lower_username,
        token_version=new_user.token_version,
        message=f"User '{lower_username}' registered successfully"
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
    Authenticates user, issues tokens, sets them in cookies.
    Logs detailed reasons for failures to assist debugging.
    """
    await rate_limit_login(request, creds.username)
    lower_username = creds.username.strip().lower()

    async with session.begin():
        result = await session.execute(
            select(User).where(User.username == lower_username).with_for_update()
        )
        db_user = result.scalars().first()
        if not db_user:
            logger.warning("Login attempt for unknown user: %s", lower_username)
            raise HTTPException(status_code=401, detail="Invalid credentials.")
        if not db_user.is_active:
            logger.warning("Login attempt for disabled user: %s", lower_username)
            raise HTTPException(status_code=403, detail="Account disabled.")

        verify_start = datetime.now(timezone.utc)
        try:
            valid_password = await asyncio.get_event_loop().run_in_executor(
                None,
                bcrypt.checkpw,
                creds.password.encode("utf-8"),
                db_user.password_hash.encode("utf-8"),
            )
            verify_duration = (datetime.now(timezone.utc) - verify_start).total_seconds()
            logger.debug("Password check took %.3fs for %s", verify_duration, lower_username)
        except ValueError as exc:
            logger.error("Corrupted password hash for '%s': %s", lower_username, exc)
            raise HTTPException(status_code=400, detail="Corrupted password hash.") from exc

        if not valid_password:
            logger.warning("Invalid password for user: %s", lower_username)
            await asyncio.sleep(0.5)  # small delay to deter brute force
            raise HTTPException(status_code=401, detail="Invalid credentials.")

        # Update last login
        db_user.last_login = naive_utc_now()
        if db_user.token_version is None:
            db_user.token_version = 0
            logger.warning("User '%s' had NULL token_version, set to 0.", db_user.username)

    # Generate tokens
    access_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    refresh_expires = timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    access_payload = build_jwt_payload(db_user, "access", access_expires)
    access_token = create_access_token(access_payload)

    refresh_payload = build_jwt_payload(db_user, "refresh", refresh_expires)
    refresh_token = create_access_token(refresh_payload)

    try:
        set_secure_cookie(response, "access_token", access_token, int(access_expires.total_seconds()), request)
        set_secure_cookie(response, "refresh_token", refresh_token, int(refresh_expires.total_seconds()), request)
    except Exception as e:
        logger.error("Failed to set cookies for user '%s': %s", lower_username, e)
        return LoginResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            username=lower_username,
            token_version=db_user.token_version,
            message="Login success but cookie setting failed."
        )

    logger.info("User '%s' logged in and tokens set.", lower_username)
    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        username=lower_username,
        token_version=db_user.token_version,
        message="Login successful"
    )


# -----------------------------------------------------------------------------
# Refresh Endpoint
# -----------------------------------------------------------------------------
from typing import Annotated

# Define the dependency using Annotated
DBSessionDep = Annotated[AsyncSession, Depends(get_async_session)]

@router.post("/refresh", response_model=LoginResponse)
async def refresh_token(
    request: Request,
    response: Response,
    session: DBSessionDep
) -> LoginResponse:
    """
    Exchanges a valid refresh token for a new access token.
    Updates last_activity. Returns newly issued 'access_token' in cookie.
    """
    refresh_cookie = request.cookies.get("refresh_token")
    if not refresh_cookie:
        logger.debug("No refresh token cookie found during refresh.")
        # Clear any invalid tokens
        set_secure_cookie(response, "access_token", "", 0, request)
        set_secure_cookie(response, "refresh_token", "", 0, request)
        raise HTTPException(
            status_code=401,
            detail="Refresh token missing. Please login again."
        )

    # Get user using the same session to avoid multiple sessions
    user = await get_user_from_token(request, session, expected_type="refresh")
    logger.debug("Attempting token refresh for user: %s", user.username)

    try:
        # Verify token first before locking user
        try:
            decoded = await verify_token(refresh_cookie, "refresh", request)
        except HTTPException as e:
            logger.warning("Invalid refresh token: %s", e.detail)
            # Clear invalid tokens
            set_secure_cookie(response, "access_token", "", 0, request)
            set_secure_cookie(response, "refresh_token", "", 0, request)
            raise HTTPException(
                status_code=401,
                detail="Invalid refresh token. Please login again."
            )

        # Ensure we have a clean session state
        if session.in_transaction():
            await session.rollback()
        else:
            # Reset the session if it's dirty
            await session.flush()
            await session.rollback()

        # Begin new transaction with clear session state
        async with session.begin():
            locked_user = await session.get(User, user.id, with_for_update=True)
            if not locked_user:
                logger.error("User not found for refresh: %s", user.id)
                raise HTTPException(status_code=404, detail="User not found (refresh).")
            if not locked_user.is_active:
                logger.warning("Refresh attempt for disabled user: %s", locked_user.username)
                raise HTTPException(status_code=403, detail="Account disabled.")

            # Check token version
            if locked_user.token_version is None:
                locked_user.token_version = 0
                logger.warning("User '%s' had NULL token_version, set to 0 during refresh.", locked_user.username)
            elif decoded.get("version", 0) != locked_user.token_version:
                logger.warning("Token version mismatch for user '%s'", locked_user.username)
                raise HTTPException(
                    status_code=401,
                    detail="Token version mismatch. Please login again."
                )

            locked_user.last_activity = naive_utc_now()

            access_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
            access_payload = build_jwt_payload(locked_user, "access", access_expires)
            new_access_token = create_access_token(access_payload)

        # Set new access token cookie
        set_secure_cookie(response, "access_token", new_access_token, int(access_expires.total_seconds()), request)

        logger.info("Refreshed access token for user '%s'.", locked_user.username)
        return LoginResponse(
            access_token=new_access_token,
            username=locked_user.username,
            token_version=locked_user.token_version,
        )

    except HTTPException as e:
        # Clear invalid tokens
        if e.status_code in (401, 403):
            try:
                set_secure_cookie(response, "access_token", "", 0, request)
                set_secure_cookie(response, "refresh_token", "", 0, request)
            except Exception as clear_error:
                logger.error("Failed to clear cookies during error handling: %s", clear_error)
        raise
    except Exception as e:
        logger.error("Error during token refresh for user '%s': %s", user.username, e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Internal server error during token refresh."
        )


# -----------------------------------------------------------------------------
# Token Info / Verification
# -----------------------------------------------------------------------------
class VerifyResponse(BaseModel):
    authenticated: bool
    username: Optional[str] = None
    user_id: Optional[int] = None
    token_version: Optional[int] = None
@router.get("/verify", response_model=VerifyResponse)
async def verify_auth_status(
    request: Request,
    session: AsyncSession = Depends(get_async_session),
) -> VerifyResponse:
    """
    Verifies an access token, returning user info.
    Uses a single session from the request context.
    """
    # We'll retrieve (user, token) the same way get_current_user_and_token did,
    # but now passing the same session from the endpoint:
    user, token = await get_current_user_and_token(request)
    return VerifyResponse(
        authenticated=True,
        username=user.username,
        user_id=user.id,
        token_version=user.token_version,
    )


# -----------------------------------------------------------------------------
# Token Expiry
# -----------------------------------------------------------------------------
class TokenExpirySettings(BaseModel):
    access_token_expire_minutes: int
    refresh_token_expire_days: int

@router.get("/settings/token-expiry", response_model=TokenExpirySettings)
async def get_token_expiry_settings() -> TokenExpirySettings:
    """
    Expose current token expiry to front-end.
    """
    return TokenExpirySettings(
        access_token_expire_minutes=ACCESS_TOKEN_EXPIRE_MINUTES,
        refresh_token_expire_days=REFRESH_TOKEN_EXPIRE_DAYS,
    )


# -----------------------------------------------------------------------------
# Server Time / CSRF
# -----------------------------------------------------------------------------
@router.get("/timestamp", response_model=dict[str, float])
async def get_server_time() -> dict[str, float]:
    """
    Returns current UTC in epoch seconds.
    """
    return {"serverTimestamp": datetime.now(timezone.utc).timestamp()}

@router.get("/csrf", response_model=dict[str, str])
async def get_csrf_token(request: Request, response: Response):
    """
    Dummy CSRF token endpoint. Real CSRF protection would rely on middleware.
    """
    csrf_token = str(uuid.uuid4())
    if AUTH_DEBUG:
        logger.debug("Providing dummy CSRF token for dev/test.")
    return {"token": csrf_token}

@router.get("/apple-touch-icon.png", include_in_schema=False)
@router.get("/apple-touch-icon-precomposed.png", include_in_schema=False)
@router.get("/favicon.ico", include_in_schema=False)
async def ignore_common_requests():
    """Avoid excessive logs for common icon requests."""
    return Response(status_code=204)


# -----------------------------------------------------------------------------
# Legacy set-cookies Endpoint (Optional / Dev Only)
# -----------------------------------------------------------------------------
@router.post("/set-cookies", include_in_schema=False)
async def set_cookies_endpoint(
    request: Request,
    response: Response,
    token_req: TokenRequest
):
    """
    Not recommended for production. Manually sets non-HttpOnly cookies for testing.
    """
    logger.warning("Manual cookie set from %s, not recommended for production.", request.client.host if request.client else "unknown")
    access_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    refresh_expires = timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    try:
        response.set_cookie(
            "access_token",
            token_req.access_token,
            max_age=int(access_expires.total_seconds()),
            path="/",
            domain=cookie_config_helper.get_attributes(request)["domain"],
            secure=cookie_config_helper.get_attributes(request)["secure"],
            httponly=False,
            samesite=cookie_config_helper.get_attributes(request)["samesite"],
        )
        logger.warning("Set non-HttpOnly access_token.")
        if token_req.refresh_token:
            response.set_cookie(
                "refresh_token",
                token_req.refresh_token,
                max_age=int(refresh_expires.total_seconds()),
                path="/",
                domain=cookie_config_helper.get_attributes(request)["domain"],
                secure=cookie_config_helper.get_attributes(request)["secure"],
                httponly=False,
                samesite=cookie_config_helper.get_attributes(request)["samesite"],
            )
            logger.warning("Set non-HttpOnly refresh_token.")
    except Exception as e:
        logger.error("Cookie set endpoint error: %s", e)
        return {"status": "error", "message": str(e)}
    return {"status": "non-HttpOnly cookies set"}


# -----------------------------------------------------------------------------
# Logout
# -----------------------------------------------------------------------------
@router.post("/logout", response_model=dict[str, str])
async def logout_user(
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_async_session),
) -> dict[str, str]:
    """
    Invalidates session by incrementing token_version, blacklists refresh, clears cookies.
    Ensures a single session usage per request.
    """
    # Pull user using the single session from this request,
    # specifying 'refresh' if you want them to hold a valid refresh token.
    current_user = await get_user_from_token(request, session, expected_type="refresh")

    refresh_cookie = request.cookies.get("refresh_token")
    if not refresh_cookie:
        logger.warning("Logout attempt without refresh token cookie")
        # Still proceed with cookie clearing
        try:
            set_secure_cookie(response, "access_token", "", 0, request)
            set_secure_cookie(response, "refresh_token", "", 0, request)
        except Exception as e:
            logger.error("Failed to clear cookies during logout: %s", e)
        return {"status": "logged out"}

    token_id = None
    expires_timestamp = None
    try:
        decoded = await verify_token(refresh_cookie, "refresh", request)
        token_id = decoded.get("jti")
        expires_timestamp = decoded.get("exp")
    except HTTPException as e:
        logger.warning("Logout with invalid refresh token: %s", e.detail)
    except Exception as e:
        logger.error("Unexpected error verifying refresh token during logout: %s", e, exc_info=True)

    try:
        async with session.begin():
            locked_user = await session.get(User, current_user.id, with_for_update=True)
            if not locked_user:
                logger.error("User not found during logout lock: %s", current_user.id)
            else:
                old_version = locked_user.token_version or 0
                locked_user.token_version = old_version + 1
                logger.info(
                    "User '%s' token_version from %d to %d on logout",
                    locked_user.username,
                    old_version,
                    locked_user.token_version
                )

                # Blacklist the refresh token if possible
                if token_id and expires_timestamp:
                    try:
                        exp_datetime = datetime.fromtimestamp(float(expires_timestamp), tz=timezone.utc)
                        blacklisted = TokenBlacklist(
                            jti=token_id,
                            expires=exp_datetime.replace(tzinfo=None),
                            user_id=locked_user.id,
                            token_type="refresh",
                            creation_reason="logout"
                        )
                        session.add(blacklisted)
                        logger.debug("Blacklisted refresh token %s on logout", token_id)
                    except Exception as e:
                        logger.error("Failed to blacklist token %s: %s", token_id, e)
    except Exception as e:
        logger.error("Error during logout transaction: %s", e)
        # Continue with cookie clearing even if other operations fail

    # Always clear cookies even if other operations fail
    try:
        set_secure_cookie(response, "access_token", "", 0, request)
        set_secure_cookie(response, "refresh_token", "", 0, request)
    except Exception as e:
        logger.error("Failed to clear cookies during logout: %s", e)

    logger.info("User logged out successfully.")
    return {"status": "logged out"}
