"""
main.py
--------
The FastAPI entrypoint for the Azure OpenAI Chat Application.
- Initializes the app with middleware (CORS, logging).
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
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.sessions import SessionMiddleware
from fastapi.middleware import Middleware

from services.user_service import get_user_by_username
from utils.auth_utils import JWT_SECRET, JWT_ALGORITHM, create_access_token
from config import settings

# Configure allowed hosts
allowed_hosts = ["*"] if settings.ENV != "production" else ["put.photo", "www.put.photo"]
origins = ["*"] if settings.ENV != "production" else [
    "https://put.photo",
    "https://www.put.photo"
]
from db import init_db, validate_db_schema
from auth import router as auth_router
from routes.conversations import router as conversations_router
from routes.file_upload import router as file_upload_router
from routes.projects import router as projects_router
from routes.knowledge_base_routes import router as knowledge_base_router
from fastapi.exceptions import RequestValidationError

# Ensure Python recognizes config.py as a module
sys.path.append(str(Path(__file__).resolve().parent))

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Suppress conda warnings
os.environ["AZUREML_ENVIRONMENT_UPDATE"] = "false"

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
# Always enable HTTPS redirection in production
if settings.ENV == "production":
    app.add_middleware(HTTPSRedirectMiddleware)
    # Add HSTS header
    @app.middleware("http")
    async def add_hsts_header(request: Request, call_next):
        response = await call_next(request)
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

# CORS Configuration
# Allow environment override
if settings.CORS_ORIGINS:
    origins = settings.CORS_ORIGINS.split(",")
else:
    origins = ["*"] if settings.ENV != "production" else [
        "https://put.photo",
        "https://www.put.photo"
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],  # Allow frontend to access all headers
    max_age=600,  # Cache preflight requests for 10 minutes
)

logger.info("CORS configured with origins: %s", origins)

from fastapi.staticfiles import StaticFiles

app.mount("/static", StaticFiles(directory="static"), name="static")


# WebSocket CORS fix middleware
@app.middleware("http")
async def websocket_cors_fix(request: Request, call_next):
    """Middleware to handle CORS for WebSocket connections."""
    response = await call_next(request)
    if request.scope.get("path", "").startswith("/ws/"):
        response.headers["Access-Control-Allow-Origin"] = "*" if settings.ENV != "production" else "https://put.photo"
        response.headers["Access-Control-Allow-Credentials"] = "true"
    return response


@app.get("/", include_in_schema=False)
async def root():
    """Return the root HTML file."""
    return FileResponse("static/index.html")


@app.get("/index.html", include_in_schema=False)
async def index():
    """Return the index HTML file."""
    return FileResponse("static/index.html")


@app.get("/health")
async def health_check():
    """Health check endpoint to verify the application is running."""
    return {"status": "ok"}


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    """Return the favicon."""
    return FileResponse("static/favicon.ico")


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc):
    """Handles validation exceptions with custom error messages."""
    return JSONResponse(
        status_code=422,
        content={"detail": "Invalid request data", "errors": exc.errors()},
    )


# Register routers
app.include_router(auth_router, prefix="/api/auth", tags=["authentication"])
app.include_router(conversations_router, prefix="/api/chat/conversations", tags=["conversations"])
app.include_router(file_upload_router, prefix="/api/uploads", tags=["uploads"])
app.include_router(projects_router, prefix="/api/projects", tags=["projects"])
app.include_router(knowledge_base_router, prefix="/api/kb", tags=["knowledge-bases"])


@app.on_event("startup")
async def on_startup():
    """Performs necessary startup tasks such as database initialization and directory setup."""
    # Clean environment first
    os.environ.pop("AZUREML_ENVIRONMENT_UPDATE", None)

    try:
        # Initialize database and run migrations
        await init_db()
        await validate_db_schema()
        logger.info("Database schema validated and migrations applied")

        # Create uploads directory with proper permissions
        upload_path = Path("./uploads/project_files")
        upload_path.mkdir(parents=True, exist_ok=True)
        upload_path.chmod(0o755)  # Ensure proper permissions
        logger.info("Upload directories initialized with secure permissions")
        
        # Initialize auth system
        from utils.auth_utils import load_revocation_list, clean_expired_tokens
        from utils.db_utils import schedule_token_cleanup
        from db import get_async_session_context
        
        # Get a database session
        async with get_async_session_context() as session:
            # Clean up expired tokens
            deleted_count = await clean_expired_tokens(session)
            logger.info(f"Cleaned {deleted_count} expired tokens during startup")
            
            # Load active revoked tokens into memory
            await load_revocation_list(session)
        
        # Schedule periodic token cleanup (every 30 minutes)
        await schedule_token_cleanup(interval_minutes=30)
            
        logger.info("Authentication system initialized")
    except Exception as e:
        logger.critical("Startup initialization failed: %s", e)
        raise
        
        
@app.on_event("shutdown")
async def on_shutdown():
    """Performs cleanup tasks when the application is shutting down."""
    logger.info("Application shutting down")
    
    # Any cleanup logic here
    try:
        from utils.auth_utils import clean_expired_tokens
        from db import get_async_session_context
        
        # Clean up expired tokens one final time
        async with get_async_session_context() as session:
            deleted_count = await clean_expired_tokens(session)
            logger.info(f"Cleaned {deleted_count} expired tokens during shutdown")
            
    except Exception as e:
        logger.error(f"Error during shutdown: {e}")
    
    logger.info("Shutdown complete")
