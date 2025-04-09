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
from typing import Dict, Any, Optional, Tuple, Union, BinaryIO, AsyncGenerator, cast
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
from services.vector_db import (
    get_vector_db,
    process_file_for_search,
)  # Make sure process_file_for_search is from vector_db

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------
# Configuration Constants
# ---------------------------------------------------------------------
def get_kb_config() -> Dict[str, Any]:
    """Centralized function to get configuration settings."""
    return {
        "max_file_bytes": getattr(config, "MAX_FILE_SIZE", 30_000_000),
        "stream_threshold": getattr(config, "STREAM_THRESHOLD", 10_000_000),
        "default_embedding_model": getattr(
            config, "DEFAULT_EMBEDDING_MODEL", "all-MiniLM-L6-v2"
        ),
        "vector_db_storage_path": getattr(
            config, "VECTOR_DB_STORAGE_PATH", "./data/vector_db"
        ),
        "default_chunk_size": getattr(config, "DEFAULT_CHUNK_SIZE", 1000),
        "default_chunk_overlap": getattr(config, "DEFAULT_CHUNK_OVERLAP", 200),
        "allowed_sort_fields": {"created_at", "filename", "file_size"},
    }


KB_CONFIG = get_kb_config()
MAX_FILE_BYTES = KB_CONFIG["max_file_bytes"]
STREAM_THRESHOLD = KB_CONFIG["stream_threshold"]
DEFAULT_EMBEDDING_MODEL = KB_CONFIG["default_embedding_model"]
VECTOR_DB_STORAGE_PATH = KB_CONFIG["vector_db_storage_path"]
DEFAULT_CHUNK_SIZE = KB_CONFIG["default_chunk_size"]
DEFAULT_CHUNK_OVERLAP = KB_CONFIG["default_chunk_overlap"]
ALLOWED_SORT_FIELDS = KB_CONFIG["allowed_sort_fields"]


def extract_file_metadata(
    file_record: ProjectFile, include_token_count: bool = True
) -> Dict[str, Any]:
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

    if include_token_count and file_record.config:
        file_config = file_record.config or {}
        if "token_count" in file_config:
            metadata["token_count"] = file_config["token_count"]

    # Add processing status if available
    if file_record.config:
        c = file_record.config
        if "search_processing" in c:
            metadata["processing"] = c["search_processing"]

    return metadata


# ---------------------------------------------------------------------
# Error Handling Decorator
# ---------------------------------------------------------------------
def handle_service_errors(
    detail_message: str = "Operation failed", status_code: int = 500
):
    """
    Decorator for consistent error handling in service functions.
    """

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except HTTPException:
                raise
            except ValueError as e:
                logger.warning(f"Validation error in {func.__name__}: {e}")
                raise HTTPException(
                    status_code=400, detail=f"{detail_message}: {str(e)}"
                )
            except SQLAlchemyError as e:
                logger.error(
                    f"Database error in {func.__name__}: {str(e)}", exc_info=True
                )
                raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
            except Exception as e:
                logger.exception(f"Unhandled error in {func.__name__}: {str(e)}")
                raise HTTPException(
                    status_code=status_code, detail=f"{detail_message}: {str(e)}"
                )

        return wrapper

    return decorator


# ---------------------------------------------------------------------
# Helper / Reuse
# ---------------------------------------------------------------------
async def _validate_user_and_project(
    project_id: UUID, user_id: Optional[int], db: AsyncSession
) -> Project:
    """
    Helper to validate user permissions and retrieve the Project.
    Raises HTTP 404/403 if not authorized or not found.
    """
    if user_id is not None:
        from services.project_service import validate_project_access

        the_user = await get_by_id(db, User, user_id)
        if not the_user:
            raise HTTPException(status_code=404, detail="User not found")
        return await validate_project_access(project_id, the_user, db)

    project = await get_by_id(db, Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


async def _validate_file_access(
    project_id: UUID,
    file_id: Optional[UUID] = None,
    user_id: Optional[int] = None,
    db: Optional[AsyncSession] = None,
) -> Tuple[Project, Optional[ProjectFile]]:
    """
    Validate access to the project and optionally a file. Returns (project, file_record).
    """
    if db is None:
        raise ValueError("Database session is required")

    project = await _validate_user_and_project(project_id, user_id, db)

    file_record = None
    if file_id:
        file_record = await get_by_id(db, ProjectFile, file_id)
        if not file_record or file_record.project_id != project_id:
            raise HTTPException(status_code=404, detail="File not found")

    return project, file_record


async def _process_upload_file_info(file: UploadFile) -> Dict[str, Any]:
    """
    Validate an incoming UploadFile with the FileValidator, sanitize its name, etc.
    """
    file_info = await FileValidator.validate_upload_file(file)
    filename, ext = os.path.splitext(file.filename or "untitled")
    sanitized_filename = f"{sanitize_filename(filename)}{ext}"
    return {
        "sanitized_filename": sanitized_filename,
        "file_size": getattr(file, "size", 0),
        "file_ext": ext[1:].lower() if ext else "",
        "file_type": file_info.get("category", "unknown"),
    }


async def _expand_query(original_query: str) -> str:
    """
    Very basic keyword expansion (placeholder).
    """
    try:
        keywords = set()
        for word in original_query.lower().split():
            if len(word) > 3:
                keywords.add(word)
                if word in ["how", "what", "why"]:
                    keywords.update(["method", "process", "reason"])
                elif word in ["best", "good"]:
                    keywords.add("effective")
        return " ".join(keywords) + " " + original_query[:100]
    except Exception:
        return original_query[:150]


# ---------------------------------------------------------------------
# Token Estimation
# ---------------------------------------------------------------------
async def estimate_tokens_from_file(
    content: Union[bytes, BinaryIO, AsyncGenerator[bytes, None]], filename: str
) -> Tuple[int, Dict[str, Any]]:
    """
    Extract text, get token count from metadata, fallback if needed.
    Returns (token_count, metadata_dict).
    """
    text_extractor = get_text_extractor()
    try:
        # If it's an AsyncGenerator, gather into bytes
        if isinstance(content, AsyncGenerator):
            collected = bytearray()
            async for chunk in content:
                collected.extend(chunk)
            content = bytes(collected)

        chunks, metadata = await text_extractor.extract_text(content, filename)
        token_count = metadata.get("token_count", 0)
        if token_count == 0 and chunks:
            joined = " ".join(chunks)
            token_count = len(joined) // 4
        extraction_method = getattr(text_extractor, "name", "unknown_extractor")
        return token_count, {
            "token_count": token_count,
            "extraction_method": extraction_method,
            "extraction_time": datetime.now().isoformat(),
        }
    except TextExtractionError as e:
        logger.error(f"Text extraction failed for {filename}: {str(e)}")
        return 0, {
            "token_count": 0,
            "extraction_error": str(e),
            "extraction_time": datetime.now().isoformat(),
        }


async def _process_file_tokens(
    contents: bytes, filename: str, file: UploadFile, project: Project
) -> Dict[str, Any]:
    """
    Helper that uses estimate_tokens_from_file, checks project token usage, etc.
    """
    try:
        # If large file, pass the file.file for streaming
        content_to_process = (
            contents if len(contents) <= STREAM_THRESHOLD else file.file
        )
        tok_count, tok_metadata = await estimate_tokens_from_file(
            content_to_process, filename
        )
    except Exception as e:
        logger.error(f"Error estimating tokens for {filename}: {str(e)}")
        tok_count, tok_metadata = 0, {"error": str(e)}

    # Check project limit
    if project.max_tokens and (project.token_usage + tok_count) > project.max_tokens:
        raise ValueError(
            f"Adding this file ({tok_count} tokens) exceeds the project's token limit ({project.max_tokens})."
        )

    return {"token_estimate": tok_count, "metadata": tok_metadata}


# ---------------------------------------------------------------------
# Create / Manage KnowledgeBase
# ---------------------------------------------------------------------


@handle_service_errors("Error creating knowledge base")
async def create_knowledge_base(
    name: str,
    project_id: UUID,
    description: Optional[str] = None,
    embedding_model: Optional[str] = None,
    db: Optional[AsyncSession] = None,
) -> KnowledgeBase:
    """
    Create a new KnowledgeBase for a project.
    """
    if db is None:
        raise ValueError("Database session is required")

    project = await get_by_id(db, Project, project_id)
    if not project:
        raise ValueError("Project not found")

    if project.knowledge_base_id:
        raise ValueError("Project already has a knowledge base")

    kb = KnowledgeBase(
        name=name,
        description=description,
        embedding_model=embedding_model or DEFAULT_EMBEDDING_MODEL,
        is_active=True,
        project_id=project_id,
    )

    await save_model(db, kb)

    # Attach to project
    project.knowledge_base_id = cast(Optional[UUID], kb.id)
    await save_model(db, project)

    return kb


# ---------------------------------------------------------------------
# Upload a File & Queue Processing
# ---------------------------------------------------------------------


@handle_service_errors("File upload failed")
async def upload_file_to_project(
    project_id: UUID,
    file: UploadFile,
    db: AsyncSession,
    user_id: Optional[int] = None,
    background_tasks: Optional[BackgroundTasks] = None,
) -> Dict[str, Any]:
    """
    Upload a file to a project + knowledge base, store in DB & disk,
    then queue for chunking/embedding in vector DB.
    """
    project, _ = await _validate_file_access(project_id, None, user_id, db)

    if not project.knowledge_base_id:
        raise HTTPException(
            status_code=400, detail="Project does not have an associated knowledge base"
        )

    # Validate + sanitize
    file_info = await _process_upload_file_info(file)
    sanitized_filename = file_info["sanitized_filename"]
    file_ext = file_info["file_ext"]
    file_type = file_info["file_type"]

    contents = await file.read()
    file_size = len(contents)
    if file_size > MAX_FILE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds maximum size of {MAX_FILE_BYTES / 1024 / 1024:.1f} MB",
        )

    # Estimate tokens
    await file.seek(0)
    token_data = await _process_file_tokens(contents, sanitized_filename, file, project)
    token_estimate = token_data["token_estimate"]

    # Store file physically
    storage_config = {
        "storage_type": getattr(config, "FILE_STORAGE_TYPE", "local"),
        "local_path": getattr(config, "LOCAL_UPLOADS_DIR", "./uploads"),
    }
    storage = get_file_storage(storage_config)

    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    safe_filename = sanitized_filename.replace(" ", "_")
    rel_path = f"{project_id}/{timestamp}_{safe_filename}"

    # Re-seek to read again
    await file.seek(0)
    file_bytes = await file.read()
    stored_path = await storage.save_file(file_bytes, rel_path, project_id=project_id)

    # Create ProjectFile record
    project_file = ProjectFile(
        project_id=project_id,
        filename=sanitized_filename,
        file_path=stored_path,
        file_type=file_type,
        file_size=file_size,
    )
    project_file.config = {
        "token_count": token_estimate,
        "file_extension": file_ext,
        "content_type": file.content_type,
        "upload_time": datetime.now().isoformat(),
        "search_processing": {
            "status": "pending",
            "queued_at": datetime.now().isoformat(),
        },
    }

    # Save file record + update project token usage
    try:
        await save_model(db, project_file)
        project.token_usage += token_estimate
        await save_model(db, project)
        await db.flush()
    except SQLAlchemyError as e:
        if "transaction is already begun" not in str(e):
            raise
        # If a transaction conflict, try again with an explicit transaction
        async with db.begin():
            await save_model(db, project_file)
            project.token_usage += token_estimate
            await save_model(db, project)

    # Queue background chunk/embedding
    if background_tasks:
        background_tasks.add_task(
            process_single_file_for_search,
            file_id=UUID(str(project_file.id)),
            project_id=UUID(str(project_id)),
            knowledge_base_id=UUID(str(project.knowledge_base_id)),
            db=db,
        )

    return {
        "id": str(project_file.id),
        "filename": project_file.filename,
        "file_type": project_file.file_type,
        "file_size": project_file.file_size,
        "created_at": (
            project_file.created_at.isoformat() if project_file.created_at else None
        ),
        "token_count": token_estimate,
        "processing_status": "pending",
        "project_id": str(project_id),
    }


# ---------------------------------------------------------------------
# Single-File Reprocessing (Used by Reindex + Upload)
# ---------------------------------------------------------------------


@handle_service_errors("File reindexing failed")
async def process_single_file_for_search(
    file_id: UUID, project_id: UUID, knowledge_base_id: UUID, db: Optional[AsyncSession] = None
):
    """
    This is called in a background task to:
      1) Load the file from DB
      2) Fetch the bytes from storage
      3) Pass them to vector_db.process_file_for_search(...) to chunk + embed
      4) Update the ProjectFile record's search_processing status
    """
    from db import get_async_session, get_async_session_context
        
    # Create new session if none provided
    if db is None:
        async with get_async_session_context() as session:
            try:
                async with session.begin():
                    # 1) Load ProjectFile
                    file_record = await get_by_id(session, ProjectFile, file_id)
                    if not file_record:
                        logger.error(f"File record {file_id} not found.")
                        return

                    # 2) Read the file from storage
                    storage_config = {
                        "storage_type": getattr(config, "FILE_STORAGE_TYPE", "local"),
                        "local_path": getattr(config, "LOCAL_UPLOADS_DIR", "./uploads"),
                    }
                    storage = get_file_storage(storage_config)
                    file_content = await storage.get_file(file_record.file_path)

                    # 3) Initialize vector DB
                    kb = await get_by_id(session, KnowledgeBase, knowledge_base_id)
                    model_name = kb.embedding_model if kb else DEFAULT_EMBEDDING_MODEL
                    vector_db = await get_vector_db(
                        model_name=str(model_name) if model_name else DEFAULT_EMBEDDING_MODEL,
                        storage_path=os.path.join(VECTOR_DB_STORAGE_PATH, str(project_id)),
                        load_existing=True,
                    )

                    # 4) Process (chunk + embed) via vector_db.process_file_for_search
                    result = await process_file_for_search(
                        project_file=file_record,
                        vector_db=vector_db,
                        file_content=file_content,
                        chunk_size=DEFAULT_CHUNK_SIZE,
                        chunk_overlap=DEFAULT_CHUNK_OVERLAP,
                        knowledge_base_id=knowledge_base_id  # Pass knowledge_base_id explicitly
                    )

                    # 5) Update the file record's status
                    search_proc = {
                        "status": "success" if result.get("success") else "error",
                        "chunk_count": result.get("chunk_count", 0),
                        "error": result.get("error"),
                        "processed_at": datetime.now().isoformat(),
                    }
                    file_config = file_record.config or {}
                    file_config["search_processing"] = search_proc
                    file_record.config = file_config

                    await save_model(session, file_record)
            except Exception as e:
                logger.exception(f"Error processing file {file_id} for reindex: {e}")
    else:
        try:
            async with db.begin():
                # 1) Load ProjectFile
                file_record = await get_by_id(db, ProjectFile, file_id)
                if not file_record:
                    logger.error(f"File record {file_id} not found.")
                    return

                # 2) Read the file from storage
                storage_config = {
                    "storage_type": getattr(config, "FILE_STORAGE_TYPE", "local"),
                    "local_path": getattr(config, "LOCAL_UPLOADS_DIR", "./uploads"),
                }
                storage = get_file_storage(storage_config)
                file_content = await storage.get_file(file_record.file_path)

                # 3) Initialize vector DB
                kb = await get_by_id(db, KnowledgeBase, knowledge_base_id)
                model_name = kb.embedding_model if kb else DEFAULT_EMBEDDING_MODEL
                vector_db = await get_vector_db(
                    model_name=str(model_name) if model_name else DEFAULT_EMBEDDING_MODEL,
                    storage_path=os.path.join(VECTOR_DB_STORAGE_PATH, str(project_id)),
                    load_existing=True,
                )

                # 4) Process (chunk + embed) via vector_db.process_file_for_search
                result = await process_file_for_search(
                    project_file=file_record,
                    vector_db=vector_db,
                    file_content=file_content,
                    chunk_size=DEFAULT_CHUNK_SIZE,
                    chunk_overlap=DEFAULT_CHUNK_OVERLAP,
                    knowledge_base_id=knowledge_base_id  # Pass knowledge_base_id explicitly
                )

                # 5) Update the file record's status
                search_proc = {
                    "status": "success" if result.get("success") else "error",
                    "chunk_count": result.get("chunk_count", 0),
                    "error": result.get("error"),
                    "processed_at": datetime.now().isoformat(),
                }
                file_config = file_record.config or {}
                file_config["search_processing"] = search_proc
                file_record.config = file_config

                await save_model(db, file_record)
        except Exception as e:
            logger.exception(f"Error processing file {file_id} for reindex: {e}")

# ---------------------------------------------------------------------
# File Deletion
# ---------------------------------------------------------------------


@handle_service_errors("File deletion failed")
async def delete_project_file(
    project_id: UUID, file_id: UUID, db: AsyncSession, user_id: Optional[int] = None
) -> Dict[str, Any]:
    """
    Delete a file from storage, remove from vector DB, then from DB.
    """
    project, file_record = await _validate_file_access(project_id, file_id, user_id, db)
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")

    config_ = file_record.config or {}
    token_estimate = config_.get("token_count", 0)

    # 1) Delete from storage
    storage_config = {
        "storage_type": getattr(config, "FILE_STORAGE_TYPE", "local"),
        "local_path": getattr(config, "LOCAL_UPLOADS_DIR", "./uploads"),
    }
    storage = get_file_storage(storage_config)
    file_deletion_status = "success"
    try:
        deleted = await storage.delete_file(file_record.file_path)
        if not deleted:
            file_deletion_status = "not_found_in_storage"
    except Exception as e:
        logger.error(f"Error deleting file from storage: {e}")
        file_deletion_status = "storage_deletion_failed"

    # 2) Remove from vector DB
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
                load_existing=True,
            )
            await vector_db.delete_by_filter({"file_id": str(file_id)})
        except Exception as e:
            logger.error(f"Error removing file from vector DB: {e}")

    # 3) Delete from DB
    try:
        await db.delete(file_record)
        project.token_usage = max(0, project.token_usage - token_estimate)
        await db.flush()
    except SQLAlchemyError as e:
        if "transaction is already begun" not in str(e):
            raise
        async with db.begin():
            await db.delete(file_record)
            project.token_usage = max(0, project.token_usage - token_estimate)

    return {
        "success": file_deletion_status == "success",
        "status": file_deletion_status,
        "file_id": str(file_id),
        "tokens_removed": token_estimate,
    }


# ---------------------------------------------------------------------
# Searching in the Knowledge Base
# ---------------------------------------------------------------------


@handle_service_errors("Error searching project context")
async def search_project_context(
    project_id: UUID, query: str, db: AsyncSession, top_k: int = 5
) -> Dict[str, Any]:
    """
    Search project knowledge base with enhanced error handling and validation.
    """
    if not query or len(query.strip()) < 2:
        raise ValueError("Query must be at least 2 characters")
    if top_k < 1 or top_k > 20:
        raise ValueError("top_k must be between 1 and 20")

    project = await _validate_user_and_project(project_id, None, db)
    # Prepare vector DB
    await db.refresh(project, ["knowledge_base"])
    model_name = DEFAULT_EMBEDDING_MODEL
    if project.knowledge_base and project.knowledge_base.embedding_model:
        model_name = project.knowledge_base.embedding_model

    vector_db = await get_vector_db(
        model_name=str(model_name) if model_name else DEFAULT_EMBEDDING_MODEL,
        storage_path=os.path.join(VECTOR_DB_STORAGE_PATH, str(project_id)),
        load_existing=True,
    )

    # Filter by project + KB
    filter_metadata = {
        "project_id": str(project_id),
        "knowledge_base_id": str(project.knowledge_base_id)
    }
    if project.knowledge_base_id:
        filter_metadata["knowledge_base_id"] = str(project.knowledge_base_id)

    # Expand the query if it's long
    clean_query = (
        await _expand_query(query) if len(query.split()) > 3 else query.strip()
    )
    if not clean_query:
        clean_query = query[:100]

    # Do the search
    results = await vector_db.search(
        query=clean_query,
        top_k=top_k * 2,  # gather extra, then do filtering below
        filter_metadata=filter_metadata,
    )

    # Filter to ensure diversity by file_id
    unique_sources = set()
    filtered_results = []
    for res in results:
        source_id = res.get("metadata", {}).get("file_id")
        if source_id not in unique_sources:
            filtered_results.append(res)
            unique_sources.add(source_id)
            if len(filtered_results) >= top_k:
                break

    # Enhance with file info
    enhanced = []
    for res in filtered_results:
        f_id = res.get("metadata", {}).get("file_id")
        if f_id:
            try:
                fid_uuid = UUID(f_id)
                file_rec = await get_by_id(db, ProjectFile, fid_uuid)
                if file_rec:
                    res["file_info"] = extract_file_metadata(
                        file_rec, include_token_count=False
                    )
            except Exception as e:
                logger.error(f"Error adding file metadata: {e}")
        enhanced.append(res)

    # Return
    return {
        "query": query,
        "results": [serialize_vector_result(r) for r in enhanced],
        "result_count": len(enhanced),
    }


@handle_service_errors("Error cleaning up KB references")
async def cleanup_orphaned_kb_references(db: AsyncSession) -> Dict[str, int]:
    """
    Clean up invalid references where the project.knowledge_base_id
    points to a missing KnowledgeBase record, or conversations referencing
    a project that no longer has a KB.
    """
    # We do an update for projects that reference a non-existent KB
    project_result = await db.execute(
        update(Project)
        .where(
            Project.knowledge_base_id.is_not(None),
            ~exists().where(KnowledgeBase.id == Project.knowledge_base_id),
        )
        .values(knowledge_base_id=None)
        .returning(Project.id)
    )
    fixed_projects = len(project_result.scalars().all())

    # Fix conversations that have use_knowledge_base=True but no valid KB
    conv_result = await db.execute(
        update(Conversation)
        .where(
            Conversation.use_knowledge_base.is_(True),
            ~exists().where(
                (Project.id == Conversation.project_id)
                & (Project.knowledge_base_id.is_not(None))
            ),
        )
        .values(use_knowledge_base=False)
        .returning(Conversation.id)
    )
    fixed_convs = len(conv_result.scalars().all())

    await db.commit()
    return {"projects_fixed": fixed_projects, "conversations_fixed": fixed_convs}


@handle_service_errors("Error retrieving file stats")
async def get_project_files_stats(project_id: UUID, db: AsyncSession) -> Dict[str, Any]:
    """
    Get file statistics (count, total size, type distribution) for a project.
    """
    project = await get_by_id(db, Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Count
    count_q = select(func.count()).where(ProjectFile.project_id == project_id)
    file_count_res = await db.execute(count_q)
    file_count = file_count_res.scalar() or 0

    # Total size
    size_q = select(func.sum(ProjectFile.file_size)).where(
        ProjectFile.project_id == project_id
    )
    size_res = await db.execute(size_q)
    total_size = size_res.scalar() or 0

    # Distribution
    type_q = (
        select(ProjectFile.file_type, func.count().label("count"))
        .where(ProjectFile.project_id == project_id)
        .group_by(ProjectFile.file_type)
    )
    type_res = await db.execute(type_q)
    file_types = {row[0]: row[1] for row in type_res}

    return {
        "file_count": file_count,
        "total_size_bytes": total_size,
        "total_size_mb": round(total_size / (1024 * 1024), 2) if total_size > 0 else 0,
        "file_types": file_types,
        "token_usage": project.token_usage,
        "max_tokens": project.max_tokens,
    }
