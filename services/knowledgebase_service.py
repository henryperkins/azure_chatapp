"""
knowledgebase_service.py
------------------------
Manages knowledge bases and their components:
 - File uploads and processing
 - Text extraction and chunking
 - Embedding generation and vector storage
 - Search and retrieval for context
 - Token usage tracking

Refactored to avoid duplication with file_storage.py and vector_db.py.
"""

import os
import io
import logging
from datetime import datetime
from functools import wraps
from typing import (
    Dict,
    Any,
    List,
    Optional,
    Tuple,
    Union,
    BinaryIO
)
from uuid import UUID

from fastapi import HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
from sqlalchemy.exc import SQLAlchemyError

import config
from models.project_file import ProjectFile
from models.project import Project
from models.knowledge_base import KnowledgeBase
from models.user import User

# Services imported from dedicated modules:
from services.file_storage import get_file_storage, FileStorage
from services.text_extraction import get_text_extractor, TextExtractor, TextExtractionError
from services.vector_db import get_vector_db, process_file_for_search
from services.project_service import validate_project_access
from utils.context import estimate_token_count  # Provided in original environment

logger = logging.getLogger(__name__)

# -----------------------------------------------------------------------------
# 1. Centralized Error Handling Decorator
# -----------------------------------------------------------------------------
def handle_service_errors(detail_message: str = "Operation failed", status_code: int = 500):
    """
    Decorator for consistent error handling in service functions.
    Logs errors and raises HTTPExceptions with standardized messages.
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
# 2. Centralize Configuration
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
        "allowed_file_extensions": {
            ".txt", ".pdf", ".doc", ".docx", ".csv", ".json", ".md", ".xlsx", ".html"
        },
        "allowed_sort_fields": {"created_at", "filename", "file_size"}
    }


KB_CONFIG = get_kb_config()
MAX_FILE_BYTES = KB_CONFIG["max_file_bytes"]
STREAM_THRESHOLD = KB_CONFIG["stream_threshold"]
DEFAULT_EMBEDDING_MODEL = KB_CONFIG["default_embedding_model"]
VECTOR_DB_STORAGE_PATH = KB_CONFIG["vector_db_storage_path"]
DEFAULT_CHUNK_SIZE = KB_CONFIG["default_chunk_size"]
DEFAULT_CHUNK_OVERLAP = KB_CONFIG["default_chunk_overlap"]
ALLOWED_FILE_EXTENSIONS = KB_CONFIG["allowed_file_extensions"]
ALLOWED_SORT_FIELDS = KB_CONFIG["allowed_sort_fields"]

# -----------------------------------------------------------------------------
# 3. Helper: Validate Access and Project
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
        the_user = await db.get(User, user_id)
        if not the_user:
            raise HTTPException(status_code=404, detail="User not found")
        return await validate_project_access(project_id, the_user, db)

    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project

# -----------------------------------------------------------------------------
# 4. Token Estimation
# -----------------------------------------------------------------------------
async def estimate_tokens_from_file(
    content: Union[bytes, BinaryIO],
    filename: str
) -> Tuple[int, Dict[str, Any]]:
    """
    Estimates the number of tokens in file content using text extraction
    and token calculation. Falls back to size-based estimation on error.

    Returns:
        (token_count, metadata_dict)
    """
    text_extractor = get_text_extractor()
    try:
        # Extract text
        text_chunks, extracted_meta = await text_extractor.extract_text(
            content,
            filename=filename,
            chunk_size=DEFAULT_CHUNK_SIZE,
            chunk_overlap=DEFAULT_CHUNK_OVERLAP
        )

        # Summation approach to avoid large memory usage
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
        logger.warning(
            f"Falling back to conservative token estimation for {filename}. "
            f"Estimated tokens: {token_count}"
        )
        return token_count, metadata

# -----------------------------------------------------------------------------
# 5. File Metadata & Content Helpers
# -----------------------------------------------------------------------------
def extract_file_metadata(
    file_record: ProjectFile,
    include_token_count: bool = True,
    include_file_path: bool = False
) -> Dict[str, Any]:
    """
    Extracts standardized metadata from a file record.
    Provides consistent keys in the returned dictionary.
    """
    result = {
        "id": str(file_record.id),
        "project_id": str(file_record.project_id),
        "filename": file_record.filename,
        "file_size": file_record.file_size,
        "file_type": file_record.file_type,
        "created_at": file_record.created_at,
    }

    metadata = file_record.metadata or {}
    if include_token_count:
        token_count = (
            metadata.get("tokens")
            or metadata.get("token_count")
            or metadata.get("token_estimate", 0)
        )
        result["token_count"] = token_count

    if include_file_path:
        result["file_path"] = file_record.file_path

    # Search processing info if present
    search_processing = metadata.get("search_processing", {})
    if search_processing:
        result["search_status"] = {
            "success": search_processing.get("success", False),
            "chunk_count": search_processing.get("chunk_count", 0),
            "processed_at": search_processing.get("processed_at")
        }

    return result

# -----------------------------------------------------------------------------
# 6. File Upload & Processing
# -----------------------------------------------------------------------------
import uuid
try:
    from werkzeug.utils import secure_filename
except ImportError:
    secure_filename = None

def _sanitize_filename(filename: str) -> str:
    """
    Safely sanitize a filename to avoid path traversal or injection.
    Appends a short unique suffix to reduce collisions.
    """
    base_name = secure_filename(filename) if secure_filename else "untitled"
    if not base_name:
        base_name = "untitled"
    unique_suffix = uuid.uuid4().hex[:8]
    return f"{base_name}_{unique_suffix}"

def validate_file_extension(filename: str) -> bool:
    """Check if the file has an allowed extension."""
    _, ext = os.path.splitext(filename.lower())
    return ext in ALLOWED_FILE_EXTENSIONS

async def _process_upload_file_info(file: UploadFile) -> Dict[str, Any]:
    """
    Validate and read UploadFile data:
    - sanitize filename
    - ensure valid extension
    - read content for size check if needed
    """
    sanitized_filename = _sanitize_filename(file.filename or "untitled")
    if not validate_file_extension(sanitized_filename):
        raise ValueError(
            f"File type not allowed. Supported: {', '.join(ALLOWED_FILE_EXTENSIONS)}"
        )

    file_size = getattr(file, 'size', None)
    contents = b""
    if file_size is None:
        # If size not provided, read entire content
        contents = await file.read()
        file_size = len(contents)
        await file.seek(0)

    if file_size > MAX_FILE_BYTES:
        raise ValueError(
            f"File too large (>{MAX_FILE_BYTES / (1024 * 1024):.1f} MB)."
        )

    file_ext = os.path.splitext(sanitized_filename)[1][1:].lower() if "." in sanitized_filename else ""
    return {
        "sanitized_filename": sanitized_filename,
        "file_size": file_size,
        "contents": contents,
        "file_ext": file_ext
    }

async def _process_file_tokens(
    contents: bytes,
    filename: str,
    file: UploadFile,
    project: Project
) -> Dict[str, Any]:
    """
    Extract text from file and estimate tokens, respecting project limits.
    Uses streaming for large files to reduce memory usage.
    """
    # If smaller than threshold, pass 'contents'; else pass 'file.file'
    if len(contents) <= STREAM_THRESHOLD:
        token_estimate, file_metadata = await estimate_tokens_from_file(contents, filename)
    else:
        token_estimate, file_metadata = await estimate_tokens_from_file(file.file, filename)
        await file.seek(0)  # reset pointer if needed later

    if project.token_usage + token_estimate > project.max_tokens:
        raise ValueError(
            f"Adding this file ({token_estimate} tokens) exceeds "
            f"the project's token limit ({project.max_tokens})."
        )

    return {
        "token_estimate": token_estimate,
        "metadata": {
            "tokens": token_estimate,
            "file_metadata": file_metadata
        }
    }

async def _save_file_and_create_record(
    db: AsyncSession,
    project: Project,
    project_id: UUID,
    file: UploadFile,
    file_info: Dict[str, Any],
    token_info: Dict[str, Any]
) -> ProjectFile:
    """
    Saves file to storage (via file_storage) and creates the ProjectFile DB record.
    """
    # Retrieve the appropriate storage configuration each time
    # (You could also cache this in the module if desired)
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
    storage: FileStorage = get_file_storage(storage_config)

    sanitized_filename = file_info["sanitized_filename"]
    file_size = file_info["file_size"]
    contents = file_info["contents"]
    file_ext = file_info["file_ext"]

    token_estimate = token_info["token_estimate"]
    metadata = token_info["metadata"]

    try:
        # Save file (use streaming if large)
        if file_size <= STREAM_THRESHOLD:
            file_content = io.BytesIO(contents)
        else:
            file_content = file.file  # streaming

        file_path = await storage.save_file(
            file_content=file_content,
            filename=sanitized_filename,
            content_type=file.content_type or "application/octet-stream",
            metadata=metadata,
            project_id=project_id
        )
    except Exception as e:
        logger.error(f"File storage error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"File storage error: {str(e)}")

    # Create the ProjectFile record
    pf = ProjectFile(
        project_id=project_id,
        filename=sanitized_filename,
        file_path=file_path,
        file_size=file_size,
        file_type=file_ext,
        order_index=0,
        metadata=metadata
    )

    # Persist in DB and update project token usage
    try:
        async with db.begin():
            db.add(pf)
            project.token_usage += token_estimate
    except SQLAlchemyError as ex:
        logger.error(f"Database transaction error: {str(ex)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error during file upload.")

    await db.refresh(pf)
    return pf

# -----------------------------------------------------------------------------
# 7. Public API Functions
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
    Handles the complete file upload process:
      1. Validate file metadata.
      2. Estimate tokens & check project token usage.
      3. Save file to storage, create DB record.
      4. (Optional) Process for search indexing with vector_db.
    """
    # 1. Validate project
    project = await _validate_user_and_project(project_id, user_id, db)

    # 2. Validate & read the file
    file_info = await _process_upload_file_info(file)

    # 3. Estimate tokens
    token_info = await _process_file_tokens(
        contents=file_info["contents"],
        filename=file_info["sanitized_filename"],
        file=file,
        project=project
    )

    # 4. Save file and create DB record
    project_file = await _save_file_and_create_record(
        db=db,
        project=project,
        project_id=project_id,
        file=file,
        file_info=file_info,
        token_info=token_info
    )

    # 5. Optionally index for search
    if process_for_search:
        # Retrieve vector DB
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

        # Reuse existing process_file_for_search from vector_db.py
        file_content = file_info["contents"]
        if not file_content and file_info["file_size"] > STREAM_THRESHOLD:
            file_content = await file.read()  # for large file streaming fallback

        search_results = await process_file_for_search(
            project_file=project_file,
            vector_db=vector_db,
            file_content=file_content,
            chunk_size=DEFAULT_CHUNK_SIZE,
            chunk_overlap=DEFAULT_CHUNK_OVERLAP
        )

        if search_results.get("success"):
            # Save chunk indexing info into file metadata
            pf_metadata = project_file.metadata or {}
            pf_metadata["search_processing"] = {
                "success": True,
                "chunk_count": search_results["chunk_count"],
                "added_ids": search_results["added_ids"],
                "processed_at": datetime.utcnow().isoformat()
            }
            project_file.metadata = pf_metadata
            await db.commit()
        else:
            logger.warning(f"Search indexing failed for file {project_file.id}: {search_results.get('error')}")

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
    """
    Retrieve project files with optional pagination & file-type filtering.
    """
    query = select(ProjectFile).where(ProjectFile.project_id == project_id)

    if file_type:
        query = query.where(ProjectFile.file_type == file_type.lower())

    if sort_by not in ALLOWED_SORT_FIELDS:
        sort_by = "created_at"
    sort_field = getattr(ProjectFile, sort_by)
    order_by = sort_field.desc() if sort_desc else sort_field.asc()

    query = query.order_by(order_by).offset(skip).limit(limit)
    result = await db.execute(query)
    files = result.scalars().all()

    data = [extract_file_metadata(f) for f in files]
    return {
        "files": data,
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
    """
    Retrieve a single file record by ID. Optionally include file content.
    """
    # Validate project if user_id given
    if user_id:
        await _validate_user_and_project(project_id, user_id, db)

    query = select(ProjectFile).where(
        ProjectFile.id == file_id,
        ProjectFile.project_id == project_id
    )
    result = await db.execute(query)
    file_record = result.scalars().first()
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")

    file_data = extract_file_metadata(file_record, include_token_count=True, include_file_path=True)

    if include_content:
        # Directly use file_storage
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
        storage: FileStorage = get_file_storage(storage_config)

        try:
            content = await storage.get_file(file_record.file_path)
            # Optionally decode text-based files here if needed
            file_data["content"] = content
        except Exception as e:
            logger.error(f"Error retrieving file content for {file_record.filename}: {e}", exc_info=True)
            file_data["retrieval_error"] = str(e)

    return file_data

@handle_service_errors("File deletion failed")
async def delete_project_file(
    project_id: UUID,
    file_id: UUID,
    db: AsyncSession,
    user_id: Optional[int] = None
) -> Dict[str, Any]:
    """
    Delete a file from storage and remove the DB record.
    Also cleans up vector DB references and updates token usage.
    """
    project = await _validate_user_and_project(project_id, user_id, db)

    query = select(ProjectFile).where(
        ProjectFile.id == file_id,
        ProjectFile.project_id == project_id
    )
    result = await db.execute(query)
    db_file_record = result.scalars().first()
    if not db_file_record:
        raise HTTPException(status_code=404, detail="File not found")

    # Extract token usage
    meta = db_file_record.metadata or {}
    token_estimate = (
        meta.get("tokens") or
        meta.get("token_count") or
        meta.get("token_estimate", 0)
    )

    # Delete from storage
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
    storage: FileStorage = get_file_storage(storage_config)

    file_deletion_status = "success"
    try:
        deleted = await storage.delete_file(db_file_record.file_path)
        if not deleted:
            file_deletion_status = "not_found_in_storage"
    except Exception as e:
        logger.error(f"Error deleting file from storage: {str(e)}", exc_info=True)
        file_deletion_status = "storage_deletion_failed"

    # Delete from vector DB
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
        logger.error(f"Error removing file from vector DB: {str(e)}", exc_info=True)
        # continue, but record the error

    # Remove DB record in a transaction
    try:
        async with db.begin():
            await db.execute(delete(ProjectFile).where(ProjectFile.id == file_id))
            project.token_usage = max(0, project.token_usage - token_estimate)
    except SQLAlchemyError as ex:
        logger.error(f"Database deletion error: {ex}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database deletion error")

    message = (
        "File deleted successfully"
        if file_deletion_status == "success"
        else "File record removed but storage deletion encountered issues"
    )
    return {
        "success": file_deletion_status == "success",
        "status": file_deletion_status,
        "message": message,
        "tokens_removed": token_estimate
    }

@handle_service_errors("Error retrieving file stats")
async def get_project_files_stats(project_id: UUID, db: AsyncSession) -> Dict[str, Any]:
    """
    Get statistics about files in a project (count, total size, type distribution, etc.).
    """
    count_query = select(func.count()).where(ProjectFile.project_id == project_id)
    file_count_result = await db.execute(count_query)
    file_count = file_count_result.scalar() or 0

    size_query = select(func.sum(ProjectFile.file_size)).where(ProjectFile.project_id == project_id)
    size_result = await db.execute(size_query)
    total_size = size_result.scalar() or 0

    type_query = (
        select(ProjectFile.file_type, func.count().label('count'))
        .where(ProjectFile.project_id == project_id)
        .group_by(ProjectFile.file_type)
    )
    type_result = await db.execute(type_query)
    file_types = {row[0]: row[1] for row in type_result}

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

# -----------------------------------------------------------------------------
# 8. Knowledge Base Management
# -----------------------------------------------------------------------------
@handle_service_errors("Error creating knowledge base")
async def create_knowledge_base(
    name: str,
    description: Optional[str] = None,
    embedding_model: Optional[str] = None,
    db: Optional[AsyncSession] = None
) -> KnowledgeBase:
    """
    Create a new KnowledgeBase in the database.
    """
    kb = KnowledgeBase(
        name=name,
        description=description,
        embedding_model=embedding_model or DEFAULT_EMBEDDING_MODEL,
        is_active=True
    )
    if db:
        db.add(kb)
        await db.commit()
        await db.refresh(kb)
    return kb

@handle_service_errors("Error searching project context")
async def search_project_context(
    project_id: UUID,
    query: str,
    db: AsyncSession,
    top_k: int = 5
) -> Dict[str, Any]:
    """
    Search for relevant context in a project's vector database.
    """
    # Validate project
    project = await _validate_user_and_project(project_id, None, db)

    # Initialize vector DB for the project
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

    from services.vector_db import search_context_for_query
    results = await search_context_for_query(
        query=query,
        vector_db=vector_db,
        project_id=str(project_id),
        top_k=top_k
    )

    # Optionally enhance with file metadata
    enhanced_results = []
    for res in results:
        file_id = res.get("metadata", {}).get("file_id")
        if file_id:
            try:
                file_uuid = UUID(file_id)
                file_record = await db.get(ProjectFile, file_uuid)
                if file_record:
                    res["file_info"] = extract_file_metadata(
                        file_record, include_token_count=False
                    )
            except Exception as e:
                logger.error(f"Error enhancing search result with file info: {e}", exc_info=True)
        enhanced_results.append(res)

    return {
        "query": query,
        "results": enhanced_results,
        "result_count": len(enhanced_results)
    }
