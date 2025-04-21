"""
main.py
-------
FastAPI application entry point with enhanced configuration, middleware,
and security settings. Includes Sentry integration, CSP support, and
optimized request handling.
"""

import os
import logging
from typing import Callable, Awaitable, Dict, Any
import sentry_sdk
from sentry_sdk.integrations.logging import LoggingIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
from sentry_sdk.integrations.asyncio import AsyncioIntegration
from fastapi import FastAPI, Request, HTTPException, Response
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.sessions import SessionMiddleware
from fastapi.routing import APIRoute

# Import middleware setup
from utils.middlewares import setup_middlewares

# Import routers
from auth import router as auth_router, create_default_user
from routes.knowledge_base_routes import router as knowledge_base_router
from routes.projects.projects import router as projects_router
from routes.projects.files import router as project_files_router
from routes.projects.artifacts import router as project_artifacts_router
from routes.user_preferences import router as user_preferences_router
from routes.unified_conversations import router as conversations_router
from routes.sentry_test import router as sentry_test_router

# Database and configuration
from db import init_db, get_async_session_context
from config import settings
from utils.auth_utils import clean_expired_tokens
from utils.db_utils import schedule_token_cleanup

# Configure environment variables
APP_NAME = os.getenv("APP_NAME", "Azure Chat App")
APP_VERSION = os.getenv("APP_VERSION", settings.APP_VERSION)
ENVIRONMENT = os.getenv("ENVIRONMENT", settings.ENV)
SENTRY_ENABLED = (
    os.getenv("SENTRY_ENABLED", str(settings.SENTRY_ENABLED)).lower() == "true"
)
SENTRY_DSN = os.getenv("SENTRY_DSN", settings.SENTRY_DSN)
TRUSTED_HOSTS = os.getenv("TRUSTED_HOSTS", ",".join(settings.ALLOWED_HOSTS)).split(",")
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "").split(",") or [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]

# Configure logging
logging.basicConfig(
    level=logging.INFO if ENVIRONMENT == "development" else logging.WARNING,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def configure_sentry() -> None:
    """Configure Sentry SDK with proper integrations and settings."""
    if not settings.SENTRY_ENABLED or not settings.SENTRY_DSN:
        logger.info("Sentry is disabled")
        return

    sentry_logging = LoggingIntegration(
        level=logging.INFO,
        event_level=logging.ERROR,
    )

    integrations = [
        sentry_logging,
        FastApiIntegration(transaction_style="endpoint"),
        SqlalchemyIntegration(),
        AsyncioIntegration(),
    ]

    # Initialize Sentry with all configured settings
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=ENVIRONMENT,
        release=f"{APP_NAME}@{APP_VERSION}",
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        profiles_sample_rate=settings.SENTRY_PROFILES_SAMPLE_RATE,
        send_default_pii=False,
        attach_stacktrace=True,
        integrations=integrations,
        before_send=filter_sensitive_event,
        max_breadcrumbs=150,
        propagate_traces=True,
        trace_propagation_targets=["*"],
    )

    # Initialize MCP server if enabled
    if settings.SENTRY_MCP_SERVER_ENABLED:
        try:
            from utils.mcp_sentry import enable_mcp_integrations
            if enable_mcp_integrations():
                logger.info("Sentry MCP server integration enabled")
        except ImportError:
            logger.warning("Sentry MCP server utilities not available")

    logger.info(f"Sentry initialized for {APP_NAME}@{APP_VERSION}")


from typing import Optional, cast
from sentry_sdk.types import Event, Hint

def filter_sensitive_event(
    event: Event, hint: Hint
) -> Optional[Event]:
    """Filter sensitive data from Sentry events."""
    try:
        # Safely access request headers
        if "request" in event and isinstance(event["request"], dict):
            request = cast(dict, event["request"])
            if "headers" in request and isinstance(request["headers"], dict):
                headers = request["headers"]
                for header in ["authorization", "cookie", "x-api-key"]:
                    if header in headers:
                        headers[header] = "[FILTERED]"

        # Safely access user email
        if "user" in event and isinstance(event["user"], dict):
            user = event["user"]
            if "email" in user:
                user["email"] = "[FILTERED]"

        return event
    except Exception as e:
        logger.error(f"Error filtering sensitive data from Sentry event: {str(e)}")
        return event


# Initialize FastAPI application
app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description="API for managing projects, knowledge bases, and related resources",
    docs_url="/docs" if ENVIRONMENT != "production" else None,
    redoc_url=None,
    openapi_tags=[
        {
            "name": "authentication",
            "description": "User authentication and session management",
        },
        {"name": "projects", "description": "Project management operations"},
        {"name": "knowledge-bases", "description": "Knowledge base operations"},
        {"name": "files", "description": "Project file management"},
        {"name": "artifacts", "description": "Project artifact management"},
        {"name": "conversations", "description": "Project conversations"},
        {"name": "preferences", "description": "User preferences"},
    ],
)

# Setup middleware
setup_middlewares(app)

# Add additional middleware
app.add_middleware(TrustedHostMiddleware, allowed_hosts=TRUSTED_HOSTS)
app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("SECRET_KEY", settings.SESSION_SECRET),
    session_cookie="session",
    same_site="strict",
    https_only=(ENVIRONMENT == "production"),
    max_age=60 * 60 * 24 * 7,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)

if ENVIRONMENT == "production":
    app.add_middleware(HTTPSRedirectMiddleware)


async def initialize_services() -> None:
    """Initialize all required services during startup."""
    await init_db()
    await create_default_user()
    await schedule_token_cleanup(interval_minutes=30)
    logger.info(
        f"Application {APP_NAME} v{APP_VERSION} initialized in {ENVIRONMENT} environment"
    )


@app.on_event("startup")
async def startup_event() -> None:
    """Initialize application services with proper error handling."""
    try:
        configure_sentry()
        await initialize_services()

        if SENTRY_ENABLED:
            sentry_sdk.add_breadcrumb(
                category="app.lifecycle",
                message="Application started",
                level="info",
                data={
                    "app_name": APP_NAME,
                    "version": APP_VERSION,
                    "environment": ENVIRONMENT,
                },
            )
    except Exception as e:
        logger.critical(f"Startup failed: {str(e)}")
        if SENTRY_ENABLED:
            sentry_sdk.capture_exception(e)
        raise


@app.on_event("shutdown")
async def shutdown_event() -> None:
    """Clean up resources on shutdown."""
    try:
        async with get_async_session_context() as session:
            await clean_expired_tokens(session)
        logger.info("Application shutdown completed")
    except Exception as e:
        logger.error(f"Shutdown error: {str(e)}")


# Static files
app.mount("/static", StaticFiles(directory="static"), name="static")


# Frontend routes
@app.get("/", include_in_schema=False)
async def serve_frontend(request: Request) -> Response:
    """Serve the main frontend application with version info."""
    response = FileResponse("static/html/base.html")
    response.set_cookie("APP_VERSION", APP_VERSION)
    return response


@app.get("/login", include_in_schema=False)
async def serve_login(request: Request) -> Response:
    """Serve the login page."""
    return FileResponse("static/html/login.html")


# API routes
@app.get("/health", tags=["system"])
async def health_check() -> Dict[str, Any]:
    """System health check endpoint."""
    return {
        "status": "healthy",
        "environment": ENVIRONMENT,
        "debug": settings.DEBUG,
        "sentry_enabled": SENTRY_ENABLED,
    }


# Exception handlers
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Handle HTTP exceptions with consistent formatting."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Handle unexpected exceptions with Sentry integration."""
    logger.error(f"Unhandled exception: {str(exc)}", exc_info=True)
    if SENTRY_ENABLED:
        event_id = sentry_sdk.capture_exception(exc)
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error", "sentry_event_id": event_id},
        )
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


# Router registration
app.include_router(auth_router, prefix="/api/auth", tags=["authentication"])
app.include_router(
    knowledge_base_router, prefix="/api/knowledge-bases", tags=["knowledge-bases"]
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
    user_preferences_router, prefix="/api/preferences", tags=["preferences"]
)
app.include_router(conversations_router, prefix="/api/projects", tags=["conversations"])

# Debug routes for development
if ENVIRONMENT != "production":
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        log_level="info" if ENVIRONMENT == "development" else "warning",
    )
