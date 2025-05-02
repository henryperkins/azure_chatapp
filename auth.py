import asyncio
import logging
import os
import uuid
import bcrypt

from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional, Annotated, Tuple

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

logger = logging.getLogger(__name__)

# NOTE: This auth.py is intended for local debugging only. Remove insecure logic before production use.

AUTH_DEBUG = (settings.ENV.lower() == "local")
DEFAULT_ADMIN = {
    "username": os.getenv("DEFAULT_ADMIN_USERNAME", "hperkins"),
    "password": os.getenv("DEFAULT_ADMIN_PASSWORD", "Twiohmld1234!"),
}
ACCESS_TOKEN_EXPIRE_MIN = 24 * 60  # 1 day in minutes
REFRESH_TOKEN_EXPIRE_DAYS = 30

router = APIRouter()

@router.get("/api/user/me")
async def get_current_user_profile(
    request: Request,
    session: AsyncSession = Depends(get_async_session),
):
    """
    Get the current user's profile and preferences for frontend bootstrapping.
    """
    try:
        user_obj, _tok = await get_current_user_and_token(request)
        prefs = user_obj.preferences or {}
        profile = {
            "id": user_obj.id,
            "username": user_obj.username,
            "role": user_obj.role,
            "is_active": user_obj.is_active,
            "preferences": prefs,
            "created_at": user_obj.created_at,
            "updated_at": user_obj.updated_at,
        }
        return {"user": profile}
    except Exception as ex:
        import traceback
        tb_str = traceback.format_exc()
        logger.error(f"Error in /api/user/me: {ex}\n{tb_str}")
        raise HTTPException(status_code=401, detail="Not authenticated")
__all__ = ["router", "create_default_user"]


class CookieSettings:
    def __init__(self, env: str, cookie_domain: str) -> None:
        self.env = env
        self.cookie_domain = cookie_domain

    def get_attributes(self, request: Request) -> dict[str, Any]:
        hostname = request.url.hostname
        scheme = request.url.scheme
        # Local dev environment defaults
        if hostname in ["localhost", "127.0.0.1"] or self.env.lower() == "development":
            return {
                "secure": False,  # False for HTTP in dev
                "domain": "localhost",
                "samesite": "none",  # None for cross-port requests
                "httponly": True,
                "path": "/",
            }
        # Production environment
        domain_value = None
        if self.cookie_domain and self.cookie_domain.lower() not in ["localhost", "127.0.0.1"]:
            domain_value = self.cookie_domain

        return {
            "secure": (scheme == "https"),
            "domain": domain_value,
            "samesite": "lax",
            "httponly": True,
            "path": "/",
        }


cookie_config_helper = CookieSettings(settings.ENV, settings.COOKIE_DOMAIN)


def set_secure_cookie(response: Response, key: str, value: str, max_age: Optional[int], request: Request) -> None:
    # Always use permissive cookie settings except in production
    env = (settings.ENV or "").lower()
    is_production = env == "production"

    if not is_production:
        # Always use permissive settings for dev/staging/test
        secure = False
        domain = None
        samesite = "lax"
        httponly = True
        path = "/"
    else:
        cookie_attrs = cookie_config_helper.get_attributes(request)
        secure = cookie_attrs["secure"]
        domain = cookie_attrs["domain"]
        samesite = cookie_attrs["samesite"]
        httponly = cookie_attrs["httponly"]
        path = cookie_attrs["path"]

    try:
        if value == "":
            # Clear cookie
            if domain:
                response.delete_cookie(key=key, path=path, domain=str(domain))
            else:
                response.delete_cookie(key=key, path=path)
            logger.info(f"[auth] Clearing cookie {key}, domain={domain}, path={path}")
            return

        logger.info(f"[auth] Setting cookie '{key}': value={value[:8]}..., max_age={max_age}, "
                    f"httpOnly={httponly}, secure={secure}, domain={domain}, samesite={samesite}, path={path}")
        response.set_cookie(
            key=key,
            value=value,
            httponly=httponly,
            secure=secure,
            path=path,
            max_age=max_age or 0,
            domain=(domain if domain else None),
            samesite=samesite,
        )
    except Exception as e:
        logger.error("Failed to set cookie %s: %s", key, str(e))
        raise HTTPException(status_code=500, detail=f"Cookie error: {str(e)}")


def rate_limit_login(_: Request, __: str) -> None:
    """Disabled in local debug mode."""
    return


def aware_utc_now() -> datetime:
    # Return naive UTC datetime (for Postgres 'timestamp without time zone' columns)
    return datetime.utcnow()


def build_jwt_payload(
    user: User,
    token_type: Literal["access", "refresh", "ws"],
    expires_delta: timedelta,
    jti: Optional[str] = None,
) -> dict[str, Any]:
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


async def create_default_user() -> None:
    if settings.ENV.lower() != "local":
        logger.info("Skipping default user creation in non-local environment.")
        return
    try:
        async with get_async_session_context() as session:
            user_exists_q = await session.execute(select(User).limit(1))
            if not user_exists_q.scalars().first():
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
                logger.info("[Insecure Debug] Default admin created: '%s'", DEFAULT_ADMIN["username"])
                if AUTH_DEBUG:
                    logger.info("Dev credentials => %s / %s", DEFAULT_ADMIN["username"], DEFAULT_ADMIN["password"])
    except Exception as e:
        logger.error("Failed to create default user: %s", e)


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


def validate_password(password: str) -> None:
    if len(password) < 12:
        raise ValueError("Password must be at least 12 characters.")
    if not any(c.isupper() for c in password):
        raise ValueError("Password must contain an uppercase letter.")
    if not any(c.islower() for c in password):
        raise ValueError("Password must contain a lowercase letter.")
    if not any(c.isdigit() for c in password):
        raise ValueError("Password must contain a digit.")
    if not any(c in "!@#$%^&*()_+-=[]{}|;:'\",.<>/?\\`~" for c in password):
        raise ValueError("Password must contain a special character.")


async def get_user_and_claims_from_refresh_token(
    token: str,
    session: AsyncSession,
    request: Request
) -> Tuple[User, dict]:
    decoded = await verify_token(token, "refresh", request)
    sub = decoded.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Missing 'sub' in refresh token.")
    q = await session.execute(select(User).where(User.username == sub).with_for_update())
    locked_user = q.scalars().first()
    if not locked_user:
        raise HTTPException(status_code=404, detail="User not found (refresh).")
    if not locked_user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled.")
    if locked_user.token_version is None:
        locked_user.token_version = 0
    if decoded.get("version", 0) != locked_user.token_version:
        raise HTTPException(status_code=401, detail="Token version mismatch. Re-login.")
    return locked_user, decoded


router = APIRouter()


@router.post("/register", response_model=LoginResponse)
async def register_user(
    request: Request,
    response: Response,
    creds: UserCredentials,
    session: AsyncSession = Depends(get_async_session),
) -> LoginResponse:
    from utils.auth_utils import validate_csrf_token
    validate_csrf_token(request)
    user_lower = creds.username.strip().lower()
    if not user_lower:
        raise HTTPException(status_code=400, detail="Username cannot be empty.")
    try:
        validate_password(creds.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    existing_q = await session.execute(select(User).where(User.username == user_lower))
    if existing_q.scalars().first():
        logger.warning("Registration blocked: user %s", user_lower)
        raise HTTPException(status_code=400, detail="Username taken.")

    hashed_pw = bcrypt.hashpw(creds.password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    new_user = User(
        username=user_lower,
        password_hash=hashed_pw,
        is_active=True,
        token_version=0,
        last_login=aware_utc_now(),
    )
    session.add(new_user)
    await session.flush()
    await session.commit()
    await session.refresh(new_user)

    access_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MIN)
    refresh_expires = timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    access_payload = build_jwt_payload(new_user, "access", access_expires)
    access_token = create_access_token(access_payload)
    refresh_payload = build_jwt_payload(new_user, "refresh", refresh_expires)
    refresh_token = create_access_token(refresh_payload)

    set_secure_cookie(response, "access_token", access_token, int(access_expires.total_seconds()), request)
    set_secure_cookie(response, "refresh_token", refresh_token, int(refresh_expires.total_seconds()), request)

    logger.info("User registered => %s", user_lower)
    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        username=user_lower,
        token_version=new_user.token_version,
        message=f"Registered user '{user_lower}' successfully.",
    )


@router.post("/login", response_model=LoginResponse)
async def login_user(
    request: Request,
    response: Response,
    creds: UserCredentials,
    session: AsyncSession = Depends(get_async_session),
) -> LoginResponse:
    from utils.auth_utils import validate_csrf_token
    validate_csrf_token(request)
    """
    Login user, set cookies for access/refresh tokens.
    """
    try:
        rate_limit_login(request, creds.username)
        name_lower = creds.username.strip().lower()

        async with session.begin():
            result = await session.execute(select(User).where(User.username == name_lower).with_for_update())
            db_user = result.scalars().first()
            if not db_user:
                logger.warning("Login unknown => %s", name_lower)
                raise HTTPException(status_code=401, detail="Invalid credentials.")
            if not db_user.is_active:
                logger.warning("Login disabled => %s", name_lower)
                raise HTTPException(status_code=403, detail="Account disabled.")

            start_time = datetime.now(timezone.utc)
            try:
                valid_pw = await asyncio.get_event_loop().run_in_executor(
                    None, bcrypt.checkpw,
                    creds.password.encode("utf-8"),
                    db_user.password_hash.encode("utf-8")
                )
                delta = (datetime.now(timezone.utc) - start_time).total_seconds()
                logger.debug("Password check %.3fs => user=%s", delta, name_lower)
            except ValueError:
                logger.error("Corrupted password hash => user=%s", name_lower)
                raise HTTPException(status_code=400, detail="Corrupted password hash.")

            if not valid_pw:
                logger.warning("Wrong password => user=%s", name_lower)
                await asyncio.sleep(0.2)
                raise HTTPException(status_code=401, detail="Invalid credentials.")

            db_user.last_login = aware_utc_now()
            db_user.last_activity = aware_utc_now()
            if db_user.token_version is None:
                db_user.token_version = 0

        access_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MIN)
        refresh_expires = timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

        ac_payload = build_jwt_payload(db_user, "access", access_expires)
        access_token = create_access_token(ac_payload)
        ref_payload = build_jwt_payload(db_user, "refresh", refresh_expires)
        refresh_token = create_access_token(ref_payload)

        set_secure_cookie(response, "access_token", access_token, int(access_expires.total_seconds()), request)
        set_secure_cookie(response, "refresh_token", refresh_token, int(refresh_expires.total_seconds()), request)

        return LoginResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            username=db_user.username,
            token_version=db_user.token_version,
        )
    except Exception as e:
        import traceback
        tb_str = traceback.format_exc()
        logger.error(f"Login fatal error: {e}\n{tb_str}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")

DBSessionDep = Annotated[AsyncSession, Depends(get_async_session)]


@router.post("/refresh", response_model=LoginResponse)
async def refresh_token(
    request: Request,
    response: Response,
    session: DBSessionDep
) -> LoginResponse:
    from utils.auth_utils import validate_csrf_token
    validate_csrf_token(request)
    """
    Refreshes the access token using a valid refresh cookie.
    """
    refresh_cookie = request.cookies.get("refresh_token")
    if not refresh_cookie:
        logger.debug("No refresh cookie => can't refresh.")
        set_secure_cookie(response, "access_token", "", 0, request)
        set_secure_cookie(response, "refresh_token", "", 0, request)
        raise HTTPException(status_code=401, detail="No refresh token; please login again.")

    try:
        locked_user, _claims = await get_user_and_claims_from_refresh_token(refresh_cookie, session, request)
        locked_user.last_activity = aware_utc_now()
        await session.commit()

        access_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MIN)
        new_payload = build_jwt_payload(locked_user, "access", access_expires)
        new_access_token = create_access_token(new_payload)

        set_secure_cookie(response, "access_token", new_access_token, int(access_expires.total_seconds()), request)
        logger.info("Token refreshed => %s", locked_user.username)

        return LoginResponse(
            access_token=new_access_token,
            username=locked_user.username,
            token_version=locked_user.token_version,
        )
    except HTTPException as ex:
        if ex.status_code in (401, 403):
            set_secure_cookie(response, "access_token", "", 0, request)
            set_secure_cookie(response, "refresh_token", "", 0, request)
        raise
    except Exception as e:
        logger.error("Token refresh error => %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Error refreshing token.")


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
    Verifies the current access token, returns user info if valid.
    """
    try:
        user_obj, _tok = await get_current_user_and_token(request)
        return VerifyResponse(
            authenticated=True,
            username=user_obj.username,
            user_id=user_obj.id,
            token_version=user_obj.token_version,
        )
    except HTTPException as ex:
        if ex.status_code in (401, 403):
            return VerifyResponse(authenticated=False)
        raise
    except Exception as e:
        logger.error("Verify error => %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Server error verifying token.")


class TokenExpirySettings(BaseModel):
    access_token_expire_minutes: int
    refresh_token_expire_days: int


@router.get("/settings/token-expiry", response_model=TokenExpirySettings)
async def get_token_expiry_settings() -> TokenExpirySettings:
    return TokenExpirySettings(
        access_token_expire_minutes=ACCESS_TOKEN_EXPIRE_MIN,
        refresh_token_expire_days=REFRESH_TOKEN_EXPIRE_DAYS,
    )


@router.get("/timestamp", response_model=dict[str, float])
async def get_server_time() -> dict[str, float]:
    return {"serverTimestamp": datetime.now(timezone.utc).timestamp()}


@router.get("/csrf", response_model=dict[str, str])
async def get_csrf_token(request: Request, response: Response):
    csrf_token = str(uuid.uuid4())
    response.set_cookie(
        "csrf_token",
        csrf_token,
        max_age=600,
        httponly=False,
        samesite="lax",
        path="/"
    )
    if AUTH_DEBUG:
        logger.debug("CSRF dev token => %s", csrf_token)
    return {"token": csrf_token}


@router.get("/apple-touch-icon.png", include_in_schema=False)
@router.get("/apple-touch-icon-precomposed.png", include_in_schema=False)
@router.get("/favicon.ico", include_in_schema=False)
async def ignore_common_requests():
    return Response(status_code=204)


@router.post("/set-cookies", include_in_schema=False)
async def set_cookies_endpoint(
    request: Request,
    response: Response,
    token_req: TokenRequest
):
    from utils.auth_utils import validate_csrf_token
    validate_csrf_token(request)
    if settings.ENV.lower() != "local":
        raise HTTPException(status_code=403, detail="Insecure cookie endpoint disabled in non-local env.")

    host_txt = request.client.host if (request.client and request.client.host) else "unknown"
    logger.warning("Manual insecure cookie set => from %s", host_txt)

    access_expires = int(timedelta(minutes=ACCESS_TOKEN_EXPIRE_MIN).total_seconds())
    refresh_expires = int(timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS).total_seconds())
    try:
        response.set_cookie(
            "access_token",
            token_req.access_token,
            max_age=access_expires,
            path="/",
            secure=True,
            httponly=False,
            samesite="none",
        )
        logger.warning("Set non-HttpOnly access_token.")
        if token_req.refresh_token:
            response.set_cookie(
                "refresh_token",
                token_req.refresh_token,
                max_age=refresh_expires,
                path="/",
                secure=True,
                httponly=False,
                samesite="none",
            )
            logger.warning("Set non-HttpOnly refresh_token.")
    except Exception as e:
        logger.error("Insecure set-cookie error => %s", e)
        return {"status": "error", "message": str(e)}
    return {"status": "non-HttpOnly cookies set"}


@router.post("/logout", response_model=dict[str, str])
async def logout_user(
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_async_session),
):
    from utils.auth_utils import validate_csrf_token
    validate_csrf_token(request)
    current_user = None
    access_cookie = request.cookies.get("access_token")
    refresh_cookie = request.cookies.get("refresh_token")

    try:
        if access_cookie:
            try:
                current_user = await get_user_from_token(
                    access_cookie, session, request=request, expected_type="access"
                )
                logger.info("Logout user => from access cookie => %s", current_user.username)
            except HTTPException:
                pass

        if not current_user and refresh_cookie:
            try:
                current_user = await get_user_from_token(
                    refresh_cookie, session, request=request, expected_type="refresh"
                )
                logger.info("Logout user => from refresh cookie => %s", current_user.username)
            except HTTPException:
                pass

        if current_user:
            async with session.begin():
                locked = await session.get(User, current_user.id, with_for_update=True)
                if locked:
                    locked.token_version = (locked.token_version or 0) + 1
                    if refresh_cookie:
                        try:
                            dec = await verify_token(refresh_cookie, "refresh", request)
                            tid = dec.get("jti")
                            exp_val = dec.get("exp")
                            if tid and exp_val:
                                dt_expirada = datetime.fromtimestamp(float(exp_val), tz=timezone.utc)
                                blackl = TokenBlacklist(
                                    jti=tid,
                                    expires=dt_expirada.replace(tzinfo=None),
                                    user_id=locked.id,
                                    token_type="refresh",
                                    creation_reason="logout",
                                )
                                session.add(blackl)
                                logger.info("Blacklisted refresh => jti=%s", tid)
                        except Exception as e:
                            logger.error("Failed to blacklist => %s", e)
    except Exception as e:
        logger.error("Logout error => %s", e)

    set_secure_cookie(response, "access_token", "", 0, request)
    set_secure_cookie(response, "refresh_token", "", 0, request)
    return {"status": "logged out"}
