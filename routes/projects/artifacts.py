"""
p_artifacts.py
-------------
Routes for managing artifacts within a project.
Provides endpoints for creating, listing, retrieving and deleting artifacts.
"""

import logging
from uuid import UUID
from typing import Optional, Dict, List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from db import get_async_session
from models.user import User
from models.project import Project
from models.artifact import Artifact
from models.conversation import Conversation
from utils.auth_deps import (
    get_current_user_and_token,
    validate_resource_ownership,
    process_standard_response
)
from utils.context import (
    get_all_by_condition,
    get_by_id,
    save_model
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================
# Pydantic Schemas
# ============================

class ArtifactCreate(BaseModel):
    """
    Schema for creating a new artifact
    """
    name: str = Field(..., min_length=1, max_length=200)
    content_type: str = Field(..., description="Type of content: code, document, etc.")
    content: str = Field(..., description="The actual content of the artifact")
    conversation_id: Optional[UUID] = None


# ============================
# Artifact Endpoints
# ============================

@router.post("/{project_id}/artifacts", response_model=dict, status_code=status.HTTP_201_CREATED)
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
    project = await validate_resource_ownership(
        project_id,
        Project,
        current_user,
        db,
        "Project",
        [
            Project.user_id == current_user.id,
            Project.archived.is_(False)  # Cannot modify archived projects
        ]
    )
    
    # If conversation_id is provided, validate it belongs to this project
    if artifact_data.conversation_id:
        conversation = await validate_resource_ownership(
            artifact_data.conversation_id,
            Conversation,
            current_user,
            db,
            "Conversation",
            [
                Conversation.project_id == project_id,
                Conversation.is_deleted.is_(False)
            ]
        )
    
    # Validate content type
    content_type = artifact_data.content_type.lower()
    valid_types = ["code", "document", "image", "audio", "video"]
    if content_type not in valid_types:
        logger.warning(f"Non-standard content type provided: {content_type}")
    
    # Create the artifact
    new_artifact = Artifact(
        project_id=project_id,
        conversation_id=artifact_data.conversation_id,
        name=artifact_data.name,
        content_type=content_type,
        content=artifact_data.content
    )
    
    # Add extra metadata
    char_count = len(artifact_data.content)
    line_count = artifact_data.content.count('\n') + 1
    token_estimate = char_count // 4  # Rough token estimation
    
    new_artifact.extra_data = {
        "char_count": char_count,
        "line_count": line_count,
        "token_estimate": token_estimate,
        "created_from_conversation": artifact_data.conversation_id is not None
    }
    
    await save_model(db, new_artifact)
    
    # Serialize artifact for response
    serialized_artifact = {
        "id": str(new_artifact.id),
        "project_id": str(new_artifact.project_id),
        "conversation_id": str(new_artifact.conversation_id) if new_artifact.conversation_id else None,
        "name": new_artifact.name,
        "content_type": new_artifact.content_type,
        "content": new_artifact.content,
        "created_at": new_artifact.created_at.isoformat() if new_artifact.created_at else None,
        "extra_data": new_artifact.extra_data
    }
    
    return await process_standard_response(serialized_artifact, "Artifact created successfully")


@router.get("/{project_id}/artifacts", response_model=dict)
async def list_artifacts(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conversation_id: Optional[UUID] = None,
    content_type: Optional[str] = None,
    skip: int = 0,
    limit: int = 100
):
    """
    List all artifacts for a project with optional filtering
    """
    # Verify project access
    project = await validate_resource_ownership(
        project_id,
        Project,
        current_user,
        db,
        "Project",
        [Project.user_id == current_user.id]
    )
    
    # Build conditions for the query
    conditions = [Artifact.project_id == project_id]
    
    if conversation_id:
        conditions.append(Artifact.conversation_id == conversation_id)
    
    if content_type:
        conditions.append(Artifact.content_type == content_type.lower())
    
    # Get artifacts using enhanced function
    artifacts = await get_all_by_condition(
        db,
        Artifact,
        *conditions,
        order_by=Artifact.created_at.desc(),
        limit=limit,
        offset=skip
    )
    
    # Create a preview for each artifact (first 150 chars)
    artifact_list = []
    for artifact in artifacts:
        artifact_dict = {
            "id": str(artifact.id),
            "project_id": str(artifact.project_id),
            "conversation_id": str(artifact.conversation_id) if artifact.conversation_id else None,
            "name": artifact.name,
            "content_type": artifact.content_type,
            "created_at": artifact.created_at,
            "metadata": artifact.extra_data,
            "content_preview": artifact.content[:150] + "..." if len(artifact.content) > 150 else artifact.content
        }
        artifact_list.append(artifact_dict)
    
    return await process_standard_response({"artifacts": artifact_list})


@router.get("/{project_id}/artifacts/{artifact_id}", response_model=dict)
async def get_artifact(
   project_id: UUID,
   artifact_id: UUID,
   current_user: User = Depends(get_current_user_and_token),
   db: AsyncSession = Depends(get_async_session)
):
   """
   Get a specific artifact by ID
   """
   # Verify project access
   project = await validate_resource_ownership(
       project_id,
       Project,
       current_user,
       db,
       "Project",
       [Project.user_id == current_user.id]
   )
   
   # Get the artifact
   artifact = await validate_resource_ownership(
       artifact_id,
       Artifact,
       current_user,
       db,
       "Artifact",
       [Artifact.project_id == project_id]
   )

   # Serialize artifact for response
   serialized_artifact = {
       "id": str(artifact.id),
       "project_id": str(artifact.project_id),
       "conversation_id": str(artifact.conversation_id) if artifact.conversation_id else None,
       "name": artifact.name,
       "content_type": artifact.content_type,
       "content": artifact.content,
       "created_at": artifact.created_at.isoformat() if artifact.created_at else None,
       "extra_data": artifact.extra_data
   }
   
   return await process_standard_response(serialized_artifact)


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
   # Verify project access
   project = await validate_resource_ownership(
       project_id,
       Project,
       current_user,
       db,
       "Project",
       [
           Project.user_id == current_user.id,
           Project.archived.is_(False)  # Cannot modify archived projects
       ]
   )
   
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
