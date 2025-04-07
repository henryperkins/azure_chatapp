from uuid import UUID

"""
knowledge_base_routes.py
------------------------
Routes for managing knowledge bases and integrating them with ChatGPT.
Provides endpoints for:
 - Creating and managing knowledge bases
 - Searching knowledge within a project
 - Integrating knowledge into chat conversations
 - Reindexing files in a project's knowledge base
"""

import logging
import os
from typing import Dict, Any, Optional
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
    Body,
    Request,
    UploadFile,
    File,
    BackgroundTasks,
)
from sqlalchemy import select, update, func
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field

from models.project_file import ProjectFile
from models.conversation import Conversation
from models.user import User
from models.project import Project
from models.knowledge_base import KnowledgeBase
from services.knowledgebase_service import (
    DEFAULT_EMBEDDING_MODEL,
)
from services.text_extraction import (
    PDF_AVAILABLE,
    DOCX_AVAILABLE,
    TIKTOKEN_AVAILABLE,
    get_text_extractor,
)
from services import knowledgebase_service
from services.vector_db import VECTOR_DB_STORAGE_PATH, get_vector_db

from db import get_async_session
from utils.auth_utils import get_current_user_and_token
from utils.db_utils import validate_resource_access, get_all_by_condition
from utils.response_utils import create_standard_response

logger = logging.getLogger(__name__)
router = APIRouter()

# ----------------------------------------------------------------------
# Status Endpoints
# ----------------------------------------------------------------------


@router.get(
    "/projects/{project_id}/status",
    response_model=Dict[str, Any],
    summary="Get knowledge base status",
    description="Returns detailed status including processing stats and vector DB connection",
)
async def get_project_knowledge_base_status(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Get detailed status of project knowledge base, including file processing stats
    and vector DB connection.
    """
    # Validate project access
    project = await validate_resource_access(
        project_id, Project, current_user, db, resource_name="Project"
    )

    # Get knowledge base details
    kb = None
    if project.knowledge_base_id:
        kb = await db.get(KnowledgeBase, project.knowledge_base_id)

    # Gather file processing stats
    processed_files = 0
    total_files = 0
    if project.knowledge_base_id:
        files_q = await db.execute(
            select(ProjectFile).where(ProjectFile.project_id == project_id)
        )
        files = files_q.scalars().all()
        total_files = len(files)
        processed_files = sum(
            1
            for f in files
            if f.config
            and f.config.get("search_processing", {}).get("status") == "success"
        )

    # Vector DB status
    vector_db_status = "not_initialized"
    vector_db_health = {}
    if kb:
        try:
            vector_db = await get_vector_db(
                model_name=(
                    str(kb.embedding_model)
                    if kb.embedding_model
                    else DEFAULT_EMBEDDING_MODEL
                ),
                storage_path=os.path.join(VECTOR_DB_STORAGE_PATH, str(project_id)),
                load_existing=True,
            )
            # Test vector DB connection
            try:
                test_results = (
                    await vector_db.test_connection()
                )  # You might implement a `test_connection()` method
                vector_db_status = "connected"
                vector_db_health = {
                    "index_count": test_results.get("index_count", 0),
                    "is_healthy": test_results.get("is_healthy", False),
                }
            except Exception as e:
                vector_db_status = f"connection_error: {str(e)}"
        except Exception as e:
            vector_db_status = f"initialization_error: {str(e)}"

    return {
        "exists": bool(kb),
        "is_active": kb.is_active if kb else False,
        "embedding_model": kb.embedding_model if kb else None,
        "files": {
            "total": total_files,
            "processed": processed_files,
            "unprocessed": total_files - processed_files,
        },
        "vector_db": {
            "status": vector_db_status,
            "health": vector_db_health,
            "model": kb.embedding_model if kb else None,
            "storage_path": (
                os.path.join(VECTOR_DB_STORAGE_PATH, str(project_id)) if kb else None
            ),
        },
        "ready_for_search": bool(kb and kb.is_active and processed_files > 0),
    }


@router.get("/projects/{project_id}/knowledge-base-status", response_model=dict)
async def get_knowledge_base_status(
    project_id: str, db: AsyncSession = Depends(get_async_session)
):
    """
    Check knowledge base status for a project.
    Simpler endpoint that just returns `exists` and `isActive`.
    """
    from services.project_service import check_knowledge_base_status

    kb_status = await check_knowledge_base_status(UUID(project_id), db)

    # Check if there's an actual knowledge base
    project = await db.get(Project, UUID(project_id))
    is_active = False
    name = None

    if project and project.knowledge_base_id:
        kb = await db.get(KnowledgeBase, project.knowledge_base_id)
        if kb:
            is_active = kb.is_active
            name = kb.name

    return {"exists": kb_status is not None, "isActive": is_active, "name": name}


# ----------------------------------------------------------------------
# Pydantic Schemas
# ----------------------------------------------------------------------


class KnowledgeBaseCreate(BaseModel):
    """
    Schema for creating a new knowledge base.
    """

    name: str = Field(..., min_length=1, max_length=200)
    project_id: UUID = Field(
        ..., description="Project to associate with this knowledge base"
    )
    description: Optional[str] = None
    embedding_model: str = Field(
        default="all-MiniLM-L6-v2",
        description="Embedding model to use",
        json_schema_extra={
            "options": [
                "all-MiniLM-L6-v2",
                "text-embedding-3-small",
                "embed-english-v3.0",
            ]
        },
    )


class KnowledgeBaseUpdate(BaseModel):
    """
    Schema for updating an existing knowledge base.
    """

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    embedding_model: Optional[str] = None
    is_active: Optional[bool] = None


class SearchRequest(BaseModel):
    """
    Schema for searching the knowledge base.
    """

    query: str = Field(..., min_length=1)
    top_k: int = Field(5, ge=1, le=20)
    filters: Optional[Dict[str, Any]] = None


class ProjectKnowledgeBaseCreate(BaseModel):
    """
    Schema for creating a new knowledge base under a project.
    """

    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    embedding_model: str = Field(
        default="all-MiniLM-L6-v2",
        description="Embedding model to use",
        json_schema_extra={
            "options": [
                "all-MiniLM-L6-v2",
                "text-embedding-3-small",
                "embed-english-v3.0",
            ]
        },
    )


# ----------------------------------------------------------------------
# Knowledge Base CRUD
# ----------------------------------------------------------------------


@router.post(
    "/projects/{project_id}/knowledge-bases",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
)
async def create_project_knowledge_base(
    project_id: UUID,
    knowledge_base_data: ProjectKnowledgeBaseCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Creates a new knowledge base associated with a project (alternative endpoint).
    Uses project_id from path parameter, ignoring any project_id in request body.
    """
    # Convert to dict and remove project_id if present
    request_data = knowledge_base_data.dict(exclude={"project_id"})
    if not request_data.get("name"):
        raise HTTPException(status_code=400, detail="Name is required")

    try:
        # Validate user access to the project
        await validate_resource_access(project_id, Project, current_user, db, "Project")

        # Create knowledge base using service
        from services.knowledgebase_service import create_knowledge_base

        knowledge_base = await create_knowledge_base(
            name=knowledge_base_data.name,
            project_id=project_id,
            description=request_data.get("description"),
            embedding_model=request_data.get("embedding_model")
            or DEFAULT_EMBEDDING_MODEL,
            db=db,
        )

        # Optionally gather stats
        from services.project_service import check_knowledge_base_status

        kb_status = await check_knowledge_base_status(project_id, db)

        return await create_standard_response(
            {
                "id": str(knowledge_base.id),
                "name": knowledge_base.name,
                "description": knowledge_base.description,
                "embedding_model": knowledge_base.embedding_model,
                "is_active": knowledge_base.is_active,
                "project_id": str(knowledge_base.project_id),
                "created_at": (
                    knowledge_base.created_at.isoformat()
                    if knowledge_base.created_at
                    else None
                ),
                "stats": {
                    "has_content": kb_status["has_content"],
                    "file_count": kb_status["file_count"],
                    "chunk_count": kb_status["chunk_count"],
                },
            },
            "Knowledge base created successfully",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating knowledge base: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to create knowledge base: {str(e)}"
        )


@router.post(
    "/knowledge-bases", response_model=dict, status_code=status.HTTP_201_CREATED
)
async def create_knowledge_base(
    knowledge_base_data: KnowledgeBaseCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Creates a new knowledge base associated with a project.
    """
    try:
        await validate_resource_access(
            knowledge_base_data.project_id, Project, current_user, db, "Project"
        )

        from services.knowledgebase_service import create_knowledge_base

        knowledge_base = await create_knowledge_base(
            name=knowledge_base_data.name,
            project_id=knowledge_base_data.project_id,
            description=knowledge_base_data.description,
            embedding_model=knowledge_base_data.embedding_model,
            db=db,
        )

        return await create_standard_response(
            {
                "id": str(knowledge_base.id),
                "name": knowledge_base.name,
                "description": knowledge_base.description,
                "embedding_model": knowledge_base.embedding_model,
                "is_active": knowledge_base.is_active,
                "project_id": str(knowledge_base.project_id),
                "created_at": (
                    knowledge_base.created_at.isoformat()
                    if knowledge_base.created_at
                    else None
                ),
            },
            "Knowledge base created successfully",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating knowledge base: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to create knowledge base: {str(e)}"
        )


@router.get("/knowledge-bases", response_model=dict)
async def list_knowledge_bases(
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = 0,
    limit: int = 100,
    active_only: bool = True,
):
    """
    List available knowledge bases.
    """
    try:
        conditions = []
        if active_only:
            conditions.append(KnowledgeBase.is_active.is_(True))

        knowledge_bases = await get_all_by_condition(
            db,
            KnowledgeBase,
            *conditions,
            order_by=KnowledgeBase.created_at.desc(),
            limit=limit,
            offset=skip,
        )

        items = []
        for kb in knowledge_bases:
            items.append(
                {
                    "id": str(kb.id),
                    "name": kb.name,
                    "description": kb.description,
                    "embedding_model": kb.embedding_model,
                    "is_active": kb.is_active,
                    "created_at": kb.created_at.isoformat() if kb.created_at else None,
                }
            )

        return await create_standard_response({"knowledge_bases": items})
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
    """
    Get a specific knowledge base by ID.
    """
    try:
        query = select(KnowledgeBase).where(KnowledgeBase.id == knowledge_base_id)
        result = await db.execute(query)
        knowledge_base = result.scalars().first()

        if not knowledge_base:
            raise HTTPException(status_code=404, detail="Knowledge base not found")

        return await create_standard_response(
            {
                "id": str(knowledge_base.id),
                "name": knowledge_base.name,
                "description": knowledge_base.description,
                "embedding_model": knowledge_base.embedding_model,
                "is_active": knowledge_base.is_active,
                "created_at": (
                    knowledge_base.created_at.isoformat()
                    if knowledge_base.created_at
                    else None
                ),
                "updated_at": (
                    knowledge_base.updated_at.isoformat()
                    if knowledge_base.updated_at
                    else None
                ),
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting knowledge base: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error retrieving knowledge base: {str(e)}"
        )


@router.patch("/knowledge-bases/{knowledge_base_id}", response_model=dict)
async def update_knowledge_base(
    knowledge_base_id: UUID,
    update_data: KnowledgeBaseUpdate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Update an existing knowledge base by ID.
    """
    try:
        query = select(KnowledgeBase).where(KnowledgeBase.id == knowledge_base_id)
        result = await db.execute(query)
        knowledge_base = result.scalars().first()

        if not knowledge_base:
            raise HTTPException(status_code=404, detail="Knowledge base not found")

        if update_data.name is not None:
            knowledge_base.name = update_data.name
        if update_data.description is not None:
            knowledge_base.description = update_data.description
        if update_data.embedding_model is not None:
            knowledge_base.embedding_model = update_data.embedding_model
        if update_data.is_active is not None:
            knowledge_base.is_active = update_data.is_active

        db.add(knowledge_base)
        await db.commit()
        await db.refresh(knowledge_base)

        return await create_standard_response(
            {
                "id": str(knowledge_base.id),
                "name": knowledge_base.name,
                "description": knowledge_base.description,
                "embedding_model": knowledge_base.embedding_model,
                "is_active": knowledge_base.is_active,
                "updated_at": (
                    knowledge_base.updated_at.isoformat()
                    if knowledge_base.updated_at
                    else None
                ),
            },
            "Knowledge base updated successfully",
        )
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
    """
    Delete a knowledge base by ID.
    """
    try:
        query = select(KnowledgeBase).where(KnowledgeBase.id == knowledge_base_id)
        result = await db.execute(query)
        knowledge_base = result.scalars().first()

        if not knowledge_base:
            raise HTTPException(status_code=404, detail="Knowledge base not found")

        await db.delete(knowledge_base)
        await db.commit()

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
    request: Request,
    project_id: UUID,
    search_request: SearchRequest,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Search for knowledge within a project using the knowledge base.
    """
    try:
        await validate_resource_access(
            project_id, Project, current_user, db, "Project", []
        )

        # Perform the search
        search_results = await knowledgebase_service.search_project_context(
            project_id=project_id,
            query=search_request.query,
            db=db,
            top_k=search_request.top_k,
        )

        return await create_standard_response(
            {
                "results": search_results,
                "count": len(search_results),
                "query": search_request.query,
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error searching project knowledge: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error searching project knowledge: {str(e)}"
        )


@router.get("/knowledge-bases/{knowledge_base_id}/health", response_model=dict)
async def get_knowledge_base_health(
    knowledge_base_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Get health status of a knowledge base, including vector DB stats.
    """
    kb = await db.get(KnowledgeBase, knowledge_base_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")

    # Example: load or init vector DB
    _ = await get_vector_db(
        model_name=kb.embedding_model or DEFAULT_EMBEDDING_MODEL,
        storage_path=os.path.join(VECTOR_DB_STORAGE_PATH, str(kb.project_id)),
        load_existing=True,
    )

    # Count of successfully processed files
    processed_files = await db.scalar(
        select(func.count())
        .select_from(ProjectFile)
        .where(
            ProjectFile.project_id == kb.project_id,
            ProjectFile.metadata["search_processing"]["status"].astext == "success",
        )
    )

    return {
        "status": "active" if kb.is_active else "inactive",
        "embedding_model": kb.embedding_model,
        "processed_files": processed_files if processed_files else 0,
        "last_updated": kb.updated_at.isoformat() if kb.updated_at else None,
    }


# ----------------------------------------------------------------------
# Text Extraction Service
# ----------------------------------------------------------------------


@router.post("/text-extractor/initialize", response_model=Dict[str, Any])
async def initialize_text_extractor():
    """
    Initialize the text extraction service.

    Returns:
        Dictionary with service status and capabilities
    """
    extractor = get_text_extractor()  # noqa: F841
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
    """
    Extract text and metadata from uploaded file.

    Returns:
        Dictionary with extracted text chunks and metadata
    """
    try:
        extractor = get_text_extractor()
        chunks, metadata = await extractor.extract_text(
            file.file, filename=file.filename, mimetype=file.content_type
        )

        return {"chunks": chunks, "metadata": metadata}

    except Exception as e:
        logger.error(f"Text extraction failed: {str(e)}")
        raise HTTPException(
            status_code=400,
            detail={
                "code": "TEXT_EXTRACTION_ERROR",
                "message": f"Text extraction failed: {str(e)}",
            },
        )


# ----------------------------------------------------------------------
# File Upload & Reindex
# ----------------------------------------------------------------------


@router.post("/projects/{project_id}/knowledge-bases/files", response_model=dict)
async def upload_file_to_knowledge_base(
    project_id: UUID,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Upload a file to a project's knowledge base.
    """
    # Validate project access
    project = await validate_resource_access(
        project_id, Project, current_user, db, resource_name="Project"
    )

    if not project.knowledge_base_id:
        raise HTTPException(
            status_code=400, detail="Project does not have a knowledge base"
        )

    try:
        result = await knowledgebase_service.upload_file_to_project(
            project_id=project_id,
            file=file,
            db=db,
            user_id=current_user.id,
            background_tasks=background_tasks,
        )

        return {
            "data": result,
            "success": True,
            "message": "File uploaded successfully",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"File upload failed: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail={"error": str(e), "success": False, "message": "File upload failed"},
        )


@router.post("/projects/{project_id}/knowledge-base/reindex", response_model=dict)
async def reindex_project_knowledge_base(
    project_id: UUID,
    force_reindex: bool = Body(False, embed=True),
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    """
    Reindex (reprocess) all files for a project's knowledge base.
    Optionally, use force_reindex=True to reset the vector store before reprocessing.
    """
    # Validate access
    project = await validate_resource_access(
        project_id, Project, current_user, db, resource_name="Project"
    )
    if not project.knowledge_base_id:
        raise HTTPException(
            status_code=400, detail="Project does not have a linked knowledge base."
        )

    # Retrieve all files
    files_query = await db.execute(
        select(ProjectFile).where(ProjectFile.project_id == project_id)
    )
    files = files_query.scalars().all()
    if not files:
        return {
            "success": False,
            "message": "No files to process.",
            "queued_files": 0,
            "total_files": 0,
        }

    # Force reindex if requested
    if force_reindex:
        kb = project.knowledge_base
        model_name = (
            kb.embedding_model if kb and kb.embedding_model else DEFAULT_EMBEDDING_MODEL
        )
        vector_db = await get_vector_db(
            model_name=model_name,
            storage_path=os.path.join(VECTOR_DB_STORAGE_PATH, str(project_id)),
            load_existing=False,
        )
        await vector_db.delete_by_filter({"project_id": str(project_id)})

    # Queue each file for background reprocessing
    processed_count = 0
    for file_record in files:
        if not project.knowledge_base_id:
            logger.warning(f"Skipping file {file_record.id} - project has no knowledge base")
            continue
            
        try:
            background_tasks.add_task(
                knowledgebase_service.process_single_file_for_search,
                file_id=UUID(str(file_record.id)),
                project_id=project_id,
                knowledge_base_id=UUID(str(project.knowledge_base_id)),
                db=db,
            )
            processed_count += 1
        except Exception as e:
            logger.error(
                f"Failed to queue file {file_record.id} for reindexing: {str(e)}"
            )

    return {
        "success": True,
        "message": f"Queued {processed_count} files for reindexing",
        "queued_files": processed_count,
        "total_files": len(files),
    }


@router.post("/projects/{project_id}/knowledge-bases/toggle", response_model=dict)
async def toggle_project_knowledge_base(
    project_id: UUID,
    enable: bool = Body(..., embed=True),
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Enable or disable knowledge base for all conversations in a project.
    Requires the project's knowledge base to be active when enabling.
    """
    project = await validate_resource_access(
        project_id, Project, current_user, db, "Project"
    )

    if enable and not project.knowledge_base_id:
        raise HTTPException(
            status_code=400, detail="Project has no linked knowledge base"
        )

    if enable:
        kb = await db.get(KnowledgeBase, project.knowledge_base_id)
        if not kb or not kb.is_active:
            raise HTTPException(
                status_code=400, detail="Project's knowledge base is not active"
            )

    # Update all conversations to reflect new KB usage
    await db.execute(
        update(Conversation)
        .where(Conversation.project_id == project_id)
        .values(use_knowledge_base=enable)
    )
    await db.commit()

    return await create_standard_response(
        {"project_id": str(project_id), "knowledge_base_enabled": enable},
        f"Knowledge base {'enabled' if enable else 'disabled'} for project",
    )
