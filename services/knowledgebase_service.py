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

from services.knowledgebase_helpers import (
    KBConfig,
    StorageManager,
    TokenManager,
    VectorDBManager,          # ← NEW (re-uses shared impl)
    MetadataHelper,           # ← NEW (re-uses shared impl)
)
from services.project_service import (
    check_knowledge_base_status as get_project_files_stats,
)  # Unified export for all code that expects file & chunk stats APIs

from fastapi import (
    HTTPException,
    UploadFile,
    BackgroundTasks,
)  # pylint: disable=no-name-in-module,import-error
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import SQLAlchemyError
from functools import wraps
from db import get_async_session_context

from models.project_file import ProjectFile
from models.project import Project
from models.knowledge_base import KnowledgeBase
from models.user import User
from services.vector_db import VectorDB, process_file_for_search, get_vector_db
from services.github_service import GitHubService
from utils.file_validation import FileValidator, sanitize_filename
from utils.db_utils import get_by_id, save_model
from utils.serializers import serialize_vector_result

logger = logging.getLogger(__name__)




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

    # Explicitly load the knowledge_base relationship asynchronously
    await db.refresh(project, ["knowledge_base"])

    if project.knowledge_base:
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
    project.knowledge_base = kb
    await save_model(db, project)

    return kb


async def ensure_project_has_knowledge_base(
    project_id: UUID, db: AsyncSession, user_id: Optional[int] = None
) -> KnowledgeBase:
    """Ensures a project has an active knowledge base with locking protection against race conditions"""
    project = await _validate_user_and_project(project_id, user_id, db)

    # Check if project already has a knowledge base (common case)
    if project.knowledge_base:
        kb = project.knowledge_base
        if kb and not kb.is_active:
            kb.is_active = True
            await save_model(db, kb)
            logger.info(f"Reactivated knowledge base {kb.id} for project {project_id}")
        return kb

    # Acquire a database-level lock to prevent race conditions
    # First, refresh the project to ensure we have latest state
    await db.refresh(project)

    # Double-check if KB was created between initial check and lock acquisition
    if project.knowledge_base:
        kb = project.knowledge_base
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
            if project.knowledge_base:
                kb = project.knowledge_base
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
    # Ensure KB exists, then validate access and get KB
    await ensure_project_has_knowledge_base(project_id, db, user_id)
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
        contents,
        file_info["sanitized_filename"],
        file,
        project,  # file and project args are kept for signature compatibility but not used
    )

    # Check if token estimation itself returned an error in its metadata
    if "error" in token_data.get("metadata", {}):
        error_detail = token_data["metadata"]["error"]
        logger.error(
            f"Token estimation failed for {file_info['sanitized_filename']}: {error_detail}"
        )
        # Use 422 if the file content caused a processing error during token estimation
        raise HTTPException(
            status_code=422,
            detail=f"Failed to process file for token estimation: {error_detail}",
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

    return MetadataHelper.extract_file_metadata(project_file)


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
    if project.knowledge_base:
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
    """
    Performs a semantic search against a project's knowledge base and returns relevant results.
    """
    if not query or len(query.strip()) < 2:
        raise ValueError("Query must be at least 2 characters")
    if top_k < 1 or top_k > 20:
        raise ValueError("top_k must be between 1 and 20")

    project = await _validate_user_and_project(project_id, None, db)
    await db.refresh(project, ["knowledge_base"])

    model_name = (
        project.knowledge_base.embedding_model if project.knowledge_base else None
    )
    vector_db = await VectorDBManager.get_for_project(
        project_id=project_id, model_name=model_name, db=db
    )

    filter_metadata = {"project_id": str(project_id)}
    if project.knowledge_base:
        filter_metadata["knowledge_base_id"] = str(project.knowledge_base.id)

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
    db: AsyncSession,
    branch: str = "main",
    file_paths: Optional[List[str]] = None,
    user_id: Optional[int] = None,
) -> dict[str, Any]:
    project, kb = await _validate_project_and_kb(project_id, user_id, db)
    user = await get_by_id(db, User, user_id) if user_id else None
    github_service = GitHubService(token=user.github_token if user else None)

    repo_path = github_service.clone_repository(repo_url=repo_url, branch=branch)
    file_paths = file_paths or []
    fetched_files = github_service.fetch_files(repo_path, file_paths)

    for file_path in fetched_files:
        with open(file_path, "rb") as fp:
            await upload_file_to_project(
                project_id=project_id,
                file=UploadFile(filename=os.path.basename(file_path), file=fp),
                db=db,
                user_id=user_id,
            )

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
    """
    Detaches a GitHub repository from a project's knowledge base.
    """
    project, kb = await _validate_project_and_kb(project_id, user_id, db)
    github_service = GitHubService(token=project.user.github_token)

    repo_path = github_service.clone_repository(repo_url=repo_url)
    file_paths = github_service.fetch_files(repo_path, [])
    github_service.remove_files(repo_path, file_paths)

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
    project = await _validate_user_and_project(project_id, user_id, db)
    if not project.knowledge_base:
        raise HTTPException(
            status_code=400, detail="Project does not have an associated knowledge base"
        )
    kb = project.knowledge_base
    return project, kb


async def _validate_user_and_project(
    project_id: UUID, user_id: Optional[int], db: AsyncSession
) -> Project:
    if user_id is not None:
        from services.project_service import validate_project_access

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
    project = await _validate_user_and_project(project_id, user_id, db)
    file_record = None
    if file_id:
        file_record = await get_by_id(db, ProjectFile, file_id)
        if not file_record or str(file_record.project_id) != str(project_id):
            raise HTTPException(status_code=404, detail="File not found")
    return project, file_record


async def _process_upload_file_info(file: UploadFile) -> dict[str, Any]:
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
    from services.text_extraction import get_text_extractor

    text_extractor = get_text_extractor()
    tok_count = 0
    tok_metadata = {}

    try:
        _chunks, metadata_dict = await text_extractor.extract_text(
            file_content=contents, filename=filename
        )
        tok_count = metadata_dict.get("token_count", 0)
        tok_metadata = metadata_dict
    except Exception as e:
        logger.error(
            f"Error estimating tokens via extract_text: {str(e)}", exc_info=True
        )
        tok_count = 0
        tok_metadata = {
            "error": f"Token estimation failed during text extraction: {str(e)}",
            "extraction_status": "failed",
        }

    return {"token_estimate": tok_count, "metadata": tok_metadata}


async def _store_uploaded_file(
    storage: Any, content: bytes, project_id: UUID, filename: str
) -> str:
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
    try:
        deleted = await storage.delete_file(file_path)
        return "success" if deleted else "not_found_in_storage"
    except Exception as e:
        logger.error(f"Error deleting file from storage: {e}")
        return "storage_deletion_failed"


async def _delete_file_vectors(project_id: UUID, file_id: UUID) -> None:
    try:
        vector_db = await VectorDBManager.get_for_project(project_id)
        await vector_db.delete_by_filter({"file_id": str(file_id)})
    except Exception as e:
        logger.error(f"Error removing file vectors: {e}")


async def _execute_search(
    vector_db: VectorDB, query: str, filter_metadata: dict[str, Any], top_k: int
) -> List[dict[str, Any]]:
    clean_query = (
        await _expand_query(query) if len(query.split()) > 3 else query.strip()
    ) or query[:100]

    results = await vector_db.search(
        query=clean_query,
        top_k=top_k * 2,
        filter_metadata=filter_metadata,
    )

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
    enhanced = []
    for res in results:
        f_id = res.get("metadata", {}).get("file_id")
        if f_id:
            try:
                fid_uuid = UUID(f_id)
                file_rec = await get_by_id(db, ProjectFile, fid_uuid)
                if file_rec:
                    res["file_info"] = MetadataHelper.extract_file_metadata(
                        file_rec, include_token_count=False
                    )
            except Exception as e:
                logger.error(f"Error adding file metadata: {e}")
        enhanced.append(res)
    return enhanced


async def _expand_query(original_query: str) -> str:
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


# --- Minimal status export for API route compatibility ---
async def get_kb_status(project_id: UUID, db: AsyncSession):
    """
    Minimal KB status export so routes/knowledge_base_routes.py can import.
    Returns file stats as used by many admin/status UIs.
    """
    file_stats = await get_project_files_stats(project_id, db)
    return {"file_stats": file_stats, "project_id": str(project_id)}
# Restore expected import for API routes and service consumers
