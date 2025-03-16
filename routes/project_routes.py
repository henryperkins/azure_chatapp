"""
project_routes.py
-----------------
Provides routes for handling Projects within the Azure OpenAI Chat Application.

Includes:
  - Creating a project owned by the user.
  - Listing all user's projects.
  - Retrieving, updating, deleting a project.
  - Optionally attaching a project to a chat (for contextual usage).
  - Uploading project-specific files if needed.

All calls enforce JWT-based auth and checks user ownership of each project.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_async_session
from models.user import User
from models.project import Project
from models.chat import Chat
from models.chat_project import ChatProject
from sqlalchemy.future import select
from utils.auth_deps import get_current_user_and_token

logger = logging.getLogger(__name__)
router = APIRouter()


# -----------------------------
# Pydantic Schemas
# -----------------------------

class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=150, description="Project name")
    subtitle: Optional[str] = Field(None, max_length=150)
    description: Optional[str] = None
    notes: Optional[str] = None

class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=150)
    subtitle: Optional[str] = Field(None, max_length=150)
    description: Optional[str] = None
    notes: Optional[str] = None

# -----------------------------
# Project Routes
# -----------------------------

@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_project(
    proj_data: ProjectCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Creates a new project for the authenticated user.
    """
    # Remove the dummy get_valid_project(...) call for now
    new_proj = Project(
        name=proj_data.name.strip(),
        subtitle=(proj_data.subtitle.strip() if proj_data.subtitle else None),
        description=proj_data.description.strip() if proj_data.description else None,
        notes=proj_data.notes.strip() if proj_data.notes else None,
        user_id=current_user.id
    )
    db.add(new_proj)
    await db.commit()
    await db.refresh(new_proj)
    logger.info(f"Project created: {new_proj.name} by user {current_user.id}")

    return {
        "id": new_proj.id,
        "name": new_proj.name,
        "subtitle": new_proj.subtitle,
        "description": new_proj.description,
        "notes": new_proj.notes
    }


@router.get("", response_model=dict)
async def list_projects(
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Returns a list of the user's projects, newest first.
    """
    results = await db.execute(
        select(Project)
        .where(Project.user_id == current_user.id)
        .order_by(Project.created_at.desc())
    )
    projects = results.scalars().all()
    data = []
    for proj in results:
        data.append({
            "id": proj.id,
            "name": proj.name,
            "subtitle": proj.subtitle,
            "description": proj.description,
            "notes": proj.notes,
            "created_at": proj.created_at
        })
    return {"projects": data}


@router.get("/{project_id}", response_model=dict)
async def get_project(
    project_id: int,
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

    return {
        "id": proj.id,
        "name": proj.name,
        "subtitle": proj.subtitle,
        "description": proj.description,
        "notes": proj.notes,
        "created_at": proj.created_at
    }


@router.patch("/{project_id}", response_model=dict)
async def update_project(
    project_id: int,
    update_data: ProjectUpdate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Updates the specified fields of an existing project if user is the owner.
    """
    result = await db.execute(
        select(Project)
        .where(Project.id == project_id, Project.user_id == current_user.id)
    )
    proj = result.scalars().first()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found or access denied")

    if update_data.name is not None:
        proj.name = update_data.name.strip()  # type: ignore[assignment]
    if update_data.subtitle is not None:
        proj.subtitle = update_data.subtitle.strip()  # type: ignore[assignment]
    if update_data.description is not None:
        proj.description = update_data.description.strip()  # type: ignore[assignment]
    if update_data.notes is not None:
        proj.notes = update_data.notes.strip()  # type: ignore[assignment]

    await db.commit()
    await db.refresh(proj)
    logger.info(f"Project {proj.id} updated by user {current_user.id}")

    return {
        "id": proj.id,
        "name": proj.name,
        "subtitle": proj.subtitle,
        "description": proj.description,
        "notes": proj.notes,
        "created_at": proj.created_at
    }


@router.delete("/{project_id}", response_model=dict)
async def delete_project(
    project_id: int,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Deletes (permanently) a project if owned by the current user.
    Ensures no further usage in conversation context.
    """
    result = await db.execute(
        select(Project)
        .where(Project.id == project_id, Project.user_id == current_user.id)
    )
    proj = result.scalars().first()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found or access denied")

    await db.delete(proj)
    await db.commit()
    logger.info(f"Project {project_id} permanently deleted by user {current_user.id}")

    return {"status": "deleted", "project_id": project_id}


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
