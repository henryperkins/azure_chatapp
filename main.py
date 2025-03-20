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
from pathlib import Path
os.environ['AZUREML_ENVIRONMENT_UPDATE'] = 'false'  # Suppress conda warnings

from fastapi import FastAPI, Response, HTTPException, Depends
from fastapi.responses import JSONResponse
import jwt
from jwt.exceptions import JWTError
from schemas.token import Token
from services.user_service import get_user_by_username
from utils.auth_deps import get_refresh_token
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# Ensure Python recognizes config.py as a module
import sys
from pathlib import Path
sys.path.append(str(Path(__file__).resolve().parent))
from config import settings

from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
from db import Base, async_engine, init_db, get_async_session
from auth import router as auth_router
from routes.conversations import router as conversations_router
from routes.file_upload import router as file_upload_router
from routes.projects import router as projects_router
from routes.knowledge_base_routes import router as knowledge_base_router

from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.sessions import SessionMiddleware
from fastapi.middleware import Middleware

allowed_hosts = settings.ALLOWED_HOSTS
app = FastAPI(
    middleware=[
        Middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts),
        Middleware(SessionMiddleware, secret_key=settings.SESSION_SECRET)
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
    docs_url="/docs",
    redoc_url=None
)

if settings.ENV == "production":
    app.add_middleware(HTTPSRedirectMiddleware)

app.mount("/static", StaticFiles(directory="static"), name="static")

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Apply CORS Middleware
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
    expose_headers=["*"],
    max_age=600  # Cache preflight requests for 10 minutes
)

logger.info(f"CORS configured with origins: {origins}")


@app.get("/", include_in_schema=False)
async def root():
    return FileResponse("static/index.html")

@app.get("/index.html", include_in_schema=False)
async def index():
    return FileResponse("static/index.html")

if settings.ENV == "production":
    @app.middleware("http")
    async def force_https(request, call_next):
        response = await call_next(request)
        if isinstance(response, Response):
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


@app.on_event("startup")
async def on_startup():
    # Clean environment first
    os.environ.pop('AZUREML_ENVIRONMENT_UPDATE', None)
    
    # Initialize database
    await init_db()
    logger.info("Database initialized")
    
    # Add critical schema validation
    from db import validate_db_schema
    await validate_db_schema()
    logger.info("Database schema has been validated.")
    
    # Create uploads directory with proper permissions
    upload_path = Path("./uploads/project_files")
    upload_path.mkdir(parents=True, exist_ok=True)
    upload_path.chmod(0o755)  # Ensure proper permissions
    logger.info("Upload directories initialized with secure permissions")

# Include the authentication router with refresh endpoint
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])

@auth_router.post("/refresh", response_model=Token)
async def refresh_token(
    refresh_token: str = Depends(get_refresh_token),
    db: AsyncSession = Depends(get_async_session)
):
    try:
        payload = jwt.decode(refresh_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        username: str = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid refresh token")
        
        user = await get_user_by_username(db, username=username)
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        
        # Create new access token
        access_token = create_access_token(data={"sub": user.username})
        
        # Set the new access token in cookies
        response = JSONResponse(content={"access_token": access_token})
        response.set_cookie(
            key="access_token",
            value=access_token,
            httponly=True,
            max_age=3600,  # 1 hour
            secure=settings.ENV == "production",
            samesite="Lax"
        )
        
        return response
        
    except PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

# Include the conversations router with updated prefix
app.include_router(conversations_router, prefix="/api/chat", tags=["conversations"])

# Include the projects router with nested resources
app.include_router(projects_router, prefix="/api/projects", tags=["projects"])

# Include legacy routers with deprecation notices
app.include_router(file_upload_router, prefix="/api/files", tags=["files"])

# Include the knowledge base router
app.include_router(knowledge_base_router, prefix="/api/knowledge-bases", tags=["knowledge-bases"])


@app.get("/health")
async def health_check():
    return {"status": "ok"}

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse("static/favicon.ico")

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    return JSONResponse(
        status_code=422,
        content={"detail": "Invalid UUID format", "errors": exc.errors()},
    )
