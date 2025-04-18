"""
main.py
--------
FastAPI entrypoint with consolidated routes and security configuration.
"""

import os
import logging
from typing import Callable, Awaitable
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
from utils.mcp_sentry import enable_mcp_integrations
from fastapi import FastAPI, Request, HTTPException, Response
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.sessions import SessionMiddleware
from fastapi.middleware import Middleware

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
APP_NAME = os.getenv("APP_NAME", "Azure Chat App")  # Default app name
APP_VERSION = os.getenv("APP_VERSION", settings.APP_VERSION)
ENVIRONMENT = os.getenv("ENVIRONMENT", settings.ENV)
SENTRY_ENABLED = (
    os.getenv("SENTRY_ENABLED", str(settings.SENTRY_ENABLED)).lower() == "true"
)
SENTRY_DSN = os.getenv("SENTRY_DSN", settings.SENTRY_DSN)
TRUSTED_HOSTS = os.getenv("TRUSTED_HOSTS", ",".join(settings.ALLOWED_HOSTS)).split(",")

# Configure logging
logging.basicConfig(
    level=logging.INFO if ENVIRONMENT == "development" else logging.WARNING
)
logger = logging.getLogger(__name__)

# Configure Sentry loggers to ignore noisy sources
configure_sentry_loggers()

# Set up Sentry integrations
sentry_logging = LoggingIntegration(
    level=logging.INFO,  # Breadcrumb level: capture INFO and above
    event_level=logging.ERROR,  # Send events for ERROR level logs and above
)

integrations = [
    sentry_logging,
    FastApiIntegration(transaction_style="endpoint"),
    SqlalchemyIntegration(),
    AsyncioIntegration(),
]

# Only initialize Sentry if enabled
if SENTRY_ENABLED and SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=ENVIRONMENT,
        release=f"{APP_NAME}@{APP_VERSION}",
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "1.0")),
        profiles_sample_rate=float(os.getenv("SENTRY_PROFILES_SAMPLE_RATE", "0.5")),
        send_default_pii=(
            os.getenv("SENTRY_SEND_DEFAULT_PII", "false").lower() == "true"
        ),
        attach_stacktrace=True,
        integrations=integrations,
        before_send=filter_sensitive_event,  # type: ignore
        max_breadcrumbs=int(os.getenv("SENTRY_MAX_BREADCRUMBS", "150")),
        propagate_traces=True,
        trace_propagation_targets=["*"],
    )

    # Enable MCP integrations if available
    enable_mcp_integrations()
    logger.info(
        f"Sentry initialized for {APP_NAME}@{APP_VERSION} in {ENVIRONMENT} environment"
    )
else:
    logger.warning("Sentry is disabled or DSN is not configured")

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

# Add middleware (order matters - executed in reverse order)
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

# Add security middlewares
app.add_middleware(TrustedHostMiddleware, allowed_hosts=TRUSTED_HOSTS)
app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("SECRET_KEY", settings.SESSION_SECRET),
    session_cookie="session",
    same_site="strict",
    https_only=(ENVIRONMENT == "production"),
    max_age=60 * 60 * 24 * 7,  # 1 week
)

# ========================
# Startup/Shutdown Handlers
# ========================


@app.on_event("startup")
async def startup_event():
    """Initialize application services"""
    try:
        # Initialize database
        await init_db()
        await create_default_user()
        await schedule_token_cleanup(interval_minutes=30)

        # Check Sentry MCP server connection if Sentry is enabled
        if SENTRY_ENABLED and SENTRY_DSN:
            mcp_status = check_sentry_mcp_connection()
            if mcp_status:
                logger.info("Sentry MCP server connection verified")
            else:
                logger.warning("Sentry MCP server connection test failed")

        logger.info(
            f"Application {APP_NAME} v{APP_VERSION} started in {ENVIRONMENT} environment"
        )

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
async def shutdown_event():
    """Clean up resources on shutdown"""
    try:
        async with get_async_session_context() as session:
            await clean_expired_tokens(session)
        logger.info("Application shutdown completed")
    except Exception as e:
        logger.error(f"Shutdown error: {str(e)}")


# ========================
# Security Middleware
# ========================

if ENVIRONMENT == "production":
    app.add_middleware(HTTPSRedirectMiddleware)

@app.middleware("http")
async def add_security_headers(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ):
        """Add security headers to all responses"""
        response = await call_next(request)
        response.headers.update(
            {
                "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
                "X-Content-Type-Options": "nosniff",
                "X-Frame-Options": "DENY",
                "X-XSS-Protection": "1; mode=block",
            }
        )
        return response


# ========================
# Static Files and HTML Templates
# ========================

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", include_in_schema=False)
async def serve_frontend() -> FileResponse:
    return FileResponse("static/html/base.html")


@app.get("/project_list.html", include_in_schema=False)
async def serve_project_list() -> FileResponse:
    return FileResponse("static/html/project_list.html")


@app.get("/project_details.html", include_in_schema=False)
async def serve_project_details() -> FileResponse:
    return FileResponse("static/html/project_details.html")


@app.get("/modals.html", include_in_schema=False)
async def serve_modals() -> FileResponse:
    return FileResponse("static/html/modals.html")


@app.get("/chat_ui.html", include_in_schema=False)
async def serve_chat_ui() -> FileResponse:
    return FileResponse("static/html/chat_ui.html")


# ========================
# Health Check
# ========================


@app.get("/health", tags=["system"])
async def health_check() -> dict[str, str | bool]:
    return {"status": "healthy", "environment": ENVIRONMENT, "debug": settings.DEBUG}


# ========================
# Error Handlers
# ========================


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


# ========================
# Router Registration
# ========================

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

# ========================
# Development Endpoints
# ========================

if ENVIRONMENT == "development":

    @app.get("/debug/routes", include_in_schema=False)
    async def debug_routes():
        routes = []
        from fastapi.routing import APIRoute

        for route in app.routes:
            if isinstance(route, APIRoute):
                routes.append(
                    {
                        "path": route.path,
                        "name": route.name,
                        "methods": list(route.methods),
                    }
                )
        return routes


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
