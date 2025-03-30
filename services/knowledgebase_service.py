"""
knowledgebase_service.py
------------------------
Manages knowledge bases and their components:
 - File uploads and processing
 - Text extraction and chunking
 - Embedding generation and vector storage
 - Search and retrieval for context
 - Token usage tracking
"""

import os
import logging
from datetime import datetime
from typing import Dict, Any, Optional, Tuple, Union, BinaryIO, AsyncGenerator
from uuid import UUID
from fastapi import HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.exc import SQLAlchemyError

import config
from models.project_file import ProjectFile
from models.project import Project
from models.knowledge_base import KnowledgeBase
from models.user import User

# Import existing utilities to reduce duplication
from utils.file_validation import FileValidator, sanitize_filename
from utils.context import estimate_token_count
from utils.db_utils import get_by_id, get_all_by_condition, save_model
from utils.serializers import serialize_project_file, serialize_vector_result
from services.file_storage import get_file_storage
from services.text_extraction import get_text_extractor, TextExtractionError
from services.vector_db import get_vector_db, process_file_for_search

logger = logging.getLogger(__name__)

# -----------------------------------------------------------------------------
# Configuration Constants - Centralized for easier maintenance
# -----------------------------------------------------------------------------
def get_kb_config() -> Dict[str, Any]:
    """Centralized function to get configuration settings."""
    return {
        "max_file_bytes": getattr(config, "MAX_FILE_SIZE", 30_000_000),
        "stream_threshold": getattr(config, "STREAM_THRESHOLD", 10_000_000),
        "default_embedding_model": getattr(config, "DEFAULT_EMBEDDING_MODEL", "all-MiniLM-L6-v2"),
        "vector_db_storage_path": getattr(config, "VECTOR_DB_STORAGE_PATH", "./data/vector_db"),
        "default_chunk_size": getattr(config, "DEFAULT_CHUNK_SIZE", 1000),
        "default_chunk_overlap": getattr(config, "DEFAULT_CHUNK_OVERLAP", 200),
        "allowed_sort_fields": {"created_at", "filename", "file_size"}
    }


KB_CONFIG = get_kb_config()
MAX_FILE_BYTES = KB_CONFIG["max_file_bytes"]
STREAM_THRESHOLD = KB_CONFIG["stream_threshold"]
DEFAULT_EMBEDDING_MODEL = KB_CONFIG["default_embedding_model"]
VECTOR_DB_STORAGE_PATH = KB_CONFIG["vector_db_storage_path"]
DEFAULT_CHUNK_SIZE = KB_CONFIG["default_chunk_size"]
DEFAULT_CHUNK_OVERLAP = KB_CONFIG["default_chunk_overlap"]
ALLOWED_SORT_FIELDS = KB_CONFIG["allowed_sort_fields"]

# -----------------------------------------------------------------------------
# Error Handling - Using a decorator for consistent error handling
# -----------------------------------------------------------------------------
def handle_service_errors(detail_message: str = "Operation failed", status_code: int = 500):
    """
    Decorator for consistent error handling in service functions.
    """
    from functools import wraps
    
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except HTTPException:
                # Pass through existing HTTP exceptions
                raise
            except ValueError as e:
                # Handle validation errors with 400 status
                logger.warning(f"Validation error in {func.__name__}: {str(e)}")
                raise HTTPException(status_code=400, detail=f"{detail_message}: {str(e)}")
            except SQLAlchemyError as e:
                # Handle database errors
                logger.error(f"Database error in {func.__name__}: {str(e)}", exc_info=True)
                raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
            except Exception as e:
                # Handle all other errors
                logger.exception(f"Unhandled error in {func.__name__}: {str(e)}")
                raise HTTPException(status_code=status_code, detail=f"{detail_message}: {str(e)}")
        return wrapper
    return decorator

# -----------------------------------------------------------------------------
# Helper Functions - Centralized for reuse
# -----------------------------------------------------------------------------
async def _validate_user_and_project(
    project_id: UUID,
    user_id: Optional[int],
    db: AsyncSession
) -> Project:
    """
    Helper to validate user permissions and retrieve the Project.
    Raises HTTP 404/403 as appropriate.
    """
    if user_id is not None:
        the_user = await get_by_id(db, User, user_id)
        if not the_user:
            raise HTTPException(status_code=404, detail="User not found")
            
        # Import validate_project_access to avoid circular imports
        from services.project_service import validate_project_access
        return await validate_project_access(project_id, the_user, db)

    project = await get_by_id(db, Project, project_id) 
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project

async def _validate_file_access(
    project_id: UUID, 
    file_id: Optional[UUID] = None,
    user_id: Optional[int] = None,
    db: Optional[AsyncSession] = None
) -> Tuple[Project, Optional[ProjectFile]]:
    """
    Validate access to project and optionally a file.
    Returns tuple of (project, file) where file may be None.
    """
    # Ensure database session is provided
    if db is None:
        raise ValueError("Database session is required")
        
    # Validate project access
    project = await _validate_user_and_project(project_id, user_id, db)
    
    # Validate file if file_id provided
    file_record = None
    if file_id:
        file_record = await get_by_id(db, ProjectFile, file_id)
        if not file_record or file_record.project_id != project_id:
            raise HTTPException(status_code=404, detail="File not found")
            
    return project, file_record

async def _process_upload_file_info(file: UploadFile) -> Dict[str, Any]:
    """
    Validate and read UploadFile data using centralized FileValidator.
    """
    # Use FileValidator for comprehensive validation
    file_info = await FileValidator.validate_upload_file(file)
    
    # Sanitize filename while preserving extension
    filename, ext = os.path.splitext(file.filename or "untitled")
    sanitized_filename = f"{sanitize_filename(filename)}{ext}"
    
    return {
        "sanitized_filename": sanitized_filename,
        "file_size": getattr(file, "size", 0),
        "file_ext": ext[1:].lower() if ext else "",
        "file_type": file_info.get("category", "unknown")
    }

async def _expand_query(original_query: str) -> str:
    """Generate enhanced query using keyword extraction and synonym expansion"""
    try:
        # Simple implementation - can be enhanced with NLP later
        keywords = set()
        for word in original_query.lower().split():
            if len(word) > 3:  # Ignore short words
                keywords.add(word)
                # Add simple synonyms
                if word in ["how", "what", "why"]:
                    keywords.update(["method", "process", "reason"])
                elif word in ["best", "good"]:
                    keywords.add("effective")
        
        return ' '.join(keywords) + " " + original_query[:100]  # Combine with original
    except Exception:
        return original_query[:150]  # Fallback to truncated original

async def _process_file_tokens(
    contents: bytes,
    filename: str,
    file: UploadFile,
    project: Project
) -> Dict[str, Any]:
    """
    Extract text and estimate tokens, using existing utilities.
    """
    # Choose content source based on size
    content_to_process = contents if len(contents) <= STREAM_THRESHOLD else file.file
    
    # Extract text and estimate tokens
    token_info = await estimate_tokens_from_file(content_to_process, filename)
    token_estimate = token_info[0]
    metadata = token_info[1]
    
    # Check project token limit
    if project.token_usage + token_estimate > project.max_tokens:
        raise ValueError(
            f"Adding this file ({token_estimate} tokens) exceeds "
            f"the project's token limit ({project.max_tokens})."
        )

    return {
        "token_estimate": token_estimate,
        "metadata": metadata
    }
async def estimate_tokens_from_file(
    content: Union[bytes, BinaryIO, AsyncGenerator[bytes, None]],
    filename: str
) -> Tuple[int, Dict[str, Any]]:
    """
    Estimates tokens using text extraction and token calculation.
    Uses existing utilities to reduce duplication.
    """
    text_extractor = get_text_extractor()
    
    try:
        # Handle AsyncGenerator by collecting all bytes
        if isinstance(content, AsyncGenerator):
            content_bytes = b''
            async for chunk in content:
                content_bytes += chunk
            content = content_bytes

        # Extract text
        text_chunks, extracted_meta = await text_extractor.extract_text(
            content,
            filename=filename,
            chunk_size=DEFAULT_CHUNK_SIZE,
            chunk_overlap=DEFAULT_CHUNK_OVERLAP
        )
        
        # Calculate tokens using existing utilities
        token_count = 0
        for chunk in text_chunks:
            token_count += estimate_token_count([{"role": "user", "content": chunk}])

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
        logger.error(f"Token estimation error for {filename}: {str(e)}", exc_info=True)
        # Fallback to conservative size-based estimate
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
        return token_count, metadata

async def _save_file_and_create_record(
    db: AsyncSession,
    project: Project,
    project_id: UUID,
    file: UploadFile,
    file_info: Dict[str, Any],
    token_info: Dict[str, Any],
    process_for_search: bool = True
) -> ProjectFile:
    """Save file to storage and create DB record."""
    # Get storage configuration
    storage_config = {
        "storage_type": getattr(config, "FILE_STORAGE_TYPE", "local"),
        "local_path": getattr(config, "LOCAL_UPLOADS_DIR", "./uploads")
    }
    storage = get_file_storage(storage_config)

    sanitized_filename = file_info["sanitized_filename"]
    file_size = file_info["file_size"]
    file_ext = file_info["file_ext"]
    token_estimate = token_info["token_estimate"]
    metadata = token_info["metadata"]

    # Choose content source based on size
    file_content = file.file
    
    try:
        # Save to storage
        file_path = await storage.save_file(
            file_content=file_content,
            filename=sanitized_filename,
            content_type=file.content_type or "application/octet-stream",
            metadata=metadata,
            project_id=project_id
        )
        
        # Create record
        pf = ProjectFile(
            project_id=project_id,
            filename=sanitized_filename,
            file_path=file_path,
            file_size=file_size,
            file_type=file_ext,
            order_index=0,
            metadata=metadata
        )
        
        # Save and update project token usage
        await save_model(db, pf)
        project.token_usage += token_estimate
        await save_model(db, project)
            
        # Process for search if requested
        if process_for_search and project.knowledge_base_id:
            await process_file_for_vector_search(db, project, pf, file.file)
            
        return pf
        
    except Exception as e:
        logger.error(f"Error in file processing: {str(e)}")
        raise

async def process_file_for_vector_search(
    db: AsyncSession,
    project: Project,
    project_file: ProjectFile,
    file_content: BinaryIO
) -> Dict[str, Any]:
    """Process a file for vector search."""
    try:
        # Reset file pointer
        await file_content.seek(0)
        
        # Get embedding model
        model_name = project.knowledge_base.embedding_model if project.knowledge_base else DEFAULT_EMBEDDING_MODEL
        
        # Initialize vector DB
        vector_db = await get_vector_db(
            model_name=model_name,
            storage_path=os.path.join(VECTOR_DB_STORAGE_PATH, str(project.id)),
            load_existing=True
        )
        
        # Process file
        search_results = await process_file_for_search(
            project_file=project_file,
            vector_db=vector_db,
            file_content=await file_content.read(),
            chunk_size=DEFAULT_CHUNK_SIZE,
            chunk_overlap=DEFAULT_CHUNK_OVERLAP
        )
        
        # Update file metadata
        if search_results.get("success", False):
            metadata = project_file.metadata or {}
            metadata["search_processing"] = {
                "success": True,
                "chunk_count": search_results.get("chunk_count", 0),
                "processed_at": datetime.now().isoformat()
            }
            project_file.metadata = metadata
            await save_model(db, project_file)
            
        return search_results
    except Exception as e:
        logger.error(f"Error processing file for search: {str(e)}")
        # Update metadata with error
        try:
            metadata = project_file.metadata or {}
            metadata["search_processing"] = {
                "success": False,
                "error": str(e),
                "attempted_at": datetime.now().isoformat()
            }
            project_file.metadata = metadata
            await save_model(db, project_file)
        except Exception as metadata_error:
            logger.error(f"Error updating file metadata: {metadata_error}")
        return {"success": False, "error": str(e)}

def extract_file_metadata(
    file_record: ProjectFile,
    include_token_count: bool = True,
    include_file_path: bool = False
) -> Dict[str, Any]:
    """Standardized file metadata from serializers."""
    data = serialize_project_file(
        file_record, 
        include_content=False,
        include_file_path=include_file_path
    )
    
    # Add knowledge base specific fields
    if include_token_count:
        data["token_count"] = (file_record.metadata or {}).get("token_count", 0)
    data["search_status"] = (file_record.metadata or {}).get("search_processing", {})
        
    return data

# -----------------------------------------------------------------------------
# Public API Functions
# -----------------------------------------------------------------------------
@handle_service_errors("File upload failed")
async def upload_file_to_project(
    project_id: UUID,
    file: UploadFile,
    db: AsyncSession,
    user_id: Optional[int] = None,
    process_for_search: bool = True
) -> Dict[str, Any]:
    """
    Handles complete file upload process with validation, storage and processing.
    """
    # Validate project
    project = await _validate_user_and_project(project_id, user_id, db)

    # Validate file
    file_info = await _process_upload_file_info(file)
    
    # Read file content for processing - limited to prevent memory issues
    file_size = file_info.get("file_size", 0)
    max_read = min(file_size, STREAM_THRESHOLD) if file_size > 0 else STREAM_THRESHOLD
    contents = await file.read(max_read)
    await file.seek(0)

    # Estimate tokens
    token_info = await _process_file_tokens(
        contents=contents,
        filename=file_info["sanitized_filename"],
        file=file,
        project=project
    )

    # Save and create record
    project_file = await _save_file_and_create_record(
        db=db,
        project=project,
        project_id=project_id,
        file=file,
        file_info=file_info,
        token_info=token_info,
        process_for_search=process_for_search
    )

    return {
        "message": "File uploaded successfully",
        "file": extract_file_metadata(project_file, include_file_path=True)
    }

@handle_service_errors("Error retrieving files")
async def list_project_files(
    project_id: UUID,
    db: AsyncSession,
    skip: int = 0,
    limit: int = 100,
    file_type: Optional[str] = None,
    sort_by: str = "created_at",
    sort_desc: bool = True
) -> Dict[str, Any]:
    """List project files with pagination and filtering."""
    # Validate project exists
    await get_by_id(db, Project, project_id)
    
    # Build query with file_type filter if provided
    conditions = [ProjectFile.project_id == project_id]
    if file_type:
        conditions.append(ProjectFile.file_type == file_type.lower())
    
    # Apply sorting with validation
    if sort_by not in ALLOWED_SORT_FIELDS:
        sort_by = "created_at"
        
    # Get files using db_utils function
    order_clause = getattr(ProjectFile, sort_by).desc() if sort_desc else getattr(ProjectFile, sort_by).asc()
    files = await get_all_by_condition(
        db,
        ProjectFile,
        *conditions,
        order_by=order_clause,
        limit=limit,
        offset=skip
    )

    # Format response
    return {
        "files": [extract_file_metadata(f) for f in files],
        "total": len(files),
        "skip": skip,
        "limit": limit
    }

@handle_service_errors("Error retrieving file")
async def get_project_file(
    project_id: UUID,
    file_id: UUID,
    db: AsyncSession,
    user_id: Optional[int] = None,
    include_content: bool = False
) -> Dict[str, Any]:
    """Get a single file with optional content."""
    # Validate access
    _, file_record = await _validate_file_access(project_id, file_id, user_id, db)
    
    # Ensure file_record exists
    if file_record is None:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Create response data
    file_data = extract_file_metadata(file_record, include_token_count=True, include_file_path=True)

    # Add content if requested
    if include_content:
        storage_config = {
            "storage_type": getattr(config, "FILE_STORAGE_TYPE", "local"),
            "local_path": getattr(config, "LOCAL_UPLOADS_DIR", "./uploads")
        }
        storage = get_file_storage(storage_config)

        try:
            content = await storage.get_file(file_record.file_path)
            file_data["content"] = content
        except Exception as e:
            logger.error(f"Error retrieving file content: {e}")
            file_data["retrieval_error"] = str(e)

    return file_data

@handle_service_errors("File deletion failed")
async def delete_project_file(
    project_id: UUID,
    file_id: UUID,
    db: AsyncSession,
    user_id: Optional[int] = None
) -> Dict[str, Any]:
    """Delete a file from storage and database."""
    # Validate access
    project, file_record = await _validate_file_access(project_id, file_id, user_id, db)
    
    # Ensure file_record exists
    if file_record is None:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Get token usage from metadata
    metadata = file_record.metadata or {}
    token_estimate = metadata.get("token_count", 0)
    
    # Delete from storage
    storage_config = {
        "storage_type": getattr(config, "FILE_STORAGE_TYPE", "local"),
        "local_path": getattr(config, "LOCAL_UPLOADS_DIR", "./uploads")
    }
    storage = get_file_storage(storage_config)
    
    file_deletion_status = "success"
    try:
        deleted = await storage.delete_file(file_record.file_path)
        if not deleted:
            file_deletion_status = "not_found_in_storage"
    except Exception as e:
        logger.error(f"Error deleting file from storage: {str(e)}")
        file_deletion_status = "storage_deletion_failed"
    
    # Delete from vector DB if exists
    if project.knowledge_base_id:
        try:
            model_name = (
                project.knowledge_base.embedding_model
                if project.knowledge_base 
                else DEFAULT_EMBEDDING_MODEL
            )
            vector_db = await get_vector_db(
                model_name=model_name,
                storage_path=os.path.join(VECTOR_DB_STORAGE_PATH, str(project_id)),
                load_existing=True
            )
            await vector_db.delete_by_filter({"file_id": str(file_id)})
        except Exception as e:
            logger.error(f"Error removing file from vector DB: {e}")
    
    # Delete from database
    async with db.begin():
        await db.delete(file_record)
        # Update project token usage
        project.token_usage = max(0, project.token_usage - token_estimate)
        await db.commit()
    
    return {
        "success": file_deletion_status == "success",
        "status": file_deletion_status,
        "file_id": str(file_id),
        "tokens_removed": token_estimate
    }

@handle_service_errors("Error creating knowledge base")
async def create_knowledge_base(
    name: str,
    project_id: UUID,
    description: Optional[str] = None,
    embedding_model: Optional[str] = None,
    db: Optional[AsyncSession] = None
) -> KnowledgeBase:
    """Create a new KnowledgeBase for a project."""
    if db is None:
        raise ValueError("Database session is required")
        
    # Check if project already has a knowledge base
    project = await get_by_id(db, Project, project_id)
    if not project:
        raise ValueError("Project not found")
    
    if project.knowledge_base_id:
        raise ValueError("Project already has a knowledge base")

    # Create KB record
    kb = KnowledgeBase(
        name=name,
        description=description,
        embedding_model=embedding_model or DEFAULT_EMBEDDING_MODEL,
        is_active=True,
        project_id=project_id
    )
    
    await save_model(db, kb)
    
    # Update project
    project.knowledge_base_id = kb.id
    await save_model(db, project)
    
    return kb

@handle_service_errors("Error searching project context")
async def search_project_context(
    project_id: UUID,
    query: str,
    db: AsyncSession,
    top_k: int = 5
) -> Dict[str, Any]:
    """Search for relevant context in a project's vector database."""
    # Validate project
    project = await _validate_user_and_project(project_id, None, db)
    
    # Get vector DB - ensure knowledge_base is loaded and properly configured
    await db.refresh(project, ["knowledge_base"])
    model_name = DEFAULT_EMBEDDING_MODEL
    if project.knowledge_base and project.knowledge_base.embedding_model:
        model_name = project.knowledge_base.embedding_model
    
    vector_db = await get_vector_db(
        model_name=model_name,
        storage_path=os.path.join(VECTOR_DB_STORAGE_PATH, str(project_id)),
        load_existing=True
    )
    
    # Perform search with required filters
    # Make sure both project_id and knowledge_base_id are always used as filters
    filter_metadata = {
        "project_id": str(project_id)
    }
    
    # Add knowledge_base_id filter if available
    if project.knowledge_base_id:
        filter_metadata["knowledge_base_id"] = str(project.knowledge_base_id)
    
    # Enhance query with expansion terms
    clean_query = await _expand_query(query) if len(query.split()) > 3 else ' '.join(query.split()[:50])
        
    # Ensure query isn't empty after processing
    clean_query = clean_query.strip()
    if not clean_query:
        clean_query = query[:100]  # Fallback to raw input
    
    # Perform search with combined filters and query expansion
    results = await vector_db.search(
        query=clean_query,
        top_k=top_k * 2,  # Get extra results for filtering
        filter_metadata=filter_metadata
    )
    
    # Filter to ensure diversity of sources
    unique_sources = set()
    filtered_results = []
    for res in results:
        source = res.get("metadata", {}).get("file_id")
        if source not in unique_sources:
            filtered_results.append(res)
            unique_sources.add(source)
            if len(filtered_results) >= top_k:
                break
    results = filtered_results
    
    # Enhance with file info
    enhanced_results = []
    for res in results:
        file_id = res.get("metadata", {}).get("file_id")
        if file_id:
            try:
                file_uuid = UUID(file_id)
                file_record = await get_by_id(db, ProjectFile, file_uuid)
                if file_record:
                    res["file_info"] = extract_file_metadata(
                        file_record, include_token_count=False
                    )
            except Exception as e:
                logger.error(f"Error enhancing search result: {e}")
        enhanced_results.append(res)
    
    return {
        "query": query,
        "results": [serialize_vector_result(r) for r in enhanced_results],
        "result_count": len(enhanced_results)
    }

@handle_service_errors("Error cleaning up KB references")
async def cleanup_orphaned_kb_references(db: AsyncSession) -> Dict[str, int]:
    """Clean up invalid KB references."""
    from sqlalchemy import update, exists
    
    # Projects with invalid KB references
    project_result = await db.execute(
        update(Project)
        .where(
            Project.knowledge_base_id.is_not(None),
            ~exists().where(KnowledgeBase.id == Project.knowledge_base_id)
        )
        .values(knowledge_base_id=None)
        .returning(Project.id)
    )
    project_fixes = len(project_result.scalars().all())
    
    # Fix conversations
    from models.conversation import Conversation
    conv_result = await db.execute(
        update(Conversation)
        .where(
            Conversation.use_knowledge_base.is_(True),
            ~exists().where(
                (Project.id == Conversation.project_id) &
                (Project.knowledge_base_id.is_not(None))
            )
        )
        .values(use_knowledge_base=False)
        .returning(Conversation.id)
    )
    conv_fixes = len(conv_result.scalars().all())
    
    await db.commit()
    
    return {
        "projects_fixed": project_fixes,
        "conversations_fixed": conv_fixes
    }

@handle_service_errors("Error retrieving file stats")
async def get_project_files_stats(project_id: UUID, db: AsyncSession) -> Dict[str, Any]:
    """Get file statistics for a project."""
    # Check project exists
    project = await get_by_id(db, Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Get file count
    count_query = select(func.count()).where(ProjectFile.project_id == project_id)
    file_count_result = await db.execute(count_query)
    file_count = file_count_result.scalar() or 0
    
    # Get total size
    size_query = select(func.sum(ProjectFile.file_size)).where(ProjectFile.project_id == project_id)
    size_result = await db.execute(size_query)
    total_size = size_result.scalar() or 0
    
    # Get file type distribution
    type_query = (
        select(ProjectFile.file_type, func.count().label('count'))
        .where(ProjectFile.project_id == project_id)
        .group_by(ProjectFile.file_type)
    )
    type_result = await db.execute(type_query)
    file_types = {row[0]: row[1] for row in type_result}
    
    return {
        "file_count": file_count,
        "total_size_bytes": total_size,
        "total_size_mb": round(total_size / (1024 * 1024), 2) if total_size > 0 else 0,
        "file_types": file_types,
        "token_usage": project.token_usage,
        "max_tokens": project.max_tokens,
    }
