"""
p_files.py
----------
Routes for managing files within a project.
Provides endpoints for uploading, listing, retrieving and deleting files.
"""

import logging
import os
import shutil
from uuid import UUID, uuid4
from typing import Optional, Dict, List

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
import services

from db import get_async_session
from models.user import User
from models.project import Project
from models.project_file import ProjectFile
from utils.auth_deps import (
    get_current_user_and_token,
    validate_resource_ownership,
    process_standard_response
)
from utils.context import get_all_by_condition, save_model

logger = logging.getLogger(__name__)
router = APIRouter()

# Constants for file validation
MAX_FILE_BYTES = 30_000_000  # 30MB
ALLOWED_FILE_EXTENSIONS = {
    ".txt", ".pdf", ".doc", ".docx", ".csv", ".json", ".md",
}

def validate_file_extension(filename: str) -> bool:
    """Validates that a filename has an allowed extension"""
    _, ext = os.path.splitext(filename.lower())
    return ext in ALLOWED_FILE_EXTENSIONS


# ============================
# File Endpoints
# ============================

@router.get("/{project_id}/files", response_model=dict)
async def list_project_files(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = 0,
    limit: int = 100,
    file_type: Optional[str] = None
):
    """
    Returns a list of files for a project with optional filtering.
    """
    # Verify project access
    project = await validate_resource_ownership(
        project_id,
        Project,
        current_user,
        db,
        "Project",
        [Project.user_id == current_user.id]
    )
    
    # Prepare query conditions
    conditions = [ProjectFile.project_id == project_id]
    if file_type:
        conditions.append(ProjectFile.file_type == file_type.lower())
    
    # Get files using enhanced db utility
    project_files = await get_all_by_condition(
        db,
        ProjectFile,
        *conditions,
        order_by=ProjectFile.created_at.desc(),
        limit=limit,
        offset=skip
    )
    
    return await process_standard_response({
        "files": [
            {
                "id": str(file.id),
                "filename": file.filename,
                "file_type": file.file_type,
                "file_size": file.file_size,
                "created_at": file.created_at.isoformat() if file.created_at else None
            }
            for file in project_files
        ]
    })


@router.post("/{project_id}/files", response_model=dict, status_code=status.HTTP_201_CREATED)
async def upload_project_file(
    project_id: UUID,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Upload a file to a project using the knowledge base service"""
    try:
        project_file = await services.knowledgebase_service.upload_file_to_project(
            project_id=project_id,
            file=file,
            db=db,
            user_id=current_user.id
        )
        
        return await process_standard_response(
            {
                "id": str(project_file.id),
                "filename": project_file.filename,
                "file_type": project_file.file_type,
                "file_size": project_file.file_size,
                "created_at": project_file.created_at.isoformat(),
                "metadata": project_file.metadata
            },
            "File uploaded successfully"
        )
    except Exception as e:
        logger.error(f"Error uploading file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to upload file: {str(e)}")


@router.get("/{project_id}/files/{file_id}", response_model=dict)
async def get_project_file(
    project_id: UUID,
    file_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Get file details and content using knowledge base service"""
    file_data = await services.knowledgebase_service.get_project_file(
        project_id=project_id,
        file_id=file_id,
        db=db,
        user_id=current_user.id,
        include_content=True
    )
    return await process_standard_response(file_data)


@router.delete("/{project_id}/files/{file_id}", response_model=dict)
async def delete_project_file(
    project_id: UUID,
    file_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Delete a file using knowledge base service"""
    result = await services.knowledgebase_service.delete_project_file(
        project_id=project_id,
        file_id=file_id,
        db=db,
        user_id=current_user.id
    )
    return await process_standard_response(result)
