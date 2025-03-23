"""
p_artifacts.py
--------------
Routes for managing artifacts within a project.
Provides endpoints for creating, listing, retrieving and deleting artifacts.
"""

import logging
from uuid import UUID
from typing import Optional, List, Dict, Any
from types import SimpleNamespace

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

import services.artifact_service
from db import get_async_session
from models.user import User
from utils.auth_utils import get_current_user_and_token
from utils.response_utils import create_standard_response

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================
# Pydantic Schemas
# ============================

class ArtifactCreate(BaseModel):
    """
    Schema for creating a new artifact.
    """
    name: str = Field(..., min_length=1, max_length=200)
    content_type: str = Field(..., description="Type of content: code, document, etc.")
    content: str = Field(..., description="The actual content of the artifact")
    conversation_id: Optional[UUID] = None


# ============================
# Artifact Endpoints
# ============================

@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_artifact(
    project_id: UUID,
    artifact_data: ArtifactCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Create a new artifact for the project."""
    artifact = await services.artifact_service.create_artifact(
        db=db,
        project_id=project_id,
        name=artifact_data.name,
        content_type=artifact_data.content_type,
        content=artifact_data.content,
        conversation_id=artifact_data.conversation_id,
        user_id=current_user.id
    )
    return await create_standard_response(artifact, "Artifact created successfully")


@router.get("", response_model=dict)
async def list_artifacts(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conversation_id: Optional[UUID] = None,
    content_type: Optional[str] = None,
    skip: int = 0,
    limit: int = 100
):
    """List all artifacts for a project with optional filtering."""
    # The service returns a list of dictionaries.
    artifacts_data: List[Dict[str, Any]] = await services.artifact_service.list_artifacts(
        project_id=project_id,
        db=db,
        conversation_id=conversation_id,
        content_type=content_type,
        skip=skip,
        limit=limit,
        user_id=current_user.id
    )

    # Convert dictionaries to objects so that dot notation works.
    artifacts = [SimpleNamespace(**art) for art in artifacts_data]

    return await create_standard_response({
        "artifacts": [
            {
                "id": str(art.id),
                "project_id": str(art.project_id),
                "conversation_id": str(art.conversation_id) if art.conversation_id else None,
                "name": art.name,
                "content_type": art.content_type,
                "created_at": art.created_at.isoformat(),
                "metadata": art.metadata,  # Adjust this key if needed (e.g., extra_data)
                "content_preview": (art.content[:150] + "..." if len(art.content) > 150 else art.content)
            }
            for art in artifacts
        ],
        "count": len(artifacts),
        "project_id": str(project_id)
    })


@router.get("/{artifact_id}", response_model=dict)
async def get_artifact(
    project_id: UUID,
    artifact_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Get a specific artifact by ID."""
    artifact = await services.artifact_service.get_artifact(
        db=db,
        artifact_id=artifact_id,
        project_id=project_id,
        user_id=current_user.id
    )
    return await create_standard_response(artifact)


@router.delete("/{artifact_id}", response_model=dict)
async def delete_artifact(
    project_id: UUID,
    artifact_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Delete an artifact by ID."""
    result = await services.artifact_service.delete_artifact(
        db=db,
        artifact_id=artifact_id,
        project_id=project_id,
        user_id=current_user.id
    )
    return await create_standard_response(result)
