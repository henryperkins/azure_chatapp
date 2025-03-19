"""
project_routes.py
-----------------
Enhanced project routes with UUIDs, token tracking, and advanced features.
"""

import logging
from uuid import UUID
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from pydantic import BaseModel, Field
from schemas.project_schemas import (
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import update, and_
from models.artifact import Artifact

from db import get_async_session
from models.user import User
from models.project import Project
from models.project_file import ProjectFile
from utils.auth_deps import get_current_user_and_token
# Commenting out unused or unresolvable utils.azure imports
# from utils.azure import AzureStorage, CognitiveSearch  # Assume these exist

from datetime import datetime
# Only import the function(s) we actually use
from services.project_service import validate_project_access

logger = logging.getLogger(__name__)
router = APIRouter()

# -----------------------------
# Project Routes
# -----------------------------

@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    project_data: ProjectCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Create new project with Azure Cognitive Search integration"""
    try:
        # Create Azure Cognitive Search index
        # Comment out or remove references to CognitiveSearch since it's not defined
        
        project = Project(
            **project_data.dict(),
            user_id=current_user.id,
        )
        
        db.add(project)
        await db.commit()
        await db.refresh(project)
        return project
        
    except Exception as e:
        logger.error(f"Project creation failed: {str(e)}")
        raise HTTPException(500, "Project creation failed")


@router.get("", response_model=List[ProjectResponse])
async def list_projects(
    archived: Optional[bool] = None,
    pinned: Optional[bool] = None,
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    query = select(Project).where(Project.user_id == current_user.id)
    if archived is not None:
        query = query.where(Project.archived == archived)
    if pinned is not None:
        query = query.where(Project.pinned == pinned)
    result = await db.execute(query.offset(skip).limit(limit))
    return result.scalars().all()


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Retrieves details for a single project. Must belong to the user.
    """
    result = await db.execute(
        select(Project)
        .where(Project.id == project_id, Project.user_id == current_user.id)
    )
    proj = result.scalars().first()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found or access denied")

    # Current user ID is a Column[int] from the model. Convert explicitly to int.
    # Remove cast usage entirely, rely on user.id being a normal int.
    # Pass the entire user object rather than user_id
    project = await validate_project_access(project_id, current_user, db)
    return project


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: UUID,
    update_data: ProjectUpdate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    project = await validate_project_access(project_id, current_user, db)
    
    update_dict = update_data.dict(exclude_unset=True)
    if 'max_tokens' in update_dict and update_dict['max_tokens'] < project.token_usage:
        raise HTTPException(400, "New token limit below current usage")
    
    for key, value in update_dict.items():
        setattr(project, key, value)
    
    await db.commit()
    await db.refresh(project)
    return project


@router.patch("/{project_id}/archive", response_model=ProjectResponse)
async def toggle_archive_project(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    project = await validate_project_access(project_id, current_user, db)
    
    stmt = (
        update(Project)
        .where(Project.id == project_id)
        .values(archived=not project.archived)
    )
    await db.execute(stmt)
    await db.commit()
    await db.refresh(project)

    @router.post("/{project_id}/artifacts", response_model=dict, status_code=status.HTTP_201_CREATED)
    async def create_artifact(
        project_id: UUID,
        artifact_data: dict,  # Replace with proper schema
        current_user: User = Depends(get_current_user_and_token),
        db: AsyncSession = Depends(get_async_session)
    ):
        """
        Create a new artifact for the project
        """
        project = await validate_project_access(project_id, current_user, db)
        
        new_artifact = Artifact(
            project_id=project_id,
            conversation_id=artifact_data.get("conversation_id"),
            name=artifact_data["name"],
            content_type=artifact_data["content_type"],
            content=artifact_data["content"]
        )
        
        db.add(new_artifact)
        await db.commit()
        await db.refresh(new_artifact)
        
        return {
            "id": str(new_artifact.id),
            "name": new_artifact.name,
            "created_at": new_artifact.created_at.isoformat()
        }

    @router.get("/{project_id}/artifacts", response_model=dict)
    async def list_artifacts(
        project_id: UUID,
        current_user: User = Depends(get_current_user_and_token),
        db: AsyncSession = Depends(get_async_session)
    ):
        """
        List all artifacts for a project
        """
        await validate_project_access(project_id, current_user, db)
        
        result = await db.execute(
            select(Artifact)
            .where(Artifact.project_id == project_id)
            .order_by(Artifact.created_at.desc())
        )
        artifacts = result.scalars().all()
        
        return {
            "artifacts": [
                {
                    "id": str(a.id),
                    "name": a.name,
                    "content_type": a.content_type,
                    "created_at": a.created_at
                }
                for a in artifacts
            ]
        }

@router.get("/{project_id}/stats", response_model=dict)
async def get_project_stats(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Get statistics for a project including token usage, file count, etc.
    """
    project = await validate_project_access(project_id, current_user, db)
    
    from models.chat import Conversation
    from models.project_file import ProjectFile
    from models.artifact import Artifact
    from sqlalchemy import func
    
    # Get conversation count
    conv_result = await db.execute(
        select(func.count()).where(Conversation.project_id == project_id, Conversation.is_deleted.is_(False))
    )
    conversation_count = conv_result.scalar() or 0
    
    # Get file count and total size
    files_result = await db.execute(
        select(func.count(), func.sum(ProjectFile.file_size)).where(ProjectFile.project_id == project_id)
    )
    file_count, total_file_size = files_result.first()
    file_count = file_count or 0
    total_file_size = total_file_size or 0
    
    # Get artifact count
    artifact_result = await db.execute(
        select(func.count()).where(Artifact.project_id == project_id)
    )
    artifact_count = artifact_result.scalar() or 0
    
    usage_percentage = (project.token_usage / project.max_tokens) * 100 if project.max_tokens > 0 else 0
    
    return {
        "token_usage": project.token_usage,
        "max_tokens": project.max_tokens,
        "usage_percentage": usage_percentage,
        "conversation_count": conversation_count,
        "file_count": file_count,
        "total_file_size": total_file_size,
        "artifact_count": artifact_count
    }
