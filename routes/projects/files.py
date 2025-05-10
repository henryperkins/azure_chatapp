"""
routes/projects/files.py
-----------------------
File management routes - focuses only on basic file operations within projects,
with knowledge base integration handled separately in KB routes.
"""

import logging
from uuid import UUID
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from db import get_async_session
from models.user import User
from models.project_file import ProjectFile
from utils.auth_utils import get_current_user_and_token
from utils.response_utils import create_standard_response
from utils.db_utils import get_all_by_condition
from services.file_storage import get_file_storage
from services.project_service import validate_project_access
from services.knowledgebase_service import upload_file_to_project # Added import
import config

logger = logging.getLogger(__name__)
router = APIRouter()

# Initialize file storage
storage_config = {
    "storage_type": getattr(config, "FILE_STORAGE_TYPE", "local"),
    "local_path": getattr(config, "LOCAL_UPLOADS_DIR", "./uploads"),
}
storage = get_file_storage(storage_config)


@router.post("", response_model=dict)
async def handle_upload_project_file(
    project_id: UUID,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user_and_token: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Handle file uploads for a project.
    """
    user, _token = current_user_and_token
    try:
        # Validate project access
        await validate_project_access(project_id, user, db)

        # Call the service function from knowledgebase_service.py
        file_metadata = await upload_file_to_project(
            project_id=project_id,
            file=file,
            db=db,
            user_id=user.id, # Pass user.id
            background_tasks=background_tasks
        )
        return await create_standard_response(file_metadata, "File uploaded successfully")
    except HTTPException as he:
        # Re-raise HTTPExceptions from service or validation
        logger.error(f"HTTPException during file upload for project {project_id} by user {user.id}: {he.detail}")
        raise he
    except ValueError as ve:
        # Catch specific ValueErrors, e.g., token limit exceeded
        logger.error(f"ValueError during file upload for project {project_id} by user {user.id}: {str(ve)}")
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Unhandled error uploading file for project {project_id} by user {user.id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to upload file due to an unexpected server error.")


@router.get("", response_model=dict)
async def list_project_files(
    project_id: UUID,
    current_user_and_token: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    file_type: Optional[str] = Query(
        None, min_length=1, max_length=50, regex="^[a-zA-Z0-9._-]+$"
    ),
):
    """
    List files in a project with metadata only.
    Does not include knowledge base processing details.
    """
    user, _token = current_user_and_token
    try:
        # Validate project access
        await validate_project_access(project_id, user, db)

        conditions = [ProjectFile.project_id == project_id]
        if file_type:
            conditions.append(ProjectFile.file_type == file_type)

        files = await get_all_by_condition(
            db,
            ProjectFile,
            *conditions,
            limit=limit,
            offset=skip,
            order_by=ProjectFile.created_at.desc(),
        )

        return await create_standard_response(
            {
                "files": [
                    {
                        "id": str(f.id),
                        "filename": f.filename,
                        "file_type": f.file_type,
                        "file_size": f.file_size,
                        "created_at": f.created_at.isoformat(),
                        "metadata": f.config or {}, # Changed f.metadata to f.config
                    }
                    for f in files
                ],
                "count": len(files),
                "total_size": await db.scalar(
                    select(func.sum(ProjectFile.file_size)).where(
                        ProjectFile.project_id == project_id
                    )
                )
                or 0,
            }
        )

    except Exception as e:
        logger.error(f"Error listing files: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Failed to list project files"
        ) from e


@router.get("/{file_id}", response_model=dict)
async def get_project_file_metadata(
    project_id: UUID,
    file_id: UUID,
    current_user_and_token: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Get metadata for a specific file.
    NOTE: Actual file content retrieval will be handled separately.
    """
    user, _token = current_user_and_token
    try:
        # Validate project access
        await validate_project_access(project_id, user, db)

        file = await db.get(ProjectFile, file_id)
        if not file or file.project_id != project_id:
            raise HTTPException(status_code=404, detail="File not found")

        return await create_standard_response(
            {
                "id": str(file.id),
                "filename": file.filename,
                "file_type": file.file_type,
                "file_size": file.file_size,
                "created_at": file.created_at.isoformat(),
                "metadata": file.metadata or {},
                "storage_path": file.file_path,
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving file metadata: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Failed to retrieve file metadata"
        ) from e


@router.delete("/{file_id}", response_model=dict)
async def delete_project_file(
    project_id: UUID,
    file_id: UUID,
    current_user_and_token: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Delete a file from project storage.
    NOTE: KB cleanup is handled by the KB service via database triggers/signals.
    """
    user, _token = current_user_and_token
    try:
        # Validate project access
        await validate_project_access(project_id, user, db)

        file = await db.get(ProjectFile, file_id)
        if not file or file.project_id != project_id:
            raise HTTPException(status_code=404, detail="File not found")

        # Delete from storage
        try:
            await storage.delete_file(file.file_path)
        except Exception as e:
            logger.warning(f"Storage deletion failed: {str(e)}")

        # Delete database record
        await db.delete(file)
        await db.commit()

        return await create_standard_response(
            {"id": str(file_id)}, "File deleted successfully"
        )

    except HTTPException:
        raise
    except Exception as e:
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
