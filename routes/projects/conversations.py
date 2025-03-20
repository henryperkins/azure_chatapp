"""
conversations.py
--------------
Routes for managing conversations within a project.
Provides endpoints for creating, retrieving, updating and deleting conversations
and their messages that belong to a specific project.
"""

import logging
import json
from uuid import UUID
from datetime import datetime
from typing import Optional, Dict

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_async_session
from models.user import User
from models.project import Project
from models.conversation import Conversation
from models.message import Message

from utils.auth_deps import (
    get_current_user_and_token,
    validate_resource_ownership,
    process_standard_response
)
from utils.message_handlers import (
    create_user_message,
    get_conversation_messages,
    validate_image_data,
    update_project_token_usage
)
from utils.ai_response import (
    generate_ai_response,
    handle_websocket_response
)
from utils.websocket_auth import authenticate_websocket
from utils.context import (
    get_all_by_condition,
    get_by_id,
    save_model
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================
# Pydantic Schemas
# ============================

class ConversationCreate(BaseModel):
    """
    Pydantic model for creating a new conversation within a project.
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
    project_id: UUID,
    conversation_data: ConversationCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Create a new conversation using the conversation service"""
    # Validate project access using service
    project = await services.project_service.validate_project_access(
        project_id, current_user, db
    )
    
    # Create conversation using service
    conversation = await services.conversation_service.create_conversation(
        project_id=project_id,
        user_id=current_user.id,
        title=conversation_data.title,
        model_id=conversation_data.model_id or "o1",  # Default model
        db=db
    )
    
    return await process_standard_response({
        "id": str(conversation.id),
        "title": conversation.title,
        "created_at": conversation.created_at.isoformat(),
        "project_id": str(project_id),
        "model_id": conversation.model_id
    }, "Conversation created successfully")


@router.get("", response_model=dict)
async def list_conversations(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = 0,
    limit: int = 100
):
    """
    Returns a list of conversations for a specific project, owned by the current user.
    """
    # Validate project access
    project = await validate_resource_ownership(
        project_id,
        Project,
        current_user,
        db,
        "Project",
        [Project.user_id == current_user.id]
    )

    # Use enhanced database function
    conversations = await get_all_by_condition(
        db,
        Conversation,
        Conversation.project_id == project_id,
        Conversation.user_id == current_user.id,
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
            "project_id": str(conv.project_id)
        }
        for conv in conversations
    ]
    
    return await process_standard_response({"conversations": items})


@router.get("/{conversation_id}", response_model=dict)
async def get_conversation(
    project_id: UUID,
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Retrieve metadata about a specific conversation, verifying ownership and project relationship.
    """
    # Validate resource using enhanced utility
    conversation = await validate_resource_ownership(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [
            Conversation.project_id == project_id,
            Conversation.is_deleted.is_(False)
        ]
    )
    
    return await process_standard_response({
        "id": str(conversation.id),
        "title": conversation.title,
        "model_id": conversation.model_id,
        "created_at": conversation.created_at,
        "project_id": str(conversation.project_id)
    })


@router.patch("/{conversation_id}", response_model=dict)
async def update_conversation(
    project_id: UUID,
    conversation_id: UUID,
    update_data: ConversationUpdate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Updates the conversation's title or model_id.
    """
    # Validate project is not archived
    project = await validate_resource_ownership(
        project_id,
        Project,
        current_user,
        db,
        "Project",
        [
            Project.user_id == current_user.id,
            Project.archived.is_(False)  # Cannot modify archived projects
        ]
    )
    
    # Validate conversation ownership
    conversation = await validate_resource_ownership(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [
            Conversation.project_id == project_id,
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
        "model_id": conversation.model_id,
        "project_id": str(conversation.project_id)
    }, "Conversation updated successfully")


@router.delete("/{conversation_id}", response_model=dict)
async def delete_conversation(
    project_id: UUID,
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Soft-deletes a conversation by setting is_deleted = True.
    """
    # Validate project is not archived
    project = await validate_resource_ownership(
        project_id,
        Project,
        current_user,
        db,
        "Project",
        [
            Project.user_id == current_user.id,
            Project.archived.is_(False)  # Cannot modify archived projects
        ]
    )
    
    # Validate conversation ownership
    conversation = await validate_resource_ownership(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [
            Conversation.project_id == project_id,
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
    project_id: UUID,
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = 0,
    limit: int = 100
):
    """
    Retrieves all messages for a conversation, sorted by creation time ascending.
    """
    # Validate conversation ownership
    conversation = await validate_resource_ownership(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [
            Conversation.project_id == project_id,
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
    
    return await process_standard_response({"messages": output})


@router.post("/{conversation_id}/messages", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_message(
    project_id: UUID,
    conversation_id: UUID,
    new_msg: MessageCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Adds a new user or system message to the specified conversation,
    optionally triggers an assistant response if role='user'.
    """
    # Validate project is not archived
    project = await validate_resource_ownership(
        project_id,
        Project,
        current_user,
        db,
        "Project",
        [
            Project.user_id == current_user.id,
            Project.archived.is_(False)  # Cannot modify archived projects
        ]
    )
    
    # Validate conversation ownership
    conversation = await validate_resource_ownership(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [
            Conversation.project_id == project_id,
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
        msg_dicts = await get_conversation_messages(conversation_id, db, include_system_prompt=True)

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
                
                # Update project token usage
                token_estimate = len(assistant_msg.content) // 4
                await update_project_token_usage(conversation, token_estimate, db)
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
    project_id: UUID,
    conversation_id: UUID
):
    """
    Real-time chat updates for the specified conversation.
    Must authenticate via query param or cookies (token).
    """
    from db import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        try:
            # Authenticate user
            success, user = await authenticate_websocket(websocket, db)
            if not success or not user:
                return

            # Validate project is not archived
            await validate_resource_ownership(
                project_id,
                Project,
                user,
                db,
                "Project",
                [
                    Project.user_id == user.id,
                    Project.archived.is_(False)  # Cannot modify archived projects
                ]
            )
                
            # Validate conversation ownership
            conversation = await validate_resource_ownership(
                conversation_id,
                Conversation,
                user,
                db,
                "Conversation",
                [
                    Conversation.project_id == project_id,
                    Conversation.is_deleted.is_(False)
                ]
            )

            while True:
                data = await websocket.receive_text()
                data_dict = json.loads(data)

                # Create message
                message = await create_user_message(
                    conversation_id=conversation.id,
                    content=data_dict["content"],
                    role=data_dict["role"],
                    db=db
                )

                if message.role == "user":
                    await handle_websocket_response(conversation.id, db, websocket)

        except WebSocketDisconnect:
            logger.info("WebSocket disconnected")
        except HTTPException:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        finally:
            await db.close()
