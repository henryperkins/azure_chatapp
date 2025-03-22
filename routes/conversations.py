"""
Routes for standalone conversations (not associated with projects).
Provides endpoints for managing conversations and their messages.
"""

import json
import logging
from datetime import datetime
from typing import Optional, List, Dict
from uuid import UUID, uuid4

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_async_session, AsyncSessionLocal
from models.conversation import Conversation
from models.message import Message
from models.user import User
from utils.auth_utils import get_current_user_and_token, authenticate_websocket
from utils.db_utils import save_model, get_all_by_condition, validate_resource_access
from utils.message_handlers import (
    create_user_message,
    get_conversation_messages,
    validate_image_data,
)
from utils.response_utils import create_standard_response
from utils.ai_response import generate_ai_response


logger = logging.getLogger(__name__)
router = APIRouter()


class ConversationResponse(BaseModel):
    """
    Schema for representing a conversation in responses.
    """

    id: UUID
    title: str
    model_id: str
    created_at: datetime
    project_id: Optional[UUID] = None


class ConversationListResponse(BaseModel):
    """
    Schema for returning a list of conversations.
    """

    conversations: List[ConversationResponse]


class MessageResponse(BaseModel):
    """
    Schema for representing a message in responses.
    """

    id: UUID
    role: str
    content: str
    metadata: Dict[str, str]
    timestamp: datetime


class ConversationCreate(BaseModel):
    """
    Pydantic model for creating a new standalone conversation.
    """

    title: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="A user-friendly title for the new conversation",
    )
    model_id: Optional[str] = Field(
        None, description="Optional model ID referencing the chosen model deployment"
    )


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

    content: str = Field(
        ..., min_length=1, description="The text content of the user message"
    )
    role: str = Field(
        default="user", description="The role: user, assistant, or system."
    )
    image_data: Optional[str] = None
    vision_detail: str = "auto"


@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    conversation_data: ConversationCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Creates a new standalone conversation.
    """
    if not conversation_data.model_id:
        conversation_data.model_id = "claude-3-sonnet-20240229"  # Default to Claude 3 Sonnet

    title = conversation_data.title.strip() or (
        f"Chat {datetime.now().strftime('%Y-%m-%d')}"
    )

    new_conversation = Conversation(
        user_id=current_user.id,
        project_id=None,
        title=title,
        model_id=conversation_data.model_id,
        is_deleted=False,
        created_at=datetime.now(),
    )

    await save_model(db, new_conversation)
    logger.info(
        "Standalone conversation created with id=%s by user_id=%s",
        new_conversation.id,
        current_user.id,
    )

    return await create_standard_response(
        {
            "data": {
                "id": str(new_conversation.id),
                "title": new_conversation.title,
                "created_at": new_conversation.created_at.isoformat(),
                "project_id": None,
            },
            "message": "Conversation created successfully"
        }
    )


@router.get("", response_model=dict)
async def list_conversations(
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = 0,
    limit: int = 100,
):
    """
    Returns a list of standalone conversations for the current user.
    """
    try:
        conversations = await get_all_by_condition(
            db,
            Conversation,
            Conversation.user_id == current_user.id,
            Conversation.project_id.is_(None),  # standalone
            Conversation.is_deleted.is_(False),
            order_by=Conversation.created_at.desc(),
            limit=limit,
            offset=skip,
        )

        items = []
        for conv in conversations:
            items.append({
                "id": str(conv.id),
                "title": conv.title,
                "model_id": conv.model_id,
                "created_at": conv.created_at.isoformat(),
                "project_id": None  # Enforce null for format consistency
            })

        return await create_standard_response({"conversations": items})
    except Exception as e:
        logger.error("Failed to list conversations: %s", str(e))
        return await create_standard_response(
            {"conversations": []},  # <-- Always return proper structure
            "Error retrieving conversations",
            success=False
        )


@router.get("/{conversation_id}", response_model=dict)
async def get_conversation(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Retrieve metadata about a specific standalone conversation.
    """
    conversation = await validate_resource_access(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [Conversation.project_id.is_(None), Conversation.is_deleted.is_(False)],
    )

    return await create_standard_response(
        {
            "id": str(conversation.id),
            "title": conversation.title,
            "model_id": conversation.model_id,
            "created_at": conversation.created_at,
            "project_id": None,
        }
    )


@router.patch("/{conversation_id}", response_model=dict)
async def update_conversation(
    conversation_id: UUID,
    update_data: ConversationUpdate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Updates a standalone conversation's title or model_id.
    """
    conversation = await validate_resource_access(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [Conversation.project_id.is_(None), Conversation.is_deleted.is_(False)],
    )

    if update_data.title is not None:
        conversation.title = update_data.title.strip()

    if update_data.model_id is not None:
        conversation.model_id = update_data.model_id

    await save_model(db, conversation)
    logger.info("Conversation %s updated by user %s", conversation_id, current_user.id)

    return await create_standard_response(
        {
            "id": str(conversation.id),
            "title": conversation.title,
            "model_id": conversation.model_id,
        },
        "Conversation updated successfully",
    )


@router.delete("/{conversation_id}", response_model=dict)
async def delete_conversation(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Soft-deletes a standalone conversation by setting is_deleted = True.
    """
    conversation = await validate_resource_access(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [Conversation.project_id.is_(None), Conversation.is_deleted.is_(False)],
    )

    conversation.is_deleted = True
    await save_model(db, conversation)
    logger.info(
        "Conversation %s soft-deleted by user %s", conversation_id, current_user.id
    )

    return await create_standard_response(
        {"conversation_id": str(conversation.id)},
        message="Conversation deleted successfully",
    )


@router.get("/{conversation_id}/messages", response_model=dict)
async def list_messages(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = 0,
    limit: int = 100,
):
    """
    Retrieves all messages for a standalone conversation.
    """
    conversation = await validate_resource_access(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [Conversation.project_id.is_(None), Conversation.is_deleted.is_(False)],
    )

    messages = await get_all_by_condition(
        db,
        Message,
        Message.conversation_id == conversation.id,
        order_by=Message.created_at.asc(),
        limit=limit,
        offset=skip,
    )

    output = []
    for msg in messages:
        output.append(
            {
                "id": str(msg.id),
                "role": msg.role,
                "content": msg.content,
                "metadata": msg.get_metadata_dict(),
                "timestamp": msg.created_at,
            }
        )

    return await create_standard_response(
        {"messages": output, "metadata": {"title": conversation.title}}
    )


@router.post(
    "/{conversation_id}/messages",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
)
async def create_message(
    conversation_id: UUID,
    new_msg: MessageCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Adds a new message to a standalone conversation,
    optionally triggers an assistant response if role='user'.
    """
    conversation = await validate_resource_access(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [Conversation.project_id.is_(None), Conversation.is_deleted.is_(False)],
    )

    if new_msg.image_data:
        await validate_image_data(new_msg.image_data)

    message = await create_user_message(
        conversation_id=conversation.id,
        content=new_msg.content.strip(),
        role=new_msg.role.lower().strip(),
        db=db,
    )

    response_payload = {
        "message_id": str(message.id),
        "role": message.role,
        "content": message.content,
    }

    if message.role == "user":
        msg_dicts = await get_conversation_messages(conversation_id, db)
        try:
            assistant_msg = await generate_ai_response(
                conversation_id=conversation.id,
                messages=msg_dicts,
                model_id=conversation.model_id,
                image_data=new_msg.image_data,
                vision_detail=new_msg.vision_detail,
                db=db,
            )
            if assistant_msg:
                response_payload["assistant_message_id"] = str(assistant_msg.id)
                response_payload["assistant_role"] = str(assistant_msg.role)
                response_payload["assistant_content"] = str(assistant_msg.content)
            else:
                response_payload["assistant_error"] = "Failed to generate response"
        except Exception as exc:
            logger.error("Error generating AI response: %s", exc)
            # Must store a string in the response payload, not a dict
            response_payload["assistant_error"] = str(exc)

    return await create_standard_response(response_payload)


# ============================
# WebSocket for Real-time Chat
# ============================


@router.websocket("/ws/{conversation_id}")
async def websocket_chat_endpoint(websocket: WebSocket, conversation_id: UUID):
    """Real-time chat updates for a standalone conversation."""
    async with AsyncSessionLocal() as db:
        try:
            # Authenticate user
            success, user = await authenticate_websocket(websocket, db)
            if not success:
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return
            logger.debug("WebSocket authentication successful for user: %s", user.username) # ADDED DEBUG LOG

            # Validate conversation access
            conversation = await validate_resource_access(
                conversation_id,
                Conversation,
                user,
                db,
                "Conversation",
                [Conversation.project_id.is_(None), Conversation.is_deleted.is_(False)],
            )

            # Accept already done in authenticate_websocket after successful authentication

            while True:
                raw_data = await websocket.receive_text()
                try:
                    data = json.loads(raw_data)
                except json.JSONDecodeError:
                    data = {"content": raw_data, "role": "user"}

                # Create message using existing function
                message = await create_user_message(
                    conversation_id=conversation.id,
                    content=data["content"],
                    role=data["role"],
                    db=db,
                )

                # Generate AI response if user message
                if message.role == "user":
                    msg_dicts = await get_conversation_messages(conversation.id, db)
                    # Stream AI response through websocket
                    # Get and stream AI response
                    # Handle Claude and OpenAI models differently
                    from config import settings
                    from utils.openai import claude_chat
                    from models.message import Message

                    if conversation.model_id in settings.CLAUDE_MODELS:
                        try:
                            # Call Claude API
                            claude_response = await claude_chat(
                                messages=msg_dicts,
                                model_name=conversation.model_id,
                                max_tokens=1500
                            )

                            # Extract content from Claude response
                            content = claude_response["content"][0]["text"]

                            # Create and save message
                            assistant_msg = Message(
                                conversation_id=conversation.id,
                                role="assistant",
                                content=content
                            )
                            db.add(assistant_msg)
                            await db.commit()
                            await db.refresh(assistant_msg)
                        except Exception as e:
                            logger.error(f"Claude API error in WebSocket: {str(e)}")
                            await websocket.send_text(
                                json.dumps({"type": "error", "content": f"Error with Claude: {str(e)}"})
                            )
                            continue
                    else:
                        # Use standard OpenAI response generation
                        assistant_msg = await generate_ai_response(
                            conversation_id=conversation.id,
                            messages=msg_dicts,
                            model_id=conversation.model_id,
                            db=db,
                        )

                    if assistant_msg:
                        await websocket.send_text(
                            json.dumps(
                                {"type": "message", "content": assistant_msg.content}
                            )
                        )

        except WebSocketDisconnect:
            logger.info("WebSocket disconnected")
        except HTTPException as he:
            await websocket.close(code=he.status_code)
        except Exception as e:
            logger.error(f"WebSocket error: {str(e)}")
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        finally:
            await db.close()
