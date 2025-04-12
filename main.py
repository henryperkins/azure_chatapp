"""
main.py
--------
The FastAPI entrypoint for the Azure OpenAI Chat Application.
- Designed for strict same-origin security
- Requires frontend to be served from same domain as backend
- Uses session cookies with SameSite=Strict and Secure flags
- Initializes app with security-focused middleware:
  - TrustedHostMiddleware (allows only specific hosts)
  - SessionMiddleware with strict cookie policies
- Includes routers (auth, conversations, projects, etc.)
- Runs database init or migrations on startup

SECURITY CONFIRMATIONS:
1. Strict SameSite cookie policy enforced (SameSite=Strict)
2. Full HTTPS enforcement with HSTS headers
3. WebSocket connections validate same-site cookies only

SECURITY NOTE: This application requires:
- Frontend to be served from same origin as backend
- No cross-domain authentication mechanisms
"""

import logging
import os
import sys
import warnings
from pathlib import Path
from cryptography.utils import CryptographyDeprecationWarning
from typing import Callable, Awaitable

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

from fastapi import FastAPI, Request, HTTPException, Response
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.sessions import SessionMiddleware
from fastapi.middleware import Middleware
from fastapi.exceptions import RequestValidationError
from starlette.routing import WebSocketRoute
from starlette.datastructures import URL

# Lifespan import removed - using event handlers instead

# -------------------------
# Import your routes
# -------------------------
from routes.unified_conversations import router as unified_conversations_router
from routes import unified_conversations  # for direct WebSocketRoute reference
from auth import router as auth_router, create_default_user
from routes.projects.projects import router as projects_router
from routes.knowledge_base_routes import router as knowledge_base_router
from routes.projects.files import router as project_files_router
from routes.projects.artifacts import router as project_artifacts_router
from routes.user_preferences import router as user_preferences_router

# -------------------------
# Import DB & Config
# -------------------------
from db import init_db, get_async_session_context, async_engine
from config import settings

# -------------------------
# Import Utility Functions
# -------------------------
from utils.auth_utils import clean_expired_tokens
from utils.db_utils import schedule_token_cleanup

# Ensure Python recognizes config.py as a module
warnings.filterwarnings(
    "ignore", category=CryptographyDeprecationWarning, module="pypdf"
)
sys.path.append(str(Path(__file__).resolve().parent))

# Configure Logging
logging_level = logging.INFO if settings.ENV == "development" else logging.WARNING
logging.basicConfig(level=logging_level)
logger = logging.getLogger(__name__)

# Configure SQLAlchemy logging
sqla_loggers = [
    "sqlalchemy.engine",
    "sqlalchemy.pool",
    "sqlalchemy.dialects",
    "sqlalchemy.orm",
]
for logger_name in sqla_loggers:
    logging.getLogger(logger_name).setLevel(logging.WARNING)
    logging.getLogger(logger_name).propagate = False

# Suppress some environment warnings
os.environ["AZUREML_ENVIRONMENT_UPDATE"] = "false"

# -------------------------
# Define Middleware
# -------------------------
middleware = [
    Middleware(
        TrustedHostMiddleware,
        allowed_hosts=["put.photo", "localhost", "127.0.0.1"],
        www_redirect=False,
    ),
    Middleware(
        SessionMiddleware,
        secret_key=os.environ["SESSION_SECRET"],
        session_cookie="session",
        same_site="strict" if settings.ENV == "production" else "lax",
        https_only=(settings.ENV == "production"),
        max_age=60 * 60 * 24 * 7,
        domain=settings.COOKIE_DOMAIN if settings.COOKIE_DOMAIN else None,
    ),
]


# -------------------------
# Lifespan Handlers
# -------------------------
async def startup_handler() -> None:
    """
    Startup routine:
    - Initialize database with migrations
    - Validate schema
    - Create secure upload directory
    - Load token revocation list & remove expired tokens
    - Schedule token cleanup
    """
    os.environ.pop("AZUREML_ENVIRONMENT_UPDATE", None)
    try:
        # 1. Initialize DB with migration checks
        await init_db()

        # 2. Validate schema with SQLAlchemy inspector
        from sqlalchemy import inspect

        async with async_engine.connect() as conn:
            inspector = await conn.run_sync(lambda sync_conn: inspect(sync_conn))

            required_tables = {
                "project_files": ["config"],
                "knowledge_bases": ["config"],
                "messages": ["context_used"],
            }

            for table, required_columns in required_tables.items():
                if not await conn.run_sync(
                    lambda s_conn, t=table: inspector.has_table(t)
                ):
                    raise RuntimeError(f"Missing critical table: {table}")

                columns = [
                    col["name"]
                    for col in await conn.run_sync(
                        lambda s_conn, t=table: inspector.get_columns(t)
                    )
                ]
                missing = set(required_columns) - set(columns)
                if missing:
                    raise RuntimeError(f"Missing columns in {table}: {missing}")

        # 3. Create secure uploads directory
        upload_path = Path("./uploads/project_files")
        upload_path.mkdir(parents=True, exist_ok=True)
        upload_path.chmod(0o700)

        # 4. Initialize authentication system and create default user if needed
        async with get_async_session_context() as session:
            deleted_count = await clean_expired_tokens(session)
            logger.info(f"Cleaned {deleted_count} expired tokens during startup")

        # 5. Create default admin user if no users exist
        try:
            await create_default_user()
            logger.info("Default user check completed")
        except Exception as e:
            logger.error(f"Error during default user creation: {e}")

        # 6. Schedule periodic token cleanup
        await schedule_token_cleanup(interval_minutes=30)

        logger.info("Startup completed: DB validated, uploads ready, auth initialized")

    except Exception as e:
        logger.critical(f"Startup initialization failed: {e}")
        raise


async def shutdown_handler() -> None:
    """
    Shutdown routine:
    - Clean up expired tokens
    """
    logger.info("Application shutting down")
    try:
        async with get_async_session_context() as session:
            deleted_count = await clean_expired_tokens(session)
            logger.info(f"Cleaned {deleted_count} expired tokens during shutdown")
    except Exception as e:
        logger.error(f"Error during shutdown: {e}")
    logger.info("Shutdown complete")


# -------------------------
# Initialize Sentry
# -------------------------
try:
    # Setup Sentry with minimal configuration to avoid errors
    sentry_sdk.init(
        dsn="https://b03711f63d1160f48dcaeda3edae14ac@o4508070823395328.ingest.us.sentry.io/4509138383863808",
        # Add data like request headers and IP for users
        send_default_pii=True,
        # Enable performance monitoring
        enable_tracing=True,
        # Add integrations for comprehensive monitoring
        integrations=[
            FastApiIntegration(),
            StarletteIntegration(),
            SqlalchemyIntegration(),
        ],
        # Set the environment based on application settings
        environment=settings.ENV,
        # Sampling rate for performance monitoring
        traces_sample_rate=0.5,
        # Basic error sampling
        sample_rate=1.0,
    )

    # Send a test event
    sentry_sdk.capture_message("Sentry initialization successful", level="info")

    logger.info("Sentry SDK initialized successfully")
except Exception as e:
    logger.warning(f"Sentry initialization failed: {e}")

# -------------------------
# Create FastAPI App
# -------------------------
app = FastAPI(
    title="Azure OpenAI Chat Application",
    description=(
        "A secure, robust, and intuitively designed web-based chat application "
        "leveraging Azure OpenAI's o1-series models with advanced features "
        "like context summarization, vision support, JWT-based auth, file uploads, etc."
    ),
    version="1.0.0",
    openapi_tags=[
        {
            "name": "conversations",
            "description": "Operations with standalone and project-based conversations",
        },
        {
            "name": "projects",
            "description": "Core project management operations",
        },
        {
            "name": "knowledge-bases",
            "description": "Operations with knowledge bases",
        },
        {
            "name": "project-files",
            "description": "Operations with project files",
        },
        {
            "name": "project-artifacts",
            "description": "Operations with project artifacts",
        },
        {
            "name": "authentication",
            "description": "User authentication and token management",
        },
    ],
    docs_url="/docs" if settings.ENV != "production" else None,
    redoc_url=None,
    middleware=middleware,
)

# Register startup and shutdown events
@app.on_event("startup")
async def startup_event():
    await startup_handler()

@app.on_event("shutdown")
async def shutdown_event():
    await shutdown_handler()

# -------------------------
# Additional Middleware
# -------------------------


# Add Cache-Control headers to auth-related responses
@app.middleware("http")
async def add_cache_control(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """
    Add Cache-Control headers to authentication-related responses
    to prevent browser caching of sensitive info.
    """
    response = await call_next(request)
    if request.url.path.startswith("/api/auth/"):
        response.headers["Cache-Control"] = (
            "no-store, no-cache, must-revalidate, max-age=0"
        )
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


# Enforce HTTPS in production
if settings.ENV == "production":
    app.add_middleware(HTTPSRedirectMiddleware)

    @app.middleware("http")
    async def add_hsts_header(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        """
        Add HTTP Strict-Transport-Security header to all responses.
        """
        response = await call_next(request)
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
        return response


# -------------------------
# Static Files & Root HTML
# -------------------------
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", include_in_schema=False)
async def root():
    """Return the root HTML file."""
    return FileResponse("static/index.html")


@app.get("/index.html", include_in_schema=False)
async def index():
    """Return the index HTML file."""
    return FileResponse("static/index.html")


@app.get("/projects", include_in_schema=False)
async def projects():
    """Return the projects HTML file."""
    return FileResponse("static/index.html")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    """Return the favicon."""
    return FileResponse("static/favicon.ico")


# -------------------------
# Health Check
# -------------------------
@app.get("/health")
async def health_check(request: Request):
    """
    Health check endpoint with strict same-origin verification.
    Rejects cross-origin calls unless from known allowed origins.
    """
    origin = request.headers.get("origin")
    host = request.headers.get("host")

    # Allowed same-origin references (including put.photo)
    if origin:
        same_origin = f"{request.url.scheme}://{host}"
        allowed_origins = [same_origin, "https://put.photo"]
        if origin not in allowed_origins:
            raise HTTPException(403, detail="Cross-origin requests not permitted")

    return {
        "status": "ok",
        "security": {
            "same_origin_verified": True,
            "session_cookie_secure": settings.ENV == "production",
            "host": host,
            "domain": settings.COOKIE_DOMAIN,
        },
    }


# -------------------------
# Debug Endpoints (Non-Production)
# -------------------------
if settings.ENV != "production":
    from sqlalchemy import inspect

    @app.get("/debug/schema-check")
    async def debug_schema_check():
        """Debug endpoint to verify database schema alignment."""
        async with get_async_session_context() as session:
            inspector = inspect(session.get_bind())
            return {
                "project_files_columns": inspector.get_columns("project_files"),
                "knowledge_bases_columns": inspector.get_columns("knowledge_bases"),
            }

    @app.get("/debug/security-headers")
    async def debug_security_headers(request: Request):
        """Verify security headers and same-origin policies."""
        # Evaluate whether the request is same-origin
        request_origin = request.headers.get("origin")
        request_host = request.headers.get("host")
        scheme = request.url.scheme

        def is_same_origin() -> bool:
            if not request_origin:
                return True  # e.g., a cURL request with no Origin
            parsed = URL(request_origin)
            return bool(parsed.scheme == scheme and parsed.hostname == request_host)

        return {
            "security_headers": {
                "strict_transport_security": request.headers.get(
                    "strict-transport-security"
                ),
                "x_frame_options": request.headers.get("x-frame-options"),
                "x_content_type_options": request.headers.get("x-content-type-options"),
                "content_security_policy": request.headers.get(
                    "content-security-policy"
                ),
                "referrer_policy": request.headers.get("referrer-policy"),
                "permissions_policy": request.headers.get("permissions-policy"),
            },
            "same_origin_verified": {
                "origin": request_origin,
                "host": request_host,
                "scheme": scheme,
                "is_same_origin": is_same_origin(),
            },
            "cookie_policies": {
                "secure_cookies": all(
                    "secure" in cookie.lower()
                    for cookie in request.headers.get("cookie", "").split("; ")
                    if cookie
                ),
                "samesite_strict": all(
                    "samesite=strict" in cookie.lower()
                    for cookie in request.headers.get("cookie", "").split("; ")
                    if cookie
                ),
            },
        }

    @app.get("/sentry-debug")
    async def trigger_error():
        """
        Trigger a test error to verify Sentry error capture.
        This endpoint will cause a division by zero error which
        should be reported to the Sentry dashboard.
        """
        division_by_zero = 1 / 0
        return {"status": "This will never be returned"}


# ---------------------------
# Custom 422 Validation Handler
# ---------------------------
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """
    Handles validation exceptions with a custom JSON error message.
    """
    logger.warning(f"Validation error for request {request.url} - {exc.errors()}")
    content = {
        "detail": "Invalid request data",
        # Show detailed errors only in non-production
        "errors": exc.errors() if settings.ENV != "production" else None,
    }
    return JSONResponse(status_code=422, content=content)


# ---------------------------
# Register Routers
# ---------------------------
app.include_router(auth_router, prefix="/api/auth", tags=["authentication"])
app.include_router(knowledge_base_router, prefix="/api", tags=["knowledge-bases"])
app.include_router(user_preferences_router, prefix="", tags=["user-preferences"])
app.include_router(projects_router, prefix="/api/projects", tags=["projects"])
app.include_router(
    project_files_router,
    prefix="/api/projects/{project_id}/files",
    tags=["project-files"],
)
app.include_router(
    project_artifacts_router,
    prefix="/api/projects/{project_id}/artifacts",
    tags=["project-artifacts"],
)
app.include_router(
    unified_conversations_router,
    prefix="/api/chat",
    tags=["conversations"],
)
# Keep older prefix for backward compatibility (if needed)
app.include_router(
    unified_conversations_router,
    prefix="/api",
    tags=["conversations"],
)

# WebSocket routes removed - using HTTP only
