"""
conversation_service.py
----------------------
Service layer for conversation operations. Handles business logic
for conversation management and acts as mediator between routes
and database models.
"""
import logging
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models.conversation import Conversation

logger = logging.getLogger(__name__)

from config import settings

from fastapi import HTTPException
from config import settings

async def validate_model(model_id: str):
    """Validate allowed models including Claude"""
    from config import settings
    
    allowed_models = [
        "claude-3-7-sonnet-20250219",
        "gpt-4", 
        "gpt-3.5-turbo",
        "o1"
    ]
    
    if model_id not in allowed_models:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model. Allowed: {', '.join(allowed_models)}"
        )

async def create_conversation(
    project_id: UUID,
    user_id: int,
    title: str,
    model_id: str,
    db: AsyncSession
) -> Conversation:
    """
    Creates a new conversation with proper model alignment.
    
    Args:
        project_id: UUID of the parent project
        user_id: ID of the user creating the conversation
        title: Initial conversation title
        model_id: Model ID to use for this conversation
        db: Database session
        
    Returns:
        Newly created Conversation object
    """
    try:
        conv = Conversation(
            project_id=project_id,
            user_id=user_id,
            title=title,
            model_id=model_id
        )
        db.add(conv)
        await db.commit()
        await db.refresh(conv)
        return conv
    except Exception as e:
        logger.error(f"Error creating conversation: {str(e)}")
        await db.rollback()
        raise RuntimeError("Failed to create conversation")

async def list_project_conversations(
    project_id: UUID,
    db: AsyncSession,
    user_id: int,
    skip: int = 0,
    limit: int = 100
) -> list[Conversation]:
    """
    Retrieves conversations for a project with pagination.
    
    Args:
        project_id: UUID of the project
        db: Database session
        user_id: ID of requesting user
        skip: Number of items to skip
        limit: Maximum number of items to return
        
    Returns:
        List of Conversation objects
    """
    result = await db.execute(
        select(Conversation)
        .where(Conversation.project_id == project_id)
        .offset(skip)
        .limit(limit)
        .order_by(Conversation.created_at.desc())
    )
    return result.scalars().all()
