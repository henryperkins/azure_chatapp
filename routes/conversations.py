"""
conversations.py
---------------
Routes for standalone conversations (not associated with projects).
Provides endpoints for managing conversations and their messages.
"""

import logging
import json
from uuid import UUID
from datetime import datetime
from typing import Optional, List, Dict

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_async_session
from models.user import User
from models.conversation import Conversation
from models.message import Message
import services
from utils.auth_deps import (
    get_current_user_and_token, 
    validate_resource_ownership,
    process_standard_response
)
from utils.openai import openai_chat
from utils.context import (
    manage_context, 
    token_limit_check, 
    get_by_id, 
    get_all_by_condition,
    save_model
)
from utils.message_handlers import (
    create_user_message,
    get_conversation_messages,
    validate_image_data
)
from utils.ai_response import (
    generate_ai_response,
    handle_websocket_response
)
from utils.websocket_auth import authenticate_websocket

logger = logging.getLogger(__name__)
router = APIRouter()

# ============================
# Pydantic Schemas
# ============================

class ConversationCreate(BaseModel):
    """
    Pydantic model for creating a new standalone conversation.
    """
    title: str = Field(..., min_length=1, max_length=100, description="A user-friendly title for the new conversation")
    model_id: Optional[str] = Field(None, description="Optional model ID referencing the chosen model deployment")


class ConversationUpdate(BaseModel):
    """
    Pydantic model for updating an existing conversation.
    """
    title: Optional[str] = Field(None, min_length=1, max_length=100)
    model_id: Optional[str] = None


class MessageCreate(BaseModel):
    """
    Pydantic model for creating a new message.
    """
    content: str = Field(..., min_length=1, description="The text content of the user message")
    role: str = Field(
        default="user",
        description="The role: user, assistant, or system."
    )
    image_data: Optional[str] = None
    vision_detail: Optional[str] = "auto"


# ============================
# Conversation Endpoints
# ============================

@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    conversation_data: ConversationCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Creates a new standalone conversation (not associated with a project).
    """
    # Add default model if none provided
    if not conversation_data.model_id:
        conversation_data.model_id = "o1"  # Default model
    
    # Create conversation with default title if empty
    title = conversation_data.title.strip() or f"Chat {datetime.now().strftime('%Y-%m-%d')}"
    
    new_conversation = Conversation(
        user_id=current_user.id,
        project_id=None,  # Explicitly set to None to indicate standalone
        title=title,
        model_id=conversation_data.model_id,
        is_deleted=False,
        created_at=datetime.now()
    )

    # Save using utility function
    await save_model(db, new_conversation)

    logger.info("Standalone conversation created with id=%s by user_id=%s", 
                new_conversation.id, current_user.id)
                
    # Return standardized response
    return await process_standard_response({
        "id": str(new_conversation.id),
        "title": new_conversation.title,
        "created_at": new_conversation.created_at.isoformat(),
        "project_id": None
    }, "Conversation created successfully")


@router.get("", response_model=dict)
async def list_conversations(
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = 0,
    limit: int = 100
):
    """
    Returns a list of standalone conversations for the current user.
    """
    # Use enhanced database function to get standalone conversations (project_id is NULL)
    conversations = await get_all_by_condition(
        db,
        Conversation,
        Conversation.user_id == current_user.id,
        Conversation.project_id.is_(None),  # Get only standalone conversations
        Conversation.is_deleted.is_(False),
        order_by=Conversation.created_at.desc(),
        limit=limit,
        offset=skip
    )

    items = [
        {
            "id": str(conv.id),
            "title": conv.title,
            "model_id": conv.model_id,
            "created_at": conv.created_at,
            "project_id": None
        }
        for conv in conversations
    ]
    
    return await process_standard_response({"conversations": items})


@router.get("/{conversation_id}", response_model=dict)
async def get_conversation(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Retrieve metadata about a specific standalone conversation.
    """
    # Validate resource without requiring project relationship
    conversation = await validate_resource_ownership(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [
            Conversation.project_id.is_(None),  # Must be standalone
            Conversation.is_deleted.is_(False)
        ]
    )
    
    return await process_standard_response({
        "id": str(conversation.id),
        "title": conversation.title,
        "model_id": conversation.model_id,
        "created_at": conversation.created_at,
        "project_id": None
    })


@router.patch("/{conversation_id}", response_model=dict)
async def update_conversation(
    conversation_id: UUID,
    update_data: ConversationUpdate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Updates a standalone conversation's title or model_id.
    """
    # Validate conversation ownership
    conversation = await validate_resource_ownership(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [
            Conversation.project_id.is_(None),  # Must be standalone
            Conversation.is_deleted.is_(False)
        ]
    )
    
    # Update fields
    if update_data.title is not None:
        conversation.title = update_data.title.strip()
    if update_data.model_id is not None:
        conversation.model_id = update_data.model_id

    # Save using utility function
    await save_model(db, conversation)
    
    logger.info(f"Conversation {conversation_id} updated by user {current_user.id}")

    return await process_standard_response({
        "id": str(conversation.id),
        "title": conversation.title,
        "model_id": conversation.model_id
    }, "Conversation updated successfully")


@router.delete("/{conversation_id}", response_model=dict)
async def delete_conversation(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Soft-deletes a standalone conversation by setting is_deleted = True.
    """
    # Validate conversation ownership
    conversation = await validate_resource_ownership(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [
            Conversation.project_id.is_(None),  # Must be standalone
            Conversation.is_deleted.is_(False)
        ]
    )
    
    conversation.is_deleted = True
    await save_model(db, conversation)
    
    logger.info(f"Conversation {conversation_id} soft-deleted by user {current_user.id}")

    return await process_standard_response(
        {"conversation_id": str(conversation.id)},
        message="Conversation deleted successfully"
    )


# ============================
# Message Endpoints
# ============================

@router.get("/{conversation_id}/messages", response_model=dict)
async def list_messages(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = 0,
    limit: int = 100
):
    """
    Retrieves all messages for a standalone conversation.
    """
    # Validate conversation ownership
    conversation = await validate_resource_ownership(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [
            Conversation.project_id.is_(None),  # Must be standalone
            Conversation.is_deleted.is_(False)
        ]
    )

    # Get messages using enhanced function
    messages = await get_all_by_condition(
        db,
        Message,
        Message.conversation_id == conversation.id,
        order_by=Message.created_at.asc(),
        limit=limit,
        offset=skip
    )
    
    output = [
        {
            "id": str(msg.id),
            "role": msg.role,
            "content": msg.content,
            "metadata": msg.get_metadata_dict(),
            "timestamp": msg.created_at
        }
        for msg in messages
    ]
    
    return await process_standard_response({
        "messages": output,
        "metadata": {"title": conversation.title}
    })


@router.post("/{conversation_id}/messages", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_message(
    conversation_id: UUID,
    new_msg: MessageCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Adds a new message to a standalone conversation,
    optionally triggers an assistant response if role='user'.
    """
    # Validate conversation ownership
    conversation = await validate_resource_ownership(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [
            Conversation.project_id.is_(None),  # Must be standalone
            Conversation.is_deleted.is_(False)
        ]
    )

    # Validate image data if provided
    if new_msg.image_data:
        await validate_image_data(new_msg.image_data)

    # Create user message
    message = await create_user_message(
        conversation_id=conversation.id,
        content=new_msg.content.strip(),
        role=new_msg.role.lower().strip(),
        db=db
    )

    response_payload = {
        "message_id": str(message.id),
        "role": message.role,
        "content": message.content
    }

    # Generate AI response if user message
    if message.role == "user":
        # Get formatted messages for API
        msg_dicts = await get_conversation_messages(conversation_id, db)

        try:
            # Generate AI response
            assistant_msg = await generate_ai_response(
                conversation_id=conversation.id,
                messages=msg_dicts,
                model_id=conversation.model_id,
                image_data=new_msg.image_data,
                vision_detail=new_msg.vision_detail,
                db=db
            )

            if assistant_msg:
                # Add assistant message to response
                response_payload["assistant_message"] = {
                    "id": str(assistant_msg.id),
                    "role": assistant_msg.role,
                    "content": assistant_msg.content
                }
            else:
                response_payload["assistant_error"] = "Failed to generate response"
        except Exception as e:
            logger.error(f"Error generating AI response: {e}")
            response_payload["assistant_error"] = str(e)

    return await process_standard_response(response_payload)


# ============================
# WebSocket for Real-time Chat
# ============================

@router.websocket("/ws/{conversation_id}")
async def websocket_chat_endpoint(
    websocket: WebSocket,
    conversation_id: UUID
):
    """
    Real-time chat updates for a standalone conversation.
    Must authenticate via query param or cookies (token).
    """
    from db import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        try:
            # Use standardized auth utility
            success, user = await authenticate_websocket(websocket, db)
            if not success:
                return

            # Validate using service layer
            conversation = await services.conversation_service.validate_conversation_access(
                conversation_id, user.id, db
            )

            while True:
                data = await websocket.receive_text()
                data_dict = json.loads(data)

                # Use message service
                message = await services.message_service.create_websocket_message(
                    conversation_id=conversation.id,
                    content=data_dict["content"],
                    role=data_dict["role"],
                    db=db
                )

                if message.role == "user":
                    await services.ai_response_service.handle_websocket_response(
                        conversation.id, db, websocket
                    )

        except WebSocketDisconnect:
            logger.info("WebSocket disconnected")
        except HTTPException as he:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        finally:
            await db.close()
