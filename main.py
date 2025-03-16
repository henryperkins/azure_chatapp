"""
main.py
--------
The FastAPI entrypoint for the Azure OpenAI Chat Application.
- Initializes the app with middleware (CORS, logging).
- Includes routers (auth, chat, file_upload, and any others).
- Runs database init or migrations on startup.
"""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db import init_db, Base
from auth import router as auth_router
from routes.chat import router as chat_router
from routes.file_upload import router as file_upload_router
from routes.project_routes import router as project_router

app = FastAPI(
    title="Azure OpenAI Chat Application",
    description="""
A secure, robust, and intuitively designed web-based chat application 
leveraging Azure OpenAI's o1-series models with advanced features 
like context summarization, vision support (for 'o1'), JWT-based auth, 
file uploads, and more.
""",
    version="1.0.0"
)

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Apply CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For development. Restrict in production.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import os
if os.getenv("ENV") == "production":
    @app.middleware("http")
    async def force_https(request, call_next):
        response = await call_next(request)
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


@app.on_event("startup")
async def on_startup():
    # Use async engine for migrations
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database initialized")

# Include the authentication router
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])

# Include the chat router
app.include_router(chat_router, prefix="/api/chat", tags=["chat"])

# Include the file upload router
app.include_router(file_upload_router, prefix="/api/files", tags=["files"])

# Include the project router
app.include_router(project_router, prefix="/api/projects", tags=["projects"])


def health_check():
    """
    A simple health-check endpoint to confirm the service is running.
    """
    return {"status": "ok"}
