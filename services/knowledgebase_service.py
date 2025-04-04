"""
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
from fastapi import HTTPException, UploadFile, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update, exists
from sqlalchemy.exc import SQLAlchemyError
from functools import wraps

import config
from models.project_file import ProjectFile
from models.project import Project
from models.knowledge_base import KnowledgeBase
from models.user import User
from models.conversation import Conversation

# Import existing utilities to reduce duplication
from utils.file_validation import FileValidator, sanitize_filename
from utils.db_utils import get_by_id, save_model
from utils.serializers import serialize_vector_result
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

# Function to extract metadata from file record
def extract_file_metadata(file_record: ProjectFile, include_token_count: bool = True) -> Dict[str, Any]:
    """Extract metadata from file record for API responses."""
    metadata = {}
    
    if hasattr(file_record, "filename"):
        metadata["filename"] = file_record.filename
    
    if hasattr(file_record, "file_type"):
        metadata["file_type"] = file_record.file_type
    
    if hasattr(file_record, "file_size"):
        metadata["file_size"] = file_record.file_size
    
    if hasattr(file_record, "created_at") and file_record.created_at:
        metadata["created_at"] = file_record.created_at.isoformat()
    
    if include_token_count and hasattr(file_record, "config") and file_record.config:
        file_config = file_record.config or {}
        if "token_count" in file_config:
            metadata["token_count"] = file_config["token_count"]
    
    # Add processing status if available
    if hasattr(file_record, "config") and file_record.config:
        config = file_record.config or {}
        if "search_processing" in config:
            metadata["processing"] = config["search_processing"]
    
    return metadata

# -----------------------------------------------------------------------------
# Error Handling - Using a decorator for consistent error handling
# -----------------------------------------------------------------------------
def handle_service_errors(detail_message: str = "Operation failed", status_code: int = 500):
    """
    Decorator for consistent error handling in service functions.
    """    
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
                raise HTTPException(status_code=400, detail=f"{detail_message}: {str(e)}") from e
            except SQLAlchemyError as e:
                # Handle database errors
                logger.error(f"Database error in {func.__name__}: {str(e)}", exc_info=True)
                raise HTTPException(status_code=500, detail=f"Database error: {str(e)}") from e
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
    """Extract text and estimate tokens, using existing utilities."""
    try:
        # Choose content source based on size
        content_to_process = contents if len(contents) <= STREAM_THRESHOLD else file.file
        
        # Extract text and estimate tokens
        token_info = await estimate_tokens_from_file(content_to_process, filename)
    except Exception as e:
        logger.error(f"Error estimating tokens for {filename}: {str(e)}")
        token_info = (0, {"error": str(e)})

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
        # Handle async generator by collecting all chunks first if needed
        if isinstance(content, AsyncGenerator):
            collected_content = bytearray()
            async for chunk in content:
                collected_content.extend(chunk)
            content = bytes(collected_content)
            
        # Extract text from file - ensure this returns a single awaitable
        chunks, metadata = text_extractor.extract_text(content, filename)
        
        # Get token count from metadata if available, otherwise calculate from whole content
        token_count = metadata.get("token_count", 0)
        if token_count == 0 and chunks:
            # Join all chunks to count tokens (less precise but fallback)
            full_text = ' '.join(chunks)
            token_count = len(full_text) // 4  # Simple estimation
        
        # Return token count and metadata
        extraction_method = getattr(text_extractor, "name", "unknown_extractor")
        return token_count, {
            "token_count": token_count,
            "extraction_method": extraction_method,
            "extraction_time": datetime.now().isoformat()
        }
    except TextExtractionError as e:
        logger.error(f"Text extraction failed for {filename}: {str(e)}")
        return 0, {
            "token_count": 0,
            "extraction_error": str(e),
            "extraction_time": datetime.now().isoformat()
        }

@handle_service_errors("File upload failed")
async def upload_file_to_project(
    project_id: UUID,
    file: UploadFile,
    db: AsyncSession,
    user_id: Optional[int] = None,
    background_tasks: Optional[BackgroundTasks] = None
) -> Dict[str, Any]:
    """
    Upload a file to a project and process it for the knowledge base.
    
    Args:
        project_id: UUID of the project
        file: UploadFile object containing the file to upload
        db: Database session
        user_id: Optional user ID for permission validation
        background_tasks: Optional background tasks for async processing
        
    Returns:
        Dict with file information and upload status
    """
    # Validate project access and KB existence
    project, _ = await _validate_file_access(project_id, None, user_id, db)
    
    if not project.knowledge_base_id:
        raise HTTPException(
            status_code=400, 
            detail="Project does not have an associated knowledge base"
        )
    
    # Process and validate upload file
    file_info = await _process_upload_file_info(file)
    sanitized_filename = file_info["sanitized_filename"]
    file_ext = file_info["file_ext"]
    file_type = file_info["file_type"]
    
    # Read file content for processing
    contents = await file.read()
    file_size = len(contents)
    
    if file_size > KB_CONFIG["max_file_bytes"]:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds maximum size of {KB_CONFIG['max_file_bytes'] / 1024 / 1024}MB"
        )
    
    # Reset file position for potential re-reading
    await file.seek(0)
    
    # Get token information 
    token_info = await _process_file_tokens(contents, sanitized_filename, file, project)  # This now properly awaits the coroutine
    token_estimate = token_info["token_estimate"]
    
    # Configure file storage
    storage_config = {
        "storage_type": getattr(config, "FILE_STORAGE_TYPE", "local"),
        "local_path": getattr(config, "LOCAL_UPLOADS_DIR", "./uploads")
    }
    storage = get_file_storage(storage_config)
    
    # Generate unique file path
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    safe_filename = sanitized_filename.replace(" ", "_")
    relative_path = f"{project_id}/{timestamp}_{safe_filename}"
    
    # Upload file to storage - we need to swap the parameters
    # First parameter should be file content (bytes/file-like), second should be the path string
    await file.seek(0)
    file_content = await file.read()
    stored_path = await storage.save_file(
        file_content=file_content, 
        filename=relative_path,
        project_id=project_id
    )
    
    # Create project file record
    project_file = ProjectFile(
        project_id=project_id,
        filename=sanitized_filename,
        file_path=stored_path,
        file_type=file_type,
        file_size=file_size
    )
    
    # Add token data and processing status to config
    project_file.config = {
        "token_count": token_estimate,
        "file_extension": file_ext,
        "content_type": file.content_type,
        "upload_time": datetime.now().isoformat(),
        "search_processing": {
            "status": "pending",
            "queued_at": datetime.now().isoformat(),
        }
    }
    
    # Save to database within a transaction
    try:
        # Try without explicit transaction
        # Save file record
        await save_model(db, project_file)
        
        # Update project token usage
        project.token_usage += token_estimate
        await save_model(db, project)
        
        # Flush to ensure changes are sent to DB, but don't commit yet
        await db.flush()
    except SQLAlchemyError as e:
        # If there's an error and it's because a transaction is already active
        if "transaction is already begun" not in str(e):
            # Re-raise if it's not a transaction-related error
            raise
        
        # Try again with explicit transaction management
        async with db.begin():
            # Save file record
            await save_model(db, project_file)
            
            # Update project token usage
            project.token_usage += token_estimate
            await save_model(db, project)

    # Process for search in background if task runner provided
    if background_tasks:
        background_tasks.add_task(
            _process_file_for_vector_db,
            project_file.id,
            project_id,
            project.knowledge_base_id,
            stored_path,
            db
        )
    
    # Return file information
    return {
        "id": str(project_file.id),
        "filename": project_file.filename,
        "file_type": project_file.file_type,
        "file_size": project_file.file_size,
        "created_at": project_file.created_at.isoformat() if project_file.created_at else None,
        "token_count": token_estimate,
        "processing_status": "pending",
        "project_id": str(project_id)
    }

# Background task to process file for vector DB
async def _process_file_for_vector_db(
    file_id: Any,  # Could be a string or UUID, will be handled in function body
    project_id: Any,
    knowledge_base_id: Any,
    file_path: str,
    db: AsyncSession
):
    """Process a file for the vector database (runs in background)"""
    try:
        # Get file record - ensure IDs are converted to UUID if they're not already
        file_record = await get_by_id(db, ProjectFile, UUID(str(file_id)) if not isinstance(file_id, UUID) else file_id)
        if not file_record:
            logger.error(f"File record {file_id} not found for processing")
            return
            
        # Configure storage
        storage_config = {
            "storage_type": getattr(config, "FILE_STORAGE_TYPE", "local"),
            "local_path": getattr(config, "LOCAL_UPLOADS_DIR", "./uploads")
        }
        storage = get_file_storage(storage_config)
        
        # Get file content
        file_content = await storage.get_file(file_path)
        
        # Get model name from knowledge base - ensure KB ID is converted to UUID
        kb = await get_by_id(db, KnowledgeBase, UUID(str(knowledge_base_id)) if not isinstance(knowledge_base_id, UUID) else knowledge_base_id)
        model_name = kb.embedding_model if kb else DEFAULT_EMBEDDING_MODEL
        
        # Configure vector DB
        vector_db = await get_vector_db(
            model_name=str(model_name) if model_name else DEFAULT_EMBEDDING_MODEL,
            storage_path=os.path.join(VECTOR_DB_STORAGE_PATH, str(project_id)),
            load_existing=True
        )
        
        # Process file 
        result = await process_file_for_search(
            project_file=file_record,
            vector_db=vector_db,
            file_content=file_content,
            chunk_size=DEFAULT_CHUNK_SIZE,
            chunk_overlap=DEFAULT_CHUNK_OVERLAP
        )
        
        # Update file record with processing status
        file_config = file_record.config or {}
        file_config["search_processing"] = {
            "status": "success" if result.get("success", False) else "error",
            "chunk_count": result.get("chunk_count", 0),
            "error": result.get("error", None),
            "processed_at": datetime.now().isoformat()
        }
        file_record.config = file_config
        
        # Save updated file record
        await save_model(db, file_record)
        
    except Exception as e:
        logger.exception(f"Error processing file {file_id} for vector DB: {str(e)}")
        try:
            # Update file record with error status
            file_record = await get_by_id(db, ProjectFile, file_id)
            if file_record:
                file_config = file_record.config or {}
                file_config["search_processing"] = {
                    "status": "error",
                    "error": str(e),
                    "processed_at": datetime.now().isoformat()
                }
                file_record.config = file_config
                await save_model(db, file_record)
        except Exception as update_error:
            logger.error(f"Failed to update file status: {update_error}")

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
    
    # Get token usage from config (previously metadata)
    config = file_record.config or {}
    token_estimate = config.get("token_count", 0)

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
                model_name=str(model_name) if model_name else DEFAULT_EMBEDDING_MODEL,
                storage_path=os.path.join(VECTOR_DB_STORAGE_PATH, str(project_id)),
                load_existing=True
            )
            await vector_db.delete_by_filter({"file_id": str(file_id)})
        except Exception as e:
            logger.error(f"Error removing file from vector DB: {e}")
    
    # Delete from database - use a more reliable approach
    try:
        # Attempt the delete and project update without explicit transaction
        await db.delete(file_record)
        # Update project token usage
        project.token_usage = max(0, project.token_usage - token_estimate)
        # Flush to ensure changes are sent to DB, but don't commit yet
        await db.flush()
        # We'll let the outer transaction handle the commit
    except SQLAlchemyError as e:
        # If there's an error, it might be because we need to manage the transaction ourselves
        if "transaction is already begun" not in str(e):
            # Re-raise if it's not a transaction-related error
            raise
        # Try again with explicit transaction management
        async with db.begin():
            await db.delete(file_record)
            # Update project token usage
            project.token_usage = max(0, project.token_usage - token_estimate)
    
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
    """Search project knowledge base with enhanced error handling and validation."""
    if not query or len(query.strip()) < 2:
        raise ValueError("Query must be at least 2 characters")
            
    if top_k < 1 or top_k > 20:
        raise ValueError("top_k must be between 1 and 20")
    
    # Validate project
    project = await _validate_user_and_project(project_id, None, db)
    
    # Get vector DB - ensure knowledge_base is loaded and properly configured
    await db.refresh(project, ["knowledge_base"])
    model_name = DEFAULT_EMBEDDING_MODEL
    if project.knowledge_base and project.knowledge_base.embedding_model:
        model_name = project.knowledge_base.embedding_model
    
    vector_db = await get_vector_db(
        model_name=str(model_name) if model_name else DEFAULT_EMBEDDING_MODEL,
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
