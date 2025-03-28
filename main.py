"""
main.py
--------
The FastAPI entrypoint for the Azure OpenAI Chat Application.
- Initializes the app with middleware (logging).
- Includes routers (auth, conversations, projects, etc.).
- Runs database init or migrations on startup.
"""

import logging
import os
import sys
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.sessions import SessionMiddleware
from fastapi.middleware import Middleware
from fastapi.exceptions import RequestValidationError
from sqlalchemy import inspect, text

# Import routers
from auth import router as auth_router
from routes.conversations import router as conversations_router
from routes.file_upload import router as file_upload_router
from routes.projects import router as projects_router
from routes.knowledge_base_routes import router as knowledge_base_router
from routes.projects.files import router as project_files_router
from routes.projects.artifacts import router as project_artifacts_router
from routes.projects.conversations import router as project_conversations_router

# Import database utilities
from db import init_db, validate_db_schema, fix_db_schema, get_async_session_context, sync_engine

# Import utility functions
from utils.auth_utils import load_revocation_list, clean_expired_tokens
from utils.db_utils import schedule_token_cleanup

# Import configuration
from config import settings

# Ensure Python recognizes config.py as a module
sys.path.append(str(Path(__file__).resolve().parent))

# Configure Logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)

# Configure SQLAlchemy logging to be less verbose
logging.getLogger('sqlalchemy.engine').setLevel(logging.WARNING)

# Suppress conda warnings
os.environ["AZUREML_ENVIRONMENT_UPDATE"] = "false"

# Configure allowed hosts
allowed_hosts = ["*"] if settings.ENV != "production" else ["put.photo", "www.put.photo"]

# Create FastAPI app instance
app = FastAPI(
    middleware=[
        Middleware(
            TrustedHostMiddleware,
            allowed_hosts=allowed_hosts,
            www_redirect=False
        ),
        Middleware(
            SessionMiddleware,
            secret_key=os.getenv(
                "SESSION_SECRET", "your-secret-key"
            ),  # Change 'your-secret-key' to a secure value
            session_cookie="session",
            same_site="lax",  # More secure setting than 'none'
            https_only=True if settings.ENV == "production" else False,
        ),
    ],
    title="Azure OpenAI Chat Application",
    description="""
A secure, robust, and intuitively designed web-based chat application 
leveraging Azure OpenAI's o1-series models with advanced features 
like context summarization, vision support (for 'o1'), JWT-based auth, 
file uploads, and more.
""",
    version="1.0.0",
    openapi_tags=[
        {
            "name": "conversations",
            "description": "Operations with standalone conversations",
        },
        {
            "name": "projects",
            "description": "Core project management operations",
        },
        {
            "name": "project-conversations",
            "description": "Operations with project-specific conversations",
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
            "name": "knowledge-bases",
            "description": "Operations with knowledge bases",
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
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
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
    return FileResponse("static/projects.html")

@app.get("/health")
async def health_check():
    """Health check endpoint to verify the application is running."""
    return {"status": "ok"}

@app.get("/debug/schema-check")
async def debug_schema_check():
    """Debug endpoint to verify database schema alignment"""
    from sqlalchemy import inspect
    async with get_async_session_context() as session:
        inspector = inspect(session.get_bind())
        return {
            "project_files_columns": inspector.get_columns("project_files"),
            "knowledge_bases_columns": inspector.get_columns("knowledge_bases")
        }
    

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    """Return the favicon."""
    return FileResponse("static/favicon.ico")


# --------------------------------
# CUSTOM 422 HANDLER
# --------------------------------
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """
    Handles validation exceptions with a custom JSON error message.
    This is where 422 Unprocessable Entity gets triggered if the request
    doesn't match the parameter or body schemas.
    """
    logger.warning(f"Validation error for request {request.url} - {exc.errors()}")
    return JSONResponse(
        status_code=422,
        content={
            "detail": "Invalid request data",
            "errors": exc.errors()
        },
    )

# -------------------------
# Register Routers
# -------------------------
app.include_router(auth_router, prefix="/api/auth", tags=["authentication"])
app.include_router(conversations_router, prefix="/api/chat/conversations", tags=["conversations"])
app.include_router(file_upload_router, prefix="/api/uploads", tags=["uploads"])
app.include_router(knowledge_base_router, prefix="/api", tags=["knowledge-bases"])
app.include_router(projects_router, prefix="/api/projects", tags=["projects"])

app.include_router(
    project_files_router,
    prefix="/api/projects/{project_id}/files", 
    tags=["project-files"]
)

app.include_router(
    project_artifacts_router,
    prefix="/api/projects/{project_id}/artifacts",
    tags=["project-artifacts"]
)

app.include_router(
    project_conversations_router,
    tags=["project-conversations"]
)


# -------------------------
# Startup & Shutdown Events
# -------------------------
@app.on_event("startup")
async def on_startup():
    """Performs necessary startup tasks: database init, migrations, token cleanup."""
    os.environ.pop("AZUREML_ENVIRONMENT_UPDATE", None)
    try:
        # Initialize database with enhanced schema alignment
        await init_db()
        
        # Additional validation after schema alignment has been applied
        async with get_async_session_context() as session:
            # Use run_sync to perform inspection operations
            required_columns = {
                "project_files": ["config"],
                "knowledge_bases": ["config"],
                "users": ["token_version"],
                "messages": ["context_used"]
            }
            
            # Get database metadata using run_sync
            def get_db_metadata(sync_session):
                inspector = inspect(sync_session.get_bind())
                metadata = {}
                
                try:
                    conn = sync_session.connection()
                    for table in required_columns.keys():
                        if not inspector.has_table(table):
                            continue
                            
                        result = conn.execute(
                            text(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{table}'")
                        )
                        metadata[table] = {row[0] for row in result}
                finally:
                    sync_session.close()
                    
                return metadata
            
            db_metadata = await session.run_sync(get_db_metadata)
            
            for table, cols in required_columns.items():
                if table not in db_metadata:
                    raise RuntimeError(f"Missing critical table: {table}")
                
                existing = db_metadata[table]
                missing = set(cols) - existing
                if missing:
                    raise RuntimeError(f"Missing columns in {table}: {missing}")

        # Create uploads directory
        upload_path = Path("./uploads/project_files")
        upload_path.mkdir(parents=True, exist_ok=True)
        upload_path.chmod(0o755)
        
        # Auth system
        async with get_async_session_context() as session:
            deleted_count = await clean_expired_tokens(session)
            await load_revocation_list(session)

        # Schedule periodic token cleanup
        await schedule_token_cleanup(interval_minutes=30)
        
        logger.info("Startup completed: Database validated, uploads ready, auth initialized")
    except Exception as e:
        logger.critical("Startup initialization failed: %s", e)
        raise
        logger.info("Authentication system initialized")
    except Exception as e:
        logger.critical("Startup initialization failed: %s", e)
        raise

@app.on_event("shutdown")
async def on_shutdown():
    """Performs cleanup tasks when the application is shutting down."""
    logger.info("Application shutting down")
    try:
        async with get_async_session_context() as session:
            deleted_count = await clean_expired_tokens(session)
            logger.info(f"Cleaned {deleted_count} expired tokens during shutdown")
    except Exception as e:
        logger.error(f"Error during shutdown: {e}")
    logger.info("Shutdown complete")
