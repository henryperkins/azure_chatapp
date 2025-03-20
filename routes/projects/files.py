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
    """
    Upload a file to a project
    """
    # Verify project access
    project = await validate_resource_ownership(
        project_id,
        Project,
        current_user,
        db,
        "Project",
        [
            Project.user_id == current_user.id,
            Project.archived.is_(False)  # Cannot upload to archived projects
        ]
    )
    
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    
    # Validate file extension
    if not validate_file_extension(file.filename):
        raise HTTPException(
            status_code=400,
            detail=f"File type not allowed. Supported types: {', '.join(ALLOWED_FILE_EXTENSIONS)}"
        )
    
    # Read file content and get size
    file_content = await file.read()
    file_size = len(file_content)
    
    # Check file size
    if file_size > MAX_FILE_BYTES:
        raise HTTPException(
            status_code=400, 
            detail=f"File too large (>{MAX_FILE_BYTES/(1024*1024):.1f} MB)"
        )
    
    # Get file extension
    file_ext = os.path.splitext(file.filename)[1].lower().lstrip('.')
    if not file_ext:
        file_ext = "bin"  # Default extension if none found
    
    # Save file to storage
    try:
        # Generate a unique filename to avoid collisions
        unique_filename = f"{uuid4().hex}_{file.filename}"
        file_path = f"project_files/{project_id}/{unique_filename}"
        
        # Create project_file record
        new_file = ProjectFile(
            project_id=project_id,
            filename=file.filename,
            file_path=file_path,
            file_size=file_size,
            file_type=file_ext
        )
        
        # If it's a text file under 1MB, store content inline
        if file_ext in ["txt", "md", "csv", "json"] and file_size < 1_000_000:
            try:
                new_file.content = file_content.decode('utf-8')
            except UnicodeDecodeError:
                pass  # Not UTF-8 text, skip inline storage
                
        # Create directory structure if it doesn't exist
        os.makedirs(os.path.dirname(f"./uploads/{file_path}"), exist_ok=True)
        
        # Save the file to disk
        with open(f"./uploads/{file_path}", "wb") as f:
            # Reset file pointer to beginning
            await file.seek(0)
            # Copy file content to disk
            file.file.seek(0)
            shutil.copyfileobj(file.file, f)
            
        # Save file record to database
        await save_model(db, new_file)
        
        # Calculate token estimate for reporting (rough estimate)
        token_estimate = file_size // 4  # 4 characters per token rule of thumb
        
        return await process_standard_response({
            "id": str(new_file.id),
            "filename": new_file.filename,
            "file_type": new_file.file_type,
            "file_size": new_file.file_size,
            "created_at": new_file.created_at.isoformat() if new_file.created_at else None,
            "token_estimate": token_estimate
        }, "File uploaded successfully")
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
    """
    Get file details and content
    """
    # Verify project access
    await validate_resource_ownership(
        project_id,
        Project,
        current_user,
        db,
        "Project",
        [Project.user_id == current_user.id]
    )
    
    # Get the file
    project_file = await validate_resource_ownership(
        file_id,
        ProjectFile,
        current_user,
        db,
        "File",
        [ProjectFile.project_id == project_id]
    )
    
    # If the file has inline content, return it directly
    if project_file.content:
        return await process_standard_response({
            "id": str(project_file.id),
            "filename": project_file.filename,
            "file_type": project_file.file_type,
            "file_size": project_file.file_size,
            "content": project_file.content,
            "created_at": project_file.created_at.isoformat() if project_file.created_at else None
        })
    
    # Otherwise, check if the file exists in storage
    file_path = f"./uploads/{project_file.file_path}"
    if not os.path.exists(file_path):
        return await process_standard_response({
            "id": str(project_file.id),
            "filename": project_file.filename,
            "file_type": project_file.file_type,
            "file_size": project_file.file_size,
            "content": None,
            "created_at": project_file.created_at.isoformat() if project_file.created_at else None,
            "error": "File content not available"
        })
    
    # Read the file content if it's a text file and not too large
    if project_file.file_type in ["txt", "md", "csv", "json"] and project_file.file_size < 1_000_000:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()
            return await process_standard_response({
                "id": str(project_file.id),
                "filename": project_file.filename,
                "file_type": project_file.file_type,
                "file_size": project_file.file_size,
                "content": content,
                "created_at": project_file.created_at.isoformat() if project_file.created_at else None
            })
        except Exception as e:
            logger.error(f"Error reading file: {str(e)}")
    
    # For non-text or large files, just return metadata
    return await process_standard_response({
        "id": str(project_file.id),
        "filename": project_file.filename,
        "file_type": project_file.file_type,
        "file_size": project_file.file_size,
        "content": None,
        "created_at": project_file.created_at.isoformat() if project_file.created_at else None
    })


@router.delete("/{project_id}/files/{file_id}", response_model=dict)
async def delete_project_file(
    project_id: UUID,
    file_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Delete a file from a project
    """
    # Verify project access
    project = await validate_resource_ownership(
        project_id,
        Project,
        current_user,
        db,
        "Project",
        [
            Project.user_id == current_user.id,
            Project.archived.is_(False)  # Cannot modify archived projects
        ]
    )
    
    # Get the file
    project_file = await validate_resource_ownership(
        file_id,
        ProjectFile,
        current_user,
        db,
        "File",
        [ProjectFile.project_id == project_id]
    )
    
    # Try to delete the actual file from storage
    try:
        file_path = f"./uploads/{project_file.file_path}"
        if os.path.exists(file_path):
            os.remove(file_path)
    except Exception as e:
        logger.error(f"Error deleting file from storage: {str(e)}")
        # Continue with deletion even if physical file removal fails
    
    # Delete the file record
    await db.delete(project_file)
    await db.commit()
    
    return await process_standard_response(
        {"file_id": str(file_id)},
        message="File deleted successfully"
    )
