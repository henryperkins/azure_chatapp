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
os.environ['AZUREML_ENVIRONMENT_UPDATE'] = 'false'

# Create FastAPI app instance
app = FastAPI(
    middleware=[
        Middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts),
        Middleware(SessionMiddleware, 
                  secret_key=os.getenv('SESSION_SECRET', 'your-secret-key'),  # Change 'your-secret-key' to a secure value
                  session_cookie="session",
                  same_site="lax",  # More secure setting than 'none'
                  https_only=True if settings.ENV == "production" else False)
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
            "description": "Operations with project-specific conversations"
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
        }
    ],
    docs_url="/docs" if settings.ENV != "production" else None,
    redoc_url=None
)

# Define allowed hosts
allowed_hosts = settings.ALLOWED_HOSTS if settings.ALLOWED_HOSTS else ["*"]  # Temporary development setting

# Enforce HTTPS in production
if settings.ENV == "production":
    app.add_middleware(HTTPSRedirectMiddleware)

# CORS Configuration
origins = settings.CORS_ORIGINS if settings.CORS_ORIGINS else []

# In development, allow localhost origins if none specified
if settings.ENV != "production" and not origins:
    origins = [
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],  # Allow frontend to access all headers
    max_age=600  # Cache preflight requests for 10 minutes
)

logger.info("CORS configured with origins: %s", origins)


# WebSocket CORS fix middleware
@app.middleware("http")
async def websocket_cors_fix(request: Request, call_next):
    """Middleware to handle CORS for WebSocket connections."""
    response = await call_next(request)
    if request.scope.get("path", "").startswith("/ws/"):
        response.headers["Access-Control-Allow-Origin"] = "http://localhost:3000"  # Change to production URL in production
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


@app.on_event("startup")
async def on_startup():
    """Performs necessary startup tasks such as database initialization and directory setup."""
    # Clean environment first
    os.environ.pop('AZUREML_ENVIRONMENT_UPDATE', None)
    
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
    except Exception as e:
        logger.critical("Startup initialization failed: %s", e)
        raise