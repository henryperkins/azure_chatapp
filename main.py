"""
main.py
--------
FastAPI entrypoint with consolidated routes and security configuration.
Enhanced with better MCP integration, improved type hints, and optimized startup.
"""

import os
import logging
from typing import Callable, Awaitable, Dict, Any
import sentry_sdk
from sentry_sdk.integrations.logging import LoggingIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
from sentry_sdk.integrations.asyncio import AsyncioIntegration
from utils.sentry_utils import (
    configure_sentry_loggers,
    filter_sensitive_event,
    check_sentry_mcp_connection,
)
from utils.middlewares import SentryTracingMiddleware, SentryContextMiddleware
from utils.mcp_sentry import (
    enable_mcp_integrations,
    check_mcp_server,
    start_mcp_server,
    get_mcp_status,
)
from fastapi import FastAPI, Request, HTTPException, Response
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.sessions import SessionMiddleware
from fastapi.middleware import Middleware
from fastapi.routing import APIRoute

# Import consolidated routers
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

# Configure environment variables (with defaults)
APP_NAME = os.getenv("APP_NAME", "Azure Chat App")
APP_VERSION = os.getenv("APP_VERSION", settings.APP_VERSION)
ENVIRONMENT = os.getenv("ENVIRONMENT", settings.ENV)
SENTRY_ENABLED = (
    os.getenv("SENTRY_ENABLED", str(settings.SENTRY_ENABLED)).lower() == "true"
)
SENTRY_DSN = os.getenv("SENTRY_DSN", settings.SENTRY_DSN)
TRUSTED_HOSTS = os.getenv("TRUSTED_HOSTS", ",".join(settings.ALLOWED_HOSTS)).split(",")

# Configure logging
logging.basicConfig(
    level=logging.INFO if ENVIRONMENT == "development" else logging.WARNING,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def configure_sentry() -> None:
    """Configure Sentry SDK with proper integrations and settings."""
    configure_sentry_loggers()

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

    if SENTRY_ENABLED and SENTRY_DSN:
        sentry_sdk.init(
            dsn=SENTRY_DSN,
            environment=ENVIRONMENT,
            release=f"{APP_NAME}@{APP_VERSION}",
            traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.2" if ENVIRONMENT == "production" else "1.0")),
            profiles_sample_rate=float(os.getenv("SENTRY_PROFILES_SAMPLE_RATE", "0.1" if ENVIRONMENT == "production" else "0.5")),
            send_default_pii=os.getenv("SENTRY_SEND_DEFAULT_PII", "false").lower()
            == "true",
            attach_stacktrace=True,
            integrations=integrations,
            before_send=filter_sensitive_event,
            max_breadcrumbs=int(os.getenv("SENTRY_MAX_BREADCRUMBS", "150")),
            propagate_traces=True,
            trace_propagation_targets=["*"],
        )

        if not enable_mcp_integrations():
            logger.warning("Failed to enable Sentry MCP integrations")
        logger.info(f"Sentry initialized for {APP_NAME}@{APP_VERSION}")


configure_sentry()

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


def setup_middleware() -> None:
    """Configure application middleware with proper ordering."""
    if SENTRY_ENABLED and SENTRY_DSN:
        app.add_middleware(
            SentryContextMiddleware,
            app_version=APP_VERSION,
            environment=ENVIRONMENT,
        )
        app.add_middleware(
            SentryTracingMiddleware,
            include_request_body=False,
            record_breadcrumbs=True,
            spans_sample_rate=float(os.getenv("SENTRY_SPANS_SAMPLE_RATE", "1.0")),
        )

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=TRUSTED_HOSTS)
    app.add_middleware(
        SessionMiddleware,
        secret_key=os.getenv("SECRET_KEY", settings.SESSION_SECRET),
        session_cookie="session",
        same_site="strict",
        https_only=(ENVIRONMENT == "production"),
        max_age=60 * 60 * 24 * 7,
    )


setup_middleware()


async def initialize_services() -> None:
    """Initialize all required services during startup."""
    await init_db()
    await create_default_user()
    await schedule_token_cleanup(interval_minutes=30)

    if SENTRY_ENABLED and SENTRY_DSN:
        if not check_mcp_server() and not start_mcp_server():
            logger.error("Failed to start Sentry MCP server")
        elif mcp_status := get_mcp_status():
            logger.info(f"Sentry MCP server status: {mcp_status}")


@app.on_event("startup")
async def startup_event() -> None:
    """Initialize application services with proper error handling."""
    try:
        await initialize_services()
        logger.info(f"Application {APP_NAME} v{APP_VERSION} started in {ENVIRONMENT}")

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


if ENVIRONMENT == "production":
    app.add_middleware(HTTPSRedirectMiddleware)


@app.middleware("http")
async def add_security_headers(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Add security headers to all responses."""
    response = await call_next(request)
    response.headers.update(
        {
            "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "X-XSS-Protection": "1; mode=block",
            "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:",
        }
    )
    return response


app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", include_in_schema=False)
async def serve_frontend(request: Request) -> Response:
    """Serve the main frontend application with version info."""
    response = FileResponse("static/html/base.html")
    response.set_cookie("APP_VERSION", APP_VERSION)
    return response


@app.get("/health", tags=["system"])
async def health_check() -> Dict[str, Any]:
    """System health check endpoint with MCP status."""
    return {
        "status": "healthy",
        "environment": ENVIRONMENT,
        "debug": settings.DEBUG,
        "sentry_enabled": SENTRY_ENABLED,
        "mcp_status": get_mcp_status() if SENTRY_ENABLED else "disabled",
    }


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
        sentry_sdk.capture_exception(exc)
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

if ENVIRONMENT != "production":
    app.include_router(sentry_test_router, prefix="/debug/sentry", tags=["monitoring"])

if ENVIRONMENT == "development":

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
