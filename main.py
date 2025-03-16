"""
main.py
--------
The FastAPI entrypoint for the Azure OpenAI Chat Application.
- Initializes the app with middleware (CORS, logging).
- Includes routers (auth, chat, file_upload, and any others).
- Runs database init or migrations on startup.
"""

import logging
import os
from fastapi import FastAPI, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from db import Base, async_engine
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

app.mount("/static", StaticFiles(directory="static"), name="static")

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Apply CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:3000"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", include_in_schema=False)
async def root():
    return FileResponse("static/index.html")

if os.getenv("ENV") == "production":
    @app.middleware("http")
    async def force_https(request, call_next):
        response = await call_next(request)
        if isinstance(response, Response):
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

@app.get("/health")
async def health_check():
    return {"status": "ok"}

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse("static/favicon.ico")
    return {"status": "ok"}
