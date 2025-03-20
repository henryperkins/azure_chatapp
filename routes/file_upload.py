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
import chardet
from fastapi import APIRouter, File, UploadFile, HTTPException, Depends, status, deprecated
from sqlalchemy.ext.asyncio import AsyncSession
from schemas.file_upload_schemas import FileUploadResponse

from db import get_async_session
from utils.auth_deps import get_current_user_and_token
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


@router.post("/files", response_model=FileUploadResponse, status_code=status.HTTP_201_CREATED, deprecated=True)
async def upload_file(
    file: UploadFile = File(...),
    purpose: str = "assistants",
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    DEPRECATED: Please use /api/projects/{project_id}/files endpoints instead.
    
    Uploads a file to Azure OpenAI. The file must be:
      - .txt extension
      - ≤ 1MB
      - UTF-8 encoded
    Purpose can be "fine-tune", "assistants", etc.
    Returns relevant file info from Azure.
    """
    # Implementation remains the same...
    # Rest of the original code...
    raise HTTPException(
        status_code=410,
        detail="This endpoint is deprecated. Please use /api/projects/{project_id}/files instead."
    )


@router.get("/files/{file_id}", response_model=dict, deprecated=True)
async def get_file_info(
    file_id: str,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    DEPRECATED: Please use /api/projects/{project_id}/files/{file_id} endpoints instead.
    
    Gets details for a single file from Azure OpenAI, including status, size, purpose, etc.
    Mirrors the 'Files - Get' reference.
    """
    # Implementation remains the same...
    # Rest of the original code...
    raise HTTPException(
        status_code=410,
        detail="This endpoint is deprecated. Please use /api/projects/{project_id}/files/{file_id} instead."
    )


@router.get("/files/{file_id}/content", response_model=dict, deprecated=True)
async def get_file_content(
    file_id: str,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    DEPRECATED: Please use /api/projects/{project_id}/files/{file_id} endpoints instead.
    
    Retrieves the content of the file from Azure OpenAI. 
    'Files - Get Content' reference.
    """
    # Implementation remains the same...
    # Rest of the original code...
    raise HTTPException(
        status_code=410,
        detail="This endpoint is deprecated. Please use /api/projects/{project_id}/files/{file_id} instead."
    )
