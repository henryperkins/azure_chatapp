"""
file_upload.py
--------------
Provides routes for handling file interactions in the Azure OpenAI Chat Application.

DEPRECATED: This module contains legacy standalone file endpoints.
New code should use /api/projects/{project_id}/files endpoints instead.

Routes include:
  - Upload a file (with local validation for type, size, encoding).
  - Retrieve file metadata from Azure OpenAI service.
  - Retrieve file content from Azure OpenAI service.
"""

import logging
import os
from fastapi import APIRouter, File, UploadFile, HTTPException, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from schemas.file_upload_schemas import FileUploadResponse

from db import get_async_session
from utils.auth_utils import get_current_user_and_token
from models.user import User

router = APIRouter()
logger = logging.getLogger(__name__)

AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "")
AZURE_OPENAI_KEY = os.getenv("AZURE_OPENAI_KEY", "")
API_VERSION = "2025-02-01-preview"

# Allowed types and size constraints
ALLOWED_EXTENSIONS = {".txt"}
MAX_FILE_BYTES = 1_000_000  # 1 MB
MIME_TEXT_PLAIN = "text/plain"


@router.post("/upload", response_model=FileUploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Uploads a file to the Azure OpenAI service with local validation.
    """
    if not file.filename.endswith(tuple(ALLOWED_EXTENSIONS)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type not allowed. Allowed types: {ALLOWED_EXTENSIONS}",
        )

    if file.content_type != MIME_TEXT_PLAIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only text/plain files are allowed.",
        )

    contents = await file.read()
    if len(contents) > MAX_FILE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File size exceeds the maximum allowed size of {MAX_FILE_BYTES} bytes.",
        )

    # Here you would typically upload the file to Azure OpenAI service
    # For demonstration, we'll just log the file upload
    logger.info(f"User {current_user.username} uploaded file: {file.filename}")

    return FileUploadResponse(
        filename=file.filename,
        content_type=file.content_type,
        size=len(contents),
        message="File uploaded successfully.",
    )
