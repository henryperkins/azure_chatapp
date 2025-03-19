"""
knowledgebase_service.py
------------------------
Contains logic for managing ProjectFile entries (knowledge base files) in a dedicated layer:
 - Validation of file uploads
 - Upload to local or cloud storage (S3/Azure)
 - Text extraction from various file formats
 - Token calculation and usage tracking
 - Database interactions for ProjectFile (create, read, delete)
"""
import os
import io
import logging
import hashlib
import json
import config
from typing import Dict, Any, List, Optional, Tuple, Union, BinaryIO
from uuid import UUID
from fastapi import HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update, func
from sqlalchemy.orm import joinedload
from models.project_file import ProjectFile
from models.project import Project
from services.file_storage import get_file_storage, FileStorage
from services.text_extraction import get_text_extractor, TextExtractor, TextExtractionError

logger = logging.getLogger(__name__)

# Constants for file validation
MAX_FILE_BYTES = 30_000_000  # 30MB as per project plan

# Expanded allowed file extensions per project plan
ALLOWED_FILE_EXTENSIONS = {
    ".txt", ".pdf", ".doc", ".docx", ".csv", ".json", ".md",
}

def validate_file_extension(filename: str) -> bool:
    """Validates that a filename has an allowed extension"""
    _, ext = os.path.splitext(filename.lower())
    return ext in ALLOWED_FILE_EXTENSIONS

# Get instances of our services
def _get_services() -> Tuple[FileStorage, TextExtractor]:
    """Get configured instances of storage and text extraction services"""
    # Configure file storage based on app settings
    storage_config = {
        "storage_type": getattr(config, "FILE_STORAGE_TYPE", "local"),
        "local_path": getattr(config, "LOCAL_UPLOADS_DIR", "./uploads"),
        "azure_connection_string": getattr(config, "AZURE_STORAGE_CONNECTION_STRING", None),
        "azure_container_name": getattr(config, "AZURE_STORAGE_CONTAINER", None),
        "aws_access_key": getattr(config, "AWS_ACCESS_KEY", None),
        "aws_secret_key": getattr(config, "AWS_SECRET_KEY", None),
        "aws_bucket_name": getattr(config, "AWS_BUCKET_NAME", None),
        "aws_region": getattr(config, "AWS_REGION", None)
    }
    
    return get_file_storage(storage_config), get_text_extractor()

async def estimate_tokens_from_file(
    content: Union[bytes, BinaryIO],
    filename: str
) -> Tuple[int, Dict[str, Any]]:
    """
    Estimates the number of tokens in file content using text extraction
    and token calculation.
    
    Args:
        content: File content as bytes or file-like object
        filename: Name of the file for type detection
        
    Returns:
        Tuple of (token_count, metadata_dict)
    """
    try:
        # Get text extractor service
        _, text_extractor = _get_services()
        
        # Extract text content and metadata
        text, metadata = await text_extractor.extract_text(content, filename)
        
        # Basic token estimation (1 token ≈ 4 chars for English)
        # For more accuracy, we would use tiktoken library here
        char_count = metadata.get("char_count", len(text))
        token_count = char_count // 4
        
        # Adjust based on content type
        file_type = metadata.get("extension", "").lower()
        
        # Add token count to metadata
        metadata["token_count"] = token_count
        
        return token_count, metadata
    except Exception as e:
        logger.error(f"Token estimation error for {filename}: {str(e)}")
        # Fallback to basic size-based estimation for unknown file types
        if isinstance(content, bytes):
            content_size = len(content)
        else:
            # Try to get file size through seek/tell if it's a file object
            # Simplify content size handling for non-file objects
            try:
                if isinstance(content, (bytes, bytearray, memoryview)):
                    content_size = len(content)
                elif hasattr(content, 'read'):
                    # Attempt to read content to measure size
                    if hasattr(content, 'seek'):
                        current_pos = content.tell()
                        content.seek(0, os.SEEK_END)
                        content_size = content.tell()
                        content.seek(current_pos)
                    else:
                        file_data = content.read()
                        content_size = len(file_data or b'')
                        try:
                            content.seek(0)
                        except:
                            pass
                else:
                    # Fallback conservative estimate
                    content_size = MAX_FILE_BYTES // 10
            except:
                content_size = MAX_FILE_BYTES // 10
        
        # Conservative token estimation based on file size
        token_count = content_size // 8
        
        return token_count, {"file_size": content_size, "token_count": token_count}

async def upload_file_to_project(
    project_id: UUID,
    file: UploadFile,
    db: AsyncSession,
    user_id: Optional[int] = None
) -> ProjectFile:
    """
    Handles full file upload process:
    1. Validates the file (size, type, etc)
    2. Uploads to storage (local or cloud)
    3. Extracts text and calculates tokens
    4. Creates the database record
    5. Updates project token usage
    
    Args:
        project_id: UUID of the project
        file: FastAPI UploadFile object
        db: Database session
        user_id: Optional user ID for permission checks
        
    Returns:
        Created ProjectFile database record
    """
    # 1. Derive or default a filename
    safe_filename = file.filename or "untitled"
    
    # Validate file extension
    if not validate_file_extension(safe_filename):
        raise HTTPException(
            status_code=400,
            detail=f"File type not allowed. Supported types: {', '.join(ALLOWED_FILE_EXTENSIONS)}"
        )
    
    # Read file content
    contents = await file.read() or b""
    if len(contents) > MAX_FILE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"File too large (>{MAX_FILE_BYTES/1_000_000}MB)."
        )
    
    # Validate project / user
    from services.project_service import validate_project_access
    from models.user import User
    
    the_user = None
    if user_id is not None:
        the_user = await db.get(User, user_id)
        if not the_user:
            raise HTTPException(status_code=404, detail="User not found")
        project = await validate_project_access(project_id, the_user, db)
    else:
        project = await db.get(Project, project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
    
    # Extract text and tokens
    token_estimate, file_metadata = await estimate_tokens_from_file(contents, safe_filename)
    
    if project.token_usage + token_estimate > project.max_tokens:
        raise HTTPException(
            status_code=400,
            detail=f"Adding this file would exceed the project's token limit of {project.max_tokens}"
        )
    
    # Build combined metadata
    metadata = {
        "token_estimate": token_estimate,
        "file_info": file_metadata
    }
    
    storage, _ = _get_services()
    
    try:
        file_path = await storage.save_file(
            file_content=io.BytesIO(contents),
            filename=safe_filename,
            content_type=file.content_type or "application/octet-stream",
            metadata=metadata,
            project_id=project_id
        )
    except Exception as e:
        logger.error(f"File storage error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"File storage error: {str(e)}")
    
    # Derive extension
    file_ext = ""
    if "." in safe_filename:
        file_ext = os.path.splitext(safe_filename)[1][1:].lower()
    
    pf = ProjectFile(
        project_id=project_id,
        filename=file.filename,
        file_path=file_path,
        file_size=len(contents),
        file_type=file_ext,
        order_index=0,  # Default order
        metadata=metadata  # Store detailed metadata
    )
    
    db.add(pf)
    
    # 6. Update project token usage
    project.token_usage += token_estimate
    
    await db.commit()
    await db.refresh(pf)
    return pf

async def list_project_files(
    project_id: UUID,
    db: AsyncSession,
    skip: int = 0,
    limit: int = 100,
    file_type: Optional[str] = None,
    sort_by: str = "created_at",
    sort_desc: bool = True
):
    """
    Retrieves files associated with the given project with filtering and pagination.
    
    Args:
        project_id: Project UUID
        db: Database session
        skip: Number of records to skip (pagination)
        limit: Maximum number of records to return
        file_type: Optional filter by file type
        sort_by: Field to sort by (created_at, filename, file_size, etc)
        sort_desc: Sort in descending order if True
        
    Returns:
        List of ProjectFile records
    """
    query = select(ProjectFile).where(ProjectFile.project_id == project_id)
    
    # Apply optional file type filter
    if file_type:
        query = query.where(ProjectFile.file_type == file_type.lower())
    
    # Apply sorting
    if hasattr(ProjectFile, sort_by):
        sort_field = getattr(ProjectFile, sort_by)
        query = query.order_by(sort_field.desc() if sort_desc else sort_field.asc())
    else:
        # Default to created_at if invalid sort field
        query = query.order_by(ProjectFile.created_at.desc() if sort_desc else ProjectFile.created_at.asc())
    
    # Apply pagination
    query = query.offset(skip).limit(limit)
    
    result = await db.execute(query)
    return result.scalars().all()

async def get_project_file(
    project_id: UUID,
    file_id: UUID,
    db: AsyncSession,
    include_content: bool = False
) -> Dict[str, Any]:
    """
    Retrieve a specific file record and optionally its content for the given project.
    
    Args:
        project_id: Project UUID
        file_id: File UUID
        db: Database session
        include_content: Whether to include the file content
        
    Returns:
        Dictionary with file information and optional content
    """
    query = select(ProjectFile).where(
        ProjectFile.id == file_id,
        ProjectFile.project_id == project_id
    )
    result = await db.execute(query)
    file_record = result.scalars().first()
    
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Convert to dict for easier manipulation
    file_data = {
        "id": str(file_record.id),
        "project_id": str(file_record.project_id),
        "filename": file_record.filename,
        "file_path": file_record.file_path,
        "file_size": file_record.file_size,
        "file_type": file_record.file_type,
        "created_at": file_record.created_at,
        "metadata": file_record.metadata or {},
    }
    
    # Include file content if requested
    if include_content:
        try:
            storage, _ = _get_services()
            content = await storage.get_file(file_record.file_path)
            
            # For text files, decode to string
            if file_record.file_type in ['txt', 'json', 'csv', 'py', 'js', 'html', 'css', 'md']:
                try:
                    content = content.decode('utf-8')
                except UnicodeDecodeError:
                    content = content.decode('utf-8', errors='replace')
                    
            file_data['content'] = content
        except Exception as e:
            logger.error(f"Error retrieving file content: {str(e)}")
            file_data['retrieval_error'] = str(e)
    
    return file_data

async def delete_project_file(
    project_id: UUID,
    file_id: UUID,
    db: AsyncSession,
    user_id: Optional[int] = None
) -> Dict[str, Any]:
    """
    Deletes the file from storage and removes the DB record.
    Also updates the project token usage.
    
    Args:
        project_id: Project UUID
        file_id: File UUID
        db: Database session
        user_id: Optional user ID for permission checks
        
    Returns:
        Dictionary with success status and message
    """
    # Get file record
    file_record = await get_project_file(project_id, file_id, db, include_content=False)
    
    # Get full database record
    query = select(ProjectFile).where(
        ProjectFile.id == file_id,
        ProjectFile.project_id == project_id
    )
    result = await db.execute(query)
    db_file_record = result.scalars().first()
    
    if not db_file_record:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Get project for permission check and token usage update
    project_result = await db.execute(select(Project).where(Project.id == project_id))
    project = project_result.scalars().first()
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # If user_id provided, check if user has access to this project
    if user_id is not None and project.user_id != user_id:
        raise HTTPException(status_code=403, detail="You don't have permission to delete files from this project")
    
    # Get token estimate from metadata
    token_estimate = 0
    if db_file_record.metadata and "token_estimate" in db_file_record.metadata:
        token_estimate = db_file_record.metadata["token_estimate"]
    
    # Delete the file from storage
    try:
        storage, _ = _get_services()
        await storage.delete_file(db_file_record.file_path)
    except Exception as e:
        logger.error(f"Error deleting file from storage: {str(e)}")
        # Continue with DB deletion even if storage deletion fails
    
    # Delete the database record
    await db.execute(
        delete(ProjectFile).where(ProjectFile.id == file_id)
    )
    
    # Update project token usage
    if token_estimate > 0:
        project.token_usage = max(0, project.token_usage - token_estimate)  # Ensure we don't go below 0
    
    await db.commit()
    return {
        "success": True,
        "message": "File deleted successfully",
        "tokens_removed": token_estimate
    }

async def get_project_files_stats(project_id: UUID, db: AsyncSession) -> Dict[str, Any]:
    """
    Get statistics about files in a project.
    
    Args:
        project_id: Project UUID
        db: Database session
        
    Returns:
        Dictionary with statistics
    """
    # Get total file count
    count_query = select(func.count()).select_from(ProjectFile).where(
        ProjectFile.project_id == project_id
    )
    file_count_result = await db.execute(count_query)
    file_count = file_count_result.scalar() or 0
    
    # Get sum of file sizes
    size_query = select(func.sum(ProjectFile.file_size)).select_from(ProjectFile).where(
        ProjectFile.project_id == project_id
    )
    size_result = await db.execute(size_query)
    total_size = size_result.scalar() or 0
    
    # Get file type distribution
    type_query = select(
        ProjectFile.file_type,
        func.count().label('count')
    ).where(
        ProjectFile.project_id == project_id
    ).group_by(ProjectFile.file_type)
    
    type_result = await db.execute(type_query)
    file_types = {row[0]: row[1] for row in type_result}
    
    # Get project token usage
    project_query = select(Project).where(Project.id == project_id)
    project_result = await db.execute(project_query)
    project = project_result.scalar()
    
    return {
        "file_count": file_count,
        "total_size_bytes": total_size,
        "total_size_mb": round(total_size / (1024 * 1024), 2) if total_size > 0 else 0,
        "file_types": file_types,
        "token_usage": project.token_usage if project else 0,
        "max_tokens": project.max_tokens if project else 0,
    }