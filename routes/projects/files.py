"""
routes/projects/files.py
-----------------------
Consolidated file management routes for projects with optional knowledge base integration.
Serves as the single source of truth for all file operations.
"""

import logging
from uuid import UUID
from typing import Optional, Tuple

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    UploadFile,
    File,
    BackgroundTasks,
)
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_async_session
from models.user import User
from services.file_service import FileService
from services.project_service import validate_project_access
from utils.auth_utils import get_current_user_and_token
from utils.response_utils import create_standard_response
from utils.sentry_utils import traced

logger = logging.getLogger(__name__)
router = APIRouter()


# =======================================================
#  Consolidated File Operations with Tracing
# =======================================================


@router.post("", response_model=dict)
async def handle_upload_project_file(
    project_id: UUID,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    index_kb: bool = Query(
        False, description="Whether to index file in knowledge base"
    ),
    current_user_and_token: Tuple[User, str] = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Upload a file to a project with optional knowledge base indexing.

    This is the canonical endpoint for all file uploads. Use index_kb=true
    to automatically index the file in the project's knowledge base.
    """
    user, _token = current_user_and_token

    with traced(op="file", description="Upload Project File") as span:
        try:
            span.set_tag("project.id", str(project_id))
            span.set_tag("user.id", str(user.id))
            span.set_tag("index_kb", index_kb)
            span.set_tag("filename", file.filename or "unknown")

            # Validate project access
            await validate_project_access(project_id, user, db)

            # Use unified FileService for upload
            file_service = FileService(db)
            file_metadata = await file_service.upload(
                project_id=project_id,
                file=file,
                user_id=user.id,
                index_kb=index_kb,
                background_tasks=background_tasks,
            )

            span.set_tag("file.id", file_metadata["id"])
            span.set_tag("file.size", file_metadata["file_size"])

            return await create_standard_response(
                file_metadata,
                f"File uploaded successfully{' and queued for KB indexing' if index_kb else ''}",
            )

        except HTTPException as he:
            span.set_tag("error", True)
            span.set_tag("error_status", he.status_code)
            logger.error(
                f"HTTPException during file upload for project {project_id} by user {user.id}: {he.detail}"
            )
            raise he
        except ValueError as ve:
            span.set_tag("error", True)
            span.set_tag("error_type", "ValueError")
            logger.error(
                f"ValueError during file upload for project {project_id} by user {user.id}: {str(ve)}"
            )
            raise HTTPException(status_code=400, detail=str(ve))
        except Exception as e:
            span.set_tag("error", True)
            span.set_tag("error_type", type(e).__name__)
            logger.error(
                f"Unhandled error uploading file for project {project_id} by user {user.id}: {str(e)}",
                exc_info=True,
            )
            raise HTTPException(
                status_code=500,
                detail="Failed to upload file due to an unexpected server error.",
            )


@router.get("", response_model=dict)
async def list_project_files(
    project_id: UUID,
    current_user_and_token: Tuple[User, str] = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    file_type: Optional[str] = Query(
        None, min_length=1, max_length=50, regex="^[a-zA-Z0-9._-]+$"
    ),
):
    """
    List files in a project with pagination and filtering.

    This is the canonical endpoint for listing project files.
    """
    user, _token = current_user_and_token

    with traced(op="file", description="List Project Files") as span:
        try:
            span.set_tag("project.id", str(project_id))
            span.set_tag("user.id", str(user.id))
            span.set_tag("skip", skip)
            span.set_tag("limit", limit)
            if file_type:
                span.set_tag("file_type", file_type)

            # Validate project access
            await validate_project_access(project_id, user, db)

            # Use unified FileService for listing
            file_service = FileService(db)
            result = await file_service.list_files(
                project_id=project_id,
                skip=skip,
                limit=limit,
                file_type=file_type,
            )

            span.set_tag("files_count", len(result["files"]))
            span.set_tag("total_files", result["total"])

            return await create_standard_response(
                result, "Files retrieved successfully"
            )

        except HTTPException:
            span.set_tag("error", True)
            raise
        except Exception as e:
            span.set_tag("error", True)
            span.set_tag("error_type", type(e).__name__)
            logger.error(f"Error listing files: {str(e)}")
            raise HTTPException(
                status_code=500, detail="Failed to list project files"
            ) from e


@router.get("/{file_id}", response_model=dict)
async def get_project_file_metadata(
    project_id: UUID,
    file_id: UUID,
    current_user_and_token: Tuple[User, str] = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Get metadata for a specific file.

    This is the canonical endpoint for retrieving file metadata.
    """
    user, _token = current_user_and_token

    with traced(op="file", description="Get File Metadata") as span:
        try:
            span.set_tag("project.id", str(project_id))
            span.set_tag("user.id", str(user.id))
            span.set_tag("file.id", str(file_id))

            # Validate project access
            await validate_project_access(project_id, user, db)

            # Use unified FileService for metadata retrieval
            file_service = FileService(db)
            file_metadata = await file_service.get_file_metadata(project_id, file_id)

            span.set_tag("filename", file_metadata["filename"])
            span.set_tag("file_size", file_metadata["file_size"])

            return await create_standard_response(
                file_metadata, "File metadata retrieved successfully"
            )

        except HTTPException:
            span.set_tag("error", True)
            raise
        except Exception as e:
            span.set_tag("error", True)
            span.set_tag("error_type", type(e).__name__)
            logger.error(f"Error retrieving file metadata: {str(e)}")
            raise HTTPException(
                status_code=500, detail="Failed to retrieve file metadata"
            ) from e


@router.delete("/{file_id}", response_model=dict)
async def delete_project_file(
    project_id: UUID,
    file_id: UUID,
    current_user_and_token: Tuple[User, str] = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Delete a file from project storage.

    This is the canonical endpoint for file deletion. KB cleanup is handled
    automatically by the service layer via database triggers/signals.
    """
    user, _token = current_user_and_token

    with traced(op="file", description="Delete Project File") as span:
        try:
            span.set_tag("project.id", str(project_id))
            span.set_tag("user.id", str(user.id))
            span.set_tag("file.id", str(file_id))

            # Validate project access
            await validate_project_access(project_id, user, db)

            # Use unified FileService for deletion
            file_service = FileService(db)
            result = await file_service.delete_file(project_id, file_id)

            span.set_tag("filename", result["filename"])

            return await create_standard_response(result, "File deleted successfully")

        except HTTPException:
            span.set_tag("error", True)
            raise
        except Exception as e:
            span.set_tag("error", True)
            span.set_tag("error_type", type(e).__name__)
            logger.error(f"File deletion failed: {str(e)}")
            raise HTTPException(status_code=500, detail="Failed to delete file") from e


@router.get("/{file_id}/download", include_in_schema=False)
async def download_project_file(
    project_id: UUID,
    file_id: UUID,
    current_user_and_token: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Stub for future file download endpoint.
    Actual implementation will depend on storage backend.
    """
    user, _token = current_user_and_token
    raise HTTPException(
        status_code=501, detail="File download endpoint not yet implemented"
    )
