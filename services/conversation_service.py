"""
conversation_service.py
----------------------
Service layer for conversation operations. Handles business logic
for conversation management and acts as mediator between routes
and database models.
"""
import logging
from typing import Dict, List, Optional
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from models.conversation import Conversation
from models.project import Project
from models.knowledge_base import KnowledgeBase
from fastapi import HTTPException
from config import settings
from services.context_integration import augment_with_knowledge
from sqlalchemy import select
from sqlalchemy.orm import joinedload  # ADD THIS LINE
from datetime import datetime  # ADD THIS LINE

# Import utilities
from utils.db_utils import get_all_by_condition, save_model


logger = logging.getLogger(__name__)

# Create decorator for consistent error handling
def handle_service_errors(error_message="Service operation failed"):
    def decorator(func):
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except Exception as e:
                logger.error(f"{error_message}: {str(e)}")
                raise HTTPException(status_code=500, detail=f"{error_message}: {str(e)}")
        return wrapper
    return decorator

async def get_conversation_context(
    conversation_id: UUID,
    user_message: str,
    db: AsyncSession,
    max_tokens: Optional[int] = None
) -> List[Dict[str, str]]:
    """
    Get knowledge context for a conversation message.
    
    Args:
        conversation_id: ID of the conversation
        user_message: The user's message text
        db: Database session
        max_tokens: Optional token limit for context
        
    Returns:
        List of context message dicts to include in prompt
    """
    return await augment_with_knowledge(
        conversation_id=conversation_id,
        user_message=user_message,
        db=db,
        max_context_tokens=max_tokens
    )

async def validate_model(model_id: str):
    """Validate allowed models including Claude"""    
    # Get allowed Claude models from config
    allowed_models = settings.CLAUDE_MODELS
    
    # Add Azure OpenAI models
    allowed_models.extend(["o1", "o3-mini", "gpt-4", "gpt-3.5-turbo"])
    
    if model_id not in allowed_models:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model. Allowed: {', '.join(allowed_models)}"
        )

@handle_service_errors("Failed to create conversation")
async def create_conversation(
    project_id: Optional[UUID],  # Make project_id optional
    user_id: int,
    title: str,
    model_id: str,
    db: AsyncSession,
    use_knowledge_base: bool = False
) -> Conversation:
    """
    Creates a new conversation with validation that standalone conversations
    cannot use knowledge base.
    """
    try:
        await validate_model(model_id)
        
        # Create base conversation object with safe defaults
        conv = Conversation(
            project_id=project_id,
            user_id=user_id,
            title=title,
            model_id=model_id,
            use_knowledge_base=False,
            knowledge_base_id=None
        )

        # Validate and set knowledge base info if needed
        if project_id:
            project = await db.get(Project, project_id)
            await db.refresh(project, ["knowledge_base"])
            
            if project and project.knowledge_base_id:
                conv.use_knowledge_base = True
                conv.knowledge_base_id = project.knowledge_base_id

        try:
            # Verify KB with actual database content
            await conv.validate_knowledge_base(db)
        except Exception as e:
            logger.warning(f"Knowledge base validation failed: {str(e)} - continuing without KB")
            conv.use_knowledge_base = False
            conv.knowledge_base_id = None
        
        saved_conv = await save_model(db, conv)
        return saved_conv
        
    except Exception as e:
        logger.error(f"Error in create_conversation: {str(e)}", exc_info=True)
        raise

@handle_service_errors("Failed to delete conversation")
async def delete_conversation(
    project_id: UUID,
    conversation_id: UUID,
    db: AsyncSession,
    user_id: int
) -> UUID:
    """
    Soft-deletes a conversation with enhanced validation and logging.
    """
    logger.info(f"Attempting to delete conversation {conversation_id} in project {project_id}")
    
    # First validate project ownership
    project = await db.get(Project, project_id)
    if not project or project.user_id != user_id:
        logger.warning(f"User {user_id} unauthorized to delete from project {project_id}")
        raise HTTPException(403, "Unauthorized to delete resources in this project")

    # Get conversation with project relationship loaded
    stmt = select(Conversation).where(
        Conversation.id == conversation_id,
        Conversation.is_deleted.is_(False)
    ).options(joinedload(Conversation.project))
    
    result = await db.execute(stmt)
    conv = result.scalar_one_or_none()
    
    if not conv:
        logger.warning(f"Conversation {conversation_id} not found or already deleted")
        raise HTTPException(404, "Conversation not found")

    # Validate project association
    if str(conv.project_id) != str(project_id):
        logger.error(f"Conversation {conversation_id} belongs to project {conv.project_id} not {project_id}")
        raise HTTPException(400, "Conversation does not belong to specified project")

    # Soft delete with timestamp
    conv.is_deleted = True
    conv.deleted_at = datetime.utcnow()
    await save_model(db, conv)
    
    logger.info(f"Conversation {conversation_id} soft-deleted by user {user_id}")
    return UUID(str(conv.id))

@handle_service_errors("Failed to list project conversations")
async def list_project_conversations(
    project_id: UUID,
    db: AsyncSession,
    user_id: int,
    skip: int = 0,
    limit: int = 100
) -> list:
    """
    Retrieves conversations for a project with pagination.
    Returns serialized list of conversations.
    """
    logger.info(f"Listing conversations for project {project_id} (user_id={user_id})")
    
    # Use get_all_by_condition from db_utils
    conversations = await get_all_by_condition(
        db, 
        Conversation,
        Conversation.project_id == project_id,
        Conversation.is_deleted.is_(False),
        order_by=Conversation.created_at.desc(),
        limit=limit,
        offset=skip
    )
    
    logger.info(f"Found {len(conversations)} non-deleted conversations for project {project_id}")
    
    # Return serialized data
    return conversations
