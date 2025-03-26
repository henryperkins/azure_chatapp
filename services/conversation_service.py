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
from models.conversation import Conversation
from fastapi import HTTPException
from config import settings
from services.context_integration import augment_with_knowledge

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
    project_id: UUID,
    user_id: int,
    title: str,
    model_id: str,
    db: AsyncSession,
    use_knowledge_base: bool = False
) -> Conversation:
    """
    Creates a new conversation with proper model alignment.
    """
    logger.info(f"Creating conversation for project {project_id} with model {model_id}")
    
    try:
        # Validate model first (reuse existing function)
        await validate_model(model_id)
        logger.info("Model validation passed")
        
        # Create conversation object
        # Get project to check if it has a knowledge base
        project = await db.get(Project, project_id)
        kb_id = project.knowledge_base_id if project else None
        
        conv = Conversation(
            project_id=project_id,
            user_id=user_id,
            title=title,
            model_id=model_id,
            use_knowledge_base=use_knowledge_base and bool(kb_id),
            knowledge_base_id=kb_id if use_knowledge_base else None
        )
        logger.info("Conversation object created")
        
        # Use db_utils for saving
        saved_conv = await save_model(db, conv)
        if not saved_conv:
            logger.error("Failed to save conversation - save_model returned None")
            raise ValueError("Failed to save conversation - check database logs for details")
            
        logger.info(f"Conversation created successfully with ID {saved_conv.id}")
        return saved_conv
        
    except Exception as e:
        logger.error(f"Error in create_conversation: {str(e)}", exc_info=True)
        raise

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
