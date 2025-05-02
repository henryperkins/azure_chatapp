"""
main.py (insecure/debug version)
--------------------------------
FastAPI application entry point with relaxed security, suitable
ONLY for local development or troubleshooting. NOT for production!
"""

import os
import logging
from typing import Dict, Any, Optional, cast

import sentry_sdk
from sentry_sdk.integrations.logging import LoggingIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
from sentry_sdk.integrations.asyncio import AsyncioIntegration
from fastapi import FastAPI, Request, HTTPException, Response
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from fastapi.routing import APIRoute
from sentry_sdk.types import Event, Hint


# -----------------------------------------------------------------------------
# Insecure Middleware Setup
# -----------------------------------------------------------------------------
def setup_middlewares_insecure(app: FastAPI) -> None:
    """
    Sets up minimal or insecure middlewares for debugging.
    Mounts CORS only for localhost for local dev safety,
    but never in prod. Ensures only one CORS middleware exists.

    If ENV is production, refuses to start with insecure CORS!
    """

    is_production = getattr(settings, "ENV", "development").lower() == "production"
    # Accept allowed origins from env for dev flexibility
    allowed_origins = getattr(settings, "CORS_ORIGINS", None)
    if allowed_origins:
        if isinstance(allowed_origins, str):
            allowed_origins = [
                o.strip() for o in allowed_origins.split(",") if o.strip()
            ]
    else:
        allowed_origins = [
            "http://localhost",
            "http://127.0.0.1",
            "http://localhost:8000",
            "http://127.0.0.1:8000",
        ]

    if is_production:
        # Extra hard lock—never allow this CORS in prod!
        raise RuntimeError(
            "Refusing to start with debug/insecure CORS settings in production!\n"
            "Update CORS config for production or use setup_middlewares_secure()."
        )

    # Session middleware for local development.
    # ⚡ PATCH: Use settings.SESSION_SECRET, crash if missing unless DEBUG
    session_secret = getattr(settings, "SESSION_SECRET", None) or "DEV_DEBUG_KEY"
    assert session_secret and session_secret != "DEV_DEBUG_KEY", (
        "SESSION_SECRET missing or insecure! Refusing to launch without a strong secret."
        "\nSet a robust SESSION_SECRET in your env file for any real usage."
    )

    app.add_middleware(
        SessionMiddleware,
        secret_key=session_secret,
        session_cookie="session",
        same_site="lax",  # Use "lax" for local dev, or "strict" if you prefer
        https_only=False,  # Do not require HTTPS for local dev
        max_age=60 * 60 * 24 * 7,  # 7 days
    )

    # ⚡ PATCH: Only add CORS if not production, no wide-open allowed.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # If you still want to test or see behavior, you could add HTTPSRedirectMiddleware,
    # but here we skip it to remain on plain HTTP (insecure).


# -----------------------------------------------------------------------------
# Optional: Sentry Filtering (still recommended for data privacy)
# -----------------------------------------------------------------------------
def filter_sensitive_event(event: Event, hint: Hint) -> Optional[Event]:
    """Filter sensitive data from Sentry events (still recommended even in debug)."""
    try:
        if "request" in event and isinstance(event["request"], dict):
            req_data = cast(dict, event["request"])
            if "headers" in req_data and isinstance(req_data["headers"], dict):
                headers = req_data["headers"]
                for header in ["authorization", "cookie", "x-api-key"]:
                    if header in headers:
                        headers[header] = "[FILTERED]"
        if "user" in event and isinstance(event["user"], dict):
            user = event["user"]
            if "email" in user:
                user["email"] = "[FILTERED]"
        return event
    except Exception as e:
        logging.error(f"Error filtering event in debug mode: {str(e)}")
        return event


# -----------------------------------------------------------------------------
# Optional: Sentry Setup for Insecure/Debug
# -----------------------------------------------------------------------------
def configure_sentry_insecure(app_name: str, app_version: str, env: str) -> None:
    """Configure Sentry in debug mode if needed. Otherwise, skip."""
    SENTRY_ENABLED = os.getenv("SENTRY_ENABLED", "false").lower() == "true"
    SENTRY_DSN = os.getenv("SENTRY_DSN", "")
    if not SENTRY_ENABLED or not SENTRY_DSN:
        logging.info("Sentry is disabled or DSN not provided (debug mode).")
        return

    sentry_logging = LoggingIntegration(level=logging.INFO, event_level=logging.ERROR)
    integrations = [
        sentry_logging,
        FastApiIntegration(transaction_style="endpoint"),
        SqlalchemyIntegration(),
        AsyncioIntegration(),
    ]

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=env,
        release=f"{app_name}@{app_version}",
        traces_sample_rate=1.0,  # High sample rate for debugging
        profiles_sample_rate=1.0,
        send_default_pii=False,
        attach_stacktrace=True,
        integrations=integrations,
        before_send=filter_sensitive_event,
        debug=False,  # Debug mode
    )
    sentry_sdk.set_tag("app", app_name)
    sentry_sdk.set_tag("environment", env)
    logging.info("Sentry initialized in debug mode")


# -----------------------------------------------------------------------------
# FastAPI & Application Setup
# -----------------------------------------------------------------------------
from config import settings
from db import init_db, get_async_session_context
from utils.auth_utils import clean_expired_tokens
from utils.db_utils import schedule_token_cleanup
from db.schema_manager import SchemaManager

# Import your routers
from auth import router as auth_router, create_default_user
from routes.knowledge_base_routes import router as knowledge_base_router
from routes.projects.projects import router as projects_router
from routes.projects.files import router as project_files_router
from routes.projects.artifacts import router as project_artifacts_router
from routes.user_preferences import router as user_preferences_router
from routes.unified_conversations import router as conversations_router
from routes.sentry_test import router as sentry_test_router
from routes.user_preferences import router as user_preferences_router
from routes.log_notification import router as log_notification_router

APP_NAME = os.getenv("APP_NAME", "Insecure Debug App")
APP_VERSION = os.getenv("APP_VERSION", settings.APP_VERSION)
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")  # Default to dev

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Create app with docs always enabled (even in "production" - insecure for debug)
app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description="INSECURE/DEBUG API",
    docs_url="/docs",
    redoc_url="/redoc",
)

# Apply insecure middlewares
setup_middlewares_insecure(app)

# Optionally configure Sentry in debug mode
configure_sentry_insecure(APP_NAME, APP_VERSION, ENVIRONMENT)


@app.on_event("startup")
async def on_startup():
    """Initialize services for debugging, with minimal checks."""
    try:
        await init_db()
        # Run schema migration/validation at startup
        schema_manager = SchemaManager()
        await schema_manager.initialize_database()
        await create_default_user()  # Insecure default user creation
        await schedule_token_cleanup(interval_minutes=30)
        logger.info(f"{APP_NAME} v{APP_VERSION} started in debug mode.")
    except Exception as exc:
        logger.critical(f"Startup failed: {exc}", exc_info=True)


@app.on_event("shutdown")
async def on_shutdown():
    """Clean up resources on shutdown."""
    try:
        async with get_async_session_context() as session:
            await clean_expired_tokens(session)
        logger.info("Application shutdown complete (debug mode).")
    except Exception as exc:
        logger.error(f"Shutdown error: {exc}", exc_info=True)


# Serve static files with directory check (always absolute, robust for debug and prod)
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if not os.path.isdir(STATIC_DIR):
    logger.critical(f"Static directory not found: {STATIC_DIR}. Aborting startup.")
    raise RuntimeError(f"Static directory not found: {STATIC_DIR}")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
async def index(request: Request) -> Response:
    """
    Insecurely serve an HTML page (base.html).
    """
    return FileResponse("static/html/base.html")


@app.get("/login", include_in_schema=False)
async def serve_login(request: Request) -> Response:
    """
    Insecurely serve the login page.
    """
    return FileResponse("static/html/login.html")


@app.get("/health")
async def health_check() -> Dict[str, Any]:
    """
    Debug health endpoint with minimal data.
    """
    return {
        "status": "healthy (INSECURE DEBUG)",
        "environment": ENVIRONMENT,
        "app_name": APP_NAME,
        "version": APP_VERSION,
    }


# Include your API routers (includes insecure auth, etc.)
app.include_router(auth_router, prefix="/api/auth", tags=["authentication"])
app.include_router(
    knowledge_base_router, prefix="/api/projects", tags=["knowledge-bases"]
)
app.include_router(projects_router, prefix="/api/projects", tags=["projects"])
app.include_router(
    project_files_router, prefix="/api/projects/{project_id}/files", tags=["files"]
)
app.include_router(
    project_artifacts_router,
    prefix="/api/projects/{project_id}/artifacts",
    tags=["artifacts"],
)
app.include_router(
    user_preferences_router, tags=["preferences"]
)
app.include_router(conversations_router, prefix="/api/projects", tags=["conversations"])
app.include_router(log_notification_router, tags=["notification-log"])

# Debug-only Sentry test routes
app.include_router(sentry_test_router, prefix="/debug/sentry", tags=["monitoring"])


@app.get("/debug/routes", include_in_schema=False)
async def debug_routes() -> list[Dict[str, Any]]:
    """List all registered routes for debugging."""

    return [
        {
            "path": route.path,
            "name": route.name,
            "methods": list(route.methods),
        }
        for route in app.routes
        if isinstance(route, APIRoute)
    ]


# -----------------------------------------------------------------------------
# Exception Handlers
# -----------------------------------------------------------------------------
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Return a JSON error response for HTTP-related issues."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Catch-all for unhandled exceptions. Returns a generic debug message.
    """
    logger.error(f"Unhandled exception (debug mode): {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error (insecure debug)"},
    )


# -----------------------------------------------------------------------------
# Uvicorn Entry
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        log_level="debug",
    )
