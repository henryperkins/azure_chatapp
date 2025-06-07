import asyncio
import logging
import os
import uuid
import bcrypt
import traceback
from utils.auth_utils import validate_csrf_token

from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional, Annotated, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings  # Use settings directly from config
from db import get_async_session, get_async_session_context
from models.user import User, TokenBlacklist
from models.project import Project
from models.conversation import Conversation
from utils.auth_utils import (
    get_user_from_token,
    get_current_user_and_token,
    create_access_token,
    verify_token,
)

logger = logging.getLogger(__name__)

# NOTE: This auth.py is intended for local debugging only. Remove insecure logic before production use.

AUTH_DEBUG = settings.ENV.lower() == "local"
DEFAULT_ADMIN = {
    "username": os.getenv("DEFAULT_ADMIN_USERNAME", "hperkins"),
    "password": os.getenv("DEFAULT_ADMIN_PASSWORD", "Twiohmld1234!"),
}
ACCESS_TOKEN_EXPIRE_MIN = 24 * 60  # 1 day in minutes
REFRESH_TOKEN_EXPIRE_DAYS = 30

# ----------------------------------------------------------------------------
# Simple in-memory login rate-limiter (dev-only)
# ----------------------------------------------------------------------------
# Blocks more than MAX_ATTEMPTS within WINDOW_SECONDS per remote address OR
# username.  Not suitable for production – replace with Redis when scaling.

LOGIN_RATE_LIMIT: dict[str, list[float]] = {}
MAX_ATTEMPTS = 10
WINDOW_SECONDS = 60

router = APIRouter()


__all__ = ["router", "create_default_user"]


class CookieSettings:
    def __init__(self, env: str, cookie_domain: str) -> None:
        self.env = env
        self.cookie_domain = cookie_domain

    def get_attributes(self, request: Request) -> dict[str, Any]:
        env = self.env.lower()
        hostname = request.url.hostname

        # Honor X-Forwarded-Proto so that deployments behind an SSL-terminating
        # reverse-proxy (e.g. Nginx, Cloudflare) are treated as HTTPS even though
        # `request.url.scheme` is "http".
        forwarded_proto_raw = request.headers.get("x-forwarded-proto", "")
        forwarded_proto = (
            forwarded_proto_raw.split(",")[0].strip().lower()
            if forwarded_proto_raw
            else ""
        )
        scheme = forwarded_proto or request.url.scheme

        is_localhost = hostname in ["localhost", "127.0.0.1"]
        is_production = env == "production"

        # Production must have strict security; only warn when *effective* scheme is not https
        if is_production and scheme != "https":
            logger.warning(
                f"Production environment detected but not using HTTPS: {hostname}"
            )

        # Force production settings for safety
        if is_production:
            return {
                "secure": True,  # Always secure in production
                "domain": (
                    self.cookie_domain
                    if self.env.lower() == "production" and self.cookie_domain
                    else None
                ),
                "samesite": "lax",
                "httponly": True,
                "path": "/",
            }

        # Default for local development
        return {
            "secure": False if is_localhost else True,
            "domain": None,
            "samesite": "lax",
            "httponly": True,
            "path": "/",
        }


cookie_config_helper = CookieSettings(settings.ENV, settings.COOKIE_DOMAIN)


def set_secure_cookie(
    response: Response, key: str, value: str, max_age: Optional[int], request: Request
) -> None:
    """Sets a cookie with correct flags for each environment, explicitly guarding localhost."""
    env = (settings.ENV or "").lower()
    hostname = request.url.hostname
    running_localhost = hostname in ["127.0.0.1", "localhost"]
    is_production = env == "production"

    # On localhost, always use dev cookie attributes—even if ENV=production
    if running_localhost:
        secure = False
        domain = None
        samesite = "lax"
        httponly = True
        path = "/"
        if is_production:
            logger.warning(
                f"[AUTH_COOKIE_PLAN] Overriding production secure/domain for localhost request (host={hostname}); ENV=production"
            )
    elif not is_production:
        # Non-prod, non-localhost (e.g., LAN IP in dev): use relaxed settings
        secure = False
        domain = None
        samesite = "lax"
        httponly = True
        path = "/"
    else:
        # True production (public hostname, ENV=production)
        cookie_attrs = cookie_config_helper.get_attributes(request)
        secure = cookie_attrs["secure"]
        domain = cookie_attrs["domain"]
        samesite = cookie_attrs["samesite"]
        httponly = cookie_attrs["httponly"]
        path = cookie_attrs["path"]

    try:
        log_value_short = f"{value[:8]}..." if value else "'' (clearing)"
        logger.info(
            f"[AUTH_COOKIE_SET] Setting cookie '{key}': value={log_value_short}, max_age={max_age}, "
            f"httpOnly={httponly}, secure={secure}, domain={domain if domain else '[None]'}, samesite={samesite}, path={path}"
        )

        if value == "":
            logger.info(
                f"[AUTH_COOKIE_CLEAR] Clearing cookie {key}, domain={domain}, path={path}"
            )
            if domain:
                response.delete_cookie(key=key, path=path, domain=str(domain))
            else:
                response.delete_cookie(key=key, path=path)
            return

        # Ensure max_age is properly set for persistence
        effective_max_age = max_age if max_age and max_age > 0 else None

        response.set_cookie(
            key=key,
            value=value,
            httponly=httponly,
            secure=secure,
            path=path,
            max_age=effective_max_age,
            domain=domain,
            samesite=samesite,
            # Add expires as backup for browsers that don't support max_age properly
            expires=(
                None
                if not effective_max_age
                else int(datetime.utcnow().timestamp()) + effective_max_age
            ),
        )

        logger.info(
            f"[AUTH_COOKIE_SET] Successfully set cookie '{key}' with max_age={effective_max_age}"
        )
    except Exception as e:
        logger.error("Failed to set cookie %s: %s", key, str(e))
        raise HTTPException(status_code=500, detail=f"Cookie error: {str(e)}") from e


def rate_limit_login(_: Request, __: str) -> None:
    """Very small in-memory rate-limiter good enough for local demo.

    Raises HTTPException 429 when a client exceeds MAX_ATTEMPTS in WINDOW_SECONDS.
    Identifies client by combination of IP and username (lower-cased).
    """
    from time import time

    request: Request = _
    username: str = __.lower() if __ else ""

    ident = f"{request.client.host if request.client else 'unknown'}|{username}"
    now_ts = time()

    attempts = LOGIN_RATE_LIMIT.get(ident, [])
    # trim old
    attempts = [ts for ts in attempts if now_ts - ts < WINDOW_SECONDS]
    attempts.append(now_ts)
    LOGIN_RATE_LIMIT[ident] = attempts

    if len(attempts) > MAX_ATTEMPTS:
        logger.warning(
            "[RATE_LIMIT] Too many login attempts for %s (count=%s)", ident, len(attempts)
        )
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Try again later.",
        )


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
    iat = int(now.timestamp())
    exp = int((now + expires_delta).timestamp())
    return {
        "sub": user.username,
        "user_id": user.id,
        "type": token_type,
        "version": user.token_version or 0,
        "iat": iat,
        "exp": exp,
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
                    "[Insecure Debug] Default admin created: '%s'",
                    DEFAULT_ADMIN["username"],
                )
                if AUTH_DEBUG:
                    logger.info(
                        "Dev credentials => %s / %s",
                        DEFAULT_ADMIN["username"],
                        DEFAULT_ADMIN["password"],
                    )
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
    token: str, session: AsyncSession, request: Request
) -> Tuple[User, dict[str, Any]]:
    decoded = await verify_token(token, "refresh", db_session=session)
    sub = decoded.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Missing 'sub' in refresh token.")
    q = await session.execute(
        select(User).where(User.username == sub).with_for_update()
    )
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


@router.post("/register", response_model=LoginResponse)
async def register_user(
    request: Request,
    response: Response,
    creds: UserCredentials,
    session: AsyncSession = Depends(get_async_session),
) -> LoginResponse:
    validate_csrf_token(request)
    user_lower = creds.username.strip().lower()
    if not user_lower:
        raise HTTPException(status_code=400, detail="Username cannot be empty.")
    try:
        validate_password(creds.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    existing_q = await session.execute(select(User).where(User.username == user_lower))
    if existing_q.scalars().first():
        logger.warning("Registration blocked: user %s", user_lower)
        raise HTTPException(status_code=400, detail="Username taken.")

    hashed_pw = bcrypt.hashpw(creds.password.encode("utf-8"), bcrypt.gensalt()).decode(
        "utf-8"
    )
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
    validate_csrf_token(request)
    # Login user, set cookies for access/refresh tokens.
    try:
        rate_limit_login(request, creds.username)
        name_lower = creds.username.strip().lower()
        masked_for_log = f"{name_lower[:3]}***"

        # Always log the login attempt minimally for audit (never store plaintext creds!)
        logger.info(f"Login attempt for user: {masked_for_log}")

        async with session.begin():
            result = await session.execute(
                select(User).where(User.username == name_lower).with_for_update()
            )
            db_user = result.scalars().first()
            if not db_user:
                logger.warning("Login failed: unknown user => %s", masked_for_log)
                raise HTTPException(status_code=401, detail="Invalid credentials.")
            if not db_user.is_active:
                logger.warning("Login failed: account disabled => %s", masked_for_log)
                raise HTTPException(status_code=403, detail="Account disabled.")

            start_time = datetime.now(timezone.utc)
            try:
                valid_pw = await asyncio.get_event_loop().run_in_executor(
                    None,
                    bcrypt.checkpw,
                    creds.password.encode("utf-8"),
                    db_user.password_hash.encode("utf-8"),
                )
                delta = (datetime.now(timezone.utc) - start_time).total_seconds()
                logger.debug("Password check %.3fs => user=%s", delta, masked_for_log)
            except ValueError as exc:
                logger.error("Corrupted password hash => user=%s", masked_for_log)
                raise HTTPException(
                    status_code=400, detail="Corrupted password hash."
                ) from exc

            if not valid_pw:
                logger.warning("Wrong password => user=%s", masked_for_log)
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

        logger.info("Login succeeded for user: %s", masked_for_log)
        return LoginResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            username=db_user.username,
            token_version=db_user.token_version,
        )
    # ----- keep explicit FastAPI errors unchanged -----
    except HTTPException as http_exc:
        # Re-raise to preserve original status (e.g. 401 Invalid credentials)
        raise http_exc

    # ----- all other unexpected errors become 500 -----
    except Exception as e:
        tb_str = traceback.format_exc()
        logger.error("Login fatal error: %s\n%s", e, tb_str)
        raise HTTPException(status_code=500, detail="Internal server error") from e


DBSessionDep = Annotated[AsyncSession, Depends(get_async_session)]


@router.post("/refresh", response_model=LoginResponse)
async def refresh_token(
    request: Request, response: Response, session: DBSessionDep
) -> LoginResponse:
    validate_csrf_token(request)
    # Refreshes the access token using a valid refresh cookie.
    refresh_cookie = request.cookies.get("refresh_token")
    if not refresh_cookie:
        logger.debug("No refresh cookie => can't refresh.")
        set_secure_cookie(response, "access_token", "", 0, request)
        set_secure_cookie(response, "refresh_token", "", 0, request)
        raise HTTPException(
            status_code=401, detail="No refresh token; please login again."
        )

    locked_user = None
    try:
        locked_user, _claims = await get_user_and_claims_from_refresh_token(
            refresh_cookie, session, request
        )
        locked_user.last_activity = aware_utc_now()
        await session.commit()

        access_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MIN)
        new_payload = build_jwt_payload(locked_user, "access", access_expires)
        new_access_token = create_access_token(new_payload)

        set_secure_cookie(
            response,
            "access_token",
            new_access_token,
            int(access_expires.total_seconds()),
            request,
        )
        logger.info("Token refreshed => %s", locked_user.username)

        return LoginResponse(
            access_token=new_access_token,
            username=locked_user.username,
            token_version=locked_user.token_version,
        )
    except HTTPException as ex:
        if ex.status_code in (401, 403):
            logger.warning(
                "[REFRESH_VERSION_MISMATCH] user=%s detail=%s cookies=%s",
                locked_user.username if locked_user else "unknown",
                ex.detail,
                request.cookies,
            )
            set_secure_cookie(response, "access_token", "", 0, request)
            set_secure_cookie(response, "refresh_token", "", 0, request)
        raise
    except Exception as e:
        logger.error("Token refresh error => %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Error refreshing token.") from e


class UserProfileForVerify(BaseModel):
    id: int
    username: str
    token_version: Optional[int] = None
    project_ids: Optional[list[str]] = []
    conversation_ids: Optional[list[str]] = []


class VerifyResponse(BaseModel):
    authenticated: bool
    user: Optional[UserProfileForVerify] = None


@router.get("/verify", response_model=VerifyResponse)
async def verify_auth_status(
    request: Request,
    session: AsyncSession = Depends(get_async_session),
) -> VerifyResponse:
    # Verifies the current access token, returns user info if valid.
    # Enhanced: includes request context for debugging.
    try:
        user_obj, _tok = await get_current_user_and_token(request)

        # Fetch associated project IDs
        project_results = await session.execute(
            select(Project.id).where(Project.user_id == user_obj.id)
        )
        project_ids = [str(pid) for pid in project_results.scalars().all()]

        # Fetch associated conversation IDs
        conversation_results = await session.execute(
            select(Conversation.id).where(Conversation.user_id == user_obj.id)
        )
        conversation_ids = [str(cid) for cid in conversation_results.scalars().all()]

        user_profile = UserProfileForVerify(
            id=user_obj.id,
            username=user_obj.username,
            token_version=user_obj.token_version,
            project_ids=project_ids,
            conversation_ids=conversation_ids,
        )
        return VerifyResponse(authenticated=True, user=user_profile)

    except HTTPException as ex:
        if ex.status_code in (401, 403):
            return VerifyResponse(authenticated=False, user=None)
        logger.warning(
            f"Verify auth encountered non-401/403 HTTPException ({ex.status_code}): {ex.detail}",
            exc_info=True,
        )
        return VerifyResponse(authenticated=False, user=None)
    except Exception as e:
        logger.error("Verify auth general error => %s", e, exc_info=True)
        return VerifyResponse(authenticated=False, user=None)


class TokenExpirySettings(BaseModel):
    access_token_expire_minutes: int
    refresh_token_expire_days: int


@router.get("/settings/token-expiry", response_model=TokenExpirySettings)
async def get_token_expiry_settings() -> TokenExpirySettings:
    return TokenExpirySettings(
        access_token_expire_minutes=ACCESS_TOKEN_EXPIRE_MIN,
        refresh_token_expire_days=REFRESH_TOKEN_EXPIRE_DAYS,
    )


@router.get("/settings/auth", response_model=dict)
async def get_auth_settings(request: Request):
    """Expose effective cookie/CORS/auth config for this request."""
    env = (settings.ENV or "").lower()
    hostname = request.url.hostname
    running_localhost = hostname in ["127.0.0.1", "localhost"]
    is_production = env == "production"
    # Always compute what set_secure_cookie would use for these values:
    if running_localhost:
        secure = False
        domain = None
        samesite = "lax"
        httponly = True
        path = "/"
        env_note = "localhost mode overrides all production cookie/domain/cors."
    elif not is_production:
        secure = False
        domain = None
        samesite = "lax"
        httponly = True
        path = "/"
        env_note = "development mode, relaxed cookie policy."
    else:
        attrs = cookie_config_helper.get_attributes(request)
        secure = attrs["secure"]
        domain = attrs["domain"]
        samesite = attrs["samesite"]
        httponly = attrs["httponly"]
        path = attrs["path"]
        env_note = "strict production policy"
    return {
        "environment": env,
        "request_hostname": hostname,
        "is_production": is_production,
        "running_localhost": running_localhost,
        "cookie_policy": {
            "secure": secure,
            "domain": domain,
            "samesite": samesite,
            "httponly": httponly,
            "path": path,
        },
        "note": env_note,
    }

# -----------------------------------------------------------------------------
#  Compatibility alias – Front-end expects `/api/auth/settings`
# -----------------------------------------------------------------------------
#  The JS bundle (static/js/appConfig.js) is wired to call `AUTH_SETTINGS` which
#  resolves to `/api/auth/settings`.  During several refactors the Python side
#  kept the handler at `/settings/auth` leading to 404s.  We expose a slim
#  wrapper that re-uses the existing implementation to avoid touching the
#  front-end bundle right now.  Remove once the constant is updated everywhere.


@router.get("/settings", response_model=dict, include_in_schema=False)
async def get_auth_settings_alias(request: Request):
    """Alias route kept for backward compatibility with older front-end."""
    return await get_auth_settings(request)


@router.get("/timestamp", response_model=dict[str, float])
async def get_server_time() -> dict[str, float]:
    return {"serverTimestamp": datetime.now(timezone.utc).timestamp()}


@router.get("/csrf", response_model=dict[str, str])
async def get_csrf_token(request: Request):
    # Generate CSRF token, store in session, set cookie, and return in JSON
    import secrets
    from fastapi.responses import JSONResponse

    token = secrets.token_urlsafe()
    request.session["csrf_token"] = token
    resp = JSONResponse(content={"token": token})
    resp.set_cookie(
        "csrf_token",
        token,
        httponly=False,
        secure=False,
        samesite="lax",
        path="/",
    )
    return resp


@router.get("/apple-touch-icon.png", include_in_schema=False)
@router.get("/apple-touch-icon-precomposed.png", include_in_schema=False)
@router.get("/favicon.ico", include_in_schema=False)
async def ignore_common_requests():
    return Response(status_code=204)


@router.post("/set-cookies", include_in_schema=False)
async def set_cookies_endpoint(
    request: Request, response: Response, token_req: TokenRequest
):
    validate_csrf_token(request)

    # Secure this endpoint even further: Only allowed in local env AND from localhost
    env = settings.ENV.lower()
    client_host = (
        request.client.host if (request.client and request.client.host) else "unknown"
    )

    if env != "local":
        raise HTTPException(
            status_code=403, detail="This endpoint is disabled in production"
        )
    if client_host not in ["localhost", "127.0.0.1"]:
        raise HTTPException(status_code=403, detail="Only available from localhost")

    access_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MIN)
    refresh_expires = timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    try:
        # usa la misma rutina que el resto de la app → atributos coherentes
        set_secure_cookie(
            response,
            "access_token",
            token_req.access_token,
            int(access_expires.total_seconds()),
            request,
        )
        if token_req.refresh_token:
            set_secure_cookie(
                response,
                "refresh_token",
                token_req.refresh_token,
                int(refresh_expires.total_seconds()),
                request,
            )

        logger.info(
            "Tokens set via insecure endpoint",
            extra={
                "event_type": "insecure_token_set",
                "has_access_token": bool(token_req.access_token),
                "has_refresh_token": bool(token_req.refresh_token),
            },
        )
    except Exception as e:
        logger.error(
            "Insecure set-cookie error",
            extra={"event_type": "insecure_token_set_error", "error": str(e)},
        )
        return {"status": "error", "message": str(e)}
    return {"status": "cookies set"}


@router.post("/logout", response_model=dict[str, str])
async def logout_user(
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_async_session),
):
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
                logger.info(
                    "Logout user => from access cookie => %s", current_user.username
                )
            except HTTPException:
                pass

        if not current_user and refresh_cookie:
            try:
                current_user = await get_user_from_token(
                    refresh_cookie, session, request=request, expected_type="refresh"
                )
                logger.info(
                    "Logout user => from refresh cookie => %s", current_user.username
                )
            except HTTPException:
                pass

        if current_user:
            locked = await session.get(User, current_user.id, with_for_update=True)
            if locked:
                locked.token_version = (locked.token_version or 0) + 1
                logger.info(
                    "[TOKEN_VERSION_INCREMENT] user=%s new_ver=%s reason=logout",
                    locked.username,
                    locked.token_version,
                )
                if refresh_cookie:
                    try:
                        # Allow version mismatch during logout to handle graceful token cleanup
                        dec = await verify_token(
                            refresh_cookie,
                            "refresh",
                            db_session=session,
                            allow_version_mismatch=True,
                        )
                        tid = dec.get("jti")
                        exp_val = dec.get("exp")
                        if tid and exp_val:
                            dt_expirada = datetime.fromtimestamp(
                                float(exp_val), tz=timezone.utc
                            )
                            blackl = TokenBlacklist(
                                jti=tid,
                                expires=dt_expirada.replace(tzinfo=None),
                                user_id=locked.id,
                                token_type="refresh",
                                creation_reason="logout",
                            )
                            session.add(blackl)
                            logger.info(
                                "Blacklisted refresh token during logout",
                                extra={
                                    "event_type": "token_blacklisted",
                                    "jti": tid,
                                    "user_id": locked.id,
                                    "token_type": "refresh",
                                    "reason": "logout",
                                },
                            )
                    except Exception as e:
                        logger.error(
                            "Failed to blacklist refresh token during logout",
                            extra={
                                "event_type": "token_blacklist_error",
                                "error": str(e),
                                "user_id": locked.id if locked else None,
                                "token_type": "refresh",
                            },
                        )
            await session.commit()
    except Exception as e:
        logger.error("Logout error => %s", e)

    set_secure_cookie(response, "access_token", "", 0, request)
    set_secure_cookie(response, "refresh_token", "", 0, request)
    return {"status": "logged out"}
