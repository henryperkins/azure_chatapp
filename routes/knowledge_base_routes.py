"""
knowledge_base_routes.py
-----------------------
Routes for managing knowledge bases and integrating them with ChatGPT.
Provides endpoints for:
 - Creating and managing knowledge bases
 - Searching knowledge within a project
 - Integrating knowledge into chat conversations
"""

import logging
from typing import List, Dict, Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Body
from sqlalchemy import update
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models.conversation import Conversation

from db import get_async_session
from models.user import User
from models.project import Project
from models.knowledge_base import KnowledgeBase
from utils.auth_utils import get_current_user_and_token
from utils.db_utils import validate_resource_access, get_all_by_condition
from utils.response_utils import create_standard_response
from services import knowledgebase_service

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================
# Pydantic Schemas
# ============================

class KnowledgeBaseCreate(BaseModel):
    """
    Schema for creating a new knowledge base.
    """
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    embedding_model: Optional[str] = None


class KnowledgeBaseUpdate(BaseModel):
    """
    Schema for updating an existing knowledge base.
    """
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    embedding_model: Optional[str] = None
    is_active: Optional[bool] = None


class SearchRequest(BaseModel):
    """
    Schema for searching the knowledge base.
    """
    query: str = Field(..., min_length=1)
    top_k: int = Field(5, ge=1, le=20)
    filters: Optional[Dict[str, Any]] = None


# ============================
# Knowledge Base Endpoints
# ============================

@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_knowledge_base(
    knowledge_base_data: KnowledgeBaseCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Create a new knowledge base.
    """
    try:
        knowledge_base = await knowledgebase_service.create_knowledge_base(
            name=knowledge_base_data.name,
            description=knowledge_base_data.description,
            embedding_model=knowledge_base_data.embedding_model,
            db=db
        )
        
        return await create_standard_response({
            "id": str(knowledge_base.id),
            "name": knowledge_base.name,
            "description": knowledge_base.description,
            "embedding_model": knowledge_base.embedding_model,
            "is_active": knowledge_base.is_active,
            "created_at": knowledge_base.created_at.isoformat() if knowledge_base.created_at else None
        }, "Knowledge base created successfully")
    except Exception as e:
        logger.error(f"Error creating knowledge base: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to create knowledge base: {str(e)}")


@router.get("", response_model=dict)
async def list_knowledge_bases(
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = 0,
    limit: int = 100,
    active_only: bool = True
):
    """
    List available knowledge bases.
    """
    try:
        # Build query conditions
        conditions = []
        if active_only:
            conditions.append(KnowledgeBase.is_active.is_(True))
        
        # Get knowledge bases
        knowledge_bases = await get_all_by_condition(
            db,
            KnowledgeBase,
            *conditions,
            order_by=KnowledgeBase.created_at.desc(),
            limit=limit,
            offset=skip
        )
        
        # Format response
        items = []
        for kb in knowledge_bases:
            items.append({
                "id": str(kb.id),
                "name": kb.name,
                "description": kb.description,
                "embedding_model": kb.embedding_model,
                "is_active": kb.is_active,
                "created_at": kb.created_at.isoformat() if kb.created_at else None
            })
        
        return await create_standard_response({"knowledge_bases": items})
    except Exception as e:
        logger.error(f"Error listing knowledge bases: {str(e)}")
        return await create_standard_response(
            {"knowledge_bases": []},
            f"Error retrieving knowledge bases: {str(e)}",
            success=False
        )


@router.get("/{knowledge_base_id}", response_model=dict)
async def get_knowledge_base(
    knowledge_base_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Get a specific knowledge base.
    """
    try:
        # Get knowledge base
        query = select(KnowledgeBase).where(KnowledgeBase.id == knowledge_base_id)
        result = await db.execute(query)
        knowledge_base = result.scalars().first()
        
        if not knowledge_base:
            raise HTTPException(status_code=404, detail="Knowledge base not found")
        
        # Return knowledge base data
        return await create_standard_response({
            "id": str(knowledge_base.id),
            "name": knowledge_base.name,
            "description": knowledge_base.description,
            "embedding_model": knowledge_base.embedding_model,
            "is_active": knowledge_base.is_active,
            "created_at": knowledge_base.created_at.isoformat() if knowledge_base.created_at else None,
            "updated_at": knowledge_base.updated_at.isoformat() if knowledge_base.updated_at else None
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting knowledge base: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error retrieving knowledge base: {str(e)}")


@router.patch("/{knowledge_base_id}", response_model=dict)
async def update_knowledge_base(
    knowledge_base_id: UUID,
    update_data: KnowledgeBaseUpdate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Update an existing knowledge base.
    """
    try:
        # Get knowledge base
        query = select(KnowledgeBase).where(KnowledgeBase.id == knowledge_base_id)
        result = await db.execute(query)
        knowledge_base = result.scalars().first()
        
        if not knowledge_base:
            raise HTTPException(status_code=404, detail="Knowledge base not found")
        
        # Update fields
        if update_data.name is not None:
            knowledge_base.name = update_data.name
        
        if update_data.description is not None:
            knowledge_base.description = update_data.description
        
        if update_data.embedding_model is not None:
            knowledge_base.embedding_model = update_data.embedding_model
        
        if update_data.is_active is not None:
            knowledge_base.is_active = update_data.is_active
        
        # Save changes
        db.add(knowledge_base)
        await db.commit()
        await db.refresh(knowledge_base)
        
        # Return updated knowledge base
        return await create_standard_response({
            "id": str(knowledge_base.id),
            "name": knowledge_base.name,
            "description": knowledge_base.description,
            "embedding_model": knowledge_base.embedding_model,
            "is_active": knowledge_base.is_active,
            "updated_at": knowledge_base.updated_at.isoformat() if knowledge_base.updated_at else None
        }, "Knowledge base updated successfully")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating knowledge base: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error updating knowledge base: {str(e)}")


@router.delete("/{knowledge_base_id}", response_model=dict)
async def delete_knowledge_base(
    knowledge_base_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Delete a knowledge base.
    """
    try:
        # Get knowledge base
        query = select(KnowledgeBase).where(KnowledgeBase.id == knowledge_base_id)
        result = await db.execute(query)
        knowledge_base = result.scalars().first()
        
        if not knowledge_base:
            raise HTTPException(status_code=404, detail="Knowledge base not found")
        
        # Delete knowledge base
        await db.delete(knowledge_base)
        await db.commit()
        
        return await create_standard_response(
            {"id": str(knowledge_base_id)},
            "Knowledge base deleted successfully"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting knowledge base: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error deleting knowledge base: {str(e)}")


# ============================
# Search Endpoints
# ============================

@router.post("/projects/{project_id}/search", response_model=dict)
async def search_project_knowledge(
    project_id: UUID,
    search_request: SearchRequest,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Search for knowledge within a project using the knowledge base.
    """
    try:
        # Validate project access
        project = await validate_resource_access(
            project_id,
            Project,
            current_user,
            db,
            "Project",
            []
        )
        
        # Search for context
        search_results = await knowledgebase_service.search_project_context(
            project_id=project_id,
            query=search_request.query,
            db=db,
            top_k=search_request.top_k
        )
        
        return await create_standard_response({
            "results": search_results,
            "count": len(search_results),
            "query": search_request.query
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error searching project knowledge: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error searching project knowledge: {str(e)}")

    @router.post("/projects/{project_id}/toggle", response_model=dict)
    async def toggle_project_knowledge_base(
        project_id: UUID,
        enable: bool = Body(..., embed=True),
        current_user: User = Depends(get_current_user_and_token),
        db: AsyncSession = Depends(get_async_session)
    ):
        """
        Enable/disable knowledge base for all conversations in a project.
        Requires project's knowledge base to be active.
        """
        # Validate project access
        project = await validate_resource_access(
            project_id,
            Project,
            current_user,
            db,
            "Project"
        )
    
        if enable and not project.knowledge_base_id:
            raise HTTPException(
                status_code=400,
                detail="Project has no linked knowledge base"
            )
    
        if enable:
            # Verify knowledge base is active
            kb = await db.get(KnowledgeBase, project.knowledge_base_id)
            if not kb or not kb.is_active:
                raise HTTPException(
                    status_code=400,
                    detail="Project's knowledge base is not active"
                )

        # Update all conversations
        await db.execute(
            update(Conversation)
            .where(Conversation.project_id == project_id)
            .values(use_knowledge_base=enable)
        )
        await db.commit()

        return await create_standard_response(
            {"project_id": str(project_id), "knowledge_base_enabled": enable},
            f"Knowledge base {'enabled' if enable else 'disabled'} for project"
        )
    
