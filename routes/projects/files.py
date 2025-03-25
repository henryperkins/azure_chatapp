"""
p_files.py
----------
Routes for managing files within a project.
Provides endpoints for uploading, listing, retrieving and deleting files.
"""

import logging
import os
from uuid import UUID
from typing import Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from services import knowledgebase_service
from services.vector_db import get_vector_db, process_file_for_search, VECTOR_DB_STORAGE_PATH, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP
from services.file_storage import get_file_storage
import config

from db import get_async_session
from models.user import User
from models.project import Project
from models.project_file import ProjectFile
from utils.auth_utils import get_current_user_and_token
from utils.db_utils import validate_resource_access, get_all_by_condition
from utils.response_utils import create_standard_response

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

@router.get("", response_model=dict)
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
    await validate_resource_access(
        project_id,
        Project,
        current_user,
        db,
        "Project"
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
    
    return await create_standard_response({
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


@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED)
async def upload_project_file(
    project_id: UUID,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Upload a file to a project using the knowledge base service"""
    try:
        # Log file info for debugging
        logger.info(f"Received file upload: {file.filename}, content_type: {file.content_type}, size: {getattr(file, 'size', 'unknown')}")
        
        # Validate file existence
        if not file or not file.filename:
            logger.error("No file or filename provided")
            raise HTTPException(status_code=400, detail="No file provided")
        
        # Validate project access
        project = await validate_resource_access(
            project_id,
            Project,
            current_user,
            db,
            "Project"
        )
        
        # Validate file extension
        if not validate_file_extension(file.filename):
            error_msg = f"File type not allowed. Supported: {', '.join(ALLOWED_FILE_EXTENSIONS)}"
            logger.error(f"File extension validation failed: {error_msg}")
            raise HTTPException(status_code=400, detail=error_msg)
        
        # Read a small portion to check if file is readable
        try:
            # Just peek at the file - don't read it all
            peek_content = await file.read(1024)
            if not peek_content and file.filename != '':  # Empty files might be valid in some cases
                logger.warning(f"Empty or unreadable file: {file.filename}")
            # Reset the file pointer for the service to read it again
            await file.seek(0)
        except Exception as read_error:
            logger.error(f"Error reading file: {str(read_error)}")
            raise HTTPException(status_code=400, detail=f"File is unreadable: {str(read_error)}")
        
        # Delegate to the service for full processing
        result = await knowledgebase_service.upload_file_to_project(
            project_id=project_id,
            file=file,
            db=db,
            user_id=current_user.id
        )
        
        # Extract the file data from the response
        file_data = result["file"]
        
        # Log success
        logger.info(f"Successfully uploaded file {file.filename} to project {project_id}, saved as {file_data['id']}")
        
        return await create_standard_response(
            file_data,  # Pass the entire file data dictionary 
            "File uploaded successfully"
        )
    except HTTPException:
        # Re-raise HTTP exceptions to preserve status codes
        raise
    except ValueError as e:
        # Handle validation errors
        logger.error(f"Validation error uploading file: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Invalid file: {str(e)}")
    except Exception as e:
        logger.error(f"Error uploading file: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to upload file: {str(e)}")


@router.get("/{file_id}", response_model=dict)
async def get_project_file(
    project_id: UUID,
    file_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Get file details and content using knowledge base service"""
    file_data = await knowledgebase_service.get_project_file(
        project_id=project_id,
        file_id=file_id,
        db=db,
        user_id=current_user.id,
        include_content=True
    )
    return await create_standard_response(file_data)


@router.delete("/{file_id}", response_model=dict)
async def delete_project_file(
    project_id: UUID,
    file_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Delete a file using knowledge base service"""
    result = await knowledgebase_service.delete_project_file(
        project_id=project_id,
        file_id=file_id,
        db=db,
        user_id=current_user.id
    )
    return await create_standard_response(result)

@router.post("/reprocess", response_model=dict)
async def reprocess_project_files(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Reprocess all files in a project for the knowledge base."""
    # Verify project access
    project = await validate_resource_access(
        project_id,
        Project,
        current_user,
        db,
        "Project"
    )
    
    # Check if project has a knowledge base
    if not project.knowledge_base_id:
        raise HTTPException(
            status_code=400,
            detail="Project does not have an associated knowledge base"
        )
    
    # Get all files
    files = await get_all_by_condition(
        db,
        ProjectFile,
        ProjectFile.project_id == project_id
    )
    
    # Setup for processing
    total_files = len(files)
    processed_count = 0
    failed_count = 0
    
    # Get vector DB - use a default model name if not available
    default_embedding_model = getattr(config, "DEFAULT_EMBEDDING_MODEL", "all-MiniLM-L6-v2")
    embedding_model = project.knowledge_base.embedding_model if project.knowledge_base else default_embedding_model
    vector_db = await get_vector_db(
        model_name=embedding_model,
        storage_path=os.path.join(VECTOR_DB_STORAGE_PATH, str(project_id)),
        load_existing=True
    )
    
    # Get storage configuration
    storage_config = {
        "storage_type": getattr(config, "FILE_STORAGE_TYPE", "local"),
        "local_path": getattr(config, "LOCAL_UPLOADS_DIR", "./uploads")
    }
    storage = get_file_storage(storage_config)
    
    # Process each file
    for file_record in files:
        try:
            # Get file content
            file_content = await storage.get_file(file_record.file_path)
            
            # Process for search
            result = await process_file_for_search(
                project_file=file_record,
                vector_db=vector_db,
                file_content=file_content,
                chunk_size=DEFAULT_CHUNK_SIZE,
                chunk_overlap=DEFAULT_CHUNK_OVERLAP
            )
            
            # Update metadata
            metadata = {} if file_record.metadata is None else (
                file_record.metadata if isinstance(file_record.metadata, dict) else {}
            )
            metadata["search_processing"] = {
                "success": result.get("success", False),
                "chunk_count": result.get("chunk_count", 0),
                "processed_at": datetime.now().isoformat()
            }
            file_record.metadata = metadata
            
            if result.get("success", False):
                processed_count += 1
            else:
                failed_count += 1
        except Exception as e:
            logger.error(f"Error processing file {file_record.id}: {str(e)}")
            failed_count += 1
    
    # Save all changes
    await db.commit()
    
    return await create_standard_response({
        "total_files": total_files,
        "processed_success": processed_count,
        "processed_failed": failed_count
    }, "Files reprocessed for knowledge base")
