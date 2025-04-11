"""
p_files.py
----------
Routes for managing files within a project.
Provides endpoints for uploading, listing, retrieving, and deleting files.
"""

import logging
from uuid import UUID
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
    UploadFile,
    File,
    Query,
    BackgroundTasks,
)
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_async_session
from models.user import User
from utils.auth_utils import get_current_user_and_token
from utils.response_utils import create_standard_response
from services import knowledgebase_service
from services.vector_db import process_files_for_project

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("", response_model=dict)
async def list_project_files(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = Query(0, ge=0, description="Pagination offset; must be >= 0"),
    limit: int = Query(
        100, ge=1, le=500, description="Max number of files to return, 1-500"
    ),
    file_type: Optional[str] = Query(
        None,
        min_length=1,
        max_length=50,
        regex="^[a-zA-Z0-9._-]+$",
        description="Filter by file type (e.g., 'pdf', 'docx', 'image').",
    ),
):
    """
    Returns a list of files for a project with optional filtering by file_type.
    Supports pagination with `skip` and `limit`.
    """
    try:
        # Use the knowledgebase service to get file list
        result = await knowledgebase_service.get_project_file_list(
            project_id=project_id,
            user_id=current_user.id,
            db=db,
            skip=skip,
            limit=limit,
            file_type=file_type,
        )

        return await create_standard_response(result)
    except Exception as e:
        logger.error(f"Error listing project files: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to list files: {str(e)}")


@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED)
async def upload_project_file(
    project_id: UUID,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    """Upload a file to a project and process it for the knowledge base."""
    try:
        result = await knowledgebase_service.upload_file_to_project(
            project_id=project_id,
            file=file,
            db=db,
            user_id=current_user.id,
            background_tasks=background_tasks,
        )
        return await create_standard_response(result, "File uploaded successfully")
    except Exception as e:
        logger.error(f"File upload failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"File upload failed: {str(e)}")


@router.get("/{file_id}", response_model=dict)
async def get_project_file(
    project_id: UUID,
    file_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Get file details and content using knowledge base service"""
    raise HTTPException(
        status_code=501, detail="Get file functionality is currently unavailable."
    )


@router.delete("/{file_id}", response_model=dict)
async def delete_project_file(
    project_id: UUID,
    file_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Delete a file from project storage and knowledge base"""
    try:
        result = await knowledgebase_service.delete_project_file(
            project_id=project_id, file_id=file_id, db=db, user_id=current_user.id
        )

        return await create_standard_response(
            {"file_id": str(file_id)},
            message=result.get("message", "File deleted successfully"),
            success=result.get("success", False),
        )
    except Exception as e:
        logger.error(f"Error deleting file {file_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"File deletion failed: {str(e)}")


@router.post("/reprocess", response_model=dict)
async def reprocess_project_files(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Reprocess all files in a project for the knowledge base."""
    try:
        # Validate project access
        from services.project_service import validate_project_access

        project = await validate_project_access(project_id, current_user, db)

        if not project.knowledge_base_id:
            raise HTTPException(
                status_code=400,
                detail="Project does not have an associated knowledge base",
            )

        # Use the vector_db service for file reprocessing
        result = await process_files_for_project(project_id, db=db)

        return await create_standard_response(
            {
                "total_files": result.get("total", 0),
                "processed_success": result.get("processed", 0),
                "processed_failed": result.get("failed", 0),
                "errors": result.get("errors", []),
            },
            "Files reprocessed for knowledge base",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error reprocessing files: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"File reprocessing failed: {str(e)}"
        )
