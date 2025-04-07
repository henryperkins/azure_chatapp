import json
import logging
import asyncio
from typing import Optional, cast
from uuid import UUID
from sqlalchemy.sql.expression import BinaryExpression
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
    status,
    Query,
    Request,
)
from config import settings
from pydantic import BaseModel, Field

# DB Session
from db import AsyncSessionLocal, get_async_session

# Models
from models.user import User
from models.project import Project
from models.conversation import Conversation
from models.message import Message

# Services
from services.project_service import validate_project_access
from services import get_conversation_service
from services.conversation_service import ConversationService
from services.context_integration import augment_with_knowledge

# Utils
from utils.auth_utils import (
    get_current_user_and_token,
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


# --------------------------------------------------------------------------
# Pydantic Models
# --------------------------------------------------------------------------
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


# --------------------------------------------------------------------------
# Helper: Resolve optional project
# --------------------------------------------------------------------------
async def resolve_project_if_any(
    project_id: Optional[UUID], current_user: User, db: AsyncSession
) -> Optional[Project]:
    """
    If project_id is provided, validate access and return the Project.
    If None, return None for standalone usage.
    """
    if project_id:
        proj = await validate_project_access(project_id, current_user, db)
        if not proj:
            raise HTTPException(
                status_code=404, detail="Project not found or not accessible"
            )
        return proj
    return None


# --------------------------------------------------------------------------
# Create Conversation
# --------------------------------------------------------------------------
@router.post("/conversations", response_model=dict, status_code=status.HTTP_201_CREATED)
@router.post(
    "/projects/{project_id}/conversations",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
)
async def create_conversation(
    conversation_data: ConversationCreate,
    project_id: Optional[UUID] = None,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """
    Create a new conversation.
    - If `project_id`, conversation is bound to that project.
    - Otherwise, it's standalone.
    """
    logger.info(f"Attempting to create conversation. project_id={project_id}")
    logger.info(f"Received ConversationCreate data: {conversation_data.dict()}")

    project = await resolve_project_if_any(project_id, current_user, db)

    # Use the provided model_id or the project's default model, or fallback
    model_id = conversation_data.model_id
    if not model_id and project:
        model_id = project.default_model
    if not model_id:
        default_model_fallback = "claude-3-sonnet-20240229"
        logger.info(
            "No model_id provided/found; using default: %s", default_model_fallback
        )
        model_id = default_model_fallback
    else:
        logger.info(f"Using model_id: {model_id}")

    try:
        conv = await conv_service.create_conversation(
            user_id=current_user.id,
            title=conversation_data.title.strip(),
            model_id=model_id,
            project_id=UUID(str(project.id)) if project else None,
        )

        if conv is None:
            logger.error("Conversation service returned None unexpectedly.")
            raise HTTPException(
                status_code=500, detail="Failed to create conversation object."
            )

        return await create_standard_response(
            serialize_conversation(conv), "Conversation created successfully"
        )

    except HTTPException as http_exc:
        logger.warning(
            f"HTTPException during conversation creation: {http_exc.status_code} - {http_exc.detail}"
        )
        raise
    except Exception as e:
        logger.exception("Unexpected error during conversation creation: %s", e)
        # Here you can comply with lint recommendation using `from e`
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}"
        ) from e


# --------------------------------------------------------------------------
# List Conversations
# --------------------------------------------------------------------------
@router.get("/conversations", response_model=dict)
@router.get("/projects/{project_id}/conversations", response_model=dict)
async def list_conversations(
    project_id: Optional[UUID] = None,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """
    List conversations.
    - If `project_id`, list that project's conversations.
    - Else, list user’s standalone conversations.
    """
    if project_id:
        await resolve_project_if_any(project_id, current_user, db)
        conversations = await conv_service.list_conversations(
            user_id=current_user.id,
            project_id=project_id,
            skip=skip,
            limit=limit,
        )
    else:
        # Standalone
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


# --------------------------------------------------------------------------
# Get Conversation
# --------------------------------------------------------------------------
@router.get("/conversations/{conversation_id}", response_model=dict)
@router.get(
    "/projects/{project_id}/conversations/{conversation_id}", response_model=dict
)
async def get_conversation(
    request: Request,
    conversation_id: UUID,
    project_id: Optional[UUID] = None,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Retrieve metadata about a specific conversation.
    - If `project_id`, it must belong to that project.
    - Otherwise, must be standalone.
    """
    project = await resolve_project_if_any(project_id, current_user, db)

    logger.info(
        "Conversation GET Request:\n"
        f"- User: {current_user.id}\n"
        f"- Project: {project_id}\n"
        f"- Conversation: {conversation_id}\n"
        f"- Headers: {json.dumps(dict(request.headers), indent=2)}"
    )

    try:
        conversation = await db.get(Conversation, conversation_id)
        logger.info(f"Conversation lookup result: {conversation}")

        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")
        if conversation.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized")
        if conversation.is_deleted:
            raise HTTPException(status_code=404, detail="Conversation was deleted")
        if project and conversation.project_id != project.id:
            raise HTTPException(
                status_code=404,
                detail="Conversation does not belong to the specified project",
            )

        return await create_standard_response(serialize_conversation(conversation))

    except HTTPException as e:
        logger.error(f"Conversation access failed: {e.status_code} {e.detail}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        # Lint recommends `from e`
        raise HTTPException(status_code=500, detail="Internal server error") from e


# --------------------------------------------------------------------------
# Update Conversation
# --------------------------------------------------------------------------
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
    - If `project_id`, conversation must belong to that project.
    - Otherwise, it's standalone.
    """
    project = await resolve_project_if_any(project_id, current_user, db)

    # Build filters if you truly need them; otherwise just check `project` alignment
    filters_to_use: list[BinaryExpression[bool]] = []
    if project:
        filters_to_use = [
            cast(BinaryExpression[bool], Conversation.project_id == project.id),
            cast(BinaryExpression[bool], Conversation.is_deleted.is_(False)),
        ]
    else:
        filters_to_use = [
            cast(BinaryExpression[bool], Conversation.project_id.is_(None)),
            cast(BinaryExpression[bool], Conversation.is_deleted.is_(False)),
        ]

    conversation = await validate_resource_access(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        additional_filters=filters_to_use,  # or rename param if needed
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


# --------------------------------------------------------------------------
# Delete/Restore Conversation
# --------------------------------------------------------------------------
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
    Restore a soft-deleted conversation. Only relevant for project-based.
    """
    # Validate project
    project = await validate_project_access(project_id, current_user, db)
    if not project:
        raise HTTPException(
            status_code=404, detail="Project not found or not accessible"
        )

    # Validate conversation belongs to that project and is deleted
    filters_to_use = [
        cast(BinaryExpression[bool], Conversation.project_id == project.id),
        cast(BinaryExpression[bool], Conversation.is_deleted.is_(True)),
    ]
    conversation = await validate_resource_access(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        additional_filters=filters_to_use,
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
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """
    Soft-delete a conversation.
    - If `project_id`, delete from that project.
    - Otherwise, delete standalone conversation.
    """
    if project_id:
        deleted_id = await conv_service.delete_conversation(
            conversation_id=conversation_id,
            user_id=current_user.id,
            project_id=project_id,
        )
        return await create_standard_response(
            {"conversation_id": str(deleted_id)}, "Conversation deleted successfully"
        )
    else:
        # Standalone logic
        filters_to_use = [
            cast(BinaryExpression[bool], Conversation.project_id.is_(None)),
            cast(BinaryExpression[bool], Conversation.is_deleted.is_(False)),
        ]
        conversation = await validate_resource_access(
            conversation_id,
            Conversation,
            current_user,
            db,
            "Conversation",
            additional_filters=filters_to_use,
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


# --------------------------------------------------------------------------
# List Conversation Messages
# --------------------------------------------------------------------------
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
    Retrieve messages in a conversation.
    """
    # Validate conversation
    filters_to_use = (
        [
            cast(BinaryExpression[bool], Conversation.project_id == project_id),
            cast(BinaryExpression[bool], Conversation.is_deleted.is_(False)),
        ]
        if project_id
        else [
            cast(BinaryExpression[bool], Conversation.project_id.is_(None)),
            cast(BinaryExpression[bool], Conversation.is_deleted.is_(False)),
        ]
    )

    conversation = await validate_resource_access(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        additional_filters=filters_to_use,
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


# --------------------------------------------------------------------------
# Create New Message
# --------------------------------------------------------------------------
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
    new_msg: dict,  # ideally use Pydantic model
    project_id: Optional[UUID] = None,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Add a new message to the specified conversation.
    Triggers an AI response if message.role == 'user'.
    """
    logger.debug(
        f"Creating message in conversation {conversation_id}, project {project_id}, user {current_user.id}"
    )

    # Validate project if provided
    if project_id:
        project = await validate_project_access(project_id, current_user, db)
        if not project:
            logger.error(f"Project validation failed for {project_id}")
            raise HTTPException(
                status_code=404, detail="Project not found or not accessible"
            )

    # Validate conversation
    filters_to_use = (
        [
            cast(BinaryExpression[bool], Conversation.project_id == project_id),
            cast(BinaryExpression[bool], Conversation.is_deleted.is_(False)),
        ]
        if project_id
        else [
            cast(BinaryExpression[bool], Conversation.project_id.is_(None)),
            cast(BinaryExpression[bool], Conversation.is_deleted.is_(False)),
            cast(BinaryExpression[bool], Conversation.user_id == current_user.id),
        ]
    )

    conversation = await validate_resource_access(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        additional_filters=filters_to_use,
        require_ownership=False,
    )

    # Validate image data if present
    if "image_data" in new_msg and new_msg["image_data"]:
        await validate_image_data(new_msg["image_data"])

    # Create the message
    role = (new_msg.get("role") or "user").lower().strip()
    content = (new_msg.get("content") or "").strip()
    message = await create_user_message(
        conversation_id=UUID(str(conversation.id)),
        content=content,
        role=role,
        db=db,
    )
    response_payload = serialize_message(message)

    # Generate AI response if user message
    if message.role == "user":
        try:
            msg_dicts = await get_conversation_messages(
                UUID(str(conversation.id)), db, include_system_prompt=True
            )

            # Possibly augment with knowledge base
            kb_context = []
            if conversation.use_knowledge_base:
                kb_context = await augment_with_knowledge(
                    conversation_id=UUID(str(conversation.id)),
                    user_message=content,
                    db=db,
                )

            try:
                assistant_msg = await generate_ai_response(
                    conversation_id=UUID(str(conversation.id)),
                    messages=kb_context + msg_dicts,
                    model_id=conversation.model_id or "claude-3-sonnet-20240229",
                    image_data=new_msg.get("image_data"),
                    vision_detail=new_msg.get("vision_detail", "auto"),
                    enable_thinking=new_msg.get("enable_thinking", False),
                    thinking_budget=new_msg.get("thinking_budget"),
                    db=db,
                )
            except HTTPException as e:
                response_payload["assistant_error"] = e.detail
                return await create_standard_response(
                    response_payload, success=False, status_code=e.status_code
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

                # Update usage (roughly 4 chars/1 token)
                token_estimate = len(assistant_msg.content) // 4
                await update_project_token_usage(conversation, token_estimate, db)
            else:
                response_payload["assistant_error"] = "Failed to generate response"

        except Exception as e:
            logger.error(f"Error generating AI response: {e}")
            response_payload["assistant_error"] = str(e)

    return await create_standard_response(response_payload)


# --------------------------------------------------------------------------
# WebSocket for Real-time Chat
# --------------------------------------------------------------------------
@router.websocket("/conversations/{conversation_id}/ws")
@router.websocket("/projects/{project_id}/conversations/{conversation_id}/ws")
async def websocket_chat_endpoint(
    websocket: WebSocket,
    conversation_id: UUID,
    project_id: Optional[UUID] = None,
    token: str = Query(None),
):
    """
    Real-time chat updates for either standalone or project-based conversations.
    """
    user = None
    heartbeat_task = None

    async with AsyncSessionLocal() as db:
        try:
            # Validate session cookie (same-origin only)
            try:
                user = await get_user_from_token(websocket.cookies.get("session"), db)
                if not user:
                    logger.warning("No valid session cookie found")
                    await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                    return
            except Exception as e:
                logger.error(f"WebSocket auth error: {str(e)}")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            # Accept WebSocket connection
                await websocket.accept()
                logger.info(f"WebSocket connection accepted for {conversation_id}")
            except Exception as e:
                logger.error(f"WebSocket setup failed: {str(e)}")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            # Project validation (if project_id provided) - skip token check since user already validated
            if project_id:
                try:
                    project = await validate_project_access(
                        project_id, user, db, skip_ownership_check=True
                    )
                    if not project:
                        logger.error(
                            f"Project {project_id} not found or not accessible"
                        )
                        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                        return
                except HTTPException as e:
                    logger.error(f"WebSocket authorization failed: {e.detail}")
                    await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                    return

            # Conversation validation - skip token check since user already validated
            try:
                conversation = await db.get(Conversation, conversation_id)
                if not conversation or conversation.user_id != user.id:
                    await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                    return
            except Exception as e:
                logger.error(f"Failed to get conversation: {str(e)}")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            # Register connection with manager
            await manager.connect_with_state(
                websocket, str(conversation_id), db, str(user.id)
            )

            # Setup heartbeat/ping handler
            async def handle_heartbeat():
                while True:
                    await asyncio.sleep(30)  # 30-second ping interval
                    try:
                        await websocket.send_json({"type": "ping"})
                    except Exception:
                        break  # Exit the heartbeat loop if sending fails

            # Start heartbeat task
            heartbeat_task = asyncio.create_task(handle_heartbeat())

            # Send connected confirmation
            await manager.send_personal_message(
                {
                    "type": "status",
                    "message": "WebSocket established",
                    "userId": str(user.id),
                },
                websocket,
            )

            # Main message processing loop
            while True:
                raw_data = await websocket.receive_text()
                try:
                    data = json.loads(raw_data)

                    # Handle ping/pong for heartbeat
                    if data.get("type") == "ping":
                        await websocket.send_json({"type": "pong"})
                        continue

                    # Handle token refresh
                    if data.get("type") == "token_refresh":
                        await manager.send_personal_message(
                            {"type": "token_refresh_success"},
                            websocket,
                        )
                        continue

                    # Handle user message
                    if data.get("type") == "message":
                        # Get conversation service
                        conv_service = ConversationService(db)

                        # Process message
                        response_data = await conv_service.handle_ws_message(
                            websocket=websocket,
                            conversation_id=conversation_id,
                            user_id=user.id,
                            message_data=data,
                            project_id=project_id,
                        )

                        # Send response back to client
                        await manager.send_personal_message(response_data, websocket)
                        continue

                except json.JSONDecodeError as e:
                    await manager.send_personal_message(
                        {"type": "error", "message": str(e)}, websocket
                    )

        except (WebSocketDisconnect, asyncio.CancelledError):
            logger.info(
                f"WebSocket disconnected for user {user.id if user else 'unknown'}, conversation {conversation_id}"
            )
        except Exception as e:
            logger.exception(f"WebSocket error: {str(e)}")
        finally:
            # Clean up
            if heartbeat_task:
                heartbeat_task.cancel()
            await manager.disconnect(websocket)
