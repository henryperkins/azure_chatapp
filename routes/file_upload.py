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


