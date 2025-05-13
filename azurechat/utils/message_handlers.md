```python
"""
message_handlers.py
-----------------
Provides utilities for message handling across conversation endpoints.
Centralizes message creation, validation, and processing logic.

This version has been updated to use db_utils.py functions instead of direct DB access.
"""

import logging
import base64
from typing import Optional, List
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from models.conversation import Conversation
from models.message import Message
from models.project import Project
from utils.openai import extract_base64_data
from utils.context import manage_context, token_limit_check
from utils.db_utils import get_by_id, get_all_by_condition, save_model

logger = logging.getLogger(__name__)


async def validate_image_data(image_data: Optional[str]) -> bool:
    """
    Validate base64 image data for vision API.

    Args:
        image_data: Base64 encoded image data

    Returns:
        True if valid, raises HTTPException otherwise
    """
    if not image_data:
        return True

    try:
        base64_str = extract_base64_data(image_data)
        if base64_str is None:
            raise HTTPException(status_code=400, detail="No image data provided")
        base64.b64decode(base64_str, validate=True)
        return True
    except Exception as e:
        logger.error(f"Invalid image data: {str(e)}")
        raise HTTPException(status_code=400, detail="Invalid image data")

async def create_user_message(
    conversation_id: UUID, content: str, role: str, db: AsyncSession
) -> Message:
    """
    Create a new user or system message for a conversation.

    Args:
        conversation_id: Conversation ID
        content: Message content
        role: Message role (user, system)
        db: Database session

    Returns:
        Created Message object
    """
    try:
        # Create message
        if not content:
            raise ValueError("Message content cannot be empty")

        message = Message(
            conversation_id=conversation_id,
            role=role.lower().strip(),
            content=content.strip(),
        )

        # Save using utility function from db_utils
        await save_model(db, message)

        logger.info(f"Message {message.id} saved for conversation {conversation_id}")

        # Check token limit for conversation context
        await token_limit_check(str(conversation_id), db)

        return message
    except Exception as e:
        await db.rollback()
        logger.error(f"Message save failed: {str(e)}")
        raise HTTPException(500, "Failed to save message")


async def get_conversation_messages(
    conversation_id: UUID, db: AsyncSession, include_system_prompt: bool = True
) -> List[dict[str, str]]:
    """
    Get all messages for a conversation formatted for OpenAI API.

    Args:
        conversation_id: Conversation ID
        db: Database session
        include_system_prompt: Whether to include custom instructions from project

    Returns:
        List of message dictionaries formatted for OpenAI API
    """
    # Get conversation to check for project_id
    conversation = await get_by_id(db, Conversation, conversation_id)
    if not conversation:
        raise HTTPException(404, "Conversation not found")

    # Get all messages using function from db_utils
    messages = await get_all_by_condition(
        db,
        Message,
        Message.conversation_id == conversation_id,
        order_by=Message.created_at.asc(),
    )

    # Format messages for API
    msg_dicts = [{"role": str(m.role), "content": str(m.content)} for m in messages]

    # Add custom instructions if the conversation has a project
    if include_system_prompt and conversation.project_id:
        project = await get_by_id(db, Project, UUID(str(conversation.project_id)))
        if project and project.custom_instructions:
            msg_dicts.insert(
                0, {"role": "system", "content": project.custom_instructions}
            )

    # Manage context to prevent token overflow
    return await manage_context(msg_dicts)


async def update_project_token_usage(
    conversation: Conversation, token_count: int, db: AsyncSession
) -> None:
    """
    Update the token usage for a project.

    Args:
        conversation: Conversation object
        token_count: Number of tokens to add
        db: Database session
    """
    if not conversation.project_id:
        return

    project = await get_by_id(db, Project, UUID(str(conversation.project_id)))
    if project:
        project.token_usage += token_count
        await save_model(db, project)
        logger.info(f"Updated project {project.id} token usage: +{token_count}")

```