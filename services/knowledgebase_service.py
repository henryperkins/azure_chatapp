"""
knowledgebase_service.py
------------------------
Contains logic for managing knowledge bases and their components:
 - File uploads and processing
 - Text extraction and chunking
 - Embedding generation and vector storage
 - Search and retrieval for context
 - Token usage tracking
"""

import os
import io
import logging
import config
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple, Union, BinaryIO
from uuid import UUID

from fastapi import HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
from sqlalchemy.exc import SQLAlchemyError

# Secure filename imports (install via: pip install werkzeug)
try:
    from werkzeug.utils import secure_filename
except ImportError:
    secure_filename = None

from models.project_file import ProjectFile
from models.project import Project
from models.knowledge_base import KnowledgeBase
from services.file_storage import get_file_storage, FileStorage
from services.text_extraction import get_text_extractor, TextExtractor, TextExtractionError
from services.vector_db import get_vector_db, process_file_for_search, VectorDB
from services.project_service import validate_project_access
from models.user import User


logger = logging.getLogger(__name__)

# Constants for file validation
MAX_FILE_BYTES = 30_000_000  # 30MB 
STREAM_THRESHOLD = 10_000_000  # Threshold beyond which we consider chunked reading

# Expanded allowed file extensions
ALLOWED_FILE_EXTENSIONS = {
    ".txt", ".pdf", ".doc", ".docx", ".csv", ".json", ".md", ".xlsx", ".html"
}

# For controlling sort fields more securely
ALLOWED_SORT_FIELDS = {"created_at", "filename", "file_size"}

# Embedding model configuration
DEFAULT_EMBEDDING_MODEL = getattr(config, "DEFAULT_EMBEDDING_MODEL", "all-MiniLM-L6-v2")
VECTOR_DB_STORAGE_PATH = getattr(config, "VECTOR_DB_STORAGE_PATH", "./data/vector_db")
DEFAULT_CHUNK_SIZE = getattr(config, "DEFAULT_CHUNK_SIZE", 1000)
DEFAULT_CHUNK_OVERLAP = getattr(config, "DEFAULT_CHUNK_OVERLAP", 200)

def validate_file_extension(filename: str) -> bool:
    """Validates that a filename has an allowed extension."""
    _, ext = os.path.splitext(filename.lower())
    return ext in ALLOWED_FILE_EXTENSIONS

def _sanitize_filename(filename: str) -> str:
    """
    Safely sanitize the filename to avoid directory traversal or injection.
    Fallback to using the original name if werkzeug is unavailable.
    """
    if secure_filename:
        return secure_filename(filename or "untitled")
    return filename or "untitled"

# Get instances of our services
def _get_services() -> Tuple[FileStorage, TextExtractor]:
    """Get configured instances of storage and text extraction services."""
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

def _chunked_read(file_obj, chunk_size=65536):
    """Generator to read a file-like object in chunks."""
    while True:
        chunk = file_obj.read(chunk_size)
        if not chunk:
            break
        yield chunk

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
    from utils.context import estimate_token_count

    # Get text extractor service
    _, text_extractor = _get_services()
    
    try:
        # Extract text using existing extractor
        text_chunks, extracted_meta = await text_extractor.extract_text(
            content,
            filename=filename,
            chunk_size=DEFAULT_CHUNK_SIZE,
            chunk_overlap=DEFAULT_CHUNK_OVERLAP
        )
        
        # Join chunks for a complete text
        text = " ".join(text_chunks) if text_chunks else ""
        
        # Use centralized token counter
        token_count = estimate_token_count([{"role": "user", "content": text}])
        
        metadata = {
            **extracted_meta,
            "token_count": token_count,
            "token_estimation_accuracy": "high"
        }
        
        return token_count, metadata
        
    except TextExtractionError as tex:
        logger.error(f"Text extraction error for {filename}: {str(tex)}")
        raise HTTPException(
            status_code=422,
            detail=f"Text extraction failed for file: {str(tex)}"
        )
    except Exception as e:
        logger.error(f"Token estimation error for {filename}: {str(e)}")
        # For errors, provide conservative size-based estimate
        content_size = (
            len(content) if isinstance(content, bytes)
            else getattr(content, "size", MAX_FILE_BYTES // 10)
        )
        token_count = content_size // 8
        
        metadata = {
            "file_size": content_size,
            "token_count": token_count,
            "token_estimation_accuracy": "low"
        }
        
        logger.warning(
            f"Falling back to conservative token estimation for {filename}. "
            f"Estimated tokens: {token_count}"
        )
        
        return token_count, metadata

async def _validate_user_and_project(
    project_id: UUID,
    user_id: Optional[int],
    db: AsyncSession
) -> Project:
    """Helper to validate user permissions and get project."""
    if user_id is not None:
        the_user = await db.get(User, user_id)
        if not the_user:
            raise HTTPException(status_code=404, detail="User not found")
        return await validate_project_access(project_id, the_user, db)
    
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project

async def _get_vector_db_for_project(
    project_id: UUID,
    project: Optional[Project] = None
) -> VectorDB:
    """Helper to get vector DB instance for a project."""
    model_name = (
        project.knowledge_base.embedding_model
        if project and project.knowledge_base
        else DEFAULT_EMBEDDING_MODEL
    )
    return await get_vector_db(
        model_name=model_name,
        storage_path=os.path.join(VECTOR_DB_STORAGE_PATH, str(project_id)),
        load_existing=True
    )

async def upload_file_to_project(
    project_id: UUID,
    file: UploadFile,
    db: AsyncSession,
    user_id: Optional[int] = None,
    process_for_search: bool = True
) -> ProjectFile:
    """
    Handles full file upload process:
    1. Validates the file (size, type, etc).
    2. Uploads to storage (local or cloud).
    3. Extracts text and calculates tokens.
    4. Creates the database record.
    5. Updates project token usage.
    6. Optionally processes for search.
    """
    # 1. Process filename and validate
    sanitized_filename = _sanitize_filename(file.filename or "untitled")
    if not validate_file_extension(sanitized_filename):
        raise HTTPException(
            status_code=400,
            detail=f"File type not allowed. Supported types: {', '.join(ALLOWED_FILE_EXTENSIONS)}"
        )

    # 2. Initialize services and validate file size
    storage, _ = _get_services()
    file_size = getattr(file, 'size', None)
    contents = b""
    
    if file_size is None:
        contents = await file.read()
        file_size = len(contents)
        await file.seek(0)
        
    if file_size > MAX_FILE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"File too large (>{MAX_FILE_BYTES / (1024 * 1024):.1f}MB)."
        )

    # 3. Validate project access
    project = await _validate_user_and_project(project_id, user_id, db)

    # 4. Process file content
    file_ext = os.path.splitext(sanitized_filename)[1][1:].lower() if "." in sanitized_filename else ""
    token_estimate = 0
    file_metadata = {}
    
    # We want to extract text from all files if possible
    token_estimate, file_metadata = await estimate_tokens_from_file(
        contents if contents else file.file,
        sanitized_filename
    )

    # Check token limit
    if project.token_usage + token_estimate > project.max_tokens:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Adding this file ({token_estimate} tokens) would exceed the project's "
                f"token limit of {project.max_tokens}"
            )
        )

    # Build combined metadata
    metadata = {
        "tokens": token_estimate,        # standard key for tokens
        "file_metadata": file_metadata   # store details from extraction
    }

    try:
        # Save file using appropriate method based on size
        file_path = await storage.save_file(
            file_content=file.file if file_size > STREAM_THRESHOLD else io.BytesIO(contents),
            filename=sanitized_filename,
            content_type=file.content_type or "application/octet-stream",
            metadata=metadata,
            project_id=project_id
        )
    except Exception as e:
        logger.error(f"File storage error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"File storage error: {str(e)}")

    # Create ProjectFile record with metadata
    pf = ProjectFile(
        project_id=project_id,
        filename=sanitized_filename,
        file_path=file_path,
        file_size=file.size,
        file_type=file_ext,
        order_index=0,  # Default order
        metadata=metadata  # Store detailed metadata
    )

    # Use explicit transaction for data integrity
    try:
        async with db.begin():
            db.add(pf)
            project.token_usage += token_estimate
    except SQLAlchemyError as ex:
        logger.error(f"Database transaction error during file upload: {str(ex)}")
        raise HTTPException(status_code=500, detail="Database error during file upload.")

    # Refresh to get final state
    await db.refresh(pf)

    # Process for search if requested
    if process_for_search:
        vector_db = await _get_vector_db_for_project(project_id, project)
        
        # Process file for search
        search_results = await process_file_for_search(
            project_file=pf,
            vector_db=vector_db,
            file_content=contents or await file.read(),
            chunk_size=DEFAULT_CHUNK_SIZE,
            chunk_overlap=DEFAULT_CHUNK_OVERLAP
        )
        
        # Update metadata with search processing results
        if search_results:
            metadata["search_processing"] = {
                "success": search_results.get("success", False),
                "chunk_count": search_results.get("chunk_count", 0),
                "added_ids": search_results.get("added_ids", []),
                "processed_at": str(datetime.now())
            }
            
            # Update the file record with new metadata
            pf.metadata = metadata
            await db.commit()

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

    # Securely handle sorting
    if sort_by not in ALLOWED_SORT_FIELDS:
        sort_by = "created_at"
    sort_field = getattr(ProjectFile, sort_by)
    query = query.order_by(sort_field.desc() if sort_desc else sort_field.asc())

    # Apply pagination
    query = query.offset(skip).limit(limit)

    result = await db.execute(query)
    return result.scalars().all()

async def get_project_file(
    project_id: UUID,
    file_id: UUID,
    db: AsyncSession,
    user_id: Optional[int] = None,
    include_content: bool = False
) -> Dict[str, Any]:
    """
    Retrieve a specific file record and optionally its content for the given project.

    Args:
        project_id: Project UUID
        file_id: File UUID
        db: Database session
        user_id: Optional user ID for permission checks
        include_content: Whether to include the file content

    Returns:
        Dictionary with file information and optional content
    """
    # Validate user permission if provided
    if user_id:
        the_user = await db.get(User, user_id)
        if not the_user:
            raise HTTPException(status_code=404, detail="User not found")
        await validate_project_access(project_id, the_user, db)
    
    # Query file record
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

            # For text-based files, decode to string
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
    # Validate user and project ownership if user_id is provided
    # Get authorized project
    project = await _validate_user_and_project(project_id, user_id, db)

    # Get the file record
    query = select(ProjectFile).where(
        ProjectFile.id == file_id,
        ProjectFile.project_id == project_id
    )
    result = await db.execute(query)
    db_file_record = result.scalars().first()

    if not db_file_record:
        raise HTTPException(status_code=404, detail="File not found")

    # Get token estimate from metadata
    token_estimate = 0
    file_meta = db_file_record.metadata or {}
    if "tokens" in file_meta:
        token_estimate = file_meta["tokens"]
    elif "token_estimate" in file_meta:  # fallback if older key
        token_estimate = file_meta["token_estimate"]

    # Attempt file deletion in storage
    try:
        storage, _ = _get_services()
        await storage.delete_file(db_file_record.file_path)
        file_deletion_status = "success"
    except Exception as e:
        logger.error(f"Error deleting file from storage: {str(e)}")
        file_deletion_status = "storage_deletion_failed"

    # Try to remove from vector database
    try:
        vector_db = await _get_vector_db_for_project(project_id, project)
        
        # Delete all chunks for this file
        await vector_db.delete_by_filter({"file_id": str(file_id)})
    except Exception as e:
        logger.error(f"Error removing file from vector database: {str(e)}")
        # Continue with DB deletion even if vector DB fails

    # Remove DB record in a transaction
    try:
        async with db.begin():
            await db.execute(
                delete(ProjectFile).where(ProjectFile.id == file_id)
            )
            project.token_usage = max(0, project.token_usage - token_estimate)
    except SQLAlchemyError as ex:
        logger.error(f"Database deletion error: {ex}")
        raise HTTPException(status_code=500, detail="Database deletion error")

    return {
        "success": file_deletion_status == "success",
        "status": file_deletion_status,
        "message": (
            "File deleted successfully"
            if file_deletion_status == "success"
            else "File record removed but storage deletion encountered issues"
        ),
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

# Knowledge Base Management
async def create_knowledge_base(
    name: str,
    description: Optional[str] = None,
    embedding_model: Optional[str] = None,
    db: Optional[AsyncSession] = None
) -> KnowledgeBase:
    """
    Create a new knowledge base.
    
    Args:
        name: Name of the knowledge base
        description: Optional description
        embedding_model: Optional embedding model to use
        db: Database session
        
    Returns:
        New KnowledgeBase instance
    """
    knowledge_base = KnowledgeBase(
        name=name,
        description=description,
        embedding_model=embedding_model or DEFAULT_EMBEDDING_MODEL,
        is_active=True
    )
    
    if db:
        db.add(knowledge_base)
        await db.commit()
        await db.refresh(knowledge_base)
    
    return knowledge_base

async def search_project_context(
    project_id: UUID,
    query: str,
    db: AsyncSession,
    top_k: int = 5
) -> List[Dict[str, Any]]:
    """
    Search for project context based on a query.
    
    Args:
        project_id: Project UUID
        query: Search query
        db: Database session
        top_k: Number of results to return
        
    Returns:
        List of relevant context pieces
    """
    # Get project and initialize vector DB
    project = await _validate_user_and_project(project_id, None, db)
    vector_db = await _get_vector_db_for_project(project_id, project)
    
    # Search for context
    from services.vector_db import search_context_for_query
    results = await search_context_for_query(
        query=query,
        vector_db=vector_db,
        project_id=str(project_id),
        top_k=top_k
    )
    
    # Enhance results with additional context
    enhanced_results = []
    for result in results:
        # Get file metadata
        file_id = result.get("metadata", {}).get("file_id")
        if file_id:
            try:
                file_query = select(ProjectFile).where(ProjectFile.id == UUID(file_id))
                file_result = await db.execute(file_query)
                file = file_result.scalars().first()
                
                if file:
                    result["file_info"] = {
                        "filename": file.filename,
                        "file_type": file.file_type,
                        "file_size": file.file_size,
                        "created_at": file.created_at
                    }
            except Exception as e:
                logger.error(f"Error getting file info: {str(e)}")
        
        enhanced_results.append(result)
    
    return enhanced_results