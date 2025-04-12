import json
import logging
from typing import Optional, cast
from uuid import UUID
from sqlalchemy.sql.expression import BinaryExpression
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
    Query,
    Request,
)
from pydantic import BaseModel, Field

# DB Session
from db import get_async_session

# Models
from models.user import User
from models.project import Project
from models.conversation import Conversation
from models.message import Message

# Services
from services.project_service import validate_project_access
from services import get_conversation_service
from services.conversation_service import ConversationService

# Utils
from utils.auth_utils import (
    get_current_user_and_token,
)
from utils.db_utils import validate_resource_access, get_all_by_condition, save_model
from utils.response_utils import create_standard_response
from utils.serializers import serialize_message, serialize_conversation


logger = logging.getLogger(__name__)
router = APIRouter(tags=["Conversations"])


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
    project_id: Optional[UUID], current_user: User, _db: AsyncSession
) -> Optional[Project]:
    """
    If project_id is provided, validate access and return the Project.
    If None, return None for standalone usage.
    """
    if project_id:
        proj = await validate_project_access(project_id, current_user, _db)
        if not proj:
            raise HTTPException(
                status_code=404, detail="Project not found or not accessible"
            )
        return proj
    return None


# --------------------------------------------------------------------------
# Create Conversation
# --------------------------------------------------------------------------
@router.post("/conversations", response_model=dict)
@router.post("/projects/{project_id}/conversations", response_model=dict)
async def create_conversation(
    conversation_data: ConversationCreate,
    project_id: Optional[UUID] = None,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """Create a new conversation."""
    try:
        conv = await conv_service.create_conversation(
            user_id=current_user.id,
            title=conversation_data.title.strip(),
            model_id=conversation_data.model_id or "claude-3-sonnet-20240229",
            project_id=project_id,
        )

        return await create_standard_response(
            serialize_conversation(conv), "Conversation created successfully"
        )
    except Exception as e:
        logger.error(f"Conversation creation failed: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to create conversation: {str(e)}"
        )


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
            cast(BinaryExpression[bool], (Conversation.project_id == project.id) | (Conversation.project_id.is_(None))),
            cast(BinaryExpression[bool], Conversation.is_deleted.is_(False)),
        ]
    else:
        filters_to_use = [
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
@router.post(
    "/chat/projects/{project_id}/conversations/{conversation_id}/messages",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
)
async def create_message(
    conversation_id: UUID,
    new_msg: dict,  # ideally use Pydantic model
    project_id: Optional[UUID] = None,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """
    Add a new message to the specified conversation.
    Triggers an AI response if message.role == 'user'.
    """
    logger.debug(
        f"Creating message in conversation {conversation_id}, project {project_id}, user {current_user.id}"
    )

    try:
        # Extract content from the message
        role = (new_msg.get("role") or "user").lower().strip()
        content = new_msg.get("content", "")

        # Handle content if it's a dictionary
        if isinstance(content, dict):
            import json

            content = json.dumps(content, ensure_ascii=False)

        # Use the conversation service to create the message and generate AI response
        # The service handles validation, processing, and AI response generation
        response = await conv_service.create_message(
            conversation_id=conversation_id,
            user_id=current_user.id,
            content=str(content).strip(),
            role=role,
            project_id=project_id,
            # Pass optional parameters for AI response generation
            image_data=new_msg.get("image_data"),
            vision_detail=new_msg.get("vision_detail", "auto"),
            enable_thinking=new_msg.get("enable_thinking", False),
            thinking_budget=new_msg.get("thinking_budget"),
            reasoning_effort=new_msg.get("reasoning_effort"),
            temperature=new_msg.get("temperature"),
            max_tokens=new_msg.get("max_tokens"),
        )

        return await create_standard_response(response)

    except HTTPException as e:
        # Re-raise HTTP exceptions directly
        raise
    except Exception as e:
        logger.error(f"Error creating message: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to create message: {str(e)}"
        ) from e
