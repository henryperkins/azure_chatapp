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
from sqlalchemy.orm import Session

from ..db import SessionLocal
from ..models.user import User
from ..models.project import Project
from ..models.chat import Chat
from ..utils.auth_deps import get_current_user_and_token

logger = logging.getLogger(__name__)
router = APIRouter()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

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

@router.post("/projects", response_model=dict, status_code=status.HTTP_201_CREATED)
def create_project(
    proj_data: ProjectCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: Session = Depends(get_db)
):
    """
    Creates a new project for the authenticated user.
    """
    new_proj = Project(
        name=proj_data.name.strip(),
        subtitle=(proj_data.subtitle.strip() if proj_data.subtitle else None),
        description=proj_data.description.strip() if proj_data.description else None,
        notes=proj_data.notes.strip() if proj_data.notes else None,
        user_id=current_user.id
    )
    db.add(new_proj)
    db.commit()
    db.refresh(new_proj)
    logger.info(f"Project created: {new_proj.name} by user {current_user.id}")

    return {
        "id": new_proj.id,
        "name": new_proj.name,
        "subtitle": new_proj.subtitle,
        "description": new_proj.description,
        "notes": new_proj.notes
    }


@router.get("/projects", response_model=dict)
def list_projects(
    current_user: User = Depends(get_current_user_and_token),
    db: Session = Depends(get_db)
):
    """
    Returns a list of the user's projects, newest first.
    """
    results = (
        db.query(Project)
        .filter(Project.user_id == current_user.id)
        .order_by(Project.created_at.desc())
        .all()
    )
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


@router.get("/projects/{project_id}", response_model=dict)
def get_project(
    project_id: int,
    current_user: User = Depends(get_current_user_and_token),
    db: Session = Depends(get_db)
):
    """
    Retrieves details for a single project. Must belong to the user.
    """
    proj = (
        db.query(Project)
        .filter(Project.id == project_id, Project.user_id == current_user.id)
        .first()
    )
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


@router.patch("/projects/{project_id}", response_model=dict)
def update_project(
    project_id: int,
    update_data: ProjectUpdate,
    current_user: User = Depends(get_current_user_and_token),
    db: Session = Depends(get_db)
):
    """
    Updates the specified fields of an existing project if user is the owner.
    """
    proj = (
        db.query(Project)
        .filter(Project.id == project_id, Project.user_id == current_user.id)
        .first()
    )
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found or access denied")

    if update_data.name is not None:
        proj.name = update_data.name.strip()
    if update_data.subtitle is not None:
        proj.subtitle = update_data.subtitle.strip()
    if update_data.description is not None:
        proj.description = update_data.description.strip()
    if update_data.notes is not None:
        proj.notes = update_data.notes.strip()

    db.commit()
    db.refresh(proj)
    logger.info(f"Project {proj.id} updated by user {current_user.id}")

    return {
        "id": proj.id,
        "name": proj.name,
        "subtitle": proj.subtitle,
        "description": proj.description,
        "notes": proj.notes,
        "created_at": proj.created_at
    }


@router.delete("/projects/{project_id}", response_model=dict)
def delete_project(
    project_id: int,
    current_user: User = Depends(get_current_user_and_token),
    db: Session = Depends(get_db)
):
    """
    Deletes (permanently) a project if owned by the current user.
    Ensures no further usage in conversation context.
    """
    proj = (
        db.query(Project)
        .filter(Project.id == project_id, Project.user_id == current_user.id)
        .first()
    )
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found or access denied")

    db.delete(proj)
    db.commit()
    logger.info(f"Project {project_id} permanently deleted by user {current_user.id}")

    return {"status": "deleted", "project_id": project_id}


# Extra route for attaching the Project to a Chat (optional)
@router.post("/projects/{project_id}/attach_chat/{chat_id}", response_model=dict)
def attach_project_to_chat(
    project_id: int,
    chat_id: str,
    current_user: User = Depends(get_current_user_and_token),
    db: Session = Depends(get_db)
):
    """
    Associates a project with a chat if both belong to the user.
    E.g. storing the link in a bridging table 'chat_projects'.
    """
    proj = (
        db.query(Project)
        .filter(Project.id == project_id, Project.user_id == current_user.id)
        .first()
    )
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found or access denied")

    chat = (
        db.query(Chat)
        .filter(Chat.id == chat_id, Chat.user_id == current_user.id, Chat.is_deleted == False)
        .first()
    )
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found or access denied")

    # Insert bridging row into chat_projects table
    # Example: no duplicates
    check_stmt = """
    SELECT COUNT(*) FROM chat_projects
    WHERE chat_id=:c AND project_id=:p
    """
    exists_count = db.execute(check_stmt, {"c": chat_id, "p": project_id}).scalar()
    if exists_count == 0:
        insert_stmt = """
        INSERT INTO chat_projects (chat_id, project_id)
        VALUES (:c, :p)
        """
        db.execute(insert_stmt, {"c": chat_id, "p": project_id})
        db.commit()
        logger.info(f"Project {project_id} attached to chat {chat_id}")
        return {"success": True, "attached": True}
    else:
        return {"success": True, "attached": False, "message": "Project already attached to chat"}
