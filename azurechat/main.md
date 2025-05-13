```python
"""
FastAPI Application Entrypoint (INSECURE/DEBUG)
-----------------------------------------------

Main application bootstrap for the development/debug version of the API service.
This script configures and launches a FastAPI app with relaxed security, permissive
CORS/session settings, and auto-registration of REST routers for all project endpoints.

Features and Debug/Integration Notes:
- Loads all API routers, models, and services, ensuring that migrations and runtime wiring are complete for all features.
- Exposes static files, HTML frontend endpoints, and health/debug routes for rapid iteration and troubleshooting.
- WARNING: CORS, session management, and security settings are intentionally permissive ("allow all") and are NOT safe/recommended for any production deployment!
- App startup runs full DB initialization and can create default/test users for local convenience.
- Integrates Sentry for error tracking (if enabled in environment), with sampling, custom event filtering, and direct error reporting on unhandled exceptions.
- Auto-attaches logging, per-request UUID correlation, and database-available status middleware for developer observability.
- Exception handling is broad and noisy (intentionally: debug visibility), logs all errors, and reports to Sentry if configured.
- Uvicorn/server entrypoint provided for local run convenience (`python main.py`).

Usage:
- For **local development only**: run as `python main.py`, then access docs/HTML frontend via exposed endpoints.
- DO NOT run this file (configuration or image) in real deployments—security model is for debug only.

Key Integration Points:
- All dependencies, routers, and middleware are auto-registered based on project config.
- Environment variables/settings used: APP_NAME, APP_VERSION, ENVIRONMENT, SENTRY_* (see code for details).
- For secure deployments, ensure usage of a production-hardened entrypoint instead.

"""

import os
import logging
import uuid
from typing import Dict, Any, Optional, cast

import sentry_sdk
from sentry_sdk.integrations.logging import LoggingIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
from sentry_sdk.integrations.asyncio import AsyncioIntegration
from fastapi import FastAPI, Request, HTTPException, Response
from fastapi.responses import JSONResponse, FileResponse
# …
# Dev helper: always deliver fresh JS/CSS/HTML – disables browser cache
from fastapi.staticfiles import StaticFiles

class NoCacheStatic(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200 and path.endswith(('.js', '.css', '.html')):
            response.headers['Cache-Control'] = 'no-store'
        return response
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
        elif isinstance(allowed_origins, list):
            # Already a list, make sure all items are properly stripped strings
            allowed_origins = [str(o).strip() for o in allowed_origins if str(o).strip()]
        else:
            # Handle any other data type by converting to a single-item list
            allowed_origins = [str(allowed_origins).strip()]
    else:
        # Allow all origins for local development and debugging
        allowed_origins = ["*"]

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

    # Add a simple CSP header middleware if you want CSP headers:
    @app.middleware("http")
    async def csp_header_middleware(request: Request, call_next):
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = (
            # ────────── BASE DIRECTIVES ──────────
            "default-src 'self' blob:; "
            # allow API calls to backend + sentry endpoints
            "connect-src 'self' http://localhost:8000 http://localhost:8001 "
            "https://o4508070823395328.ingest.us.sentry.io "
            "https://js.sentry-cdn.com https://browser.sentry-cdn.com; "
            # ────────── JS LOADERS ──────────
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' "
            "https://js.sentry-cdn.com https://browser.sentry-cdn.com; "
            "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' "
            "https://js.sentry-cdn.com https://browser.sentry-cdn.com; "
            # ────────── WORKERS / CHILDREN ──────────
            "worker-src 'self' blob:; "
            "child-src  'self' blob:; "
            # ────────── MEDIA / STYLES ──────────
            "img-src 'self' data: blob: https://*.sentry.io https://*.sentry-cdn.com; "
            "style-src 'self' 'unsafe-inline'; "
            "font-src  'self';"
        )
        return response

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
        # SqlalchemyIntegration(), # Temporarily commented out to diagnose greenlet_spawn issue
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

# ----- Ensure ALL models are registered for migrations/table creation -----
import models

# Import your routers
from auth import router as auth_router, create_default_user
from routes.knowledge_base_routes import router as knowledge_base_router
from routes.projects.projects import router as projects_router
from routes.projects.files import router as project_files_router
from routes.projects.artifacts import router as project_artifacts_router
from routes.user_preferences import router as user_preferences_router
from routes.unified_conversations import router as conversations_router
from routes.sentry_test import router as sentry_test_router
from routes.log_notification import router as log_notification_router

from routes.admin import router as admin_router

APP_NAME = os.getenv("APP_NAME", "Insecure Debug App")
APP_VERSION = os.getenv("APP_VERSION", settings.APP_VERSION)
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")  # Default to dev

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logging.getLogger("urllib3").setLevel(logging.INFO)  # suprime spam DEBUG
logger = logging.getLogger(__name__)

# -----------------------------------------------------------------------------
# Suppress /api/log_notification and common vulnerability scan paths in access logs
# -----------------------------------------------------------------------------
class SuppressUnwantedLogsFilter(logging.Filter):
    def filter(self, record):
        msg = str(record.getMessage())
        # Suppress any access log for /api/log_notification
        if "/api/log_notification" in msg:
            return False

        # Suppress common WordPress/PHP vulnerability scan paths
        unwanted_paths = [
            "/wp-", ".php", "/wordpress", "/wp-admin", "/wp-content",
            "/wp-includes", "/.well-known/acme-challenge"
        ]
        if any(path in msg for path in unwanted_paths):
            return False

        return True

# Apply the filter to all noisy access loggers
for logname in ("uvicorn.access", "", "notification_system"):
    logging.getLogger(logname).addFilter(SuppressUnwantedLogsFilter())

# Create app with docs always enabled (even in "production" - insecure for debug)
app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description="INSECURE/DEBUG API",
    docs_url="/docs",
    redoc_url="/redoc",
)

# --- DB availability flag ---
DB_AVAILABLE = True

# Apply insecure middlewares
setup_middlewares_insecure(app)

# Optionally configure Sentry in debug mode
configure_sentry_insecure(APP_NAME, APP_VERSION, ENVIRONMENT)


@app.on_event("startup")
async def on_startup():
    """Initialize services for debugging, with minimal checks."""
    global DB_AVAILABLE
    try:
        await init_db()
        await create_default_user()  # Insecure default user creation
        await schedule_token_cleanup(interval_minutes=30)
        logger.info(f"{APP_NAME} v{APP_VERSION} started in debug mode.")
        DB_AVAILABLE = True
    except Exception as exc:
        logger.critical(f"Startup failed: {exc}", exc_info=True)
        DB_AVAILABLE = False


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

# Enhanced static file serving with more debugging
try:
    # Check if modals.html exists
    modals_path = os.path.join(STATIC_DIR, "html", "modals.html")
    if os.path.isfile(modals_path):
        logger.info(f"Found modals.html at: {modals_path}")
    else:
        logger.critical(f"CRITICAL: modals.html not found at: {modals_path}")
        # Try to locate modals.html anywhere in the project
        import glob

        modals_files = glob.glob("**/modals.html", recursive=True)
        if modals_files:
            logger.info(f"Found modals.html in alternative locations: {modals_files}")
        else:
            logger.info("Could not find modals.html anywhere in the project")

    # Mount static directory
    app.mount("/static", NoCacheStatic(directory=STATIC_DIR), name="static")
    logger.info(f"Static files mounted from {STATIC_DIR}")
except Exception as e:
    logger.critical(f"Failed to mount static files: {str(e)}", exc_info=True)
    raise RuntimeError(f"Failed to mount static files: {str(e)}")


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


@app.get("/modals", include_in_schema=False)
async def serve_modals(request: Request) -> Response:
    """
    Special direct route to serve modals.html for debugging.
    """
    modals_path = "static/html/modals.html"
    if os.path.isfile(modals_path):
        logger.info(f"Serving modals.html via direct route from: {modals_path}")
        return FileResponse(modals_path)
    else:
        logger.error(f"modals.html not found at {modals_path} in direct route")
        return JSONResponse(
            status_code=404,
            content={"detail": f"modals.html not found at {modals_path}"},
        )


@app.get("/health")
async def health_check() -> Dict[str, Any]:
    """
    Debug health endpoint with DB status.
    """
    return {
        "status": "healthy (INSECURE DEBUG)",
        "db_available": DB_AVAILABLE,
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
app.include_router(user_preferences_router, tags=["preferences"])
app.include_router(conversations_router, prefix="/api/projects", tags=["conversations"])
app.include_router(log_notification_router)
# Debug-only Sentry test routes
app.include_router(sentry_test_router, prefix="/debug/sentry", tags=["monitoring"])

# Admin/debug repairs
app.include_router(admin_router, prefix="/api/admin", tags=["admin"])



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
# Request ID Logging Middleware
# -----------------------------------------------------------------------------
@app.middleware("http")
async def request_id_logging_middleware(request: Request, call_next):
    """
    Attach a per-request UUID so every log/Sentry event can be correlated.
    Also logs basic ↗/↘ lines and returns the ID in a response header.
    """
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id

    logger.info("[%s] ↗ %s %s%s",
                request_id,
                request.method,
                request.url.path,
                f"?{request.url.query}" if request.url.query else "")

    try:
        response = await call_next(request)
    except Exception as exc:
        # delegate to generic handler so it still gets Sentry + JSON payload
        response = await generic_exception_handler(request, exc)

    response.headers["X-Request-ID"] = request_id
    logger.info("[%s] ↘ %s %s – %s",
                request_id,
                response.status_code,
                request.method,
                request.url.path)
    return response

# -----------------------------------------------------------------------------
# DB Down Middleware (friendly error if DB unavailable)
# -----------------------------------------------------------------------------
@app.middleware("http")
async def db_availability_middleware(request: Request, call_next):
    # Allow health, static, and root pages even if DB is down
    allowed_paths = [
        "/health", "/static", "/", "/login", "/modals", "/docs", "/redoc"
    ]
    if not DB_AVAILABLE and not any(request.url.path == p or request.url.path.startswith(p + "/") for p in allowed_paths):
        return JSONResponse(
            status_code=503,
            content={
                "detail": "Service temporarily unavailable: database connection failed at startup. Please try again later or contact support."
            },
        )
    return await call_next(request)

# -----------------------------------------------------------------------------
# Exception Handlers
# -----------------------------------------------------------------------------
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    rid = getattr(request.state, "request_id", "n/a")
    logger.warning("[%s] HTTPException %s – %s", rid, exc.status_code, exc.detail)

    if exc.status_code >= 500:
        with sentry_sdk.push_scope() as scope:
            scope.set_tag("request_id", rid)
            scope.set_tag("http_status", exc.status_code)
            scope.set_extra("path", request.url.path)
            sentry_sdk.capture_exception(exc)

    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    rid = getattr(request.state, "request_id", "n/a")
    logger.error("[%s] Unhandled exception: %s", rid, exc, exc_info=True)

    with sentry_sdk.push_scope() as scope:
        scope.set_tag("request_id", rid)
        scope.set_extra("path", request.url.path)
        scope.set_extra("query_params", dict(request.query_params))
        sentry_sdk.capture_exception(exc)

    return JSONResponse(status_code=500,
                        content={"detail": "Internal server error (insecure debug)"})


# -----------------------------------------------------------------------------
# -----------------------------------------------------------------------------
# Log Notification API Endpoint for Frontend <--- ADDED
# (Removed: now handled by routes.log_notification router)

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

```