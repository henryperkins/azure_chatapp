"""
main.py
--------
FastAPI entrypoint with consolidated routes and security configuration.
"""

import logging
from typing import Callable, Awaitable
from fastapi import FastAPI, Request, HTTPException, Response
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
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

# Database and configuration
from db import init_db, get_async_session_context
from config import settings
from utils.auth_utils import clean_expired_tokens
from utils.db_utils import schedule_token_cleanup

# Configure logging
logging.basicConfig(level=logging.INFO if settings.ENV == "development" else logging.WARNING)
logger = logging.getLogger(__name__)

# Security middleware configuration
middleware = [
    Middleware(
        TrustedHostMiddleware,
        allowed_hosts=settings.ALLOWED_HOSTS,
        www_redirect=False
    ),
    Middleware(
        SessionMiddleware,
        secret_key=settings.SESSION_SECRET,
        session_cookie="session",
        same_site="strict",
        https_only=(settings.ENV == "production"),
        max_age=60 * 60 * 24 * 7  # 1 week
    )
]

# Initialize FastAPI application
app = FastAPI(
    title="Project Management API",
    description="API for managing projects, knowledge bases, and related resources",
    version="1.0.0",
    middleware=middleware,
    docs_url="/docs" if settings.ENV != "production" else None,
    redoc_url=None,
    openapi_tags=[
        {
            "name": "authentication",
            "description": "User authentication and session management"
        },
        {
            "name": "projects",
            "description": "Project management operations"
        },
        {
            "name": "knowledge-bases",
            "description": "Knowledge base operations"
        },
        {
            "name": "files",
            "description": "Project file management"
        },
        {
            "name": "artifacts",
            "description": "Project artifact management"
        },
        {
            "name": "conversations",
            "description": "Project conversations"
        },
        {
            "name": "preferences",
            "description": "User preferences"
        }
    ]
)

# ========================
# Startup/Shutdown Handlers
# ========================

@app.on_event("startup")
async def startup_event():
    """Initialize application services"""
    try:
        await init_db()
        await create_default_user()
        await schedule_token_cleanup(interval_minutes=30)
        logger.info("Application startup completed successfully")
    except Exception as e:
        logger.critical(f"Startup failed: {str(e)}")
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

if settings.ENV == "production":
    app.add_middleware(HTTPSRedirectMiddleware)

    @app.middleware("http")
    async def add_security_headers(request: Request, call_next: Callable[[Request], Awaitable[Response]]):
        """Add security headers to all responses"""
        response = await call_next(request)
        response.headers.update({
            "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "X-XSS-Protection": "1; mode=block"
        })
        return response

# ========================
# Static Files and HTML Templates
# ========================

# Mount static files directory
app.mount("/static", StaticFiles(directory="static"), name="static")

# Serve main frontend application from the HTML directory
@app.get("/", include_in_schema=False)
async def serve_frontend():
    """Serve the main frontend application using the new HTML structure"""
    return FileResponse("static/html/base.html")

# Routes for individual HTML components
@app.get("/project_list.html", include_in_schema=False)
async def serve_project_list():
    """Serve the project list component"""
    return FileResponse("static/html/project_list.html")

@app.get("/project_details.html", include_in_schema=False)
async def serve_project_details():
    """Serve the project details component"""
    return FileResponse("static/html/project_details.html")

@app.get("/modals.html", include_in_schema=False)
async def serve_modals():
    """Serve the modals component"""
    return FileResponse("static/html/modals.html")

@app.get("/chat_ui.html", include_in_schema=False)
async def serve_chat_ui():
    """Serve the chat UI component"""
    return FileResponse("static/html/chat_ui.html")

# ========================
# Health Check
# ========================

@app.get("/health", tags=["system"])
async def health_check():
    """System health check endpoint"""
    return {
        "status": "healthy",
        "environment": settings.ENV,
        "debug": settings.DEBUG
    }

# ========================
# Error Handlers
# ========================

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Handle HTTP exceptions with consistent formatting"""
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )

@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    """Handle unexpected exceptions"""
    logger.error(f"Unhandled exception: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )

# ========================
# Router Registration
# ========================

# Authentication routes
app.include_router(
    auth_router,
    prefix="/api/auth",
    tags=["authentication"]
)

# Knowledge base routes
app.include_router(
    knowledge_base_router,
    prefix="/api/knowledge-bases",
    tags=["knowledge-bases"]
)

# Project management routes
app.include_router(
    projects_router,
    prefix="/api/projects",
    tags=["projects"]
)

# Project file routes
app.include_router(
    project_files_router,
    prefix="/api/projects/{project_id}/files",
    tags=["files"]
)

# Project artifact routes
app.include_router(
    project_artifacts_router,
    prefix="/api/projects/{project_id}/artifacts",
    tags=["artifacts"]
)

# User preference routes
app.include_router(
    user_preferences_router,
    prefix="/api/preferences",
    tags=["preferences"]
)

# Conversation routes
app.include_router(
    conversations_router,
    prefix="/api/projects",
    tags=["conversations"]
)

# ========================
# Development Endpoints
# ========================

if settings.ENV == "development":
    @app.get("/debug/routes", include_in_schema=False)
    async def debug_routes():
        """List all registered routes (development only)"""
        routes = []
        from fastapi.routing import APIRoute

        for route in app.routes:
            if isinstance(route, APIRoute):
                routes.append({
                    "path": route.path,
                    "name": route.name,
                    "methods": list(route.methods)
                })
        return routes
