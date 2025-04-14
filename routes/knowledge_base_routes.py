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
from typing import Dict, Any, Optional
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
    Body,
    UploadFile,
    File,
    BackgroundTasks,
    Query
)
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
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
)

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
        default="all-MiniLM-L6-v2",
        description="Embedding model to use"
    )
    process_existing_files: bool = Field(
        True,
        description="Process existing files for search"
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

# ----------------------------------------------------------------------
# Knowledge Base CRUD Operations
# ----------------------------------------------------------------------

@router.post(
    "/projects/{project_id}/knowledge-bases",
    response_model=Dict,
    status_code=status.HTTP_201_CREATED
)
async def create_project_knowledge_base(
    project_id: UUID,
    kb_data: KnowledgeBaseCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    """Create a new knowledge base and optionally process existing files"""
    try:
        # Validate project access
        project: Project = await validate_project_access(project_id, current_user, db)

        if project.knowledge_base_id:
            raise HTTPException(
                status_code=400,
                detail="Project already has a knowledge base"
            )

        # Create knowledge base using service
        kb = await kb_service_create_kb(
            name=kb_data.name,
            project_id=project_id,
            description=kb_data.description,
            embedding_model=kb_data.embedding_model,
            db=db
        )

        # Associate with project
        import uuid
        project.knowledge_base_id = uuid.UUID(str(kb["id"]))
        await db.commit()

        result = {
            "knowledge_base": {
                "id": str(kb.id),
                "name": kb.name,
                "description": kb.description,
                "embedding_model": kb.embedding_model,
                "is_active": kb.is_active,
                "status": "active"
            },
            "files_processed": kb_data.process_existing_files
        }

        # Process existing files if requested
        if kb_data.process_existing_files:
            file_stats = await get_project_files_stats(project_id, db)
            result["file_stats"] = file_stats
            background_tasks.add_task(
                process_files_for_project,
                project_id=project_id,
                db=db
            )

        return await create_standard_response(result, "Knowledge base created successfully")

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Knowledge base creation failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to create knowledge base"
        ) from e

@router.get("/projects/{project_id}/knowledge-bases", response_model=Dict)
async def get_project_knowledge_bases(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Get knowledge bases associated with a project"""
    try:
        # Validate project access
        await validate_project_access(project_id, current_user, db)

        # Get knowledge bases for project
        kbs = await list_knowledge_bases(
            db=db,
            active_only=True
        )

        return await create_standard_response({
            "knowledge_bases": kbs,
            "count": len(kbs),
            "project_id": str(project_id)
        })

    except Exception as e:
        logger.error(f"Failed to list knowledge bases: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to retrieve knowledge bases"
        )

@router.get("/projects/{project_id}/knowledge-bases/{kb_id}", response_model=Dict)
async def get_project_knowledge_base(
    project_id: UUID,
    kb_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Get details for a specific knowledge base"""
    try:
        # Validate project access
        await validate_project_access(project_id, current_user, db)

        # Get knowledge base
        kb = await get_knowledge_base(knowledge_base_id=kb_id, db=db)

        if not kb or str(kb["project_id"]) != str(project_id):
            raise HTTPException(
                status_code=404,
                detail="Knowledge base not found for this project"
            )

        return await create_standard_response(kb)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get knowledge base: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to retrieve knowledge base"
        )

@router.patch("/projects/{project_id}/knowledge-bases/{kb_id}", response_model=Dict)
async def update_knowledge_base(
    project_id: UUID,
    kb_id: UUID,
    update_data: KnowledgeBaseUpdate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Update a knowledge base"""
    try:
        # Validate project access
        await validate_project_access(project_id, current_user, db)

        # Convert to dict for service
        update_dict = update_data.dict(exclude_unset=True)

        # Update using service
        kb = await kb_service_update_kb(
            knowledge_base_id=kb_id,
            update_data=update_dict,
            db=db
        )

        if not kb or str(kb["project_id"]) != str(project_id):
            raise HTTPException(
                status_code=404,
                detail="Knowledge base not found for this project"
            )

        return await create_standard_response(
            kb,
            "Knowledge base updated successfully"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update knowledge base: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to update knowledge base"
        )

@router.delete("/projects/{project_id}/knowledge-bases/{kb_id}", response_model=Dict)
async def delete_knowledge_base(
    project_id: UUID,
    kb_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Delete a knowledge base"""
    try:
        # Validate project access
        project: Project = await validate_project_access(project_id, current_user, db)

        # Get KB to verify it belongs to project
        kb = await get_knowledge_base(knowledge_base_id=kb_id, db=db)
        if not kb or str(kb["project_id"]) != str(project_id):
            raise HTTPException(
                status_code=404,
                detail="Knowledge base not found for this project"
            )

        # Delete using service
        await kb_service_delete_kb(
            knowledge_base_id=kb_id,
            db=db
        )

        # Remove reference from project
        if str(project.knowledge_base_id) == str(kb_id):
            project.knowledge_base_id = None
            await db.commit()

        return await create_standard_response(
            {"deleted_id": str(kb_id)},
            "Knowledge base deleted successfully"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete knowledge base: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to delete knowledge base"
        )

# ----------------------------------------------------------------------
# Knowledge Base Status & Health
# ----------------------------------------------------------------------

@router.get("/projects/{project_id}/knowledge-bases/status", response_model=Dict)
async def get_knowledge_base_status(
    project_id: UUID,
    detailed: bool = Query(False, description="Include detailed status"),
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Get knowledge base status (basic or detailed)"""
    try:
        # Validate project access
        project: Project = await validate_project_access(project_id, current_user, db)

        if not project.knowledge_base_id:
            raise HTTPException(
                status_code=404,
                detail="Project has no knowledge base"
            )

        # Get basic status
        status_data = await get_kb_status(project_id, db)

        if not detailed:
            return await create_standard_response(status_data)

        # Get detailed status
        kb_health = await get_knowledge_base_health(
            knowledge_base_id=project.knowledge_base_id,
            db=db
        )

        file_stats = await get_project_files_stats(project_id, db)

        return await create_standard_response({
            **status_data,
            **kb_health,
            "files": file_stats
        })

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get knowledge base status: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to retrieve knowledge base status"
        )

# ----------------------------------------------------------------------
# Search Operations
# ----------------------------------------------------------------------

@router.post("/projects/{project_id}/knowledge-bases/search", response_model=Dict)
async def search_project_knowledge(
    project_id: UUID,
    search_request: SearchRequest,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Search a project's knowledge base"""
    try:
        # Validate project access
        project: Project = await validate_project_access(project_id, current_user, db)

        if not project.knowledge_base_id:
            raise HTTPException(
                status_code=400,
                detail="Project has no knowledge base"
            )

        results = await search_project_context(
            project_id=project_id,
            query=search_request.query,
            top_k=search_request.top_k,
            filters=search_request.filters
        )

        return await create_standard_response({
            "results": results,
            "count": len(results),
            "project_id": str(project_id)
        })

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Search failed: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Search operation failed"
        )

# ----------------------------------------------------------------------
# File Operations
# ----------------------------------------------------------------------

@router.post(
    "/projects/{project_id}/knowledge-bases/files",
    response_model=Dict,
    status_code=status.HTTP_201_CREATED
)
async def upload_knowledge_base_file(
    project_id: UUID,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    """Upload and process a file for the knowledge base"""
    try:
        # Validate project access
        project: Project = await validate_project_access(project_id, current_user, db)

        if not project.knowledge_base_id:
            raise HTTPException(
                status_code=400,
                detail="Project has no knowledge base"
            )

        result = await upload_file_to_project(
            project_id=project_id,
            file=file,
            db=db,
            user_id=current_user.id,
            background_tasks=background_tasks
        )

        return await create_standard_response(
            result,
            "File uploaded successfully"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"File upload failed: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to upload file"
        )

@router.post(
    "/projects/{project_id}/knowledge-bases/reindex",
    response_model=Dict
)
async def reindex_knowledge_base(
    project_id: UUID,
    force: bool = Body(False, embed=True),
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Reindex all files for a project's knowledge base
    Optional 'force' parameter to delete existing vectors first
    """
    try:
        # Validate project access
        project: Project = await validate_project_access(project_id, current_user, db)

        if not project.knowledge_base_id:
            raise HTTPException(
                status_code=400,
                detail="Project has no knowledge base"
            )

        if force:
            # Get KB to find embedding model
            kb = await get_knowledge_base(
                knowledge_base_id=project.knowledge_base_id,
                db=db
            )

            if kb:
                # Delete existing vectors
                vector_db = await initialize_project_vector_db(
                    project_id=project_id,
                    embedding_model=kb.get("embedding_model", "all-MiniLM-L6-v2")
                )
                await vector_db.delete_by_filter({"project_id": str(project_id)})

        # Process all files
        result = await process_files_for_project(
            project_id=project_id,
            db=db
        )

        return await create_standard_response(
            result,
            "Reindexing complete"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Reindexing failed: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to reindex knowledge base"
        )

@router.delete(
    "/projects/{project_id}/knowledge-bases/files/{file_id}",
    response_model=Dict
)
async def delete_knowledge_base_file(
    project_id: UUID,
    file_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Delete a file from the knowledge base"""
    try:
        # Validate project access
        await validate_project_access(project_id, current_user, db)

        result = await delete_project_file(
            project_id=project_id,
            file_id=file_id,
            db=db,
            user_id=current_user.id
        )

        return await create_standard_response(
            result,
            "File deleted successfully"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"File deletion failed: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to delete file"
        )

# ----------------------------------------------------------------------
# Knowledge Base Toggle
# ----------------------------------------------------------------------

@router.post(
    "/projects/{project_id}/knowledge-bases/toggle",
    response_model=Dict
)
async def toggle_knowledge_base(
    project_id: UUID,
    enable: bool = Body(..., embed=True),
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Enable or disable knowledge base for a project"""
    try:
        # Validate project access
        project: Project = await validate_project_access(project_id, current_user, db)

        if not project.knowledge_base_id:
            raise HTTPException(
                status_code=400,
                detail="Project has no knowledge base"
            )

        result = await toggle_project_kb(
            project_id=project_id,
            enable=enable,
            user_id=current_user.id,
            db=db
        )

        return await create_standard_response(
            result,
            f"Knowledge base {'enabled' if enable else 'disabled'}"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to toggle knowledge base: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to toggle knowledge base"
        )
