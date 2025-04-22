import asyncio
import logging
import os
import uuid
import bcrypt

from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional, Annotated

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

# from utils.auth_utils import clean_expired_tokens  # If used for scheduled cleanup

logger = logging.getLogger(__name__)

# -----------------------------------------------------------------------------
# WARNING / DISCLAIMER:
# THIS FILE IS INSECURE BY DESIGN FOR LOCAL DEBUGGING / TROUBLESHOOTING ONLY!
# DO NOT USE THIS CONFIGURATION IN PRODUCTION!
# -----------------------------------------------------------------------------

AUTH_DEBUG = True  # Force debug mode or set from env if you like

DEFAULT_ADMIN = {
    "username": os.getenv("DEFAULT_ADMIN_USERNAME", "hperkins"),
    "password": os.getenv("DEFAULT_ADMIN_PASSWORD", "Twiohmld1234!"),
}

# For simplicity, let's set these with "relaxed" or bigger expiry times
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 1 day
REFRESH_TOKEN_EXPIRE_DAYS = 30  # 1 month

router = APIRouter()


# -----------------------------------------------------------------------------
# Centralized Cookie Settings
# -----------------------------------------------------------------------------
class CookieSettings:
    env: str
    cookie_domain: str

    def __init__(self, env: str, cookie_domain: str) -> None:
        self.env = env
        self.cookie_domain = cookie_domain

    def get_attributes(self, request: Request) -> dict[str, Any]:
        hostname = request.url.hostname
        scheme = request.url.scheme

        # Local dev environment
        if hostname in ["localhost", "127.0.0.1"] or self.env == "development":
            return {
                "secure": False,  # Must be False for HTTP
                "domain": None,   # No domain for localhost
                "samesite": None, # Less restrictive for local dev
                "httponly": True,
                "path": "/"
            }

        # Production settings
        return {
            "secure": scheme == "https",
            "domain": self.cookie_domain,
            "samesite": "lax",
            "httponly": True,
            "path": "/"
        }


cookie_config_helper = CookieSettings(settings.ENV, settings.COOKIE_DOMAIN)


def set_secure_cookie(
    response: Response,
    key: str,
    value: str,
    max_age: Optional[int],
    request: Request,
):
    """
    A single helper function to set (or clear) cookies with consistent attributes.
    """
    cookie_attrs = cookie_config_helper.get_attributes(request)

    try:
        # If value is empty, remove the cookie
        if value == "":
            response.delete_cookie(
                key=key,
                path=cookie_attrs["path"],
                domain=cookie_attrs["domain"]
            )
            return

        logger.debug(f"set_secure_cookie -> key={key}, value={value}, attributes={cookie_attrs}")
        if AUTH_DEBUG:
            print(f"Setting cookie {key} with attributes:", cookie_attrs)

        response.set_cookie(
            key=key,
            value=value,
            httponly=cookie_attrs["httponly"],
            secure=cookie_attrs["secure"],
            samesite=cookie_attrs["samesite"],
            domain=cookie_attrs["domain"],
            path=cookie_attrs["path"],
            max_age=max_age if value else 0
        )
    except Exception as e:
        logger.error("Failed to set cookie %s: %s", key, str(e))
        raise HTTPException(status_code=500, detail=f"Cookie error: {str(e)}")


# -----------------------------------------------------------------------------
# Simple In-Memory Rate Limiter (Optional)
# -----------------------------------------------------------------------------
LOGIN_ATTEMPTS = {}
MAX_ATTEMPTS = 5
WINDOW_SECONDS = 300  # 5 minutes


async def rate_limit_login(request: Request, username: str):
    """
    Insecure mode: you can *bypass* rate limiting by returning early if you want to.
    """
    # return  # Uncomment to disable rate limiting entirely

    client_ip = request.client.host if request.client else "unknown"
    key = f"{client_ip}:{username}"
    now = datetime.now().timestamp()

    attempts = [ts for ts in LOGIN_ATTEMPTS.get(key, []) if now - ts < WINDOW_SECONDS]
    attempts.append(now)
    LOGIN_ATTEMPTS[key] = attempts

    if len(attempts) > MAX_ATTEMPTS:
        logger.warning(
            "Rate limit exceeded for user '%s' from IP '%s'.", username, client_ip
        )
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Please wait before trying again.",
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
    Builds a JWT payload with key fields.
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
    Creates a default admin user if the database has no users (DEV ONLY).
    """
    try:
        logger.info("Checking for default user creation (Insecure debug mode)...")
        async with get_async_session_context() as session:
            result = await session.execute(select(User).limit(1))
            if not result.scalars().first():
                logger.info("No users found. Creating default admin user.")
                hashed_pw = bcrypt.hashpw(
                    DEFAULT_ADMIN["password"].encode("utf-8"), bcrypt.gensalt()
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

                logger.info(
                    "Default admin user '%s' created (INSECURE DEBUG).",
                    DEFAULT_ADMIN["username"],
                )
                if AUTH_DEBUG:
                    logger.info(
                        "DEV LOGIN -> username=%s password=%s",
                        DEFAULT_ADMIN["username"],
                        DEFAULT_ADMIN["password"],
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
# Password Validation (Relaxed)
# -----------------------------------------------------------------------------
def validate_password(password: str):
    """
    Basic password policy for demonstration.
    Matches the frontend validation in base.html.
    """
    if len(password) < 12:
        raise ValueError("Password must be at least 12 characters long.")
    if not any(c.isupper() for c in password):
        raise ValueError("Password must contain an uppercase letter.")
    if not any(c.islower() for c in password):
        raise ValueError("Password must contain a lowercase letter.")
    if not any(c.isdigit() for c in password):
        raise ValueError("Password must contain a number.")
    if not any(c in "!@#$%^&*()_+-=[]{}|;:'\",.<>/?\\`~" for c in password):
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
        logger.warning("Registration attempt for existing username: %s", lower_username)
        raise HTTPException(status_code=400, detail="Username already taken.")

    hashed_pw = bcrypt.hashpw(creds.password.encode("utf-8"), bcrypt.gensalt()).decode(
        "utf-8"
    )
    new_user = User(
        username=lower_username,
        password_hash=hashed_pw,
        is_active=True,
        token_version=0,
        last_login=naive_utc_now(),
    )
    session.add(new_user)
    await session.flush()
    await session.commit()
    await session.refresh(new_user)

    # Create tokens
    access_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    refresh_expires = timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    access_payload = build_jwt_payload(new_user, "access", access_expires)
    access_token = create_access_token(access_payload)

    refresh_payload = build_jwt_payload(new_user, "refresh", refresh_expires)
    refresh_token = create_access_token(refresh_payload)

    # Use the single helper function to set cookies
    set_secure_cookie(
        response,
        "access_token",
        access_token,
        int(access_expires.total_seconds()),
        request,
    )
    set_secure_cookie(
        response,
        "refresh_token",
        refresh_token,
        int(refresh_expires.total_seconds()),
        request,
    )

    logger.info("User registered and logged in: %s", lower_username)
    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        username=lower_username,
        token_version=new_user.token_version,
        message=f"Registered user '{lower_username}' successfully.",
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
    """Login endpoint with proper cookie handling for all environments."""
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
            verify_duration = (
                datetime.now(timezone.utc) - verify_start
            ).total_seconds()
            logger.debug(
                "Password check took %.3fs for %s", verify_duration, lower_username
            )
        except ValueError as exc:
            logger.error("Corrupted password hash for '%s': %s", lower_username, exc)
            raise HTTPException(
                status_code=400, detail="Corrupted password hash."
            ) from exc

        if not valid_password:
            logger.warning("Invalid password for user: %s", lower_username)
            await asyncio.sleep(0.2)  # minor delay
            raise HTTPException(status_code=401, detail="Invalid credentials.")

        # Update last login
        db_user.last_login = naive_utc_now()
        if db_user.token_version is None:
            db_user.token_version = 0

    # Generate tokens
    access_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    refresh_expires = timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    access_payload = build_jwt_payload(db_user, "access", access_expires)
    access_token = create_access_token(access_payload)

    refresh_payload = build_jwt_payload(db_user, "refresh", refresh_expires)
    refresh_token = create_access_token(refresh_payload)

    # Set tokens with environment-appropriate settings
    set_secure_cookie(
        response,
        "access_token",
        access_token,
        int(access_expires.total_seconds()),
        request
    )

    set_secure_cookie(
        response,
        "refresh_token",
        refresh_token,
        int(refresh_expires.total_seconds()),
        request
    )

    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        username=db_user.username,
        token_version=db_user.token_version
    )


# -----------------------------------------------------------------------------
# Refresh Endpoint
# -----------------------------------------------------------------------------
DBSessionDep = Annotated[AsyncSession, Depends(get_async_session)]


@router.post("/refresh", response_model=LoginResponse)
async def refresh_token(
    request: Request, response: Response, session: DBSessionDep
) -> LoginResponse:
    refresh_cookie = request.cookies.get("refresh_token")
    if not refresh_cookie:
        logger.debug("No refresh token cookie found during refresh.")
        set_secure_cookie(response, "access_token", "", 0, request)
        set_secure_cookie(response, "refresh_token", "", 0, request)
        raise HTTPException(
            status_code=401, detail="Refresh token missing. Please login again."
        )

    user = await get_user_from_token(refresh_cookie, session, expected_type="refresh")
    logger.debug("Attempting token refresh for user: %s", user.username)

    try:
        decoded = await verify_token(refresh_cookie, "refresh", request)
        await session.rollback()

        result = await session.execute(
            select(User).where(User.username == decoded.get("sub")).with_for_update()
        )
        locked_user = result.scalars().first()
        if not locked_user:
            logger.error("User not found for refresh: %s", decoded.get("sub"))
            raise HTTPException(status_code=404, detail="User not found (refresh).")

        if not locked_user.is_active:
            logger.warning(
                "Refresh attempt for disabled user: %s", locked_user.username
            )
            raise HTTPException(status_code=403, detail="Account disabled.")

        if locked_user.token_version is None:
            locked_user.token_version = 0

        if decoded.get("version", 0) != locked_user.token_version:
            logger.warning("Token version mismatch for '%s'", locked_user.username)
            raise HTTPException(
                status_code=401, detail="Token version mismatch. Please re-login."
            )

        locked_user.last_activity = naive_utc_now()

        # Generate a new access token
        access_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        access_payload = build_jwt_payload(locked_user, "access", access_expires)
        new_access_token = create_access_token(access_payload)

        # Set the new access cookie
        set_secure_cookie(
            response,
            "access_token",
            new_access_token,
            int(access_expires.total_seconds()),
            request,
        )

        logger.info("Refreshed token for user '%s'.", locked_user.username)
        return LoginResponse(
            access_token=new_access_token,
            username=locked_user.username,
            token_version=locked_user.token_version,
        )

    except HTTPException as e:
        if e.status_code in (401, 403):
            # Clear cookies in these cases
            set_secure_cookie(response, "access_token", "", 0, request)
            set_secure_cookie(response, "refresh_token", "", 0, request)
        raise
    except Exception as e:
        logger.error(
            "Error during refresh for '%s': %s", user.username, e, exc_info=True
        )
        raise HTTPException(
            status_code=500, detail="Internal server error during token refresh."
        )


# -----------------------------------------------------------------------------
# Token Verification
# -----------------------------------------------------------------------------
class VerifyResponse(BaseModel):
    authenticated: bool
    username: Optional[str] = None
    user_id: Optional[int] = None
    token_version: Optional[int] = None


@router.get("/verify", response_model=VerifyResponse)
async def verify_auth_status(
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_async_session),
) -> VerifyResponse:
    """
    Attempts to verify the current user's access token;
    if valid, returns basic user info.
    """
    try:
        user, access_token = await get_current_user_and_token(request)
        refresh_token = request.cookies.get("refresh_token")

        # If verified, we optionally re-set the cookies with the same values
        # to ensure consistent attributes (rolling or persistent).
        if user and access_token:
            # Typically, might re-issue the same expiration; here, let's just keep them
            # or set max_age to None. Use same-lifetime approach if desired:
            set_secure_cookie(response, "access_token", access_token, None, request)
            if refresh_token:
                set_secure_cookie(
                    response, "refresh_token", refresh_token, None, request
                )

        return VerifyResponse(
            authenticated=True,
            username=user.username,
            user_id=user.id,
            token_version=user.token_version,
        )
    except Exception as e:
        logger.debug(f"Verify error: {str(e)}")
        return VerifyResponse(authenticated=False)


# -----------------------------------------------------------------------------
# Token Expiry Info
# -----------------------------------------------------------------------------
class TokenExpirySettings(BaseModel):
    access_token_expire_minutes: int
    refresh_token_expire_days: int


@router.get("/settings/token-expiry", response_model=TokenExpirySettings)
async def get_token_expiry_settings() -> TokenExpirySettings:
    return TokenExpirySettings(
        access_token_expire_minutes=ACCESS_TOKEN_EXPIRE_MINUTES,
        refresh_token_expire_days=REFRESH_TOKEN_EXPIRE_DAYS,
    )


# -----------------------------------------------------------------------------
# Server Time / CSRF
# -----------------------------------------------------------------------------
@router.get("/timestamp", response_model=dict[str, float])
async def get_server_time() -> dict[str, float]:
    return {"serverTimestamp": datetime.now(timezone.utc).timestamp()}


@router.get("/csrf", response_model=dict[str, str])
async def get_csrf_token(request: Request, response: Response):
    # Dummy endpoint returning a UUID token for demonstration
    csrf_token = str(uuid.uuid4())
    if AUTH_DEBUG:
        logger.debug("Providing dummy CSRF token for dev.")
    return {"token": csrf_token}


@router.get("/apple-touch-icon.png", include_in_schema=False)
@router.get("/apple-touch-icon-precomposed.png", include_in_schema=False)
@router.get("/favicon.ico", include_in_schema=False)
async def ignore_common_requests():
    """Avoid logs for icon requests."""
    return Response(status_code=204)


# -----------------------------------------------------------------------------
# Dev-only set-cookies Endpoint (INSECURE Example)
# -----------------------------------------------------------------------------
@router.post("/set-cookies", include_in_schema=False)
async def set_cookies_endpoint(
    request: Request, response: Response, token_req: TokenRequest
):
    """
    Demonstrates manually setting insecure cookies (not httponly) for debugging.
    Only for local dev/test. Do NOT use in production.
    """
    logger.warning(
        "Manual cookie set from %s, not recommended for production.",
        request.client.host if request.client else "unknown",
    )
    access_expires = int(timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES).total_seconds())
    refresh_expires = int(timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS).total_seconds())
    try:
        # This sets non-HttpOnly cookies (explicitly).
        response.set_cookie(
            "access_token",
            token_req.access_token,
            max_age=access_expires,
            path="/",
            domain=None,
            secure=True,  # Must be True when SameSite=None for Chrome
            httponly=False,
            samesite="none",
        )
        logger.warning("Set non-HttpOnly access_token (INSECURE).")

        if token_req.refresh_token:
            response.set_cookie(
                "refresh_token",
                token_req.refresh_token,
                max_age=refresh_expires,
                path="/",
                domain=None,
                secure=True,
                httponly=False,
                samesite="none",
            )
            logger.warning("Set non-HttpOnly refresh_token (INSECURE).")
    except Exception as e:
        logger.error("Cookie set endpoint error: %s", e)
        return {"status": "error", "message": str(e)}
    return {"status": "non-HttpOnly cookies set"}


# -----------------------------------------------------------------------------
# Logout Endpoint
# -----------------------------------------------------------------------------
@router.post("/logout", response_model=dict[str, str])
async def logout_user(
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_async_session),
) -> dict[str, str]:
    current_user = None
    access_token = request.cookies.get("access_token")
    refresh_token = request.cookies.get("refresh_token")

    try:
        # Try to get user from the access token
        if access_token:
            try:
                current_user = await get_user_from_token(
                    access_token, session, request=request, expected_type="access"
                )
                logger.info(f"User from access token: {current_user.username}")
            except HTTPException:
                pass

        # If that fails, try getting from the refresh token
        if not current_user and refresh_token:
            try:
                current_user = await get_user_from_token(
                    refresh_token, session, request=request, expected_type="refresh"
                )
                logger.info(f"User from refresh token: {current_user.username}")
            except HTTPException:
                pass

        if current_user:
            # Invalidate tokens by incrementing token_version
            async with session.begin():
                locked_user = await session.get(
                    User, current_user.id, with_for_update=True
                )
                if locked_user:
                    old_version = locked_user.token_version or 0
                    locked_user.token_version = old_version + 1

                    # Optionally blacklist the refresh token if present
                    if refresh_token:
                        try:
                            decoded = await verify_token(
                                refresh_token, "refresh", request
                            )
                            token_id = decoded.get("jti")
                            expires_timestamp = decoded.get("exp")
                            if token_id and expires_timestamp:
                                exp_datetime = datetime.fromtimestamp(
                                    float(expires_timestamp), tz=timezone.utc
                                )
                                blacklisted = TokenBlacklist(
                                    jti=token_id,
                                    expires=exp_datetime.replace(tzinfo=None),
                                    user_id=locked_user.id,
                                    token_type="refresh",
                                    creation_reason="logout",
                                )
                                session.add(blacklisted)
                                logger.info(
                                    f"Blacklisted refresh token {token_id} on logout"
                                )
                        except Exception as e:
                            logger.error(f"Failed to blacklist refresh token: {e}")

    except Exception as e:
        logger.error(f"Unexpected error during logout: {e}")

    # Always clear cookies (via set_secure_cookie)
    set_secure_cookie(response, "access_token", "", 0, request)
    set_secure_cookie(response, "refresh_token", "", 0, request)

    return {"status": "logged out"}
