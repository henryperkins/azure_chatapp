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
    VectorDBManager,  # ← NEW (re-uses shared impl)
    MetadataHelper,  # ← NEW (re-uses shared impl)
)
from services.project_service import (
    check_knowledge_base_status as get_project_files_stats,
    validate_project_access,
)  # Unified export for all code that expects file & chunk stats APIs
from services.file_service import FileService

from fastapi import (
    HTTPException,
    UploadFile,
    BackgroundTasks,
)  # pylint: disable=no-name-in-module,import-error
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import SQLAlchemyError
from functools import wraps
from db import get_async_session_context

from sqlalchemy import select, func
from utils.serializers import (
    serialize_knowledge_base,
    serialize_project_file,
)

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


# TODO-deduplicate: this helper mostly duplicates project_service.validate_project_access.
# Replace calls with the shared version and delete this local copy.
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
    *,
    background_tasks: Optional[BackgroundTasks] = None,
) -> dict[str, Any]:
    # ── Unified validation (still enforces permission rules) ───────────
    await _validate_user_and_project(project_id, user_id, db)

    # ── Single-source-of-truth upload via FileService ──────────────────
    fs = FileService(db)
    return await fs.upload(
        project_id=project_id,
        file=file,
        user_id=user_id,            # FileService already validates this
        index_kb=True,              # KB uploads must always be indexed
        background_tasks=background_tasks,
    )


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

    token_count = file_record.config.get("token_count", 0) if file_record.config else 0

    from services.file_service import FileService
    fs = FileService(db, StorageManager.get())
    await fs.delete_file(project_id, file_id)

    if project.knowledge_base:
        await _delete_file_vectors(project_id, file_id, db)

    await TokenManager.update_usage(project, -token_count, db)

    return {
        "file_id": str(file_id),
        "deleted": True,
        "tokens_removed": token_count,
    }


@handle_service_errors("Error searching project context")
async def search_project_context(
    project_id: UUID,
    query: str,
    db: AsyncSession,
    top_k: int = 5,
    filters: dict[str, Any] | None = None,  # ← new
) -> dict[str, Any]:
    """
    Performs a semantic search against a project's knowledge base and returns relevant results.
    Accepts optional filters to further constrain the search.
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
    if filters:  # ← new
        filter_metadata.update(filters)

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
    project_id: UUID,
    user_id: Optional[int],
    db: AsyncSession,
) -> Project:
    """
    Wrapper kept for legacy callers – now delegates to the single-source-of-truth
    `validate_project_access` in services.project_service.
    """
    user = None
    if user_id is not None:
        user = await get_by_id(db, User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

    return await validate_project_access(
        project_id=project_id,
        user=user,
        db=db,
        skip_ownership_check=user is None,
    )


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






async def _delete_file_vectors(
    project_id: UUID, file_id: UUID, db: AsyncSession
) -> None:
    try:
        vector_db = await VectorDBManager.get_for_project(project_id, db=db)
        await vector_db.delete_by_filter({"file_id": str(file_id)})
    except Exception as e:
        logger.error(f"Error removing file vectors: {e}")


async def _execute_search(
    vector_db: VectorDB, query: str, filter_metadata: dict[str, Any], top_k: int
) -> List[dict[str, Any]]:
    clean_query = (
        await MetadataHelper.expand_query(query)
        if len(query.split()) > 3
        else query.strip()
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


# --- Minimal status export for API route compatibility ---
async def get_kb_status(project_id: UUID, db: AsyncSession):
    """
    Minimal KB status export so routes/knowledge_base_routes.py can import.
    Returns file stats as used by many admin/status UIs.
    """
    file_stats = await get_project_files_stats(project_id, db)
    return {"file_stats": file_stats, "project_id": str(project_id)}


# ──────────────────────────────────────────────────────────────
#  Public helpers consumed by routes/knowledge_base_routes.py
# ──────────────────────────────────────────────────────────────
async def get_knowledge_base(
    knowledge_base_id: UUID, db: AsyncSession
) -> dict[str, Any]:
    kb = await get_by_id(db, KnowledgeBase, knowledge_base_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    return serialize_knowledge_base(kb)


async def list_knowledge_bases(
    db: AsyncSession, active_only: bool = False
) -> list[dict[str, Any]]:
    stmt = select(KnowledgeBase)
    if active_only:
        stmt = stmt.where(KnowledgeBase.is_active.is_(True))
    result = await db.execute(stmt)
    return [serialize_knowledge_base(k) for k in result.scalars().all()]


async def update_knowledge_base(
    knowledge_base_id: UUID, update_data: dict[str, Any], db: AsyncSession
) -> dict[str, Any]:
    kb = await get_by_id(db, KnowledgeBase, knowledge_base_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    for k, v in update_data.items():
        if hasattr(kb, k):
            setattr(kb, k, v)
    await save_model(db, kb)
    return serialize_knowledge_base(kb)


async def delete_knowledge_base(
    knowledge_base_id: UUID, db: AsyncSession
) -> dict[str, Any]:
    kb = await get_by_id(db, KnowledgeBase, knowledge_base_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    await db.delete(kb)
    await db.commit()
    return {"deleted_id": str(knowledge_base_id)}


async def toggle_project_kb(
    project_id: UUID, enable: bool, user_id: Optional[int], db: AsyncSession
) -> dict[str, Any]:
    project = await _validate_user_and_project(project_id, user_id, db)
    if not project.knowledge_base:
        raise HTTPException(status_code=404, detail="Project has no knowledge base")
    project.knowledge_base.is_active = enable
    await save_model(db, project.knowledge_base)
    return {"knowledge_base_id": str(project.knowledge_base.id), "is_active": enable}


async def get_knowledge_base_health(
    knowledge_base_id: UUID, db: AsyncSession
) -> dict[str, Any]:
    kb = await get_by_id(db, KnowledgeBase, knowledge_base_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    vdb = await VectorDBManager.get_for_project(kb.project_id, db=db)
    stats = await vdb.get_stats()
    return {"knowledge_base_id": str(kb.id), "vector_db": stats}


async def get_project_file_list(
    project_id: UUID,
    user_id: Optional[int],
    db: AsyncSession,
    skip: int = 0,
    limit: int = 100,
    file_type: Optional[str] = None,
) -> dict[str, Any]:
    # Single-source permission check
    await _validate_user_and_project(project_id, user_id, db)

    fs = FileService(db)
    result = await fs.list_files(
        project_id=project_id,
        skip=skip,
        limit=limit,
        file_type=file_type,
    )
    return {
        "files": result["files"],
        "count": len(result["files"]),
        "total": result["total"],
    }


# Restore expected import for API routes and service consumers
