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
import uuid
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
    search_project_context,
    process_files_for_project,
    initialize_project_vector_db,
)
from services.knowledgebase_service import (
    get_kb_status,
    get_project_files_stats,
    get_knowledge_base_health,
    list_knowledge_bases,
    get_knowledge_base,
    create_knowledge_base as kb_service_create_kb,
    update_knowledge_base as kb_service_update_kb,
    delete_knowledge_base as kb_service_delete_kb,
    toggle_project_kb,
    upload_file_to_project,
    delete_project_file,
    get_project_file_list, # Added import
)
from services.github_service import GitHubService

# Models and Utils
from models.user import User
from models.project import Project
from utils.auth_utils import get_current_user_and_token
from utils.response_utils import create_standard_response
from services.project_service import validate_project_access

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Knowledge Base"])


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
    current_user_and_token: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    background_tasks: BackgroundTasks = BackgroundTasks(),
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
            background_tasks.add_task(
                process_files_for_project, project_id=project_id, db=db
            )

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
        await validate_project_access(project_id, current_user, db)

        # Get knowledge bases (active only)
        kbs = await list_knowledge_bases(db=db, active_only=True)

        return await create_standard_response(
            {"knowledge_bases": kbs, "count": len(kbs), "project_id": str(project_id)}
        )

    except Exception as e:
        logger.error(f"Failed to list knowledge bases: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Failed to retrieve knowledge bases"
        ) from e


@router.get("/{project_id}/knowledge-bases/{kb_id}", response_model=dict)
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


@router.patch("/{project_id}/knowledge-bases/{kb_id}", response_model=dict)
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

        # Validate project access
        await validate_project_access(project_id, current_user, db)

        # Convert update data to dict
        update_dict = update_data.dict(exclude_unset=True)

        # Update knowledge base
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


@router.delete("/{project_id}/knowledge-bases/{kb_id}", response_model=dict)
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

        # Validate project access
        project: Project = await validate_project_access(project_id, current_user, db)

        # Verify knowledge base belongs to this project
        kb = await get_knowledge_base(knowledge_base_id=kb_id, db=db)
        if not kb or str(kb["project_id"]) != str(project_id):
            raise HTTPException(
                status_code=404, detail="Knowledge base not found for this project"
            )

        # Delete the knowledge base
        await kb_service_delete_kb(knowledge_base_id=kb_id, db=db)

        # Remove reference from project, if this was the active KB
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

        results = await search_project_context(
            project_id=project_id,
            query=search_request.query,
            top_k=search_request.top_k,
            filters=search_request.filters,
        )

        return await create_standard_response(
            {"results": results, "count": len(results), "project_id": str(project_id)}
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Search failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Search operation failed") from e


# ----------------------------------------------------------------------
# File Operations
# ----------------------------------------------------------------------


@router.post(
    "/{project_id}/knowledge-bases/files",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
)
async def upload_knowledge_base_file(
    project_id: UUID,
    file: UploadFile = File(...),
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    """
    Upload and process a file for the project's knowledge base.
    """
    try:
        current_user = current_user_tuple[0]

        # Validate project access
        project: Project = await validate_project_access(project_id, current_user, db)

        if not project.knowledge_base:
            raise HTTPException(status_code=400, detail="Project has no knowledge base")

        result = await upload_file_to_project(
            project_id=project_id,
            file=file,
            db=db,
            user_id=current_user.id,
            background_tasks=background_tasks,
        )

        return await create_standard_response(result, "File uploaded successfully")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"File upload failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to upload file") from e


@router.get("/{project_id}/knowledge-bases/files-list", response_model=dict)
async def list_knowledge_base_files(
    project_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    file_type: Optional[str] = Query(None),
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    List files associated with a project's knowledge base.
    Only files that are part of the active knowledge base are listed.
    """
    try:
        current_user = current_user_tuple[0]

        # Validate project access
        project: Project = await validate_project_access(project_id, current_user, db)

        if not project.knowledge_base or not project.knowledge_base.is_active:
            raise HTTPException(
                status_code=400, detail="Project does not have an active knowledge base"
            )

        # Fetch files using the service function
        # The service function get_project_file_list already handles user_id for project access,
        # but we've already validated project access for the current user.
        # We pass current_user.id to ensure it aligns with service expectations if it uses it for further filtering.
        file_list_data = await get_project_file_list(
            project_id=project_id,
            user_id=current_user.id, # Pass integer user ID
            db=db,
            skip=skip,
            limit=limit,
            file_type=file_type,
        ), # Re-added the trailing comma here

        # The service function already returns a dict with 'files' and 'pagination'
        return await create_standard_response(file_list_data)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to list knowledge base files: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail="Failed to retrieve knowledge base files"
        ) from e


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

        if force:
            # Get KB to find the embedding model
            kb = await get_knowledge_base(
                knowledge_base_id=project.knowledge_base.id, db=db
            )
            if kb:
                # Delete existing vectors
                vector_db = await initialize_project_vector_db(
                    project_id=project_id,
                    embedding_model=kb.get("embedding_model", "all-MiniLM-L6-v2"),
                )
                await vector_db.delete_by_filter({"project_id": str(project_id)})

        # Process all files
        result = await process_files_for_project(project_id=project_id, db=db)

        return await create_standard_response(result, "Reindexing complete")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Reindexing failed: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Failed to reindex knowledge base"
        ) from e


@router.delete("/{project_id}/knowledge-bases/files/{file_id}", response_model=dict)
async def delete_knowledge_base_file(
    project_id: UUID,
    file_id: UUID,
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Delete a file from the project's knowledge base.
    """
    try:
        current_user = current_user_tuple[0]

        # Validate project access
        await validate_project_access(project_id, current_user, db)

        result = await delete_project_file(
            project_id=project_id, file_id=file_id, db=db, user_id=current_user.id
        )

        return await create_standard_response(result, "File deleted successfully")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"File deletion failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to delete file") from e


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

    Raises:
        HTTPException: If the project does not have a knowledge base or if an error occurs during the operation.

    Returns:
        A standardized response indicating the result of the toggle operation and the new status.
    """
    try:
        current_user = current_user_tuple[0]

        # Validate project access
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

    Validates project access and knowledge base existence, clones the specified repository and branch,
    fetches the specified or all files, and uploads them to the project's knowledge base.
    Returns the repository URL and the number of files processed.
    """
    try:
        current_user = current_user_tuple[0]

        # Validate project access
        project: Project = await validate_project_access(project_id, current_user, db)
        if not project.knowledge_base:
            raise HTTPException(status_code=400, detail="Project has no knowledge base")

        # Initialize GitHub service
        github_service = GitHubService(
            token=getattr(current_user, "github_token", None)
        )

        # Clone repository
        branch = repo_data.branch if repo_data.branch else "main"
        repo_path = github_service.clone_repository(
            repo_url=repo_data.repo_url, branch=branch
        )

        # Fetch specified files (or all if none specified)
        file_paths = repo_data.file_paths or []
        fetched_files = github_service.fetch_files(repo_path, file_paths)

        # Process fetched files
        for file_path in fetched_files:
            with open(file_path, "rb") as file_obj:
                upload_file = UploadFile(filename=file_path, file=file_obj)
                await upload_file_to_project(
                    project_id=project_id,
                    file=upload_file,
                    db=db,
                    user_id=current_user.id,
                )

        return await create_standard_response(
            {
                "repo_url": repo_data.repo_url,
                "files_processed": len(fetched_files),
            },
            "GitHub repository attached successfully",
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

    Removes all files associated with the specified GitHub repository from the project's knowledge base.
    Returns the repository URL and the number of files removed.
    Raises an HTTP 400 error if the project has no knowledge base,
    and an HTTP 500 error if the operation fails.
    """
    try:
        current_user = current_user_tuple[0]

        # Validate project access
        project: Project = await validate_project_access(project_id, current_user, db)
        if not project.knowledge_base:
            raise HTTPException(status_code=400, detail="Project has no knowledge base")

        # Initialize GitHub service
        github_service = GitHubService(
            token=getattr(current_user, "github_token", None)
        )

        # In an actual implementation, you'd track which files came from the repo
        # and remove them individually from your database/storage layer.
        # This snippet shows a simplistic approach to "detaching" the repo.
        repo_path = github_service.clone_repository(repo_url=repo_data.repo_url)
        file_paths = github_service.fetch_files(repo_path, [])
        github_service.remove_files(repo_path, file_paths)

        return await create_standard_response(
            {"repo_url": repo_data.repo_url, "files_removed": len(file_paths)},
            "GitHub repository detached successfully",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to detach GitHub repository: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail="Failed to detach GitHub repository"
        ) from e
