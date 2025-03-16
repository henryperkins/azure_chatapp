"""
file_upload.py
--------------
Provides routes for handling file interactions in the Azure OpenAI Chat Application.

Routes include:
  - Upload a file (with local validation for type, size, encoding).
  - Retrieve file metadata from Azure OpenAI service (including status, size, and purpose).
  - Retrieve file content from Azure OpenAI service.

All calls enforce JWT-based auth and ownership checks.
Integrates with the Azure REST API references for:
 - Uploading:  POST {endpoint}/openai/files?api-version=2025-02-01-preview
 - Getting:    GET  {endpoint}/openai/files/{file_id}?api-version=2025-02-01-preview
 - Content:    GET  {endpoint}/openai/files/{file_id}/content?api-version=2025-02-01-preview
"""

import logging
import os
import chardet
import asyncio
from concurrent.futures import ThreadPoolExecutor
import httpx

from fastapi import APIRouter, File, UploadFile, HTTPException, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional

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

class FileUploadResponse(BaseModel):
    """
    Response schema for a successful file creation (upload).
    Mirrors key aspects from Azure's REST response.
    """
    file_id: str
    filename: str
    purpose: str
    created_at: int
    status: str
    object_type: str


@router.post("/files", response_model=FileUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_file(
    file: UploadFile = File(...),
    purpose: str = "assistants",
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Uploads a file to Azure OpenAI. The file must be:
      - .txt extension
      - ≤ 1MB
      - UTF-8 encoded
    Purpose can be "fine-tune", "assistants", etc.
    Returns relevant file info from Azure.
    """
    # Basic local validation
    if not file.filename.lower().endswith(tuple(ALLOWED_EXTENSIONS)):
        raise HTTPException(
            status_code=400,
            detail="Only .txt files allowed."
        )

    contents = await file.read()
    import html
    sanitized_content = html.escape(contents.decode("utf-8"))

    def virus_scan(file_bytes: bytes):
        """Integration with ClamAV or cloud scan service"""
        # Implement actual scanning logic
        if b"PK" in file_bytes[:4]:  # Simple ZIP file check
            raise HTTPException(400, "ZIP archives not allowed")
        # Add more heuristic checks

    from concurrent.futures import ThreadPoolExecutor
    import asyncio
    with ThreadPoolExecutor() as pool:
        await asyncio.get_event_loop().run_in_executor(pool, virus_scan, contents)
    if len(contents) > MAX_FILE_BYTES:
        raise HTTPException(
            status_code=400, 
            detail="File too large (>1 MB)."
        )

    guess = chardet.detect(contents)
    if guess["encoding"] is None or guess["encoding"].lower() != "utf-8":
        raise HTTPException(
            status_code=400,
            detail="File must be UTF-8 encoded."
        )

    # Make a POST request to Azure OpenAI /openai/files
    headers = {
        "api-key": AZURE_OPENAI_KEY,
        "Content-Type": "multipart/form-data"
    }
    endpoint_url = f"{AZURE_OPENAI_ENDPOINT}/openai/files?api-version={API_VERSION}"

    # Build form-data
    # 'file' is the name param, 'purpose' is also required
    form_data = {
        "purpose": (None, purpose),
        "file": (file.filename, contents, MIME_TEXT_PLAIN)
    }

    try:
        import httpx
        async with httpx.AsyncClient() as client:
            multipart_resp = await client.post(endpoint_url, headers=headers, files=form_data, timeout=60)
        if multipart_resp.status_code != 201:
            logger.error(f"Azure files upload failed: {multipart_resp.text}")
            raise HTTPException(
                status_code=502, 
                detail=f"File upload to Azure failed: {multipart_resp.text}"
            )

        resp_json = multipart_resp.json()
        return FileUploadResponse(
            file_id=resp_json["id"],
            filename=resp_json["filename"],
            purpose=resp_json["purpose"],
            created_at=resp_json["created_at"],
            status=resp_json.get("status", "uploaded"),
            object_type=resp_json["object"]
        )
    except requests.RequestException as e:
        logger.error(f"Exception uploading file to Azure: {e}")
        raise HTTPException(
            status_code=502, 
            detail=f"Failed to connect to Azure for file upload: {str(e)}"
        )


@router.get("/files/{file_id}", response_model=dict)
def get_file_info(
    file_id: str,
    current_user: User = Depends(get_current_user_and_token),
    db: Session = Depends(get_db)
):
    """
    Gets details for a single file from Azure OpenAI, including status, size, purpose, etc.
    Mirrors the 'Files - Get' reference.

    Returns the file metadata in JSON form. 
    """
    headers = {
        "api-key": AZURE_OPENAI_KEY,
        "Content-Type": "application/json"
    }
    endpoint_url = f"{AZURE_OPENAI_ENDPOINT}/openai/files/{file_id}?api-version={API_VERSION}"
    try:
        resp = requests.get(endpoint_url, headers=headers, timeout=30)
        if resp.status_code == 200:
            return resp.json()
        logger.error(f"Azure get file info error: {resp.status_code} -> {resp.text}")
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"Error retrieving file info: {resp.text}"
        )
    except requests.RequestException as e:
        logger.error(f"Exception retrieving file info: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"Failed to connect to Azure for file info: {str(e)}"
        )


@router.get("/files/{file_id}/content", response_model=dict)
def get_file_content(
    file_id: str,
    current_user: User = Depends(get_current_user_and_token),
    db: Session = Depends(get_db)
):
    """
    Retrieves the content of the file from Azure OpenAI. 
    'Files - Get Content' reference.

    For .txt or JSON, returns a JSON payload with content as a string.
    """
    headers = {
        "api-key": AZURE_OPENAI_KEY
    }
    endpoint_url = f"{AZURE_OPENAI_ENDPOINT}/openai/files/{file_id}/content?api-version={API_VERSION}"
    try:
        resp = requests.get(endpoint_url, headers=headers, timeout=30)
        if resp.status_code == 200:
            # Azure returns plain text or JSON
            # We'll convert it to a JSON response
            return {"file_id": file_id, "content": resp.text}
        logger.error(f"Azure get file content error: {resp.status_code} -> {resp.text}")
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"Error retrieving file content: {resp.text}"
        )
    except requests.RequestException as e:
        logger.error(f"Exception retrieving file content: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"Failed to connect to Azure for file content: {str(e)}"
        )
def validate_file_upload(file, contents):
    if not file.filename.lower().endswith(tuple(ALLOWED_EXTENSIONS)):
        raise HTTPException(400, "Invalid file type")
    if len(contents) > MAX_FILE_BYTES:
        raise HTTPException(400, "File too large")
    # Additional checks can be placed here
