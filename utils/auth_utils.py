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
from typing import Optional, Any, Tuple
import os
import http.cookies

from config import settings
import jwt
from jwt import ExpiredSignatureError, InvalidTokenError
from fastapi import HTTPException, Request, status
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_async_session_context
from models.user import User, TokenBlacklist
from utils.logging_config import request_id_var, trace_id_var


logger = logging.getLogger(__name__)

# -----------------------------------------------------------------------------
# JWT Configuration
# -----------------------------------------------------------------------------
# -------------------------------------------------------------------------
# Consistent JWT secret across all processes:
#   1) settings.JWT_SECRET            (preferred)
#   2) environment variable JWT_SECRET
#   3) fixed dev-only fallback (never use in prod)
# -------------------------------------------------------------------------
JWT_SECRET: Optional[str] = getattr(settings, "JWT_SECRET", None) or os.getenv(
    "JWT_SECRET"
)

if not JWT_SECRET:
    # Production must never start without an explicit secret
    if getattr(settings, "ENV", "development").lower() == "production":
        raise RuntimeError("JWT_SECRET must be set in production environment")

    # Dev / test fallback ─ SAME value for every worker to prevent the
    #   “login → immediate logout” bug caused by each process generating
    #   its own random key.
    JWT_SECRET = "dev-insecure-default-secret"
    logger.warning(
        "JWT_SECRET not configured - using insecure default for development",
        extra={
            "event_type": "jwt_secret_fallback",
            "environment": getattr(settings, "ENV", "development"),
            "request_id": request_id_var.get(),
            "trace_id": trace_id_var.get(),
        },
    )

JWT_ALGORITHM = "HS256"


# -----------------------------------------------------------------------------
# Token Creation
# -----------------------------------------------------------------------------
def create_access_token(data: dict) -> str:
    """
    Encodes a JWT token from the given payload `data`.
    Assumes 'data' already contains all necessary claims, including 'exp'.
    """
    if JWT_SECRET is None:
        raise RuntimeError("JWT_SECRET is not set. Cannot encode token.")
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
            "Created JWT token successfully",
            extra={
                "event_type": "jwt_token_created",
                "jti": data.get("jti"),
                "sub": data.get("sub"),
                "token_type": data.get("type"),
                "request_id": request_id_var.get(),
                "trace_id": trace_id_var.get(),
            },
        )
        return token
    except Exception as exc:
        logger.error(
            "Failed to create JWT token",
            extra={
                "event_type": "jwt_token_creation_failed",
                "error": str(exc),
                "request_id": request_id_var.get(),
                "trace_id": trace_id_var.get(),
            },
            exc_info=True,
        )
        raise


# -----------------------------------------------------------------------------
# Token Verification & Blacklist Checking
# -----------------------------------------------------------------------------
async def verify_token(
    token: str,
    expected_type: Optional[str] = None,
    db_session: Optional[AsyncSession] = None,
    allow_version_mismatch: bool = False,
) -> dict[str, Any]:
    """
    Enhanced token verification with strict error handling and structured logging.
    Raises HTTPException(401) on any validation or blacklist failure.

    Args:
        token: JWT token to verify
        expected_type: Expected token type (access, refresh, ws)
        db_session: Database session for blacklist checking
        allow_version_mismatch: If True, allows tokens with version mismatch (for logout)
    """
    if db_session is None:
        raise RuntimeError("Database session required for verify_token")

    if JWT_SECRET is None:
        raise RuntimeError("JWT_SECRET is not set. Cannot decode token.")
    try:
        decoded = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        token_id = decoded.get("jti")
        token_type = decoded.get("type", "unknown")

        if not token_id:
            raise HTTPException(status_code=401, detail="Invalid token: missing jti")

        # Check token version with structured logging
        sub = decoded.get("sub")
        if sub:
            # Check user
            user_result = await db_session.execute(
                select(User).where(User.username == sub)
            )
            user = user_result.scalars().first()
            if (
                user
                and user.token_version is not None
                and decoded.get("version") != user.token_version
            ):
                # Structured logging for token version mismatch
                logger.warning(
                    "Token version mismatch detected",
                    extra={
                        "event_type": "token_version_mismatch",
                        "user": sub,
                        "token_version": decoded.get("version"),
                        "db_version": user.token_version,
                        "jti": decoded.get("jti"),
                        "exp": decoded.get("exp"),
                        "iat": decoded.get("iat"),
                        "allow_version_mismatch": allow_version_mismatch,
                        "token_type": token_type,
                    },
                )

                # Reject token if version mismatch is not allowed
                if not allow_version_mismatch:
                    raise HTTPException(
                        status_code=401,
                        detail="Token version mismatch. Please re-authenticate.",
                    )

        if expected_type and token_type != expected_type:
            logger.warning(
                "Token type mismatch",
                extra={
                    "event_type": "token_type_mismatch",
                    "expected_type": expected_type,
                    "actual_type": token_type,
                    "jti": token_id,
                    "user": sub,
                },
            )
            raise HTTPException(
                status_code=401, detail=f"Invalid token type: expected {expected_type}"
            )

        # Check blacklist
        blacklisted = await db_session.execute(
            select(TokenBlacklist).where(TokenBlacklist.jti == token_id)
        )
        if blacklisted.scalar_one_or_none():
            logger.warning(
                "Blacklisted token access attempt",
                extra={
                    "event_type": "blacklisted_token_access",
                    "jti": token_id,
                    "user": sub,
                    "token_type": token_type,
                },
            )
            raise HTTPException(status_code=401, detail="Token has been revoked")

        # Log successful verification
        logger.debug(
            "Token verification successful",
            extra={
                "event_type": "token_verification_success",
                "user": sub,
                "token_type": token_type,
                "jti": token_id,
            },
        )

        return decoded

    except ExpiredSignatureError as exc:
        logger.warning(
            "Expired token access attempt",
            extra={
                "event_type": "expired_token_access",
                "token_preview": token[:10] if token else "None",
            },
        )
        raise HTTPException(status_code=401, detail="Token has expired") from exc
    except InvalidTokenError as e:
        logger.warning(
            "Invalid token format",
            extra={
                "event_type": "invalid_token_format",
                "error": str(e),
                "token_preview": token[:10] if token else "None",
            },
        )
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}") from e
    except HTTPException as http_exc:
        # Preserve original status code / detail – just re-raise.
        logger.debug(
            "verify_token propagated HTTPException",
            extra={
                "event_type": "token_verification_http_exception",
                "status_code": http_exc.status_code,
                "detail": http_exc.detail,
            },
        )
        raise  # <-- propagate unchanged
    except Exception as e:
        logger.error(
            "Unexpected error during token verification",
            extra={
                "event_type": "token_verification_error",
                "error": str(e),
                "token_preview": token[:10] if token else "None",
                "expected_type": expected_type,
                "allow_version_mismatch": allow_version_mismatch,
            },
            exc_info=True,
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
    # Use a timezone-naive UTC timestamp so Postgres doesn’t raise
    # “offset-naive and offset-aware datetimes” errors when comparing.
    # The database `expires` column stores naive timestamps (UTC), so we align
    # the Python value accordingly.
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
    result = await db.execute(token_count_query)
    token_counts = result.all() if hasattr(result, "all") else []
    for token_type, count in token_counts:
        logger.info(
            "Active blacklisted tokens by type",
            extra={
                "event_type": "blacklisted_tokens_count",
                "token_type": token_type,
                "count": count,
                "request_id": request_id_var.get(),
                "trace_id": trace_id_var.get(),
            },
        )

    if deleted_count > 0:
        logger.info(
            "Cleaned up expired blacklisted tokens",
            extra={
                "event_type": "blacklisted_tokens_cleanup",
                "deleted_count": deleted_count,
                "request_id": request_id_var.get(),
                "trace_id": trace_id_var.get(),
            },
        )
    return deleted_count


# -----------------------------------------------------------------------------
# CSRF Protection Utilities
# -----------------------------------------------------------------------------
def validate_csrf_token(request: Request) -> None:
    """
    Validates CSRF token for state-changing (non-GET/HEAD/OPTIONS) requests.
    - Checks X-CSRF-Token header matches csrf_token cookie.
    - Raises HTTPException(403) if missing or mismatched.
    - Always logs the received tokens for troubleshooting.
    """
    # Only validate on unsafe methods
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    csrf_cookie = request.cookies.get("csrf_token")
    csrf_header = request.headers.get("x-csrf-token")
    logger.warning(
        "CSRF token validation check",
        extra={
            "event_type": "csrf_validation_check",
            "method": request.method,
            "csrf_cookie_present": bool(csrf_cookie),
            "csrf_header_present": bool(csrf_header),
            "request_id": request_id_var.get(),
            "trace_id": trace_id_var.get(),
        },
    )
    if not csrf_cookie or not csrf_header or csrf_cookie != csrf_header:
        logger.error(
            "CSRF token validation failed",
            extra={
                "event_type": "csrf_validation_failure",
                "csrf_cookie_present": bool(csrf_cookie),
                "csrf_header_present": bool(csrf_header),
                "tokens_match": (
                    csrf_cookie == csrf_header if csrf_cookie and csrf_header else False
                ),
                "request_id": request_id_var.get(),
                "trace_id": trace_id_var.get(),
            },
        )
        raise HTTPException(
            status_code=403,
            detail=f"CSRF token missing or incorrect (cookie={csrf_cookie!r} header={csrf_header!r})",
        )


# -----------------------------------------------------------------------------
# Cookie Extraction for HTTP / WebSocket
# -----------------------------------------------------------------------------
def extract_token(request_or_websocket, token_type="access"):
    """
    Retrieves the specified token type from cookies or from the Authorization header.
    Works with both HTTP (Request) and WebSocket objects.

    Args:
        request_or_websocket: The request or websocket object
        token_type: The type of token to extract ('access' or 'refresh')
    """
    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    cookie_name = f"{token_type}_token"

    debugging: bool = bool(getattr(settings, "DEBUG", False))

    def _debug(event: str, **extra):  # type: ignore[no-redef]
        """Helper to emit structured debug logs only when DEBUG is on."""
        if not debugging:
            return
        logger.debug(
            event,
            extra={
                "event_type": event,
                "token_type": token_type,
                **extra,
                "request_id": request_id_var.get(),
                "trace_id": trace_id_var.get(),
            },
        )

    # --------------------------------------------------------------
    # Extraction strategies (ordered)
    # --------------------------------------------------------------

    def _from_parsed_cookies() -> tuple[Optional[str], str]:
        if not hasattr(request_or_websocket, "cookies") or not request_or_websocket.cookies:
            return None, ""
        token_val = request_or_websocket.cookies.get(cookie_name)
        if token_val:
            _debug("token_found_in_cookies", cookie_name=cookie_name)
            return token_val, "cookie"
        return None, ""

    def _from_auth_header() -> tuple[Optional[str], str]:
        if token_type != "access" or not hasattr(request_or_websocket, "headers"):
            return None, ""
        auth_header = request_or_websocket.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            token_val = auth_header[7:]
            _debug("token_found_in_auth_header")
            return token_val, "auth_header"
        return None, ""

    def _from_raw_cookie_header() -> tuple[Optional[str], str]:
        if not hasattr(request_or_websocket, "headers"):
            return None, ""
        cookie_header = request_or_websocket.headers.get("cookie", "")
        if not cookie_header:
            return None, ""
        try:
            parsed = http.cookies.SimpleCookie()
            parsed.load(cookie_header)
            if cookie_name in parsed:
                token_val = parsed[cookie_name].value  # type: ignore[index]
                _debug("token_found_in_ws_header", cookie_name=cookie_name)
                return token_val, "ws_cookie_header"
        except Exception as exc:  # Pragmatic: don't let parse errors explode
            _debug("cookie_header_parse_error", error=str(exc))
        return None, ""

    # --------------------------------------------------------------
    # Attempt extraction in priority order
    # --------------------------------------------------------------

    _debug(
        "token_extraction_start",
        has_cookie_header=bool(
            hasattr(request_or_websocket, "headers") and request_or_websocket.headers.get("cookie")
        ),
    )

    for extractor in (
        _from_parsed_cookies,
        _from_auth_header,
        _from_raw_cookie_header,
    ):
        token_val, src = extractor()
        if token_val:
            _debug("token_extraction_success", source=src, token_preview=token_val[:10] + "...")
            return token_val

    _debug("token_extraction_failure")
    return None


# -----------------------------------------------------------------------------
# User Retrieval from Token
# -----------------------------------------------------------------------------
async def get_user_from_token(
    token: str,
    db: AsyncSession,
    *,
    request: Request | None = None,
    expected_type: str = "access",
) -> User:
    """
    Retrieve and verify a JWT token, then load the user from the database.
    Raises HTTPException if the token is invalid, revoked, expired, or if the user is not found/disabled.
    """
    logger.info(
        "Attempting to get user from token",
        extra={
            "event_type": "get_user_from_token_start",
            "expected_type": expected_type,
            "token_present": bool(token),
            "token_preview": token[:10] if token else None,
            "request_id": request_id_var.get(),
            "trace_id": trace_id_var.get(),
        },
    )

    if not token:
        logger.warning(
            "No token provided for user authentication",
            extra={
                "event_type": "missing_token",
                "expected_type": expected_type,
                "request_id": request_id_var.get(),
                "trace_id": trace_id_var.get(),
            },
        )
        raise HTTPException(
            status_code=401,
            detail=f"Missing {expected_type} token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Verify token and decode its payload
    decoded = await verify_token(token, expected_type=expected_type, db_session=db)
    if not decoded:
        logger.warning(
            "Token verification failed or returned None",
            extra={
                "event_type": "token_verification_failed",
                "expected_type": expected_type,
                "request_id": request_id_var.get(),
                "trace_id": trace_id_var.get(),
            },
        )
        # verify_token itself should raise HTTPException, but as a safeguard:
        raise HTTPException(
            status_code=401,
            detail="Invalid token (verify_token returned None/False)",
            headers={"WWW-Authenticate": "Bearer"},
        )
    logger.info(
        "Token decoded successfully",
        extra={
            "event_type": "token_decoded",
            "sub": decoded.get("sub"),
            "jti": decoded.get("jti"),
            "expected_type": expected_type,
            "request_id": request_id_var.get(),
            "trace_id": trace_id_var.get(),
        },
    )

    username = decoded.get("sub")
    if not username:
        logger.warning(
            "Token missing subject claim",
            extra={
                "event_type": "missing_subject_claim",
                "jti": decoded.get("jti"),
                "request_id": request_id_var.get(),
                "trace_id": trace_id_var.get(),
            },
        )
        raise HTTPException(
            status_code=401,
            detail="Invalid token payload: missing subject",
            headers={"WWW-Authenticate": "Bearer"},
        )
    logger.info(
        "Username extracted from token",
        extra={
            "event_type": "username_extracted",
            "username": username,
            "request_id": request_id_var.get(),
            "trace_id": trace_id_var.get(),
        },
    )

    # Fetch user from DB
    result = await db.execute(select(User).where(User.username == username))
    user = result.scalars().first()

    if not user:
        logger.warning(
            "User not found in database",
            extra={
                "event_type": "user_not_found",
                "username": username,
                "jti": decoded.get("jti"),
                "request_id": request_id_var.get(),
                "trace_id": trace_id_var.get(),
            },
        )
        raise HTTPException(
            status_code=401,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    logger.info(
        "User found in database",
        extra={
            "event_type": "user_found",
            "username": username,
            "user_id": user.id,
            "request_id": request_id_var.get(),
            "trace_id": trace_id_var.get(),
        },
    )

    if not user.is_active:
        logger.warning(
            "Attempt to use token for disabled account",
            extra={
                "event_type": "disabled_account_access",
                "username": username,
                "user_id": user.id,
                "request_id": request_id_var.get(),
                "trace_id": trace_id_var.get(),
            },
        )
        raise HTTPException(
            status_code=403,
            detail="Account disabled",
            headers={"WWW-Authenticate": "Bearer"},
        )
    logger.info(
        "User account is active",
        extra={
            "event_type": "user_active_verified",
            "username": username,
            "user_id": user.id,
            "request_id": request_id_var.get(),
            "trace_id": trace_id_var.get(),
        },
    )

    # Attach token metadata to the user object (optional)
    user.jti = decoded.get("jti")
    user.exp = decoded.get("exp")
    user.active_project_id = decoded.get("project_context")

    # --- REMOVE inactivity check entirely to prevent forced logout ---
    # (If you want to re-enable inactivity, add it back here.)

    # --- PATCH: Always update last_activity on login/refresh/verify ---
    # This prevents the backend from considering the session "inactive" if any code still checks it.
    # WARNING: Do NOT update last_activity here, as it is not committed to DB and may cause ORM to think user is "dirty".
    # If you want to update last_activity, do it only on login/refresh endpoints, not on every token verify.

    return user


# -----------------------------------------------------------------------------
# FastAPI Dependency: Current User & Token
# -----------------------------------------------------------------------------
async def get_current_user_and_token(request: Request) -> Tuple[User, str]:
    """
    FastAPI dependency that:
      1. Extracts an "access" token from the request (cookies or header).
      2. Verifies it and loads the corresponding user.
      3. Returns (User, token) if authenticated, or raises an HTTPException otherwise.
    """
    debugging = hasattr(settings, "DEBUG") and settings.DEBUG
    logger.info(
        "Attempting to extract access token from request",
        extra={
            "event_type": "get_current_user_start",
            "has_cookies": bool(request.cookies),
            "request_id": request_id_var.get(),
            "trace_id": trace_id_var.get(),
        },
    )

    token = extract_token(request)  # extract_token already has good logging
    if not token:
        logger.warning(
            "Access token not found in request",
            extra={
                "event_type": "access_token_not_found",
                "request_id": request_id_var.get(),
                "trace_id": trace_id_var.get(),
            },
        )
        # Log headers for more context if debugging is enabled
        if debugging:
            logger.debug(
                "Request headers for missing token debug",
                extra={
                    "event_type": "missing_token_debug",
                    "has_auth_header": bool(request.headers.get("authorization")),
                    "has_cookie_header": bool(request.headers.get("cookie")),
                    "request_id": request_id_var.get(),
                    "trace_id": trace_id_var.get(),
                },
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated (token not found by extract_token)",
            headers={"WWW-Authenticate": "Bearer"},
        )
    logger.info(
        "Token extracted successfully",
        extra={
            "event_type": "token_extracted",
            "token_preview": token[:10],
            "request_id": request_id_var.get(),
            "trace_id": trace_id_var.get(),
        },
    )

    # Token verification + user load within a single DB session
    async with get_async_session_context() as db:
        user = await get_user_from_token(
            token, db, request=request, expected_type="access"
        )
    logger.info(
        "Successfully retrieved user from token",
        extra={
            "event_type": "get_current_user_success",
            "username": user.username,
            "user_id": user.id,
            "request_id": request_id_var.get(),
            "trace_id": trace_id_var.get(),
        },
    )
    return user, token


# -----------------------------------------------------------------------------
# FastAPI Dependency: Current User Only
# -----------------------------------------------------------------------------
async def get_current_user(request: Request) -> User:
    """
    FastAPI dependency that returns only the authenticated User object.
    """
    user, _ = await get_current_user_and_token(request)
    return user
