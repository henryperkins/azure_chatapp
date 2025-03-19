"""
project_routes.py
-----------------
Enhanced project routes with UUIDs, token tracking, and advanced features.
Using consolidated auth and database utilities.
"""

import logging
from uuid import UUID
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from pydantic import BaseModel, Field
from schemas.project_schemas import (
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
    ArtifactCreate,
    ArtifactResponse
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import update, and_
from models.artifact import Artifact

from db import get_async_session
from models.user import User
from models.project import Project
from models.project_file import ProjectFile
from utils.auth_deps import (
    get_current_user_and_token, 
    validate_resource_ownership,
    verify_project_access,
    process_standard_response
)
from utils.context import get_by_id, get_all_by_condition, save_model, create_response

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
        # Create project using db utility
        project = Project(
            **project_data.dict(),
            user_id=current_user.id,
        )
        await save_model(db, project)
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
    return projects


@router.get("/{project_id}", response_model=ProjectResponse)
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
    return await process_standard_response(project)


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: UUID,
    update_data: ProjectUpdate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    # Verify project ownership
    project = await verify_project_access(project_id, current_user, db)
    
    update_dict = update_data.dict(exclude_unset=True)
    if 'max_tokens' in update_dict and update_dict['max_tokens'] < project.token_usage:
        raise HTTPException(400, "New token limit below current usage")
    
    for key, value in update_dict.items():
        setattr(project, key, value)
    
    await save_model(db, project)
    return await process_standard_response(project)


@router.patch("/{project_id}/archive", response_model=ProjectResponse)
async def toggle_archive_project(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    project = await verify_project_access(project_id, current_user, db)
    
    # Toggle archived status
    project.archived = not project.archived
    
    # If archiving, also remove pin
    if project.archived and project.pinned:
        project.pinned = False
        
    await save_model(db, project)
    return await process_standard_response(
        project, 
        message=f"Project {'archived' if project.archived else 'unarchived'} successfully"
    )

@router.post("/{project_id}/artifacts", response_model=ArtifactResponse, status_code=status.HTTP_201_CREATED)
async def create_artifact(
    project_id: UUID,
    artifact_data: ArtifactCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Create a new artifact for the project
    """
    # Verify project access first
    project = await verify_project_access(project_id, current_user, db)
    
    # Create the artifact
    new_artifact = Artifact(
        project_id=project_id,
        conversation_id=artifact_data.conversation_id,
        name=artifact_data.name,
        content_type=artifact_data.content_type,
        content=artifact_data.content
    )
    
    await save_model(db, new_artifact)
    return await process_standard_response(new_artifact, "Artifact created successfully")

@router.get("/{project_id}/artifacts", response_model=dict)
async def list_artifacts(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    List all artifacts for a project
    """
    # Verify project access
    await verify_project_access(project_id, current_user, db)
    
    # Get artifacts using enhanced db utility
    artifacts = await get_all_by_condition(
        db,
        Artifact,
        Artifact.project_id == project_id,
        order_by=Artifact.created_at.desc()
    )
    
    return await process_standard_response({
        "artifacts": [
            {
                "id": str(a.id),
                "name": a.name,
                "content_type": a.content_type,
                "created_at": a.created_at
            }
            for a in artifacts
        ]
    })

@router.get("/{project_id}/stats", response_model=dict)
async def get_project_stats(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Get statistics for a project including token usage, file count, etc.
    """
    project = await verify_project_access(project_id, current_user, db)
    
    from models.conversation import Conversation
    from models.project_file import ProjectFile
    from models.artifact import Artifact
    from sqlalchemy import func
    
    # Get conversation count using db utility
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
    
    return await process_standard_response({
        "token_usage": project.token_usage,
        "max_tokens": project.max_tokens,
        "usage_percentage": usage_percentage,
        "conversation_count": conversation_count,
        "file_count": file_count,
        "total_file_size": total_file_size,
        "artifact_count": artifact_count
    })

@router.post("/{project_id}/pin", response_model=ProjectResponse)
async def toggle_pin_project(
   project_id: UUID,
   current_user: User = Depends(get_current_user_and_token),
   db: AsyncSession = Depends(get_async_session)
):
   """
   Pin or unpin a project for quick access.
   Cannot pin archived projects.
   """
   project = await verify_project_access(project_id, current_user, db)
   
   if project.archived and not project.pinned:
       raise HTTPException(status_code=400, detail="Cannot pin an archived project")

   project.pinned = not project.pinned
   await save_model(db, project)
   
   return await process_standard_response(
       project,
       message=f"Project {'pinned' if project.pinned else 'unpinned'} successfully"
   )

@router.get("/{project_id}/artifacts/{artifact_id}", response_model=ArtifactResponse)
async def get_artifact(
   project_id: UUID,
   artifact_id: UUID,
   current_user: User = Depends(get_current_user_and_token),
   db: AsyncSession = Depends(get_async_session)
):
   """
   Get a specific artifact by ID
   """
   # Use validate_resource_ownership to check both project and artifact access
   artifact = await validate_resource_ownership(
       artifact_id,
       Artifact,
       current_user,
       db,
       "Artifact",
       [Artifact.project_id == project_id]
   )

   return await process_standard_response(artifact)

@router.delete("/{project_id}/artifacts/{artifact_id}", response_model=dict)
async def delete_artifact(
   project_id: UUID,
   artifact_id: UUID,
   current_user: User = Depends(get_current_user_and_token),
   db: AsyncSession = Depends(get_async_session)
):
   """
   Delete an artifact by ID
   """
   # Validate project access
   await verify_project_access(project_id, current_user, db)
   
   # Get the artifact
   artifact = await validate_resource_ownership(
       artifact_id,
       Artifact,
       current_user,
       db,
       "Artifact",
       [Artifact.project_id == project_id]
   )

   # Delete the artifact
   await db.delete(artifact)
   await db.commit()
   
   return await process_standard_response(
       {"artifact_id": str(artifact_id)},
       message="Artifact deleted successfully"
   )