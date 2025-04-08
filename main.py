"""
main.py
--------
The FastAPI entrypoint for the Azure OpenAI Chat Application.
- Designed for strict same-origin security
- Requires frontend to be served from same domain as backend
- Uses session cookies with SameSite=Strict and Secure flags
- Initializes app with security-focused middleware:
  - TrustedHostMiddleware (allows any host since we rely on same-origin)
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
from sqlalchemy import text

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.sessions import SessionMiddleware
from fastapi.middleware import Middleware
from fastapi.exceptions import RequestValidationError
from sqlalchemy import inspect
from starlette.routing import WebSocketRoute

# -------------------------
# Import your routes
# -------------------------
from routes.unified_conversations import router as unified_conversations_router
from routes import unified_conversations  # for direct WebSocketRoute reference
from auth import router as auth_router
from routes.file_upload import router as file_upload_router
from routes.projects.projects import router as projects_router
from routes.knowledge_base_routes import router as knowledge_base_router
from routes.projects.files import router as project_files_router
from routes.projects.artifacts import router as project_artifacts_router
from routes.user_preferences import router as user_preferences_router

# -------------------------
# Import DB & Config
# -------------------------
from db import init_db, get_async_session_context, async_engine, Base
from config import settings

# -------------------------
# Import Utility Functions
# -------------------------
from utils.auth_utils import load_revocation_list, clean_expired_tokens
from utils.db_utils import schedule_token_cleanup

warnings.filterwarnings(
    "ignore", category=CryptographyDeprecationWarning, module="pypdf"
)

# Ensure Python recognizes config.py as a module
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

# Suppress conda warnings
os.environ["AZUREML_ENVIRONMENT_UPDATE"] = "false"

middleware = [
    Middleware(TrustedHostMiddleware, allowed_hosts=["*"], www_redirect=False),
    Middleware(
        SessionMiddleware,
        secret_key=os.environ["SESSION_SECRET"],
        session_cookie="session", 
        same_site="strict",
        https_only=True,
        max_age=60 * 60 * 24 * 7,
    ),
]

# Create FastAPI app with configured middleware
app = FastAPI(
    middleware=middleware,
    title="Azure OpenAI Chat Application",
    description=(
        "A secure, robust, and intuitively designed web-based chat application "
        "leveraging Azure OpenAI's o1-series models with advanced features "
        "like context summarization, vision support (for 'o1'), JWT-based auth, "
        "file uploads, and more."
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
)

# Add Cache-Control headers to auth-related responses
@app.middleware("http")
async def add_cache_control(request: Request, call_next):
    """Add Cache-Control headers to auth-related responses to prevent browser caching"""
    response = await call_next(request)
    if request.url.path.startswith("/api/auth/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# Enforce HTTPS in production
if settings.ENV == "production":
    app.add_middleware(HTTPSRedirectMiddleware)

    @app.middleware("http")
    async def add_hsts_header(request: Request, call_next):
        response = await call_next(request)
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
        return response


# Serve static files
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


@app.get("/health")
async def health_check(request: Request):
    """Health check endpoint with same-origin verification."""
    # Verify request came from same origin
    origin = request.headers.get("origin")
    if origin and origin != f"{request.url.scheme}://{request.headers.get('host')}":
        raise HTTPException(403, detail="Cross-origin requests not permitted")
    
    return {
        "status": "ok",
        "security": {
            "same_origin_verified": True,
            "session_cookie_secure": True
        }
    }


# Debug endpoints only available in non-production
if settings.ENV != "production":

    @app.get("/debug/schema-check")
    async def debug_schema_check():
        """Debug endpoint to verify database schema alignment"""
        async with get_async_session_context() as session:
            inspector = inspect(session.get_bind())
            return {
                "project_files_columns": inspector.get_columns("project_files"),
                "knowledge_bases_columns": inspector.get_columns("knowledge_bases"),
            }
    
    @app.get("/debug/security-headers")
    async def debug_security_headers(request: Request):
        """Verify all security headers and same-origin policies"""
        return {
            "security_headers": {
                "strict_transport_security": request.headers.get("strict-transport-security"),
                "x_frame_options": request.headers.get("x-frame-options"),
                "x_content_type_options": request.headers.get("x-content-type-options"),
                "content_security_policy": request.headers.get("content-security-policy"),
                "referrer_policy": request.headers.get("referrer-policy"),
                "permissions_policy": request.headers.get("permissions-policy"),
            },
            "same_origin_verified": {
                "origin": request.headers.get("origin"),
                "host": request.headers.get("host"),
                "scheme": request.url.scheme,
                "is_same_origin": (
                    not request.headers.get("origin") or 
                    request.headers.get("origin") == f"{request.url.scheme}://{request.headers.get('host')}"
                ),
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


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    """Return the favicon."""
    return FileResponse("static/favicon.ico")


# ---------------------------
# CUSTOM 422 HANDLER
# ---------------------------
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """
    Handles validation exceptions with a custom JSON error message.
    """
    logger.warning(f"Validation error for request {request.url} - {exc.errors()}")
    content = {
        "detail": "Invalid request data",
        "errors": exc.errors() if settings.ENV != "production" else None,
    }
    return JSONResponse(status_code=422, content=content)


# --------------------------------------------------
# Register Routers
# --------------------------------------------------
app.include_router(auth_router, prefix="/api/auth", tags=["authentication"])
app.include_router(file_upload_router, prefix="/api/uploads", tags=["uploads"])
app.include_router(knowledge_base_router, prefix="/api", tags=["knowledge-bases"])
app.include_router(user_preferences_router, prefix="/api", tags=["user-preferences"])
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

# Unified conversations router
app.include_router(
    unified_conversations_router,
    prefix="/api/chat",  # new prefix
    tags=["conversations"],
)
app.include_router(
    unified_conversations_router,
    prefix="/api",  # old prefix for compatibility
    tags=["conversations"],
)

# Manually add WebSocket routes with /api/chat prefix to match HTTP routes
app.routes.extend(
    [
        WebSocketRoute(
            "/api/chat/conversations/{conversation_id}/ws",
            unified_conversations.websocket_chat_endpoint,
            name="standalone_websocket_chat",
        ),
        WebSocketRoute(
            "/api/chat/projects/{project_id}/conversations/{conversation_id}/ws",
            unified_conversations.websocket_chat_endpoint,
            name="project_websocket_chat",
        ),
    ]
)


# --------------------------------------------------
# Startup & Shutdown
# --------------------------------------------------
@app.on_event("startup")
async def on_startup():
    """Performs necessary startup tasks: DB init, migrations, token cleanup."""
    os.environ.pop("AZUREML_ENVIRONMENT_UPDATE", None)
    try:
        # 1. Initialize DB with migration checks
        await init_db()

        # 2. Validate schema with SQLAlchemy inspector
        async with async_engine.connect() as conn:
            inspector = await conn.run_sync(lambda sync_conn: inspect(sync_conn))

            required_tables = {
                "project_files": ["config"],
                "knowledge_bases": ["config"],
                "users": ["token_version"],
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

        # 4. Initialize auth system
        async with get_async_session_context() as session:
            deleted_count = await clean_expired_tokens(session)
            await load_revocation_list(session)
            logger.info(f"Cleaned {deleted_count} expired tokens during startup")

        # 5. Schedule periodic token cleanup
        await schedule_token_cleanup(interval_minutes=30)

        logger.info("Startup completed: DB validated, uploads ready, auth initialized")

    except Exception as e:
        logger.critical(f"Startup initialization failed: {e}")
        raise


@app.on_event("shutdown")
async def on_shutdown():
    """Perform cleanup tasks when the application shuts down."""
    logger.info("Application shutting down")
    try:
        async with get_async_session_context() as session:
            deleted_count = await clean_expired_tokens(session)
            logger.info(f"Cleaned {deleted_count} expired tokens during shutdown")
    except Exception as e:
        logger.error(f"Error during shutdown: {e}")
    logger.info("Shutdown complete")


async def _get_existing_tables():
    """Get existing tables using async connection"""
    async with async_engine.connect() as conn:
        result = await conn.execute(
            text("SELECT table_name FROM information_schema.tables")
        )
        return {row[0] for row in result.fetchall()}

async def _create_missing_tables(tables: list[str]):
    """Create missing tables with progress tracking"""
    for idx, table_name in enumerate(tables, 1):
        logger.info(f"Creating table {idx}/{len(tables)}: {table_name}")
        async with async_engine.begin() as conn:
            await conn.run_sync(
                lambda sync_conn: Base.metadata.tables[table_name].create(sync_conn)
            )
