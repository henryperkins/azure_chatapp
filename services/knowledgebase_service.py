"""
knowledgebase_service.py
------------------------
Refactored service for managing knowledge bases with:
- File uploads and processing
- Text extraction and chunking
- Embedding generation and vector storage
- Search and retrieval for context
- Token usage tracking

Key Improvements:
- Extracted helper classes for common operations
- Reduced code duplication
- Better error handling
- Cleaner organization
"""

import os
import logging
from datetime import datetime
from typing import Any, Optional, Tuple, List
from uuid import UUID

from fastapi import HTTPException, UploadFile, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update, exists
from sqlalchemy.exc import SQLAlchemyError
from functools import wraps
from db import get_async_session_context

import config
from models.project_file import ProjectFile
from models.project import Project
from models.knowledge_base import KnowledgeBase
from models.user import User
from models.conversation import Conversation
from services.vector_db import VectorDB, process_file_for_search, get_vector_db
from services.github_service import GitHubService
from utils.file_validation import FileValidator, sanitize_filename
from utils.db_utils import get_by_id, save_model
from utils.serializers import serialize_vector_result

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------
# Configuration and Helpers
# ---------------------------------------------------------------------


class KBConfig:
    """Centralized configuration for knowledge base service"""

    @staticmethod
    def get() -> dict[str, Any]:
        return {
            "max_file_bytes": getattr(config, "MAX_FILE_SIZE", 30_000_000),
            "stream_threshold": getattr(config, "STREAM_THRESHOLD", 10_000_000),
            "default_embedding_model": getattr(
                config, "DEFAULT_EMBEDDING_MODEL", "all-MiniLM-L6-v2"
            ),
            "vector_db_storage_path": getattr(
                config, "VECTOR_DB_STORAGE_PATH", "./storage/vector_db"
            ),
            "default_chunk_size": getattr(config, "DEFAULT_CHUNK_SIZE", 1000),
            "default_chunk_overlap": getattr(config, "DEFAULT_CHUNK_OVERLAP", 200),
            "allowed_sort_fields": {"created_at", "filename", "file_size"},
        }


class StorageManager:
    """Handles all file storage operations"""

    @staticmethod
    def get() -> Any:
        from services.file_storage import (
            get_file_storage,
        )  # pylint: disable=import-outside-toplevel

        return get_file_storage(
            {
                "storage_type": getattr(config, "FILE_STORAGE_TYPE", "local"),
                "local_path": getattr(config, "LOCAL_UPLOADS_DIR", "./uploads"),
            }
        )


class VectorDBManager:
    """Manages VectorDB instances and operations"""

    @staticmethod
    async def get_for_project(
        project_id: UUID,
        model_name: Optional[str] = None,
        db: Optional[AsyncSession] = None,
    ) -> VectorDB:
        config = KBConfig.get()
        return await get_vector_db(
            model_name=model_name or config["default_embedding_model"],
            storage_path=os.path.join(
                config["vector_db_storage_path"], str(project_id)
            ),
            load_existing=True,
        )


class TokenManager:
    """Handles token counting and limits"""

    @staticmethod
    async def update_usage(project: Project, delta: int, db: AsyncSession) -> None:
        project.token_usage = max(0, project.token_usage + delta)
        await save_model(db, project)

    @staticmethod
    async def validate_usage(project: Project, additional_tokens: int) -> bool:
        if not project.max_tokens:
            return True
        return (project.token_usage + additional_tokens) <= project.max_tokens


def extract_file_metadata(
    file_record: ProjectFile, include_token_count: bool = True
) -> dict[str, Any]:
    """Extract standardized metadata from file record"""
    metadata = {
        "filename": file_record.filename,
        "file_type": file_record.file_type,
        "file_size": file_record.file_size,
        "created_at": (
            file_record.created_at.isoformat() if file_record.created_at else None
        ),
    }

    if include_token_count and file_record.config:
        metadata["token_count"] = file_record.config.get("token_count", 0)

    if file_record.config and "search_processing" in file_record.config:
        metadata["processing"] = file_record.config["search_processing"]

    return metadata


# ---------------------------------------------------------------------
# Error Handling Decorator
# ---------------------------------------------------------------------


def handle_service_errors(
    detail_message: str = "Operation failed", status_code: int = 500
):
    """Decorator for consistent error handling in service functions"""

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
                ) from e
            except SQLAlchemyError as e:
                logger.error(
                    f"Database error in {func.__name__}: {str(e)}", exc_info=True
                )
                raise HTTPException(
                    status_code=500, detail=f"Database error: {str(e)}"
                ) from e
            except Exception as e:
                logger.exception(f"Unhandled error in {func.__name__}: {str(e)}")
                raise HTTPException(
                    status_code=status_code, detail=f"{detail_message}: {str(e)}"
                ) from e

        return wrapper

    return decorator


# ---------------------------------------------------------------------
# Core Service Functions
# ---------------------------------------------------------------------


@handle_service_errors("Error creating knowledge base")
async def create_knowledge_base(
    name: str,
    project_id: UUID,
    description: Optional[str] = None,
    embedding_model: Optional[str] = None,
    db: Optional[AsyncSession] = None,
) -> KnowledgeBase:
    """Create a new KnowledgeBase for a project"""
    if db is None:
        raise ValueError("Database session is required")

    project = await get_by_id(db, Project, project_id)
    if not project:
        raise ValueError("Project not found")

    if project.knowledge_base_id:
        raise ValueError("Project already has a knowledge base")

    config = KBConfig.get()
    kb = KnowledgeBase(
        name=name,
        description=description,
        embedding_model=embedding_model or config["default_embedding_model"],
        is_active=True,
        project_id=project_id,
    )

    await save_model(db, kb)

    # Attach to project
    project.knowledge_base_id = kb.id  # type: ignore
    await save_model(db, project)

    return kb


async def ensure_project_has_knowledge_base(
    project_id: UUID, db: AsyncSession, user_id: Optional[int] = None
) -> KnowledgeBase:
    """Ensures a project has an active knowledge base with locking protection against race conditions"""
    project = await _validate_user_and_project(project_id, user_id, db)

    # Check if project already has a knowledge base (common case)
    if project.knowledge_base_id:
        kb = await db.get(KnowledgeBase, project.knowledge_base_id)
        if kb and not kb.is_active:
            kb.is_active = True
            await save_model(db, kb)
            logger.info(f"Reactivated knowledge base {kb.id} for project {project_id}")
        return kb

    # Acquire a database-level lock to prevent race conditions
    # First, refresh the project to ensure we have latest state
    await db.refresh(project)

    # Double-check if KB was created between initial check and lock acquisition
    if project.knowledge_base_id:
        kb = await db.get(KnowledgeBase, project.knowledge_base_id)
        if kb:
            logger.info(
                f"KB already created in concurrent request for project {project_id}"
            )
            return kb

    try:
        # Create new knowledge base
        kb = await create_knowledge_base(
            name=f"{project.name} Knowledge Base",
            project_id=project_id,
            description="Automatically created knowledge base",
            embedding_model=None,
            db=db,
        )
        logger.info(f"Created knowledge base {kb.id} for project {project_id}")
        return kb
    except ValueError as e:
        # If there's an error like "Project already has a knowledge base"
        # it could be due to a race condition, try to get the KB again
        if "already has a knowledge base" in str(e):
            await db.refresh(project)
            if project.knowledge_base_id:
                kb = await db.get(KnowledgeBase, project.knowledge_base_id)
                if kb:
                    logger.info(
                        f"Using KB created by concurrent request for project {project_id}"
                    )
                    return kb
        # If we couldn't recover, re-raise the exception
        raise


@handle_service_errors("File upload failed")
async def upload_file_to_project(
    project_id: UUID,
    file: UploadFile,
    db: AsyncSession,
    user_id: Optional[int] = None,
    background_tasks: Optional[BackgroundTasks] = None,
) -> dict[str, Any]:
    """Upload and process a file for a project"""
    # Validate access and get KB
    project, kb = await _validate_project_and_kb(project_id, user_id, db)

    # Process file info
    file_info = await _process_upload_file_info(file)

    # Read file in chunks to avoid massive in-memory reads
    chunk_size = 65536  # 64 KB
    file_chunks = []
    total_bytes = 0

    chunk = await file.read(chunk_size)
    while chunk:
        file_chunks.append(chunk)
        total_bytes += len(chunk)
        # Log progress for large files
        if total_bytes % (1024 * 1024) < chunk_size:
            logger.info(f"Reading file... total so far: {total_bytes} bytes")
        chunk = await file.read(chunk_size)

    contents = b"".join(file_chunks)
    logger.info(f"Finished reading file: total {total_bytes} bytes")

    # Validate size
    config = KBConfig.get()
    if len(contents) > config["max_file_bytes"]:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds maximum size of {config['max_file_bytes'] / 1024 / 1024:.1f} MB",
        )

    # Estimate tokens
    token_data = await _estimate_file_tokens(
        contents, file_info["sanitized_filename"], file, project
    )
    if not await TokenManager.validate_usage(project, token_data["token_estimate"]):
        raise ValueError(
            f"Adding this file would exceed the project's token limit "
            f"({project.max_tokens} tokens)"
        )

    # Store file
    storage = StorageManager.get()
    stored_path = await _store_uploaded_file(
        storage, contents, project_id, file_info["sanitized_filename"]
    )

    # Create file record
    project_file = await _create_file_record(
        project_id, file_info, stored_path, len(contents), token_data
    )
    await save_model(db, project_file)
    await TokenManager.update_usage(project, token_data["token_estimate"], db)

    # Queue background processing
    if background_tasks:
        background_tasks.add_task(
            process_single_file_for_search,
            file_id=UUID(str(project_file.id)),
            project_id=UUID(str(project_id)),
            knowledge_base_id=UUID(str(kb.id)),
            db=db,
        )

    return extract_file_metadata(project_file)


async def process_single_file_for_search(
    file_id: UUID,
    project_id: UUID,
    knowledge_base_id: UUID,
    db: Optional[AsyncSession] = None,
) -> None:
    """Process a file for search in background"""

    async def _process_core(session: AsyncSession) -> None:
        file_record = await get_by_id(session, ProjectFile, file_id)
        if not file_record:
            logger.error(f"File {file_id} not found")
            return

        storage = StorageManager.get()
        content = await storage.get_file(file_record.file_path)

        vector_db = await VectorDBManager.get_for_project(
            project_id=project_id, db=session
        )

        result = await process_file_for_search(
            project_file=file_record,
            vector_db=vector_db,
            file_content=content,
            knowledge_base_id=UUID(str(knowledge_base_id)),
        )

        # Update processing status
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

    if db is not None:
        await _process_core(db)
    else:
        async with get_async_session_context() as session:
            await _process_core(session)


@handle_service_errors("File deletion failed")
async def delete_project_file(
    project_id: UUID,
    file_id: UUID,
    db: AsyncSession,
    user_id: Optional[int] = None,
) -> dict[str, Any]:
    """Delete a project file and its vectors"""
    project, file_record = await _validate_file_access(project_id, file_id, user_id, db)
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")

    # Delete from storage
    storage = StorageManager.get()
    file_deletion_status = await _delete_file_from_storage(
        storage, file_record.file_path
    )

    # Delete vectors
    if project.knowledge_base_id:
        await _delete_file_vectors(project_id, file_id)

    # Delete record and update tokens
    token_count = file_record.config.get("token_count", 0) if file_record.config else 0
    await db.delete(file_record)
    await TokenManager.update_usage(project, -token_count, db)

    return {
        "success": file_deletion_status == "success",
        "status": file_deletion_status,
        "file_id": str(file_id),
        "tokens_removed": token_count,
    }


@handle_service_errors("Error searching project context")
async def search_project_context(
    project_id: UUID, query: str, db: AsyncSession, top_k: int = 5
) -> dict[str, Any]:
    """Search project knowledge base"""
    if not query or len(query.strip()) < 2:
        raise ValueError("Query must be at least 2 characters")
    if top_k < 1 or top_k > 20:
        raise ValueError("top_k must be between 1 and 20")

    project = await _validate_user_and_project(project_id, None, db)
    await db.refresh(project, ["knowledge_base"])

    # Get vector DB
    model_name = (
        project.knowledge_base.embedding_model if project.knowledge_base else None
    )
    vector_db = await VectorDBManager.get_for_project(
        project_id=project_id, model_name=model_name, db=db
    )

    # Prepare filters
    filter_metadata = (
        {
            "project_id": str(project_id),
            "knowledge_base_id": str(project.knowledge_base_id),
        }
        if project.knowledge_base_id
        else {"project_id": str(project_id)}
    )

    # Search and process results
    results = await _execute_search(vector_db, query, filter_metadata, top_k)
    enhanced_results = await _enhance_with_file_info(results, db)

    return {
        "query": query,
        "results": [serialize_vector_result(r) for r in enhanced_results],
        "result_count": len(enhanced_results),
    }


# ---------------------------------------------------------------------
# GitHub Repository Operations
# ---------------------------------------------------------------------


@handle_service_errors("Error attaching GitHub repository")
async def attach_github_repository(
    project_id: UUID,
    repo_url: str,
    branch: Optional[str] = "main",
    file_paths: Optional[List[str]] = None,
    db: AsyncSession,
    user_id: Optional[int] = None,
) -> dict[str, Any]:
    """Attach a GitHub repository as a data source for the project's knowledge base"""
    project, kb = await _validate_project_and_kb(project_id, user_id, db)

    # Initialize GitHub service
    github_service = GitHubService(token=project.user.github_token)

    # Clone repository
    repo_path = github_service.clone_repository(repo_url=repo_url, branch=branch)

    # Fetch specified files
    file_paths = file_paths or []
    fetched_files = github_service.fetch_files(repo_path, file_paths)

    # Process fetched files
    for file_path in fetched_files:
        with open(file_path, "rb") as file:
            await upload_file_to_project(
                project_id=project_id,
                file=UploadFile(file),
                db=db,
                user_id=user_id,
            )

    # Update knowledge base with repository info
    kb.repo_url = repo_url
    kb.branch = branch
    kb.file_paths = file_paths
    await save_model(db, kb)

    return {
        "repo_url": repo_url,
        "branch": branch,
        "files_processed": len(fetched_files),
    }


@handle_service_errors("Error detaching GitHub repository")
async def detach_github_repository(
    project_id: UUID,
    repo_url: str,
    db: AsyncSession,
    user_id: Optional[int] = None,
) -> dict[str, Any]:
    """Detach a GitHub repository from the project's knowledge base"""
    project, kb = await _validate_project_and_kb(project_id, user_id, db)

    # Initialize GitHub service
    github_service = GitHubService(token=project.user.github_token)

    # Remove files associated with the repository
    repo_path = github_service.clone_repository(repo_url=repo_url)
    file_paths = github_service.fetch_files(repo_path, [])
    github_service.remove_files(repo_path, file_paths)

    # Update knowledge base to remove repository info
    kb.repo_url = None
    kb.branch = None
    kb.file_paths = None
    await save_model(db, kb)

    return {
        "repo_url": repo_url,
        "files_removed": len(file_paths),
    }


# ---------------------------------------------------------------------
# Private Helper Functions
# ---------------------------------------------------------------------


async def _validate_project_and_kb(
    project_id: UUID, user_id: Optional[int], db: AsyncSession
) -> Tuple[Project, KnowledgeBase]:
    """Validate project and knowledge base access"""
    project = await _validate_user_and_project(project_id, user_id, db)
    if not project.knowledge_base_id:
        raise HTTPException(
            status_code=400, detail="Project does not have an associated knowledge base"
        )
    kb = await get_by_id(db, KnowledgeBase, project.knowledge_base_id)
    return project, kb


async def _validate_user_and_project(
    project_id: UUID, user_id: Optional[int], db: AsyncSession
) -> Project:
    """Validate user access to project"""
    if user_id is not None:
        from services.project_service import (
            validate_project_access,
        )  # pylint: disable=import-outside-toplevel

        user = await get_by_id(db, User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return await validate_project_access(project_id, user, db)

    project = await get_by_id(db, Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


async def _validate_file_access(
    project_id: UUID, file_id: Optional[UUID], user_id: Optional[int], db: AsyncSession
) -> Tuple[Project, Optional[ProjectFile]]:
    """Validate access to project file"""
    project = await _validate_user_and_project(project_id, user_id, db)
    file_record = None
    if file_id:
        file_record = await get_by_id(db, ProjectFile, file_id)
        if not file_record or str(file_record.project_id) != str(project_id):
            raise HTTPException(status_code=404, detail="File not found")
    return project, file_record


async def _process_upload_file_info(file: UploadFile) -> dict[str, Any]:
    """Process and validate uploaded file"""
    file_info = await FileValidator.validate_upload_file(file)
    filename, ext = os.path.splitext(file.filename or "untitled")
    return {
        "sanitized_filename": f"{sanitize_filename(filename)}{ext}",
        "file_ext": ext[1:].lower() if ext else "",
        "file_type": file_info.get("category", "unknown"),
    }


async def _estimate_file_tokens(
    contents: bytes, filename: str, file: UploadFile, project: Project
) -> dict[str, Any]:
    """Estimate token count for file"""
    from services.text_extraction import (
        get_text_extractor,
    )  # pylint: disable=import-outside-toplevel

    text_extractor = get_text_extractor()

    try:
        content_to_process = (
            contents
            if len(contents) <= KBConfig.get()["stream_threshold"]
            else file.file
        )
        tok_count, tok_metadata = await text_extractor.estimate_token_count(  # type: ignore # pylint: disable=E1101
            content_to_process, filename
        )
    except Exception as e:
        logger.error(f"Error estimating tokens: {str(e)}")
        tok_count, tok_metadata = 0, {"error": str(e)}

    return {"token_estimate": tok_count, "metadata": tok_metadata}


async def _store_uploaded_file(
    storage: Any, content: bytes, project_id: UUID, filename: str
) -> str:
    """Store uploaded file and return path"""
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    safe_name = filename.replace(" ", "_")
    rel_path = f"{project_id}/{timestamp}_{safe_name}"
    return await storage.save_file(content, rel_path, project_id=project_id)


async def _create_file_record(
    project_id: UUID,
    file_info: dict[str, Any],
    stored_path: str,
    file_size: int,
    token_data: dict[str, Any],
) -> ProjectFile:
    """Create ProjectFile record from upload data"""
    return ProjectFile(
        project_id=project_id,
        filename=file_info["sanitized_filename"],
        file_path=stored_path,
        file_type=file_info["file_type"],
        file_size=file_size,
        config={
            "token_count": token_data["token_estimate"],
            "file_extension": file_info["file_ext"],
            "upload_time": datetime.now().isoformat(),
            "search_processing": {
                "status": "pending",
                "queued_at": datetime.now().isoformat(),
            },
            **token_data["metadata"],
        },
    )


async def _delete_file_from_storage(storage: Any, file_path: str) -> str:
    """Delete file from storage backend"""
    try:
        deleted = await storage.delete_file(file_path)
        return "success" if deleted else "not_found_in_storage"
    except Exception as e:
        logger.error(f"Error deleting file from storage: {e}")
        return "storage_deletion_failed"


async def _delete_file_vectors(project_id: UUID, file_id: UUID) -> None:
    """Delete vectors associated with file"""
    try:
        vector_db = await VectorDBManager.get_for_project(project_id)
        await vector_db.delete_by_filter({"file_id": str(file_id)})
    except Exception as e:
        logger.error(f"Error removing file vectors: {e}")


async def _execute_search(
    vector_db: VectorDB, query: str, filter_metadata: dict[str, Any], top_k: int
) -> List[dict[str, Any]]:
    """Execute search with query expansion"""
    clean_query = (
        await _expand_query(query) if len(query.split()) > 3 else query.strip()
    ) or query[:100]

    results = await vector_db.search(
        query=clean_query,
        top_k=top_k * 2,  # Get extra for deduplication
        filter_metadata=filter_metadata,
    )

    # Deduplicate by file_id
    unique_sources = set()
    filtered_results = []
    for res in results:
        source_id = res.get("metadata", {}).get("file_id")
        if source_id not in unique_sources:
            filtered_results.append(res)
            unique_sources.add(source_id)
            if len(filtered_results) >= top_k:
                break

    return filtered_results


async def _enhance_with_file_info(
    results: List[dict[str, Any]], db: AsyncSession
) -> List[dict[str, Any]]:
    """Add file metadata to search results"""
    enhanced = []
    for res in results:
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
    return enhanced


async def _expand_query(original_query: str) -> str:
    """Basic query expansion with synonyms"""
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
# Maintenance Functions
# ---------------------------------------------------------------------


@handle_service_errors("Error cleaning up KB references")
async def cleanup_orphaned_kb_references(db: AsyncSession) -> dict[str, int]:
    """Clean up invalid knowledge base references"""
    # Fix projects with invalid KB references
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

    # Fix conversations referencing invalid KBs
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


@handle_service_errors("Error retrieving KB status")
async def get_kb_status(project_id: UUID, db: AsyncSession) -> dict[str, Any]:
    """Get basic status of knowledge base for a project"""
    project = await get_by_id(db, Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    kb_exists = project.knowledge_base_id is not None
    kb_active = False
    if kb_exists:
        if not project.knowledge_base_id:
            raise HTTPException(
                status_code=400, detail="Project has no knowledge base ID set"
            )
        kb = await get_by_id(db, KnowledgeBase, UUID(str(project.knowledge_base_id)))
        kb_active = kb.is_active if kb else False

    return {
        "exists": kb_exists,
        "isActive": kb_active,
        "project_id": str(project_id),
    }


@handle_service_errors("Error retrieving KB health")
async def get_knowledge_base_health(
    knowledge_base_id: UUID, db: AsyncSession
) -> dict[str, Any]:
    """Get detailed health status of a knowledge base"""
    kb = await get_by_id(db, KnowledgeBase, knowledge_base_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")

    vector_db = await VectorDBManager.get_for_project(UUID(str(kb.project_id)), db=db)
    stats = await vector_db.get_knowledge_base_status(UUID(str(kb.project_id)), db)

    return {
        "id": str(kb.id),
        "name": kb.name,
        "is_active": kb.is_active,
        "embedding_model": kb.embedding_model,
        "vector_stats": stats,
        "created_at": kb.created_at.isoformat() if kb.created_at else None,
    }


@handle_service_errors("Error getting project files stats")
async def get_project_files_stats(project_id: UUID, db: AsyncSession) -> dict[str, Any]:
    """Get statistics about files in a project including processing status.

    Returns:
        Dictionary containing:
        - total_files: Total number of files in project
        - processed_files: Count of files successfully processed for search
        - failed_files: Count of files that failed processing
        - pending_files: Count of files not yet processed
        - total_tokens: Sum of tokens from all processed files
    """
    # Get total file count
    total_files = await db.scalar(
        select(func.count(ProjectFile.id)).where(  # pylint: disable=not-callable
            ProjectFile.project_id == project_id
        )
    )

    # Get processed files count and total tokens
    processed_result = await db.execute(
        select(
            func.count(ProjectFile.id),  # pylint: disable=not-callable
            func.sum(ProjectFile.config["token_count"].as_integer()),
        ).where(
            ProjectFile.project_id == project_id,
            ProjectFile.config["search_processing"]["status"].as_string() == "success",
        )
    )
    processed_files, total_tokens = processed_result.first() or (0, 0)

    # Get failed files count
    failed_files = await db.scalar(
        select(func.count(ProjectFile.id)).where(  # pylint: disable=not-callable
            ProjectFile.project_id == project_id,
            ProjectFile.config["search_processing"]["status"].as_string() == "error",
        )
    )

    return {
        "total_files": total_files or 0,
        "processed_files": processed_files or 0,
        "failed_files": failed_files or 0,
        "pending_files": (total_files or 0)
        - (processed_files or 0)
        - (failed_files or 0),
        "total_tokens": total_tokens or 0,
    }


@handle_service_errors("Error listing knowledge bases")
async def list_knowledge_bases(
    db: AsyncSession, skip: int = 0, limit: int = 100, active_only: bool = True
) -> List[dict[str, Any]]:
    """List knowledge bases with optional filtering"""
    query = select(KnowledgeBase)
    if active_only:
        query = query.where(KnowledgeBase.is_active.is_(True))

    if skip > 0:
        query = query.offset(skip)
    if limit > 0:
        query = query.limit(limit)

    result = await db.execute(query)
    kbs = result.scalars().all()

    return [
        {
            "id": str(kb.id),
            "name": kb.name,
            "description": kb.description,
            "is_active": kb.is_active,
            "project_id": str(kb.project_id) if kb.project_id else None,
            "created_at": kb.created_at.isoformat() if kb.created_at else None,
        }
        for kb in kbs
    ]


@handle_service_errors("Error getting knowledge base")
async def get_knowledge_base(
    knowledge_base_id: UUID, db: AsyncSession
) -> dict[str, Any]:
    """Get a knowledge base by ID"""
    kb = await get_by_id(db, KnowledgeBase, knowledge_base_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")

    return {
        "id": str(kb.id),
        "name": kb.name,
        "description": kb.description,
        "is_active": kb.is_active,
        "project_id": str(kb.project_id) if kb.project_id else None,
        "embedding_model": kb.embedding_model,
        "created_at": kb.created_at.isoformat() if kb.created_at else None,
    }


@handle_service_errors("Error updating knowledge base")
async def update_knowledge_base(
    knowledge_base_id: UUID, update_data: dict[str, Any], db: AsyncSession
) -> dict[str, Any]:
    """Update a knowledge base"""
    kb = await get_by_id(db, KnowledgeBase, knowledge_base_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")

    for field, value in update_data.items():
        if hasattr(kb, field):
            setattr(kb, field, value)

    await save_model(db, kb)
    return await get_knowledge_base(knowledge_base_id, db)


@handle_service_errors("Error deleting knowledge base")
async def delete_knowledge_base(knowledge_base_id: UUID, db: AsyncSession) -> bool:
    """Delete a knowledge base"""
    kb = await get_by_id(db, KnowledgeBase, knowledge_base_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")

    # Remove from associated project
    if kb.project_id:
        project = await get_by_id(db, Project, UUID(str(kb.project_id)))
        if project and project.knowledge_base_id == kb.id:
            project.knowledge_base_id = None
            await save_model(db, project)

    await db.delete(kb)
    return True


@handle_service_errors("Error toggling project KB")
async def toggle_project_kb(
    project_id: UUID,
    enable: bool,
    user_id: Optional[int] = None,
    db: Optional[AsyncSession] = None,
) -> dict[str, Any]:
    """Enable/disable knowledge base for a project"""
    if db is None:
        raise ValueError("Database session is required")

    project = await _validate_user_and_project(project_id, user_id, db)
    if not project.knowledge_base_id:
        raise HTTPException(
            status_code=400, detail="Project does not have a knowledge base"
        )

    kb = await get_by_id(db, KnowledgeBase, project.knowledge_base_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")

    kb.is_active = enable
    await save_model(db, kb)

    return {
        "project_id": str(project_id),
        "knowledge_base_active": enable,
        "knowledge_base_id": str(kb.id),
    }


@handle_service_errors("Error retrieving project file list")
async def get_project_file_list(
    project_id: UUID,
    user_id: int,  # Changed from UUID to int
    db: AsyncSession,
    skip: int = 0,
    limit: int = 100,
    file_type: Optional[str] = None,
) -> dict[str, Any]:
    """
    Retrieve a list of files for a specific project with pagination and optional filtering.

    Args:
        project_id: UUID of the project
        user_id: UUID of the user requesting the files (for access control)
        db: Database session
        skip: Number of items to skip for pagination
        limit: Maximum number of items to return
        file_type: Optional filter for file type

    Returns:
        Dictionary containing the list of files and pagination metadata
    """
    # Validate user has access to the project
    from services.project_service import (
        validate_project_access,
    )  # pylint: disable=import-outside-toplevel

    user = await get_by_id(db, User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    await validate_project_access(project_id, user, db)

    query = select(ProjectFile).where(ProjectFile.project_id == project_id)

    if file_type:
        query = query.where(ProjectFile.file_type == file_type)

    count_query = select(func.count("*")).select_from(
        query.subquery()
    )  # pylint: disable=not-callable
    total = await db.execute(count_query)
    total_count = total.scalar() or 0

    query = query.offset(skip).limit(limit).order_by(ProjectFile.created_at.desc())

    result = await db.execute(query)
    files = result.scalars().all()

    return {
        "files": [file.to_dict() for file in files],
        "pagination": {"total": total_count, "skip": skip, "limit": limit},
    }
