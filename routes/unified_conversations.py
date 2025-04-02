"""
conversations.py
----------------
Unified routes handling both project-based and standalone conversations
by using optional project_id in the same set of handlers.
"""

import json
import logging
from typing import Optional, Sequence, cast
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
    status,
    Query,
)
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.expression import BinaryExpression

# Import from your existing modules
from models.user import User
from models.project import Project
from models.conversation import Conversation
from models.message import Message

from services import project_service, conversation_service
from services.context_integration import augment_with_knowledge
from db import get_async_session
from utils.auth_utils import (
    get_current_user_and_token,
    extract_token,
    get_user_from_token,
)
from utils.db_utils import validate_resource_access, get_all_by_condition, save_model
from utils.response_utils import create_standard_response
from utils.serializers import serialize_message, serialize_conversation
from utils.message_handlers import (
    create_user_message,
    get_conversation_messages,
    validate_image_data,
    update_project_token_usage,
)
from utils.websocket_manager import ConnectionManager
from utils.ai_response import generate_ai_response


logger = logging.getLogger(__name__)

router = APIRouter(tags=["Conversations"])

manager = ConnectionManager()


# ------------------------------------------------------------------------------
# Pydantic Models
# ------------------------------------------------------------------------------
class ConversationCreate(BaseModel):
    """Model for creating a new conversation."""

    title: str = Field(
        ..., min_length=1, max_length=100, description="User-friendly title"
    )
    model_id: Optional[str] = Field(
        None, description="Model deployment ID (Claude, GPT, etc.)"
    )


class ConversationUpdate(BaseModel):
    """Model for updating an existing conversation."""

    title: Optional[str] = Field(None, min_length=1, max_length=100)
    model_id: Optional[str] = None


# ------------------------------------------------------------------------------
# Helper: resolve optional project
# ------------------------------------------------------------------------------
async def resolve_project_if_any(
    project_id: Optional[UUID], current_user: User, db: AsyncSession
) -> Optional[Project]:
    """
    If project_id is provided, validate access and return the Project.
    If None, this is a standalone conversation scenario, return None.
    """
    if project_id:
        project = await project_service.validate_project_access(
            project_id, current_user, db
        )
        if not project:
            raise HTTPException(
                status_code=404, detail="Project not found or not accessible"
            )
        return project
    return None


# ------------------------------------------------------------------------------
# Create Conversation
# ------------------------------------------------------------------------------
@router.post("/conversations", response_model=dict, status_code=status.HTTP_201_CREATED)
@router.post(
    "/projects/{project_id}/conversations",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
)
async def create_conversation(
    conversation_data: ConversationCreate,
    project_id: Optional[UUID] = None,  # type: ignore[type-var]
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Creates a new conversation.
    - If `project_id` is provided, the conversation is bound to that project.
    - If no `project_id`, it's a standalone conversation.
    """
    project = await resolve_project_if_any(project_id, current_user, db)

    # Use either the provided model_id or project default (else fallback).
    model_id = conversation_data.model_id
    if not model_id and project:
        model_id = project.default_model
    if not model_id:
        model_id = "claude-3-sonnet-20240229"  # Example fallback for standalone

    # Create via service layer
    conv = await conversation_service.create_conversation(
        project_id=project.id if project else None,
        user_id=current_user.id,
        title=conversation_data.title.strip(),
        model_id=model_id,
        db=db,
    )

    return await create_standard_response(
        serialize_conversation(conv), "Conversation created successfully"
    )


# ------------------------------------------------------------------------------
# List Conversations
# ------------------------------------------------------------------------------
@router.get("/conversations", response_model=dict)
@router.get("/projects/{project_id}/conversations", response_model=dict)
async def list_conversations(
    project_id: Optional[UUID] = None,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    """
    List conversations.
    - If `project_id` given, list that project's conversations.
    - Else, list the user's standalone conversations.
    """
    if project_id:
        # Validate access & list project-based
        await resolve_project_if_any(project_id, current_user, db)
        conversations = await conversation_service.list_project_conversations(
            project_id=project_id,
            db=db,
            user_id=current_user.id,
            skip=skip,
            limit=limit,
        )
    else:
        # Standalone conversations: project_id is NULL
        conversations = await get_all_by_condition(
            db,
            Conversation,
            Conversation.user_id == current_user.id,
            Conversation.project_id.is_(None),
            Conversation.is_deleted.is_(False),
            order_by=Conversation.created_at.desc(),
            limit=limit,
            offset=skip,
        )

    return await create_standard_response(
        {"conversations": [serialize_conversation(conv) for conv in conversations]}
    )


# ------------------------------------------------------------------------------
# Get Conversation
# ------------------------------------------------------------------------------
@router.get("/conversations/{conversation_id}", response_model=dict)
@router.get(
    "/projects/{project_id}/conversations/{conversation_id}", response_model=dict
)
async def get_conversation(
    conversation_id: UUID,
    project_id: Optional[UUID] = None,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Retrieve metadata about a specific conversation.
    - If `project_id` is provided, the conversation must belong to that project.
    - Otherwise, it must be a standalone conversation.
    """
    project = await resolve_project_if_any(project_id, current_user, db)

    # Build additional filters depending on whether it's standalone or project-based
    if project:
        additional_filters: Sequence[BinaryExpression[bool]] = [
            Conversation.project_id == project.id,
            Conversation.is_deleted.is_(False),
        ]
    else:
        additional_filters: Sequence[BinaryExpression[bool]] = [
            Conversation.project_id.is_(None),
            Conversation.is_deleted.is_(False),
        ]

    conversation = await validate_resource_access(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        additional_filters,
    )

    return await create_standard_response(serialize_conversation(conversation))


# ------------------------------------------------------------------------------
# Update Conversation
# ------------------------------------------------------------------------------
@router.patch("/conversations/{conversation_id}", response_model=dict)
@router.patch(
    "/projects/{project_id}/conversations/{conversation_id}", response_model=dict
)
async def update_conversation(
    conversation_id: UUID,
    update_data: ConversationUpdate,
    project_id: Optional[UUID] = None,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Update a conversation's title or model_id.
    - If `project_id` is provided, the conversation must be in that project.
    - Otherwise, it must be standalone.
    """
    project = await resolve_project_if_any(project_id, current_user, db)

    if project:
        additional_filters: Sequence[BinaryExpression[bool]] = [
            Conversation.project_id == project.id,
            Conversation.is_deleted.is_(False),
        ]
    else:
        additional_filters: Sequence[BinaryExpression[bool]] = [
            Conversation.project_id.is_(None),
            Conversation.is_deleted.is_(False),
        ]

    conversation = await validate_resource_access(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        additional_filters,
    )

    if update_data.title is not None:
        conversation.title = update_data.title.strip()
    if update_data.model_id is not None:
        conversation.model_id = update_data.model_id

    await save_model(db, conversation)
    logger.info(f"Conversation {conversation_id} updated by user {current_user.id}")

    return await create_standard_response(
        serialize_conversation(conversation), "Conversation updated successfully"
    )


# ------------------------------------------------------------------------------
# Delete/Restore Conversation
# ------------------------------------------------------------------------------
@router.post(
    "/projects/{project_id}/conversations/{conversation_id}/restore",
    response_model=dict,
)
async def restore_conversation(
    project_id: UUID,
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Restores a soft-deleted conversation. Only relevant for project-based.
    (Standalone restore logic is optional; omit if you don't need it.)
    """
    additional_filters: Sequence[BinaryExpression[bool]] = [
        Conversation.project_id == project_id,
        Conversation.is_deleted.is_(True),
    ]
    conversation = await validate_resource_access(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        additional_filters,
    )

    conversation.is_deleted = False
    conversation.deleted_at = None
    await save_model(db, conversation)

    logger.info(f"Conversation {conversation_id} restored by user {current_user.id}")
    return await create_standard_response(
        {"id": str(conversation.id)}, "Conversation restored successfully"
    )


@router.delete("/conversations/{conversation_id}", response_model=dict)
@router.delete(
    "/projects/{project_id}/conversations/{conversation_id}", response_model=dict
)
async def delete_conversation(
    conversation_id: UUID,
    project_id: Optional[UUID] = None,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Soft-delete a conversation.
    - If `project_id` is provided, delete from that project.
    - Otherwise, delete standalone conversation.
    """
    if project_id:
        deleted_id = await conversation_service.delete_conversation(
            project_id=project_id,
            conversation_id=conversation_id,
            db=db,
            user_id=current_user.id,
        )
        return await create_standard_response(
            {"conversation_id": str(deleted_id)}, "Conversation deleted successfully"
        )
    else:
        # Standalone logic:
        additional_filters: Sequence[BinaryExpression] = [
            Conversation.project_id.is_(None),
            Conversation.is_deleted.is_(False),
        ]
        conversation = await validate_resource_access(
            conversation_id,
            Conversation,
            current_user,
            db,
            "Conversation",
            additional_filters,
        )
        conversation.is_deleted = True
        conversation.deleted_at = None  # or datetime.utcnow()
        await save_model(db, conversation)

        logger.info(
            f"Standalone conversation {conversation.id} deleted by user {current_user.id}"
        )
        return await create_standard_response(
            {"id": str(conversation.id)}, "Standalone conversation deleted successfully"
        )


# ------------------------------------------------------------------------------
# List Conversation Messages
# ------------------------------------------------------------------------------
@router.get("/conversations/{conversation_id}/messages", response_model=dict)
@router.get(
    "/projects/{project_id}/conversations/{conversation_id}/messages",
    response_model=dict,
)
async def list_conversation_messages(
    conversation_id: UUID,
    project_id: Optional[UUID] = None,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    """
    Retrieve messages from a conversation.
    """
    if project_id:
        additional_filters: Sequence[BinaryExpression] = [
            Conversation.project_id == project_id,
            Conversation.is_deleted.is_(False),
        ]
    else:
        additional_filters: Sequence[BinaryExpression] = [
            Conversation.project_id.is_(None),
            Conversation.is_deleted.is_(False),
        ]

    conversation = await validate_resource_access(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        additional_filters,
    )

    messages = await get_all_by_condition(
        db,
        Message,
        Message.conversation_id == conversation.id,
        order_by=Message.created_at.asc(),
        limit=limit,
        offset=skip,
    )

    return await create_standard_response(
        {
            "messages": [serialize_message(msg) for msg in messages],
            "metadata": {"title": conversation.title},
        }
    )


# ------------------------------------------------------------------------------
# Create New Message
# ------------------------------------------------------------------------------
@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
)
@router.post(
    "/projects/{project_id}/conversations/{conversation_id}/messages",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
)
async def create_message(
    conversation_id: UUID,
    new_msg: dict,  # or a Pydantic model e.g. MessageCreate
    project_id: Optional[UUID] = None,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Adds a new message to the specified conversation.
    Triggers an AI response if message.role == "user".
    """
    # If you have a Pydantic model like `MessageCreate`, you can parse it here
    # e.g.: new_msg: MessageCreate
    # Just ensure it has fields content, role, image_data, etc.

    # Validate project scope
    if project_id:
        # Validate project ownership
        additional_filters_project: Sequence[BinaryExpression[bool]] = [  # type: ignore[type-arg]
            Project.user_id == current_user.id,
            Project.archived.is_(False),
        ]
        await validate_resource_access(
            project_id, Project, current_user, db, "Project", additional_filters_project
        )

        additional_filters_conv: Sequence[BinaryExpression] = [
            Conversation.project_id == project_id,
            Conversation.is_deleted.is_(False),
        ]
    else:
        # Standalone
        additional_filters_conv: Sequence[BinaryExpression] = [
            Conversation.project_id.is_(None),
            Conversation.is_deleted.is_(False),
        ]

    conversation = await validate_resource_access(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        additional_filters_conv,
    )

    # Validate image data if present
    if "image_data" in new_msg and new_msg["image_data"]:
        await validate_image_data(new_msg["image_data"])

    # Create the message
    role = (new_msg.get("role") or "user").lower().strip()
    content = (new_msg.get("content") or "").strip()
    message = await create_user_message(
        conversation_id=cast(
            UUID, conversation.id
        ),  # Cast to ensure type compatibility
        content=content,
        role=role,
        db=db,
    )

    response_payload = serialize_message(message)

    # Generate AI response if user role
    if message.role == "user":
        try:
            msg_dicts = await get_conversation_messages(
                cast(UUID, conversation.id), db, include_system_prompt=True
            )

            # Knowledge base context if enabled
            kb_context = []
            if conversation.use_knowledge_base:
                kb_context = await augment_with_knowledge(
                    conversation_id=cast(UUID, conversation.id),
                    user_message=content,
                    db=db,
                )

            assistant_msg = await generate_ai_response(
                conversation_id=cast(UUID, conversation.id),
                messages=kb_context + msg_dicts,
                model_id=conversation.model_id,
                image_data=new_msg.get("image_data"),
                vision_detail=new_msg.get("vision_detail", "auto"),
                enable_thinking=new_msg.get("enable_thinking", False),
                thinking_budget=new_msg.get("thinking_budget"),
                db=db,
            )

            if assistant_msg:
                metadata = (
                    assistant_msg.get_metadata_dict()
                    if hasattr(assistant_msg, "get_metadata_dict")
                    else {}
                )
                response_payload["assistant_message"] = {
                    "id": str(assistant_msg.id),
                    "role": assistant_msg.role,
                    "content": assistant_msg.content,
                    "message": assistant_msg.content,
                    "metadata": metadata,
                }
                # For older clients
                response_payload["content"] = assistant_msg.content
                response_payload["message"] = assistant_msg.content

                if metadata:
                    if "thinking" in metadata:
                        response_payload["thinking"] = metadata["thinking"]
                    if "redacted_thinking" in metadata:
                        response_payload["redacted_thinking"] = metadata[
                            "redacted_thinking"
                        ]

                # Update token usage
                token_estimate = len(assistant_msg.content) // 4
                await update_project_token_usage(conversation, token_estimate, db)
            else:
                response_payload["assistant_error"] = "Failed to generate response"
        except Exception as e:
            logger.error(f"Error generating AI response: {e}")
            response_payload["assistant_error"] = str(e)

    return await create_standard_response(response_payload)


# ------------------------------------------------------------------------------
# WebSocket for Real-time Chat
# ------------------------------------------------------------------------------
@router.websocket("/conversations/{conversation_id}/ws")
@router.websocket("/projects/{project_id}/conversations/{conversation_id}/ws")
async def websocket_chat_endpoint(
    websocket: WebSocket,
    conversation_id: UUID,
    project_id: Optional[UUID] = None,
    token: str = Query(None),
    chatId: str = Query(None),  # Kept for backward compatibility
):
    """
    Real-time chat updates for either standalone or project-based conversations.
    """
    from db import AsyncSessionLocal
    import asyncio

    async with AsyncSessionLocal() as db:
        user = None
        heartbeat_task: Optional[asyncio.Task] = None

        try:
            user_token = token or extract_token(websocket)
            if not user_token:
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            user = await get_user_from_token(user_token, db, "access")
            if not user or not user.is_active:
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            # If project-based, verify project access
            if project_id:
                project = await resolve_project_if_any(project_id, user, db)
                if not project:
                    await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                    return
                additional_filters: Sequence[BinaryExpression] = [
                    Conversation.project_id == project.id,
                    Conversation.is_deleted.is_(False),
                ]
            else:
                # standalone
                additional_filters: Sequence[BinaryExpression] = [
                    Conversation.project_id.is_(None),
                    Conversation.is_deleted.is_(False),
                ]

            # Validate conversation
            conversation = await validate_resource_access(
                conversation_id,
                Conversation,
                user,
                db,
                "Conversation",
                additional_filters,
            )

            # Connect
            connection_success = await manager.connect(
                websocket, str(conversation_id), str(user.id)
            )
            if not connection_success:
                return

            async def heartbeat():
                while True:
                    await asyncio.sleep(25)
                    try:
                        await websocket.send_json({"type": "pong"})
                    except Exception:
                        break

            heartbeat_task = asyncio.create_task(heartbeat())

            # Send connected
            await manager.send_personal_message(
                {
                    "type": "connected",
                    "message": "WebSocket established",
                    "conversation_id": str(conversation_id),
                },
                websocket,
            )

            # Main receive loop
            while True:
                raw_data = await websocket.receive_text()
                try:
                    data_dict = json.loads(raw_data)
                    if "content" not in data_dict:
                        raise ValueError("Missing 'content' in message")

                    role = data_dict.get("role", "user")
                    if role not in ["user", "system"]:
                        await manager.send_personal_message(
                            {"type": "error", "message": "Invalid role"}, websocket
                        )
                        continue

                    # Check for token refresh
                    if data_dict.get("type") == "token_refresh" and data_dict.get(
                        "token"
                    ):
                        try:
                            new_token = data_dict["token"]
                            user = await get_user_from_token(new_token, db, "access")
                            # Possibly re-verify user or project
                            await manager.send_personal_message(
                                {
                                    "type": "token_refresh_success",
                                    "message": "Token refreshed successfully",
                                },
                                websocket,
                            )
                            continue
                        except Exception as token_error:
                            await manager.send_personal_message(
                                {
                                    "type": "error",
                                    "message": f"Token refresh failed: {token_error}",
                                },
                                websocket,
                            )
                            continue

                except (json.JSONDecodeError, ValueError) as e:
                    await manager.send_personal_message(
                        {"type": "error", "message": str(e)}, websocket
                    )
                    continue

                # Create message
                message_id = data_dict.get("messageId")
                message = await create_user_message(
                    conversation_id=cast(UUID, conversation.id),
                    content=data_dict["content"],
                    role=role,
                    db=db,
                )

                # Acknowledge
                if message_id:
                    await manager.send_personal_message(
                        {
                            "type": "message_received",
                            "messageId": message_id,
                            "message": "Message stored",
                        },
                        websocket,
                    )

                # If user message, generate AI response
                if message.role == "user":
                    try:
                        msg_dicts = await get_conversation_messages(
                            cast(UUID, conversation.id), db, include_system_prompt=True
                        )
                        kb_context = []
                        if conversation.use_knowledge_base:
                            kb_context = await augment_with_knowledge(
                                conversation_id=cast(UUID, conversation.id),
                                user_message=message.content,
                                db=db,
                            )
                        assistant_msg = await generate_ai_response(
                            conversation_id=cast(UUID, conversation.id),
                            messages=kb_context + msg_dicts,
                            model_id=conversation.model_id,
                            image_data=data_dict.get("image_data"),
                            vision_detail=data_dict.get("vision_detail", "auto"),
                            enable_thinking=data_dict.get("enable_thinking", False),
                            thinking_budget=data_dict.get("thinking_budget"),
                            db=db,
                        )

                        if assistant_msg:
                            metadata = (
                                assistant_msg.get_metadata_dict()
                                if hasattr(assistant_msg, "get_metadata_dict")
                                else {}
                            )
                            response_data = {
                                "type": "message",
                                "role": "assistant",
                                "content": assistant_msg.content,
                                "message": assistant_msg.content,
                                "timestamp": assistant_msg.created_at.isoformat(),
                            }
                            if metadata:
                                response_data["metadata"] = metadata
                                if "thinking" in metadata:
                                    response_data["thinking"] = metadata["thinking"]
                                if "redacted_thinking" in metadata:
                                    response_data["redacted_thinking"] = metadata[
                                        "redacted_thinking"
                                    ]

                            if message_id:
                                response_data["messageId"] = message_id

                            await manager.send_personal_message(
                                response_data, websocket
                            )

                            # Update token usage
                            token_estimate = len(assistant_msg.content) // 4
                            await update_project_token_usage(
                                conversation, token_estimate, db
                            )
                        else:
                            await manager.send_personal_message(
                                {
                                    "type": "error",
                                    "messageId": message_id,
                                    "message": "Failed to generate AI response",
                                },
                                websocket,
                            )

                    except Exception as e:
                        logger.error(f"Error with AI response: {e}")
                        await manager.send_personal_message(
                            {
                                "type": "error",
                                "messageId": message_id,
                                "message": str(e),
                            },
                            websocket,
                        )

        except (WebSocketDisconnect, asyncio.CancelledError):
            logger.info(
                f"WebSocket disconnected for user {user.id if user else 'unknown'}, conversation {conversation_id}"
            )
        finally:
            if heartbeat_task and not heartbeat_task.done():
                heartbeat_task.cancel()
                try:
                    await heartbeat_task
                except asyncio.CancelledError:
                    pass
            await manager.disconnect(websocket)
            await db.close()
