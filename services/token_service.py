"""
token_service.py
----------------
Service for estimating token usage for conversation inputs.
Encapsulates all model resolution and token counting logic.
"""

from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException

from services.conversation_service import ConversationService
from utils.tokens import count_tokens_text

async def estimate_input_tokens(
    conversation_id: UUID,
    input_text: str,
    db: AsyncSession,
    user_id: int = None,
    project_id: UUID = None,
) -> int:
    """
    Estimate the number of tokens for a given input in the context of a conversation.

    Args:
        conversation_id: UUID of the conversation
        input_text: The input text to estimate tokens for
        db: AsyncSession for DB access
        user_id: (optional) user ID for access validation
        project_id: (optional) project ID for access validation

    Returns:
        Estimated token count (int)
    """
    # Use ConversationService to get conversation metadata (model_id)
    conv_service = ConversationService(db)
    conv = await conv_service.get_conversation(
        conversation_id=conversation_id,
        user_id=user_id,
        project_id=project_id,
    )
    model_id = conv.get("model_id") or conv.get("model_config", {}).get("model_id")
    if not model_id:
        raise HTTPException(status_code=400, detail="Model not set for conversation.")
    return count_tokens_text(input_text, model_id)
