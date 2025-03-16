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

from .db import init_db
from .auth import router as auth_router
# You'll also need to import your other routers, for example:
# from .routes.chat import router as chat_router
# from .routes.file_upload import router as file_upload_router

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

@app.on_event("startup")
async def on_startup():
    """
    Runs automatically on application startup.
    Ensures the database is initialized or migrations are run.
    """
    await init_db()
    logger.info("Application startup completed. Database initialized.")

# Include the authentication router
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])

# Example of including additional routers:
# app.include_router(chat_router, prefix="/api/chat", tags=["chat"])
# app.include_router(file_upload_router, prefix="/api/files", tags=["files"])

@app.get("/health", tags=["health"])
def health_check():
    """
    A simple health-check endpoint to confirm the service is running.
    """
    return {"status": "ok"}
