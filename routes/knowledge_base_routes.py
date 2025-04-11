"""
knowledge_base_routes.py
------------------------
Routes for managing knowledge bases and integrating them with AI.
Provides endpoints for creating knowledge bases, searching, and managing project files.
"""

import logging
from typing import Dict, Any, Optional
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
    Body,
    UploadFile,
    File,
    BackgroundTasks,
)
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_async_session
from models.user import User
from models.knowledge_base import KnowledgeBase
from utils.auth_utils import get_current_user_and_token
from utils.response_utils import create_standard_response
from services import knowledgebase_service
from services.vector_db import (
    search_project_context,
    process_files_for_project,
    initialize_project_vector_db,
)
from services.project_service import validate_project_access

logger = logging.getLogger(__name__)
router = APIRouter()

# ----------------------------------------------------------------------
# Pydantic Schemas
# ----------------------------------------------------------------------


class KnowledgeBaseCreate(BaseModel):
    """Schema for creating a new knowledge base."""

    name: str = Field(..., min_length=1, max_length=200)
    project_id: UUID = Field(
        ..., description="Project to associate with this knowledge base"
    )
    description: Optional[str] = None
    embedding_model: str = Field(
        default="all-MiniLM-L6-v2", description="Embedding model to use"
    )


class KnowledgeBaseUpdate(BaseModel):
    """Schema for updating an existing knowledge base."""

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    embedding_model: Optional[str] = None
    is_active: Optional[bool] = None


class ProjectKnowledgeBaseCreate(BaseModel):
    """Schema for creating a new knowledge base under a project."""

    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    embedding_model: Optional[str] = None
    process_existing_files: bool = Field(
        True, description="Process existing files for search"
    )


class SearchRequest(BaseModel):
    """Schema for searching the knowledge base."""

    query: str = Field(..., min_length=1)
    top_k: int = Field(5, ge=1, le=20)
    filters: Optional[Dict[str, Any]] = None


# ----------------------------------------------------------------------
# Status Endpoints
# ----------------------------------------------------------------------


@router.get("/projects/{project_id}/knowledge-base-status", response_model=dict)
async def get_knowledge_base_status(
    project_id: UUID, db: AsyncSession = Depends(get_async_session)
):
    """Check basic knowledge base status for a project."""
    try:
        # Service function handles all status gathering
        status_data = await knowledgebase_service.get_kb_status(project_id, db)
        return await create_standard_response(status_data)
    except Exception as e:
        logger.error(f"Error retrieving KB status: {str(e)}")
        return await create_standard_response(
            {"exists": False, "isActive": False, "error": str(e)},
            success=False,
            status_code=500,
        )


@router.get("/projects/{project_id}/status", response_model=Dict[str, Any])
async def get_project_knowledge_base_status(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Get detailed knowledge base status with vector DB metrics."""
    try:
        # Validate project access
        await validate_project_access(project_id, current_user, db)

        # Get KB status using vector DB service
        vector_db = await initialize_project_vector_db(project_id)
        kb_status = await vector_db.get_knowledge_base_status(project_id, db)

        # Get file stats using knowledgebase service
        file_stats = await knowledgebase_service.get_project_files_stats(project_id, db)

        return await create_standard_response(
            {"vector_db": kb_status, "files": file_stats}
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting knowledge base status: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve knowledge base status: {str(e)}",
        )


@router.get("/knowledge-bases/{knowledge_base_id}/health", response_model=dict)
async def get_knowledge_base_health(
    knowledge_base_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Get health status of a knowledge base, including vector DB stats."""
    try:
        kb_health = await knowledgebase_service.get_knowledge_base_health(
            knowledge_base_id=knowledge_base_id, db=db
        )
        return await create_standard_response(kb_health)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting KB health: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to check knowledge base health: {str(e)}"
        )


# ----------------------------------------------------------------------
# Knowledge Base CRUD
# ----------------------------------------------------------------------


@router.get("/knowledge-bases", response_model=dict)
async def list_knowledge_bases(
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = 0,
    limit: int = 100,
    active_only: bool = True,
):
    """List available knowledge bases."""
    try:
        knowledge_bases = await knowledgebase_service.list_knowledge_bases(
            db=db, skip=skip, limit=limit, active_only=active_only
        )

        return await create_standard_response({"knowledge_bases": knowledge_bases})
    except Exception as e:
        logger.error(f"Error listing knowledge bases: {str(e)}")
        return await create_standard_response(
            {"knowledge_bases": []},
            f"Error retrieving knowledge bases: {str(e)}",
            success=False,
        )


@router.get("/knowledge-bases/{knowledge_base_id}", response_model=dict)
async def get_knowledge_base(
    knowledge_base_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Get a specific knowledge base by ID."""
    try:
        kb = await knowledgebase_service.get_knowledge_base(
            knowledge_base_id=knowledge_base_id, db=db
        )

        if not kb:
            raise HTTPException(status_code=404, detail="Knowledge base not found")

        return await create_standard_response(kb)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting knowledge base: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error retrieving knowledge base: {str(e)}"
        )


@router.post(
    "/projects/{project_id}/knowledge-bases",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
)
async def create_project_knowledge_base(
    project_id: UUID,
    kb_data: ProjectKnowledgeBaseCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Create a new knowledge base associated with a project."""
    try:
        # Validate project access
        await validate_project_access(project_id, current_user, db)

        # Create knowledge base using service
        kb = await knowledgebase_service.create_knowledge_base(
            name=kb_data.name,
            project_id=project_id,
            description=kb_data.description,
            embedding_model=kb_data.embedding_model,
            db=db,
        )

        result_data = {
            "id": str(kb.id),
            "name": kb.name,
            "embedding_model": kb.embedding_model,
            "is_active": kb.is_active,
            "project_id": str(kb.project_id) if kb.project_id else None,
            "created_at": kb.created_at.isoformat() if kb.created_at else None,
        }

        # Process existing files if requested
        if kb_data.process_existing_files:
            file_stats = await knowledgebase_service.get_project_files_stats(
                project_id, db
            )
            result_data["stats"] = file_stats

            # Process files in background
            BackgroundTasks().add_task(
                process_files_for_project, project_id=project_id, db=db
            )

        return await create_standard_response(
            result_data, "Knowledge base created successfully"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating knowledge base: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to create knowledge base: {str(e)}"
        )


@router.post(
    "/knowledge-bases", response_model=dict, status_code=status.HTTP_201_CREATED
)
async def create_knowledge_base(
    kb_data: KnowledgeBaseCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Create a new knowledge base (generic endpoint)."""
    try:
        # Validate project access
        await validate_project_access(kb_data.project_id, current_user, db)

        # Use service to create the knowledge base
        kb = await knowledgebase_service.create_knowledge_base(
            name=kb_data.name,
            project_id=kb_data.project_id,
            description=kb_data.description,
            embedding_model=kb_data.embedding_model,
            db=db,
        )

        return await create_standard_response(
            {
                "id": str(kb.id),
                "name": kb.name,
                "description": kb.description,
                "embedding_model": kb.embedding_model,
                "is_active": kb.is_active,
                "project_id": str(kb.project_id) if kb.project_id else None,
                "created_at": kb.created_at.isoformat() if kb.created_at else None,
            },
            "Knowledge base created successfully",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating knowledge base: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to create knowledge base: {str(e)}"
        )


@router.patch("/knowledge-bases/{knowledge_base_id}", response_model=dict)
async def update_knowledge_base(
    knowledge_base_id: UUID,
    update_data: KnowledgeBaseUpdate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Update an existing knowledge base by ID."""
    try:
        kb = await knowledgebase_service.update_knowledge_base(
            knowledge_base_id=knowledge_base_id,
            update_data=update_data.dict(exclude_unset=True),
            db=db,
        )

        return await create_standard_response(kb, "Knowledge base updated successfully")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating knowledge base: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error updating knowledge base: {str(e)}"
        )


@router.delete("/knowledge-bases/{knowledge_base_id}", response_model=dict)
async def delete_knowledge_base(
    knowledge_base_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Delete a knowledge base by ID."""
    try:
        result = await knowledgebase_service.delete_knowledge_base(
            knowledge_base_id=knowledge_base_id, db=db
        )

        return await create_standard_response(
            {"id": str(knowledge_base_id)}, "Knowledge base deleted successfully"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting knowledge base: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error deleting knowledge base: {str(e)}"
        )


# ----------------------------------------------------------------------
# Search Endpoints
# ----------------------------------------------------------------------


@router.post("/projects/{project_id}/knowledge-bases/search", response_model=dict)
async def search_project_knowledge(
    project_id: UUID,
    search_request: SearchRequest,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Search for knowledge within a project using the knowledge base."""
    try:
        # Validate project access
        await validate_project_access(project_id, current_user, db)

        # Use the search service directly
        results = await search_project_context(
            project_id=project_id,
            query=search_request.query,
            top_k=search_request.top_k,
            filters=search_request.filters,
        )

        return await create_standard_response(
            {
                "results": results,
                "count": len(results),
                "query": search_request.query,
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error searching project knowledge: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


# ----------------------------------------------------------------------
# File Upload & Processing
# ----------------------------------------------------------------------


@router.post("/projects/{project_id}/knowledge-bases/files", response_model=dict)
async def upload_file_to_knowledge_base(
    project_id: UUID,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Upload a file to a project's knowledge base."""
    try:
        # The service handles all validation and processing
        result = await knowledgebase_service.upload_file_to_project(
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
        raise HTTPException(status_code=500, detail=f"Failed to upload file: {str(e)}")


@router.post("/projects/{project_id}/knowledge-base/reindex", response_model=dict)
async def reindex_project_knowledge_base(
    project_id: UUID,
    force_reindex: bool = Body(False, embed=True),
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Reindex all files for a project's knowledge base."""
    try:
        # Validate project access
        project = await validate_project_access(project_id, current_user, db)

        if not project.knowledge_base_id:
            raise HTTPException(
                status_code=400, detail="Project does not have a linked knowledge base"
            )

        # Use vector DB service directly for reindexing
        if force_reindex:
            # Get vector DB instance
            vector_db = await initialize_project_vector_db(project_id)
            # Delete existing vectors
            await vector_db.delete_by_filter({"project_id": str(project_id)})

        # Process all files
        result = await process_files_for_project(project_id=project_id, db=db)

        return await create_standard_response(
            result, f"Reindexed {result.get('processed', 0)} files successfully"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error reindexing files: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to reindex files: {str(e)}"
        )


@router.post("/projects/{project_id}/knowledge-bases/toggle", response_model=dict)
async def toggle_project_knowledge_base(
    project_id: UUID,
    enable: bool = Body(..., embed=True),
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Enable or disable knowledge base for all conversations in a project."""
    try:
        # Let the service handle all the logic
        result = await knowledgebase_service.toggle_project_kb(
            project_id=project_id, enable=enable, user_id=current_user.id, db=db
        )

        return await create_standard_response(
            result, f"Knowledge base {'enabled' if enable else 'disabled'} for project"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error toggling knowledge base: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to toggle knowledge base: {str(e)}"
        )


# ----------------------------------------------------------------------
# Text Extraction Service
# ----------------------------------------------------------------------


@router.post("/text-extractor/initialize", response_model=Dict[str, Any])
async def initialize_text_extractor():
    """Initialize the text extraction service."""
    from services.text_extraction import (
        get_text_extractor,
        PDF_AVAILABLE,
        DOCX_AVAILABLE,
        TIKTOKEN_AVAILABLE,
    )

    extractor = get_text_extractor()
    return {
        "status": "ready",
        "capabilities": {
            "formats": ["pdf", "docx", "txt", "json", "csv", "html", "py", "js"],
            "features": {
                "pdf_extraction": PDF_AVAILABLE,
                "docx_extraction": DOCX_AVAILABLE,
                "token_counting": TIKTOKEN_AVAILABLE,
            },
        },
    }


@router.post("/text-extractor/extract", response_model=Dict[str, Any])
async def extract_text_from_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user_and_token),
):
    """Extract text and metadata from uploaded file."""
    try:
        from services.text_extraction import get_text_extractor

        extractor = get_text_extractor()
        chunks, metadata = await extractor.extract_text(
            file.file, filename=file.filename, mimetype=file.content_type
        )

        return await create_standard_response({"chunks": chunks, "metadata": metadata})
    except Exception as e:
        logger.error(f"Text extraction failed: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Text extraction failed: {str(e)}")
