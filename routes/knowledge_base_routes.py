"""
knowledge_base_routes.py
-----------------------
Routes for knowledge base management with proper authentication.
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from pydantic import BaseModel
from typing import Optional, List
from uuid import UUID

from db import get_async_session
from models.knowledge_base import KnowledgeBase
from models.user import User
from utils.auth_deps import get_current_user_and_token, process_standard_response, validate_resource_ownership

logger = logging.getLogger(__name__)
router = APIRouter()

class KnowledgeBaseCreate(BaseModel):
    name: str
    description: Optional[str] = None
    embedding_model: Optional[str] = None

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_knowledge_base(
    data: KnowledgeBaseCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Creates a new knowledge base owned by the current user.
    """
    # Create the knowledge base with user ownership
    knowledge_base = KnowledgeBase(
        user_id=current_user.id,
        **data.dict()
    )
    db.add(knowledge_base)
    await db.commit()
    await db.refresh(knowledge_base)
    
    logger.info(f"Knowledge base created with id={knowledge_base.id} by user {current_user.id}")
    
    return await process_standard_response(
        {
            "id": knowledge_base.id,
            "name": knowledge_base.name,
            "description": knowledge_base.description
        },
        "Knowledge base created successfully"
    )

@router.get("")
async def list_knowledge_bases(
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Lists all knowledge bases owned by the current user.
    """
    result = await db.execute(
        select(KnowledgeBase)
        .where(KnowledgeBase.user_id == current_user.id)
        .order_by(KnowledgeBase.name)
    )
    knowledge_bases = result.scalars().all()
    
    return await process_standard_response({
        "knowledge_bases": [
            {
                "id": kb.id,
                "name": kb.name,
                "description": kb.description,
                "created_at": kb.created_at
            }
            for kb in knowledge_bases
        ]
    })

@router.get("/{kb_id}")
async def get_knowledge_base(
    kb_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Retrieves a specific knowledge base by ID.
    """
    kb = await validate_resource_ownership(
        kb_id,
        KnowledgeBase,
        current_user,
        db,
        "Knowledge Base"
    )
    
    return await process_standard_response({
        "id": kb.id,
        "name": kb.name,
        "description": kb.description,
        "embedding_model": kb.embedding_model,
        "created_at": kb.created_at
    })

@router.delete("/{kb_id}")
async def delete_knowledge_base(
    kb_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Deletes a knowledge base owned by the current user.
    """
    kb = await validate_resource_ownership(
        kb_id,
        KnowledgeBase,
        current_user,
        db,
        "Knowledge Base"
    )
    
    await db.delete(kb)
    await db.commit()
    
    logger.info(f"Knowledge base {kb_id} deleted by user {current_user.id}")
    
    return await process_standard_response(
        {"id": kb_id},
        "Knowledge base deleted successfully"
    )