"""
projects.py
---------
Core project management routes with CRUD operations,
statistics, and project-level actions.
"""

import logging
from uuid import UUID
from typing import Optional, Dict

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select

from db import get_async_session
from models.user import User
from models.project import Project
from models.conversation import Conversation
from models.project_file import ProjectFile
from models.artifact import Artifact
from utils.auth_deps import (
    get_current_user_and_token,
    validate_resource_ownership,
    process_standard_response
)
from utils.context import (
    get_all_by_condition,
    save_model
)
from utils.serializers import serialize_project

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================
# Pydantic Schemas
# ============================

class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    goals: Optional[str] = Field(None, max_length=1000)
    description: Optional[str] = Field(None, max_length=2000)
    custom_instructions: Optional[str] = Field(None, max_length=5000)
    max_tokens: int = Field(
        default=200000,
        ge=50000,
        le=500000
    )


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    goals: Optional[str] = Field(None, max_length=1000)
    custom_instructions: Optional[str] = Field(None, max_length=5000)
    is_default: Optional[bool]
    pinned: Optional[bool]
    archived: Optional[bool]
    extra_data: Optional[dict]
    max_tokens: Optional[int] = Field(
        default=None,
        ge=50000,
        le=500000
    )


# ============================
# Project CRUD Operations
# ============================

@router.post("/", response_model=Dict, status_code=status.HTTP_201_CREATED)
async def create_project(
    project_data: ProjectCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Create new project"""
    try:
        # Create project using db utility
        project = Project(
            **project_data.dict(),
            user_id=current_user.id,
        )
        await save_model(db, project)
        logger.info(f"Project created successfully: {project.id} for user {current_user.id}")
        
        # Serialize project for response
        serialized_project = serialize_project(project)
        
        return await process_standard_response(serialized_project, "Project created successfully")
        
    except Exception as e:
        logger.error(f"Project creation failed: {str(e)}")
        raise HTTPException(500, "Project creation failed")


@router.get("/", response_model=Dict)
async def list_projects(
    archived: Optional[bool] = None,
    pinned: Optional[bool] = None,
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """List all projects owned by the current user with optional filtering"""
    # Create conditions list based on filters
    conditions = [Project.user_id == current_user.id]
    if archived is not None:
        conditions.append(Project.archived == archived)
    if pinned is not None:
        conditions.append(Project.pinned == pinned)
    
    # Use consolidated function for database query
    projects = await get_all_by_condition(
        db,
        Project,
        *conditions,
        limit=limit,
        offset=skip,
        order_by=Project.created_at.desc()
    )
    
    # Log the projects being returned
    logger.info(f"Retrieved {len(projects)} projects for user {current_user.id}")
    
    # Serialize projects to dict for JSON response
    serialized_projects = [serialize_project(project) for project in projects]
    
    # Return standardized response format
    return await process_standard_response(serialized_projects)


@router.get("/{project_id}", response_model=Dict)
async def get_project(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Retrieves details for a single project. Must belong to the user.
    """
    # Use the enhanced validation function
    project = await validate_resource_ownership(
        project_id,
        Project,
        current_user,
        db,
        "Project",
        [Project.user_id == current_user.id]
    )
    
    # Serialize project to dict for JSON response
    serialized_project = serialize_project(project)
    
    return await process_standard_response(serialized_project)


@router.patch("/{project_id}", response_model=Dict)
async def update_project(
    project_id: UUID,
    update_data: ProjectUpdate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Update project details"""
    # Verify project ownership
    project = await validate_resource_ownership(
        project_id,
        Project,
        current_user,
        db,
        "Project",
        [Project.user_id == current_user.id]
    )
    
    update_dict = update_data.dict(exclude_unset=True)
    if 'max_tokens' in update_dict and update_dict['max_tokens'] < project.token_usage:
        raise HTTPException(400, "New token limit below current usage")
    
    for key, value in update_dict.items():
        setattr(project, key, value)
    
    await save_model(db, project)
    
    # Serialize project for response
    serialized_project = serialize_project(project)
    
    return await process_standard_response(serialized_project, "Project updated successfully")


@router.delete("/{project_id}", response_model=Dict)
async def delete_project(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Delete a project and all associated resources"""
    # Verify project ownership
    project = await validate_resource_ownership(
        project_id,
        Project,
        current_user,
        db,
        "Project",
        [Project.user_id == current_user.id]
    )
    
    # Delete the project and rely on CASCADE for related resources
    await db.delete(project)
    await db.commit()
    
    return await process_standard_response(
        {"id": str(project_id)},
        "Project and all associated resources deleted successfully"
    )


# ============================
# Project Actions
# ============================

@router.patch("/{project_id}/archive")
async def toggle_archive_project(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Toggle archive status of a project.
    Cannot have pinned and archived simultaneously.
    """
    project = await validate_resource_ownership(
        project_id,
        Project,
        current_user,
        db,
        "Project",
        [Project.user_id == current_user.id]
    )
    
    # Toggle archived status
    project.archived = not project.archived
    
    # If archiving, also remove pin
    if project.archived and project.pinned:
        project.pinned = False
        
    await save_model(db, project)
    
    return await process_standard_response(
        serialize_project(project), 
        message=f"Project {'archived' if project.archived else 'unarchived'} successfully"
    )


@router.post("/{project_id}/pin")
async def toggle_pin_project(
   project_id: UUID,
   current_user: User = Depends(get_current_user_and_token),
   db: AsyncSession = Depends(get_async_session)
):
   """
   Pin or unpin a project for quick access.
   Cannot pin archived projects.
   """
   project = await validate_resource_ownership(
       project_id,
       Project,
       current_user,
       db,
       "Project",
       [Project.user_id == current_user.id]
   )
   
   if project.archived and not project.pinned:
       raise HTTPException(status_code=400, detail="Cannot pin an archived project")

   project.pinned = not project.pinned
   await save_model(db, project)
   
   return await process_standard_response(
       serialize_project(project),
       message=f"Project {'pinned' if project.pinned else 'unpinned'} successfully"
   )


@router.get("/{project_id}/stats", response_model=dict)
async def get_project_stats(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Get statistics for a project including token usage, file count, etc.
    """
    project = await validate_resource_ownership(
        project_id,
        Project,
        current_user,
        db,
        "Project",
        [Project.user_id == current_user.id]
    )
    
    # Get conversation count
    conversations = await get_all_by_condition(
        db,
        Conversation,
        Conversation.project_id == project_id,
        Conversation.is_deleted.is_(False)
    )
    conversation_count = len(conversations)
    
    # Get file count and size
    files_result = await db.execute(
        select(func.count(), func.sum(ProjectFile.file_size)).where(ProjectFile.project_id == project_id)
    )
    file_count, total_file_size = files_result.first()
    file_count = file_count or 0
    total_file_size = total_file_size or 0
    
    # Get artifact count
    artifacts = await get_all_by_condition(
        db,
        Artifact,
        Artifact.project_id == project_id
    )
    artifact_count = len(artifacts)
    
    usage_percentage = (project.token_usage / project.max_tokens) * 100 if project.max_tokens > 0 else 0
    
    logger.info(f"Returning stats for project {project_id}: {conversation_count} conversations, {file_count} files")
    return await process_standard_response({
        "token_usage": project.token_usage,
        "max_tokens": project.max_tokens,
        "usage_percentage": usage_percentage,
        "conversation_count": conversation_count,
        "file_count": file_count,
        "total_file_size": total_file_size,
        "artifact_count": artifact_count
    })
