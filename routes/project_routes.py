"""
project_routes.py
-----------------
Enhanced project routes with UUIDs, token tracking, and advanced features.
"""

import logging
from uuid import UUID
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from pydantic import BaseModel, Field, conint
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import update, and_

from db import get_async_session
from models.user import User
from models.project import Project
from models.project_file import ProjectFile
from utils.auth_deps import get_current_user_and_token
from utils.azure import AzureStorage, CognitiveSearch  # Assume these exist

logger = logging.getLogger(__name__)
router = APIRouter()


# -----------------------------
# Pydantic Schemas
# -----------------------------

class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    goals: Optional[str] = Field(None, max_length=1000)
    custom_instructions: Optional[str] = Field(None, max_length=5000)
    max_tokens: conint(ge=50000, le=500000) = 200000  # 50k-500k range

class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    goals: Optional[str] = Field(None, max_length=1000)
    custom_instructions: Optional[str] = Field(None, max_length=5000)
    max_tokens: Optional[conint(ge=50000, le=500000)]

class ProjectResponse(BaseModel):
    id: UUID
    name: str
    goals: Optional[str]
    token_usage: int
    max_tokens: int
    custom_instructions: Optional[str]
    archived: bool
    pinned: bool
    version: int
    knowledge_base_id: Optional[str]
    created_at: datetime
    updated_at: datetime
    user_id: int

    class Config:
        orm_mode = True

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
        search = CognitiveSearch()
        kb_id = await search.create_index(f"project-{project_data.name}")
        
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

    project = await validate_project_access(project_id, current_user.id, db)
    return project


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: UUID,
    update_data: ProjectUpdate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    project = await validate_project_access(project_id, current_user.id, db)
    
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
    project = await validate_project_access(project_id, current_user.id, db)
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
    project_id: int,
    chat_id: str,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Associates a project with a chat if both belong to the user.
    E.g. storing the link in a bridging table 'chat_projects'.
    """
    result = await db.execute(
        select(Project)
        .where(Project.id == project_id, Project.user_id == current_user.id)
    )
    proj = result.scalars().first()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found or access denied")

    result_chat = await db.execute(
        select(Chat)
        .where(Chat.id == chat_id, Chat.user_id == current_user.id, Chat.is_deleted == False)
    )
    chat = result_chat.scalars().first()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found or access denied")

    # Insert bridging row into chat_projects table
    # Example: no duplicates
    result_existing = await db.execute(
        select(ChatProject).where(ChatProject.chat_id == chat_id, ChatProject.project_id == project_id)
    )
    existing = result_existing.scalars().first()
    if not existing:
        association = ChatProject(chat_id=chat_id, project_id=project_id)
        db.add(association)
        await db.commit()
        logger.info(f"Project {project_id} attached to chat {chat_id}")
        return {"success": True, "attached": True}
    else:
        return {"success": True, "attached": False, "message": "Project already attached to chat"}
async def get_valid_project(project_id: int, user: User, db: AsyncSession):
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == user.id)
    )
    proj = result.scalars().first()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    return proj
async def validate_project_access(project_id: UUID, user_id: int, db: AsyncSession) -> Project:
    result = await db.execute(
        select(Project)
        .where(Project.id == project_id, Project.user_id == user_id)
    )
    project = result.scalars().first()
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.archived:
        raise HTTPException(status_code=400, detail="Project is archived")
    return project
