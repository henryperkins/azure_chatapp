"""
main.py
--------
The FastAPI entrypoint for the Azure OpenAI Chat Application.
- Initializes the app with middleware (CORS, security, logging)
- Includes routers (auth, conversations, projects, etc.)
- Runs database init or migrations on startup
"""

import logging
import os
import sys
import warnings
from pathlib import Path
from cryptography.utils import CryptographyDeprecationWarning

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.middleware.cors import CORSMiddleware
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
from routes.knowledge_base_routes import router as knowledge_base_router
from routes.projects.files import router as project_files_router
from routes.projects.artifacts import router as project_artifacts_router

# -------------------------
# Import DB & Config
# -------------------------
from db import init_db, get_async_session_context, async_engine
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

# Configure allowed hosts
allowed_hosts = (
    ["*"] if settings.ENV != "production" else ["put.photo", "www.put.photo"]
)

# Create FastAPI app instance
middleware = [
    Middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts, www_redirect=False),
    Middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Lock this down in production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    ),
    Middleware(
        SessionMiddleware,
        secret_key=os.environ["SESSION_SECRET"],
        session_cookie="session",
        same_site="lax",  # changed from 'strict'
        https_only=settings.ENV == "production",
    ),
]

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
async def health_check():
    """Health check endpoint to verify the application is running."""
    return {"status": "ok"}


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
app.include_router(projects_router, prefix="/api/projects", tags=["projects"])
app.include_router(knowledge_base_router, prefix="/api", tags=["knowledge-bases"])
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
app.routes.extend([
    WebSocketRoute(
        "/api/chat/conversations/{conversation_id}/ws",
        unified_conversations.websocket_chat_endpoint,
        name="standalone_websocket_chat",
    ),
    WebSocketRoute(
        "/api/chat/projects/{project_id}/conversations/{conversation_id}/ws",
        unified_conversations.websocket_chat_endpoint,
        name="project_websocket_chat",
    )
])


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
