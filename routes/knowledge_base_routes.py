"""
knowledge_base_routes.py
------------------------
Consolidated routes for knowledge base management with improved:

1. Unified endpoints
2. Standardized error handling
3. Consistent response formats
4. Project-scoped validation
"""

import logging
from uuid import UUID
from typing import Any, Optional, Dict, List

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
    Body,
    UploadFile,
    File,
    BackgroundTasks,
    Query,
)
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

# Database Dependency
from db import get_async_session

# Services
from services.vector_db import (
    process_files_for_project,
    initialize_project_vector_db,
)
from services.knowledgebase_service import (
    search_project_context,  # ← NEW: canonical location
    get_kb_status,
    get_project_files_stats,
    get_knowledge_base_health,
    get_knowledge_base,
    create_knowledge_base as kb_service_create_kb,
    update_knowledge_base as kb_service_update_kb,
    delete_knowledge_base as kb_service_delete_kb,
    toggle_project_kb,
    attach_github_repository as kb_attach_repository,
    detach_github_repository as kb_detach_repository,
)

# Models and Utils
from models.project import Project
from utils.auth_utils import get_current_user_and_token
from utils.response_utils import create_standard_response
from services.project_service import validate_project_access
from utils.serializers import serialize_knowledge_base

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Knowledge Base"])

# ----------------------------------------------------------------------
# KB Readiness / Health Endpoint
# ----------------------------------------------------------------------

from services.kb_readiness_service import KBReadinessService  # noqa: E402  – after router creation


@router.get("/health/{project_id}", response_model=dict)
async def get_kb_health_status(
    project_id: UUID,
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Return a fast readiness / health status for the KB of *project_id*."""

    # We purposely do **not** require a DB dependency because the readiness
    # service internally opens its own short-lived session on cache miss.
    current_user, _ = current_user_tuple

    # Optional: access validation – reuse existing validator so that users
    # cannot probe readiness of projects they cannot see.
    # Re-use existing validator to ensure user may see this project.
    await validate_project_access(project_id, current_user, db)

    readiness_service = KBReadinessService.get_instance()
    status = await readiness_service.check_project_readiness(project_id)

    return {
        "available": status.available,
        "reason": status.reason,
        "fallback_available": status.fallback_available,
        "missing_dependencies": status.missing_dependencies,
    }


# ----------------------------------------------------------------------
# Pydantic Schemas
# ----------------------------------------------------------------------


class KnowledgeBaseCreate(BaseModel):
    """Schema for creating a new knowledge base"""

    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    embedding_model: str = Field(
        default="all-MiniLM-L6-v2", description="Embedding model to use"
    )
    process_existing_files: bool = Field(
        True, description="Process existing files for search"
    )


class KnowledgeBaseUpdate(BaseModel):
    """Schema for updating an existing knowledge base"""

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    embedding_model: Optional[str] = None
    is_active: Optional[bool] = None


class SearchRequest(BaseModel):
    """Schema for searching the knowledge base"""

    query: str = Field(..., min_length=1)
    top_k: int = Field(5, ge=1, le=20)
    filters: Optional[Dict[str, Any]] = None


class GitHubRepoAttach(BaseModel):
    """Schema for attaching a GitHub repository"""

    repo_url: str = Field(..., description="GitHub repository URL")
    branch: Optional[str] = Field("main", description="Branch to use")
    file_paths: Optional[List[str]] = Field(
        None, description="Specific file paths to include"
    )


class GitHubRepoDetach(BaseModel):
    """Schema for detaching a GitHub repository"""

    repo_url: str = Field(..., description="GitHub repository URL")


# ----------------------------------------------------------------------
# Knowledge Base CRUD Operations
# ----------------------------------------------------------------------


@router.post(
    "/{project_id}/knowledge-bases",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
)
async def create_project_knowledge_base(
    project_id: UUID,
    kb_data: KnowledgeBaseCreate,
    background_tasks: BackgroundTasks,
    current_user_and_token: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Create a new knowledge base for a project and optionally process
    existing files in the background.
    """
    try:
        # Unpack current_user from the tuple
        current_user = current_user_and_token[0]

        # Validate project access
        project: Project = await validate_project_access(project_id, current_user, db)

        if project.knowledge_base:
            raise HTTPException(
                status_code=400, detail="Project already has a knowledge base"
            )

        # Create knowledge base using service
        kb = await kb_service_create_kb(
            name=kb_data.name,
            project_id=project_id,
            description=kb_data.description,
            embedding_model=kb_data.embedding_model,
            db=db,
        )

        # After creating the KB, refresh the project to see the new relationship
        await db.refresh(project)

        result = {
            "knowledge_base": {
                "id": str(kb.id),
                "name": kb.name,
                "description": kb.description,
                "embedding_model": kb.embedding_model,
                "is_active": kb.is_active,
                "status": "active",
            },
            "files_processed": kb_data.process_existing_files,
        }

        # If requested, process existing files in a background task
        if kb_data.process_existing_files:
            file_stats = await get_project_files_stats(project_id, db)
            result["file_stats"] = file_stats
            # process_files_for_project opens its own DB session when no
            # session is supplied – safe for background tasks.
            background_tasks.add_task(process_files_for_project, project_id=project_id)

        return await create_standard_response(
            result, "Knowledge base created successfully"
        )

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Knowledge base creation failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail="Failed to create knowledge base"
        ) from e


@router.get("/{project_id}/knowledge-bases", response_model=dict)
async def get_project_knowledge_bases(
    project_id: UUID,
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Retrieve all active knowledge bases associated with a project.
    """
    try:
        current_user = current_user_tuple[0]

        # Validate project access
        project: Project = await validate_project_access(project_id, current_user, db)

        kb = (
            project.knowledge_base
            if project and project.knowledge_base and project.knowledge_base.is_active
            else None
        )
        kbs = [serialize_knowledge_base(kb)] if kb else []

        return await create_standard_response(
            {"knowledge_bases": kbs, "count": len(kbs), "project_id": str(project_id)}
        )

    except Exception as e:
        logger.error(f"Failed to list knowledge bases: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Failed to retrieve knowledge bases"
        ) from e


# ----------------------------------------------------------------------
# Knowledge Base Status & Health
# ----------------------------------------------------------------------


@router.get("/{project_id}/knowledge-bases/status", response_model=dict)
async def get_knowledge_base_status(
    project_id: UUID,
    detailed: bool = Query(False, description="Include detailed status"),
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Retrieve basic or detailed status information about a project's KB.
    """
    try:
        current_user = current_user_tuple[0]

        # Validate project access
        project: Project = await validate_project_access(project_id, current_user, db)

        if not project.knowledge_base:
            raise HTTPException(status_code=404, detail="Project has no knowledge base")

        # Get basic status
        status_data = await get_kb_status(project_id, db)

        if not detailed:
            return await create_standard_response(status_data)

        # Detailed status includes KB health and file stats
        kb_health = await get_knowledge_base_health(
            knowledge_base_id=project.knowledge_base.id, db=db
        )
        file_stats = await get_project_files_stats(project_id, db)

        return await create_standard_response(
            {**status_data, **kb_health, "files": file_stats}
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get knowledge base status: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Failed to retrieve knowledge base status"
        ) from e


# ----------------------------------------------------------------------
# Search Operations
# ----------------------------------------------------------------------


@router.post("/{project_id}/knowledge-bases/search", response_model=dict)
async def search_project_knowledge(
    project_id: UUID,
    search_request: SearchRequest,
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Search a project's knowledge base by query.
    """
    try:
        current_user = current_user_tuple[0]

        # Validate project access
        project: Project = await validate_project_access(project_id, current_user, db)

        if not project.knowledge_base:
            raise HTTPException(status_code=400, detail="Project has no knowledge base")

        search_data = await search_project_context(
            project_id=project_id,
            query=search_request.query,
            top_k=search_request.top_k,
            filters=search_request.filters,
            db=db,  # Added the db parameter that was missing
        )

        return await create_standard_response(search_data, "Search completed")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Search failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Search operation failed") from e


# ----------------------------------------------------------------------
# File Operations
# ----------------------------------------------------------------------


# NOTE: This endpoint is a deliberate permanent redirect to the canonical file upload endpoint.
# It must not contain any business logic—only the redirect.
@router.post(
    "/{project_id}/knowledge-bases/files",
    response_model=dict,
    status_code=status.HTTP_308_PERMANENT_REDIRECT,
)
async def upload_knowledge_base_file_redirect(
    project_id: UUID,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    DEPRECATED: Use POST /projects/{project_id}/files?index_kb=true instead.

    This endpoint returns a permanent redirect to the canonical file upload endpoint.
    """
    from fastapi.responses import RedirectResponse

    # Return permanent redirect to canonical endpoint with KB indexing enabled
    redirect_url = f"/projects/{project_id}/files?index_kb=true"
    return RedirectResponse(
        url=redirect_url,
        status_code=status.HTTP_308_PERMANENT_REDIRECT,
        headers={"Location": redirect_url},
    )


# NOTE: This endpoint is a deliberate permanent redirect to the canonical file listing endpoint.
# It must not contain any business logic—only the redirect.
@router.get(
    "/{project_id}/knowledge-bases/files-list",
    response_model=dict,
    status_code=status.HTTP_308_PERMANENT_REDIRECT,
)
async def list_knowledge_base_files_redirect(
    project_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    file_type: Optional[str] = Query(None),
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    DEPRECATED: Use GET /projects/{project_id}/files instead.

    This endpoint returns a permanent redirect to the canonical file listing endpoint.
    """
    from fastapi.responses import RedirectResponse

    # Build redirect URL with query parameters
    redirect_url = f"/projects/{project_id}/files?skip={skip}&limit={limit}"
    if file_type:
        redirect_url += f"&file_type={file_type}"

    return RedirectResponse(
        url=redirect_url,
        status_code=status.HTTP_308_PERMANENT_REDIRECT,
        headers={"Location": redirect_url},
    )


@router.post("/{project_id}/knowledge-bases/reindex", response_model=dict)
async def reindex_knowledge_base(
    project_id: UUID,
    force: bool = Body(False, embed=True),
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Reindex all files for a project's knowledge base. Optionally, set `force=True`
    to delete existing vectors before reindexing.
    """
    try:
        current_user = current_user_tuple[0]

        # Validate project access
        project: Project = await validate_project_access(project_id, current_user, db)

        if not project.knowledge_base:
            raise HTTPException(status_code=400, detail="Project has no knowledge base")

        from services.knowledgebase_service import reindex_project_kb

        result = await reindex_project_kb(
            project_id=project_id, force=force, db=db
        )

        return await create_standard_response(result, "Reindexing complete")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Reindexing failed: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Failed to reindex knowledge base"
        ) from e


# NOTE: This endpoint is a deliberate permanent redirect to the canonical file deletion endpoint.
# It must not contain any business logic—only the redirect.
@router.delete(
    "/{project_id}/knowledge-bases/files/{file_id}",
    response_model=dict,
    status_code=status.HTTP_308_PERMANENT_REDIRECT,
)
async def delete_knowledge_base_file_redirect(
    project_id: UUID,
    file_id: UUID,
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    DEPRECATED: Use DELETE /projects/{project_id}/files/{file_id} instead.

    This endpoint returns a permanent redirect to the canonical file deletion endpoint.
    """
    from fastapi.responses import RedirectResponse

    # Return permanent redirect to canonical endpoint
    redirect_url = f"/projects/{project_id}/files/{file_id}"
    return RedirectResponse(
        url=redirect_url,
        status_code=status.HTTP_308_PERMANENT_REDIRECT,
        headers={"Location": redirect_url},
    )


# ----------------------------------------------------------------------
# Knowledge Base Toggle
# ----------------------------------------------------------------------


@router.post("/{project_id}/knowledge-bases/toggle", response_model=dict)
async def toggle_knowledge_base(
    project_id: UUID,
    enable: bool = Body(..., embed=True),
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Enables or disables the knowledge base for a specified project.
    """
    try:
        current_user = current_user_tuple[0]
        project: Project = await validate_project_access(project_id, current_user, db)

        if not project.knowledge_base:
            raise HTTPException(status_code=400, detail="Project has no knowledge base")

        result = await toggle_project_kb(
            project_id=project_id, enable=enable, user_id=current_user.id, db=db
        )

        return await create_standard_response(
            result, f"Knowledge base {'enabled' if enable else 'disabled'}"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to toggle knowledge base: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Failed to toggle knowledge base"
        ) from e


# ----------------------------------------------------------------------
# GitHub Repository Operations
# ----------------------------------------------------------------------


@router.post("/{project_id}/knowledge-bases/github/attach", response_model=dict)
async def attach_github_repository(
    project_id: UUID,
    repo_data: GitHubRepoAttach,
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Attaches a GitHub repository as a data source for a project's knowledge base.
    """
    try:
        current_user = current_user_tuple[0]
        # Validate project access
        await validate_project_access(project_id, current_user, db)

        result = await kb_attach_repository(
            project_id=project_id,
            repo_url=repo_data.repo_url,
            db=db,
            branch=repo_data.branch or "main",
            file_paths=repo_data.file_paths,
            user_id=current_user.id,
        )

        return await create_standard_response(
            result, "GitHub repository attached successfully"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to attach GitHub repository: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail="Failed to attach GitHub repository"
        ) from e


@router.post("/{project_id}/knowledge-bases/github/detach", response_model=dict)
async def detach_github_repository(
    project_id: UUID,
    repo_data: GitHubRepoDetach,
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Detaches a GitHub repository from a project's knowledge base and removes its files.
    """
    try:
        current_user = current_user_tuple[0]
        # Validate project access
        await validate_project_access(project_id, current_user, db)

        result = await kb_detach_repository(
            project_id=project_id,
            repo_url=repo_data.repo_url,
            db=db,
            user_id=current_user.id,
        )

        return await create_standard_response(
            result, "GitHub repository detached successfully"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to detach GitHub repository: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail="Failed to detach GitHub repository"
        ) from e


# ----------------------------------------------------------------------
# Dynamic {kb_id:uuid} Routes Moved Below
# ----------------------------------------------------------------------


@router.get("/{project_id}/knowledge-bases/{kb_id:uuid}", response_model=dict)
async def get_project_knowledge_base(
    project_id: UUID,
    kb_id: UUID,
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Get details for a specific knowledge base under a project.
    """
    try:
        current_user = current_user_tuple[0]

        # Validate project access
        await validate_project_access(project_id, current_user, db)

        kb = await get_knowledge_base(knowledge_base_id=kb_id, db=db)
        if not kb or str(kb["project_id"]) != str(project_id):
            raise HTTPException(
                status_code=404, detail="Knowledge base not found for this project"
            )

        return await create_standard_response(kb)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get knowledge base: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Failed to retrieve knowledge base"
        ) from e


@router.patch("/{project_id}/knowledge-bases/{kb_id:uuid}", response_model=dict)
async def update_knowledge_base(
    project_id: UUID,
    kb_id: UUID,
    update_data: KnowledgeBaseUpdate,
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Update an existing knowledge base.
    """
    try:
        current_user = current_user_tuple[0]

        await validate_project_access(project_id, current_user, db)
        update_dict = update_data.dict(exclude_unset=True)
        kb = await kb_service_update_kb(
            knowledge_base_id=kb_id, update_data=update_dict, db=db
        )

        if not kb or str(kb["project_id"]) != str(project_id):
            raise HTTPException(
                status_code=404, detail="Knowledge base not found for this project"
            )

        return await create_standard_response(kb, "Knowledge base updated successfully")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update knowledge base: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Failed to update knowledge base"
        ) from e


@router.delete("/{project_id}/knowledge-bases/{kb_id:uuid}", response_model=dict)
async def delete_knowledge_base(
    project_id: UUID,
    kb_id: UUID,
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Delete a knowledge base from a project.
    """
    try:
        current_user = current_user_tuple[0]
        project: Project = await validate_project_access(project_id, current_user, db)

        kb = await get_knowledge_base(knowledge_base_id=kb_id, db=db)
        if not kb or str(kb["project_id"]) != str(project_id):
            raise HTTPException(
                status_code=404, detail="Knowledge base not found for this project"
            )

        await kb_service_delete_kb(knowledge_base_id=kb_id, db=db)

        if project.knowledge_base and str(project.knowledge_base.id) == str(kb_id):
            project.knowledge_base = None
            await db.commit()

        return await create_standard_response(
            {"deleted_id": str(kb_id)}, "Knowledge base deleted successfully"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete knowledge base: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Failed to delete knowledge base"
        ) from e
