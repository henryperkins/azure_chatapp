```python
"""
p_artifacts.py
--------------
Routes for managing artifacts within a project.
Provides endpoints for creating, listing, retrieving, and deleting artifacts.
"""

import logging
from uuid import UUID
from typing import Optional

from fastapi import APIRouter, Depends, status, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from services import artifact_service
from db import get_async_session
from models.user import User
from utils.auth_utils import get_current_user_and_token
from utils.response_utils import create_standard_response
from utils.serializers import serialize_artifact

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
    current_user_and_token: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Create a new artifact for the project.
    """
    user, _token = current_user_and_token
    try:
        artifact = await artifact_service.create_artifact(
            db=db,
            project_id=project_id,
            name=artifact_data.name,
            content_type=artifact_data.content_type,
            content=artifact_data.content,
            conversation_id=artifact_data.conversation_id,
            user_id=user.id,
        )

        serialized_artifact = serialize_artifact(artifact)
        return await create_standard_response(
            serialized_artifact, "Artifact created successfully"
        )
    except HTTPException:
        raise
    except Exception as _e:
        logger.error("Error creating artifact", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create artifact",
        ) from _e


@router.get("", response_model=dict)
async def list_artifacts(
    project_id: UUID,
    current_user_and_token: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conversation_id: Optional[UUID] = None,
    content_type: Optional[str] = None,
    search_term: Optional[str] = None,
    sort_by: str = "created_at",
    sort_desc: bool = True,
    skip: int = 0,
    limit: int = 100,
):
    """
    List all artifacts for a project with optional filtering.
    """
    user, _token = current_user_and_token
    try:
        artifacts = await artifact_service.list_artifacts(
            project_id=project_id,
            db=db,
            conversation_id=conversation_id,
            content_type=content_type,
            search_term=search_term,
            sort_by=sort_by,
            sort_desc=sort_desc,
            skip=skip,
            limit=limit,
            user_id=user.id,
        )

        return await create_standard_response(
            {
                "artifacts": artifacts,
                "count": len(artifacts),
                "project_id": str(project_id),
            }
        )
    except HTTPException:
        raise
    except Exception as _e:
        logger.error("Error listing artifacts", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to list artifacts",
        ) from _e


@router.get("/stats", response_model=dict)
async def get_artifact_stats(
    project_id: UUID,
    current_user_and_token: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Get statistics about artifacts in the project.
    """
    user, _token = current_user_and_token
    try:
        stats = await artifact_service.get_artifact_stats(
            project_id=project_id,
            db=db,
            user_id=user.id,
        )

        return await create_standard_response(stats)
    except HTTPException:
        raise
    except Exception as _e:
        logger.error("Error retrieving artifact statistics", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve artifact statistics",
        ) from _e


@router.get("/{artifact_id}", response_model=dict)
async def get_artifact(
    project_id: UUID,
    artifact_id: UUID,
    current_user_and_token: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Get a specific artifact by ID.
    """
    user, _token = current_user_and_token
    try:
        artifact = await artifact_service.get_artifact(
            db=db,
            artifact_id=artifact_id,
            project_id=project_id,
            user_id=user.id,
        )

        serialized_artifact = serialize_artifact(artifact)
        return await create_standard_response(serialized_artifact)
    except HTTPException:
        raise
    except Exception as _e:
        logger.error("Error retrieving artifact", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve artifact",
        ) from _e


@router.put("/{artifact_id}", response_model=dict)
async def update_artifact(
    project_id: UUID,
    artifact_id: UUID,
    update_data: dict,
    current_user_and_token: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Update an artifact by ID.
    """
    user, _token = current_user_and_token
    try:
        artifact = await artifact_service.update_artifact(
            db=db,
            artifact_id=artifact_id,
            project_id=project_id,
            update_data=update_data,
            user_id=user.id,
        )

        serialized_artifact = serialize_artifact(artifact)
        return await create_standard_response(
            serialized_artifact, message="Artifact updated successfully"
        )
    except HTTPException:
        raise
    except Exception as _e:
        logger.error("Error updating artifact", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update artifact",
        ) from _e


@router.delete("/{artifact_id}", response_model=dict)
async def delete_artifact(
    project_id: UUID,
    artifact_id: UUID,
    current_user_and_token: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Delete an artifact by ID.
    """
    user, _token = current_user_and_token
    try:
        result = await artifact_service.delete_artifact(
            db=db,
            artifact_id=artifact_id,
            project_id=project_id,
            user_id=user.id,
        )

        return await create_standard_response(
            result, message=result.get("message", "Artifact deleted successfully")
        )
    except HTTPException:
        raise
    except Exception as _e:
        logger.error("Error deleting artifact", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete artifact",
        ) from _e


@router.get("/{artifact_id}/export", response_model=dict)
async def export_artifact(
    project_id: UUID,
    artifact_id: UUID,
    export_format: str = "text",
    current_user_and_token: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Export an artifact in various formats.
    """
    user, _token = current_user_and_token
    try:
        export_data = await artifact_service.export_artifact(
            db=db,
            artifact_id=artifact_id,
            project_id=project_id,
            export_format=export_format,
            user_id=user.id,
        )

        return await create_standard_response(
            export_data, message=f"Artifact exported as {export_format} successfully"
        )
    except HTTPException:
        raise
    except Exception as _e:
        logger.error("Error exporting artifact", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to export artifact",
        ) from _e

```