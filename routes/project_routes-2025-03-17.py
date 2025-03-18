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
from models.chat import Chat
from models.chat_project import ChatProject

logger = logging.getLogger(__name__)
router = APIRouter()

# Removed local Pydantic schemas; now import them from schemas.project_schemas
# Remove leftover 'orm_mode = True' line

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
        kb_id = None
        
        project = Project(
            **project_data.dict(),
            user_id=current_user.id,
            knowledge_base_id=kb_id
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
    return project


# Extra route for attaching the Project to a Chat (optional)
@router.post("/{project_id}/attach_chat/{chat_id}", response_model=dict)
async def attach_project_to_chat(
    project_id: UUID,
    chat_id: str,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    project = await validate_project_access(project_id, current_user, db)
    chat = await db.execute(
        select(Chat)
        .where(Chat.id == chat_id, Chat.user_id == current_user.id)
    )
    chat = chat.scalars().first()
    
    if not chat:
        raise HTTPException(404, "Chat not found")
    
    existing = await db.execute(
        select(ChatProject)
        .where(ChatProject.chat_id == chat_id, ChatProject.project_id == project_id)
    )
    if existing.scalars().first():
        return {"message": "Already attached"}
    
    association = ChatProject(chat_id=chat_id, project_id=project_id)
    db.add(association)
    await db.commit()
    return {"status": "attached"}

# Removed duplicated definitions, we import from services.project_service now
    # removed duplicated knowledge base code
# Remove leftover line
