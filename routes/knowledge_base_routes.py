"""
knowledge_base_routes.py
-----------------------
Routes for knowledge base management with proper authentication.
Provides endpoints for creating, listing, retrieving, and deleting knowledge bases.
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field
from typing import Optional, Dict
from uuid import UUID

from db import get_async_session
from models.knowledge_base import KnowledgeBase
from models.user import User
from utils.auth_utils import (
    get_current_user_and_token,
    create_standard_response
)
from utils.db_utils import validate_resource_access

from utils.context import (
    get_all_by_condition,
    save_model
)
from utils.serializers import serialize_list

logger = logging.getLogger(__name__)
router = APIRouter()

# ============================
# Pydantic Schemas
# ============================

class KnowledgeBaseCreate(BaseModel):
    """Schema for creating a new knowledge base"""
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    embedding_model: Optional[str] = None


class KnowledgeBaseUpdate(BaseModel):
    """Schema for updating an existing knowledge base"""
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    embedding_model: Optional[str] = None
    is_active: Optional[bool] = None


# ============================
# Knowledge Base Endpoints
# ============================

@router.post("", status_code=status.HTTP_201_CREATED, response_model=Dict)
async def create_knowledge_base(
    data: KnowledgeBaseCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Create a new knowledge base using the knowledge base service"""
    # Use knowledge base service
    kb = await services.knowledgebase_service.create_knowledge_base(
        name=data.name,
        description=data.description,
        embedding_model=data.embedding_model,
        user_id=current_user.id,
        db=db
    )
    
    return await create_standard_response({
        "id": str(kb.id),
        "name": kb.name,
        "description": kb.description,
        "embedding_model": kb.embedding_model,
        "is_active": kb.is_active,
        "created_at": kb.created_at.isoformat()
    }, "Knowledge base created successfully")


@router.get("", response_model=Dict)
async def list_knowledge_bases(
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    is_active: Optional[bool] = None,
    skip: int = 0,
    limit: int = 50
):
    """
    Lists knowledge bases with optional filtering.
    """
    # Build conditions
    conditions = []
    if is_active is not None:
        conditions.append(KnowledgeBase.is_active == is_active)
    
    # Get knowledge bases using utility function
    knowledge_bases = await get_all_by_condition(
        db,
        KnowledgeBase,
        *conditions,
        order_by=KnowledgeBase.name,
        limit=limit,
        offset=skip
    )
    
    # Serialize to dictionaries
    kb_list = [
        {
            "id": str(kb.id),
            "name": kb.name,
            "description": kb.description,
            "embedding_model": kb.embedding_model,
            "is_active": kb.is_active,
            "created_at": kb.created_at
        }
        for kb in knowledge_bases
    ]
    
    return await create_standard_response({"knowledge_bases": kb_list})


@router.get("/{kb_id}", response_model=Dict)
async def get_knowledge_base(
    kb_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Retrieves a specific knowledge base by ID.
    """
    # Get the knowledge base using utility function
    kb = await validate_resource_access(
        kb_id,
        KnowledgeBase,
        current_user,
        db,
        "Knowledge Base"
    )
    
    return await create_standard_response({
        "id": str(kb.id),
        "name": kb.name,
        "description": kb.description,
        "embedding_model": kb.embedding_model,
        "is_active": kb.is_active,
        "created_at": kb.created_at,
        "updated_at": kb.updated_at
    })


@router.patch("/{kb_id}", response_model=Dict)
async def update_knowledge_base(
    kb_id: UUID,
    update_data: KnowledgeBaseUpdate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Updates an existing knowledge base.
    """
    # Get the knowledge base using utility function
    kb = await validate_resource_access(
        kb_id,
        KnowledgeBase,
        current_user,
        db,
        "Knowledge Base"
    )
    
    # Apply updates
    update_dict = update_data.dict(exclude_unset=True)
    for key, value in update_dict.items():
        setattr(kb, key, value)
    
    # Save changes
    await save_model(db, kb)
    
    return await create_standard_response(
        {
            "id": str(kb.id),
            "name": kb.name,
            "description": kb.description,
            "embedding_model": kb.embedding_model,
            "is_active": kb.is_active,
            "updated_at": kb.updated_at
        },
        "Knowledge base updated successfully"
    )


@router.delete("/{kb_id}", response_model=Dict)
async def delete_knowledge_base(
    kb_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Deletes a knowledge base owned by the current user.
    """
    # Get the knowledge base using utility function
    kb = await validate_resource_access(
        kb_id,
        KnowledgeBase,
        current_user,
        db,
        "Knowledge Base"
    )
    
    # Delete the knowledge base
    await db.delete(kb)
    await db.commit()
    
    logger.info(f"Knowledge base {kb_id} deleted by user {current_user.id}")
    
    return await create_standard_response(
        {"id": str(kb_id)},
        "Knowledge base deleted successfully"
    )


@router.get("/{kb_id}/projects", response_model=Dict)
async def list_knowledge_base_projects(
    kb_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Lists all projects associated with the specified knowledge base.
    """
    # Get the knowledge base using utility function
    kb = await validate_resource_access(
        kb_id,
        KnowledgeBase,
        current_user,
        db,
        "Knowledge Base"
    )
    
    # Get associated projects
    from models.project import Project
    projects = await get_all_by_condition(
        db,
        Project,
        Project.knowledge_base_id == kb_id,
        Project.user_id == current_user.id
    )
    
    # Serialize projects using the utility function
    from utils.serializers import serialize_project
    project_list = [serialize_project(project) for project in projects]
    
    return await create_standard_response({"projects": project_list})
