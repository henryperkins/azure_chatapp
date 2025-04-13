"""
projects.py
---------
Project management routes - focused solely on project CRUD operations
and metadata, without knowledge base implementation details.
"""

import logging
from uuid import UUID
from typing import Optional, Dict, cast
import os
import shutil
from enum import Enum

from fastapi import (
    APIRouter, 
    Depends, 
    HTTPException, 
    status, 
    Request, 
    Query
)
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select, text

from db import get_async_session
from models.user import User
from models.project import Project
from models.conversation import Conversation
from models.project_file import ProjectFile
from models.artifact import Artifact
from models.knowledge_base import KnowledgeBase
from utils.auth_utils import get_current_user_and_token
from services.project_service import validate_project_access
import config
from services import knowledgebase_service
from utils.db_utils import get_all_by_condition, save_model
from utils.response_utils import create_standard_response
from utils.serializers import serialize_project
from services.file_storage import get_file_storage

logger = logging.getLogger(__name__)
router = APIRouter()

# ============================
# Pydantic Schemas
# ============================

class ProjectCreate(BaseModel):
    """Schema for creating a new project"""
    name: str = Field(..., min_length=1, max_length=200)
    goals: Optional[str] = Field(None, max_length=1000)
    description: Optional[str] = Field(None, max_length=2000)
    custom_instructions: Optional[str] = Field(None, max_length=5000)
    max_tokens: int = Field(default=200000, ge=50000, le=500000)

class ProjectUpdate(BaseModel):
    """Schema for updating a project"""
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    goals: Optional[str] = Field(None, max_length=1000)
    custom_instructions: Optional[str] = Field(None, max_length=5000)
    is_default: Optional[bool]
    pinned: Optional[bool]
    archived: Optional[bool]
    extra_data: Optional[dict]
    max_tokens: Optional[int] = Field(default=None, ge=50000, le=500000)

class ProjectFilter(str, Enum):
    """Filter options for listing projects"""
    all = "all"
    pinned = "pinned"
    archived = "archived"
    active = "active"

# ============================
# Core Project CRUD
# ============================

@router.post("/", response_model=Dict, status_code=status.HTTP_201_CREATED)
async def create_project(
    project_data: ProjectCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Create a new project"""
    try:
        project = Project(
            **project_data.dict(),
            user_id=current_user.id,
        )
        await save_model(db, project)
        
        logger.info(f"Created project {project.id} for user {current_user.id}")
        
        return await create_standard_response(
            serialize_project(project),
            "Project created successfully"
        )
    except Exception as e:
        logger.error(f"Project creation failed: {str(e)}")
        raise HTTPException(
            status_code=500, 
            detail=f"Project creation failed: {str(e)}"
        ) from e

@router.get("/", response_model=Dict)
async def list_projects(
    request: Request,
    filter_param: ProjectFilter = Query(ProjectFilter.all, description="Filter type"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """List projects with filtering"""
    try:
        projects = await get_all_by_condition(
            db,
            Project,
            Project.user_id == current_user.id,
            limit=limit,
            offset=skip,
            order_by=Project.created_at.desc(),
        )

        # Apply filters
        if filter_param == ProjectFilter.pinned:
            projects = [p for p in projects if p.pinned]
        elif filter_param == ProjectFilter.archived:
            projects = [p for p in projects if p.archived]
        elif filter_param == ProjectFilter.active:
            projects = [p for p in projects if not p.archived]

        serialized = [serialize_project(p) for p in projects]
        
        return {
            "projects": serialized,
            "count": len(serialized),
            "filter": {
                "type": filter_param.value,
                "applied": {
                    "archived": filter_param == ProjectFilter.archived,
                    "pinned": filter_param == ProjectFilter.pinned,
                }
            }
        }
    except Exception as e:
        logger.error(f"Failed to list projects: {str(e)}")
        raise HTTPException(500, "Failed to retrieve projects") from e

@router.get("/{project_id}/", response_model=Dict)
async def get_project(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Get a single project"""
    project = await validate_project_access(project_id, current_user, db)
    return await create_standard_response(serialize_project(project))

@router.patch("/{project_id}/", response_model=Dict)
async def update_project(
    project_id: UUID,
    update_data: ProjectUpdate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Update project details"""
    project = await validate_project_access(project_id, current_user, db)

    updates = update_data.dict(exclude_unset=True)
    if "max_tokens" in updates and updates["max_tokens"] < project.token_usage:
        raise HTTPException(400, "Token limit below current usage")

    for key, value in updates.items():
        setattr(project, key, value)

    await save_model(db, project)
    return await create_standard_response(
        serialize_project(project),
        "Project updated successfully"
    )

@router.delete("/{project_id}/", response_model=Dict)
async def delete_project(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Delete project and associated resources"""
    try:
        project = await validate_project_access(project_id, current_user, db)
        storage = get_file_storage({
            "storage_type": getattr(config, "FILE_STORAGE_TYPE", "local"),
            "local_path": getattr(config, "LOCAL_UPLOADS_DIR", "./uploads"),
        })

        # Delete files
        files = await get_all_by_condition(
            db,
            ProjectFile,
            ProjectFile.project_id == project_id
        )
        for file in files:
            try:
                await storage.delete_file(file.file_path)
            except Exception as file_err:
                logger.warning(f"Failed to delete file {file.id}: {file_err}")

        # Delete project (knowledge base will cascade)
        await db.delete(project)
        await db.commit()

        return await create_standard_response(
            {"id": str(project_id)},
            "Project deleted successfully"
        )
    except Exception as e:
        logger.error(f"Project deletion failed: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete project: {str(e)}"
        ) from e

# ============================
# Project Actions
# ============================

@router.patch("/{project_id}/archive")
async def toggle_archive_project(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Toggle archive status"""
    project = await validate_project_access(project_id, current_user, db)
    
    project.archived = not project.archived
    if project.archived and project.pinned:
        project.pinned = False

    await save_model(db, project)
    return await create_standard_response(
        serialize_project(project),
        f"Project {'archived' if project.archived else 'unarchived'}"
    )

@router.post("/{project_id}/pin")
async def toggle_pin_project(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Toggle pin status"""
    project = await validate_project_access(project_id, current_user, db)
    
    if project.archived and not project.pinned:
        raise HTTPException(400, "Cannot pin archived projects")

    project.pinned = not project.pinned
    await save_model(db, project)
    return await create_standard_response(
        serialize_project(project),
        f"Project {'pinned' if project.pinned else 'unpinned'}"
    )

# ============================
# Project Stats
# ============================

@router.get("/{project_id}/stats", response_model=dict)
async def get_project_stats(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Get project statistics"""
    project = await validate_project_access(project_id, current_user, db)

    # Get conversation count
    conversations = await get_all_by_condition(
        db,
        Conversation,
        Conversation.project_id == project_id,
        Conversation.is_deleted.is_(False),
    )
    
    # Get file statistics
    files_result = await db.execute(
        select(
            func.count(ProjectFile.id),
            func.sum(ProjectFile.file_size)
        ).where(ProjectFile.project_id == project_id)
    )
    file_count, total_size = files_result.first() or (0, 0)
    
    # Get artifact count
    artifacts = await get_all_by_condition(
        db, Artifact, Artifact.project_id == project_id
    )
    
    # KB information (simplified)
    kb_info = None
    if project.knowledge_base_id:
        kb_info = {
            "id": str(project.knowledge_base_id),
            "is_active": False,
            "indexed_files": 0
        }
        try:
            kb = await db.get(KnowledgeBase, project.knowledge_base_id)
            if kb:
                kb_info["is_active"] = kb.is_active
                # Get processed files count
                processed = await db.scalar(
                    select(func.count(ProjectFile.id)).where(
                        ProjectFile.project_id == project_id,
                        ProjectFile.processed_for_search == True  # noqa
                    )
                )
                kb_info["indexed_files"] = processed or 0
        except Exception as e:
            kb_info["error"] = str(e)

    return {
        "token_usage": project.token_usage,
        "max_tokens": project.max_tokens,
        "usage_percentage": project.token_usage / project.max_tokens * 100,
        "conversation_count": len(conversations),
        "file_count": file_count,
        "total_file_size": total_size or 0,
        "artifact_count": len(artifacts),
        "knowledge_base": kb_info
    }
