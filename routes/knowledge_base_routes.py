# Create routes/knowledge_base_routes.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional, List
from uuid import UUID

from db import get_async_session
from models.knowledge_base import KnowledgeBase
from models.user import User
from utils.auth_deps import get_current_user_and_token, process_standard_response

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
    knowledge_base = KnowledgeBase(**data.dict())
    db.add(knowledge_base)
    await db.commit()
    await db.refresh(knowledge_base)
    
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
    from sqlalchemy.future import select
    result = await db.execute(select(KnowledgeBase).order_by(KnowledgeBase.name))
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

# Additional endpoints for get/update/delete as needed