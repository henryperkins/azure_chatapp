"""
Routes for standalone conversations (not associated with projects).
Provides endpoints for managing conversations and their messages.
"""

import json
import logging
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from pydantic import BaseModel, Field
from schemas.chat_schemas import MessageCreate
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_async_session, AsyncSessionLocal
from models.conversation import Conversation
from models.message import Message
from models.user import User
from utils.auth_utils import (
    get_current_user_and_token,
    extract_token,
    get_user_from_token
)
from utils.db_utils import save_model, get_all_by_condition, validate_resource_access
from utils.message_handlers import (
    create_user_message,
    get_conversation_messages,
    validate_image_data,
)
from utils.response_utils import create_standard_response
from utils.ai_response import generate_ai_response
from utils.serializers import serialize_conversation, serialize_message


logger = logging.getLogger(__name__)
router = APIRouter()
project_id: UUID | None = None  # Instead of Optional[UUID]
# Remove the problematic line referring to undefined conversation_id
# conversation_id = UUID(str(conversation_id))


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

    conversations: list[ConversationResponse]


class MessageResponse(BaseModel):
    """
    Schema for representing a message in responses.
    """

    id: UUID
    role: str
    content: str
    metadata: dict[str, str]
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
        serialize_conversation(new_conversation),
        "Conversation created successfully"
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
            items.append(serialize_conversation(conv))

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
        serialize_conversation(conversation)
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
        serialize_conversation(conversation),
        "Conversation updated successfully"
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
        {"id": str(conversation.id)},
        "Conversation deleted successfully"
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
        output.append(serialize_message(msg))

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

    # Use UUID() to ensure type compatibility
    message = await create_user_message(
        conversation_id=UUID(str(conversation.id)),
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
        msg_dicts = await get_conversation_messages(UUID(str(conversation_id)), db)
        try:
            assistant_msg = await generate_ai_response(
                conversation_id=UUID(str(conversation.id)),
                messages=msg_dicts,
                model_id=conversation.model_id,
                image_data=new_msg.image_data,
                vision_detail=new_msg.vision_detail,
                enable_thinking=new_msg.enable_thinking,
                thinking_budget=new_msg.thinking_budget,
                db=db,
            )
            if assistant_msg:
                # Individual fields for backward compatibility
                response_payload["assistant_message_id"] = str(assistant_msg.id)
                response_payload["assistant_role"] = str(assistant_msg.role)
                response_payload["assistant_content"] = str(assistant_msg.content)
                
                # Include metadata (thinking blocks) if available
                metadata = assistant_msg.get_metadata_dict()
                
                # Add the assistant_message as a proper object
                response_payload["assistant_message"] = {
                    "id": str(assistant_msg.id),
                    "role": assistant_msg.role,
                    "content": assistant_msg.content,
                    "message": assistant_msg.content,  # Add message field for compatibility
                    "metadata": metadata
                }
                
                # Add direct content field for older clients
                response_payload["content"] = assistant_msg.content
                response_payload["message"] = assistant_msg.content  # Add message field for compatibility
                
                # Add thinking metadata at root level for direct access
                if metadata:
                    if "thinking" in metadata:
                        response_payload["thinking"] = metadata["thinking"]
                    if "redacted_thinking" in metadata:
                        response_payload["redacted_thinking"] = metadata["redacted_thinking"]
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
            # Extract and validate token before accepting connection
            token = extract_token(websocket)
            logger.debug(f"Extracted WebSocket token: {token}")
            if not token:
                logger.warning("WebSocket connection rejected: No token provided. Headers: %s, Query: %s",
                             websocket.headers, websocket.query_params)
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            # Get user from token
            try:
                user = await get_user_from_token(token, db, "access")
                if not user:
                    await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                    return
                logger.debug("WebSocket authentication successful for user: %s", user.username)
            except Exception as e:
                logger.warning(f"WebSocket authentication failed: {str(e)}")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            # Validate conversation access before accepting connection
            try:
                conversation = await validate_resource_access(
                    conversation_id,
                    Conversation,
                    user,
                    db,
                    "Conversation",
                    [Conversation.project_id.is_(None), Conversation.is_deleted.is_(False)],
                )
            except Exception as e:
                logger.warning(f"WebSocket conversation access denied: {str(e)}")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            # Use connection manager for WebSocket management
            from utils.websocket_manager import manager
            connection_success = await manager.connect(websocket, str(conversation_id), str(user.id))
            if not connection_success:
                logger.warning(f"WebSocket connection failed for user {user.id}, conversation {conversation_id}")
                return

            try:
                # Send connection confirmation
                await manager.send_personal_message({
                    "type": "connected", 
                    "message": "WebSocket connection established",
                    "conversation_id": str(conversation_id)
                }, websocket)

                # Process messages
                while True:
                    raw_data = await websocket.receive_text()
                    try:
                        data = json.loads(raw_data)
                        
                        # Check for token refresh
                        if data.get("type") == "token_refresh" and data.get("token"):
                            try:
                                # Validate the new token
                                new_token = data.get("token")
                                await verify_token(new_token, "access", db)
                                logger.info(f"Token refreshed via WebSocket for user {user.id}")
                                await manager.send_personal_message({
                                    "type": "token_refresh_success",
                                    "message": "Token refreshed successfully"
                                }, websocket)
                                continue
                            except Exception as token_error:
                                logger.error(f"Token refresh error: {str(token_error)}")
                                await manager.send_personal_message({
                                    "type": "error",
                                    "message": "Token refresh failed"
                                }, websocket)
                                continue
                        
                        # Validate basic message content
                        if "content" not in data:
                            raise ValueError("Message missing required 'content' field")
                        
                        # Validate role
                        role = data.get("role", "user").lower()
                        if role not in ["user", "system"]:
                            await manager.send_personal_message({
                                "type": "error",
                                "message": "Invalid message role - must be 'user' or 'system'"
                            }, websocket)
                            continue
                    except (json.JSONDecodeError, ValueError) as e:
                        await manager.send_personal_message({
                            "type": "error", 
                            "message": f"Invalid message format: {str(e)}"
                        }, websocket)
                        continue

                    # Create message using existing function
                    message_id = data.get("messageId")
                    message = await create_user_message(
                        conversation_id=UUID(str(conversation.id)),
                        content=data["content"],
                        role=role,
                        db=db,
                    )

                    # Acknowledge message receipt
                    if message_id:
                        await manager.send_personal_message({
                            "type": "message_received",
                            "messageId": message_id,
                            "message": "Message received and stored"
                        }, websocket)

                    # Generate AI response if user message
                    if message.role == "user":
                        msg_dicts = await get_conversation_messages(UUID(str(conversation.id)), db)
                        try:
                            # Get model parameters from request
                            image_data = data.get("image_data")
                            vision_detail = data.get("vision_detail", "auto")
                            enable_thinking = data.get("enable_thinking", True)
                            thinking_budget = data.get("thinking_budget")

                            # Generate AI response 
                            assistant_msg = await generate_ai_response(
                                conversation_id=UUID(str(conversation.id)),
                                messages=msg_dicts,
                                model_id=conversation.model_id,
                                image_data=image_data,
                                vision_detail=vision_detail,
                                enable_thinking=enable_thinking,
                                thinking_budget=thinking_budget,
                                db=db,
                            )

                            if assistant_msg:
                                # Get metadata from the message
                                metadata = assistant_msg.get_metadata_dict() if hasattr(assistant_msg, 'get_metadata_dict') else {}
                                
                                # Prepare response
                                response_data = {
                                    "type": "message",
                                    "role": "assistant",
                                    "content": assistant_msg.content,
                                    "message": assistant_msg.content,
                                    "timestamp": assistant_msg.created_at.isoformat()
                                }
                                
                                # Add thinking if available
                                if metadata:
                                    if "thinking" in metadata:
                                        response_data["thinking"] = metadata["thinking"]
                                    if "redacted_thinking" in metadata:
                                        response_data["redacted_thinking"] = metadata["redacted_thinking"]
                                    if "model" in metadata:
                                        response_data["model"] = metadata["model"]
                                    response_data["metadata"] = metadata
                                
                                # Add message ID if present in original request
                                if message_id:
                                    response_data["messageId"] = message_id
                                
                                # Send response to client
                                await manager.send_personal_message(response_data, websocket)
                            else:
                                await manager.send_personal_message({
                                    "type": "error",
                                    "messageId": message_id,
                                    "message": "Failed to generate AI response"
                                }, websocket)
                        except Exception as e:
                            logger.error(f"Error generating AI response: {str(e)}")
                            await manager.send_personal_message({
                                "type": "error",
                                "messageId": message_id,
                                "message": f"Error generating response: {str(e)}"
                            }, websocket)

            except WebSocketDisconnect:
                logger.info(f"WebSocket disconnected for user {user.id}, conversation {conversation_id}")
            finally:
                # Always disconnect properly
                await manager.disconnect(websocket)

        except Exception as e:
            logger.error(f"WebSocket error: {str(e)}")
            try:
                await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
            except Exception:
                pass
        finally:
            await db.close()
