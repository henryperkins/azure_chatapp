"""
ai_response.py
------------
Handles AI response generation logic for chat conversations.
Centralizes OpenAI API calls and response processing.

This version uses db_utils.py and response_utils.py to reduce duplication.
"""
import logging
from typing import Dict, Any, Optional, List
from uuid import UUID

from fastapi import HTTPException, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from models.conversation import Conversation
from models.message import Message
from utils.openai import openai_chat
from utils.db_utils import get_by_id, save_model
from utils.response_utils import create_standard_response
from utils.message_handlers import (
    get_conversation_messages,
    update_project_token_usage
)
from utils.serializers import serialize_message

logger = logging.getLogger(__name__)


async def generate_ai_response(
    conversation_id: UUID,
    messages: List[Dict[str, str]],
    model_id: Optional[str],
    image_data: Optional[str] = None,
    vision_detail: str = "auto",
    db: AsyncSession = None
) -> Optional[Message]:
    """
    Generate an AI response for a conversation using OpenAI API.
    
    Args:
        conversation_id: Conversation ID
        messages: List of message dictionaries
        model_id: OpenAI model ID
        image_data: Optional base64 image data for vision
        vision_detail: Detail level for vision
        db: Database session
        
    Returns:
        Created assistant Message object or None if error
    """
    chosen_model = "o1" if image_data else (model_id or "o1")
    
    try:
        # Call OpenAI API
        openai_response = await openai_chat(
            messages=messages,
            model_name=chosen_model,
            image_data=image_data,
            vision_detail=vision_detail
        )
        
        assistant_content = openai_response["choices"][0]["message"]["content"]
        
        # Create assistant message
        assistant_msg = Message(
            conversation_id=conversation_id,
            role="assistant",
            content=assistant_content
        )
        
        # Save using utility function if db session provided
        if db:
            await save_model(db, assistant_msg)
            
            # Update token usage if applicable
            conversation = await get_by_id(db, Conversation, conversation_id)
            if conversation:
                token_estimate = len(assistant_content) // 4
                await update_project_token_usage(conversation, token_estimate, db)
        
        return assistant_msg
    except Exception as e:
        logger.error(f"Error calling OpenAI: {e}")
        return None


async def handle_websocket_response(
    conversation_id: UUID,
    db: AsyncSession,
    websocket: WebSocket
) -> None:
    """
    Handle AI response generation for WebSocket connections.
    
    Args:
        conversation_id: Conversation ID
        db: Database session
        websocket: WebSocket connection
    """
    try:
        # Get conversation
        conversation = await get_by_id(db, Conversation, conversation_id)
        if not conversation:
            await websocket.send_json(
                await create_standard_response(None, "Conversation not found", False)
            )
            return
            
        # Get formatted messages for API
        msg_dicts = await get_conversation_messages(conversation_id, db)
        
        # Generate AI response
        assistant_msg = await generate_ai_response(
            conversation_id=conversation_id,
            messages=msg_dicts,
            model_id=conversation.model_id,
            db=db
        )
        
        if assistant_msg:
            # Send response via WebSocket
            await websocket.send_json({
                "id": str(assistant_msg.id),
                "role": assistant_msg.role,
                "content": assistant_msg.content
            })
        else:
            await websocket.send_json(
                await create_standard_response(None, "Failed to generate AI response", False)
            )
    except Exception as e:
        logger.error(f"WebSocket AI response error: {e}")
        await websocket.send_json(
            await create_standard_response(None, f"Error generating response: {str(e)}", False)
        )