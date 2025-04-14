# unified_conversations.py
# -------------------------
# Routes for managing conversations within projects.
# Relies on ConversationService for all conversation operations.

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_async_session
from models.user import User
from services.project_service import validate_project_access
from services import get_conversation_service
from services.conversation_service import ConversationService
from utils.auth_utils import get_current_user_and_token
from utils.response_utils import create_standard_response
from utils.serializers import serialize_conversation


logger = logging.getLogger(__name__)
router = APIRouter(tags=["Project Conversations"])


# --------------------------------------------------------------------------
# Pydantic Models
# --------------------------------------------------------------------------
class ConversationCreate(BaseModel):
    """Model for creating a new conversation within a project."""

    title: str = Field(
        ..., min_length=1, max_length=100, description="User-friendly title"
    )
    model_id: str = Field(
        "claude-3-sonnet-20240229",
        description="Model deployment ID (Claude, GPT, etc.)",
    )


class ConversationUpdate(BaseModel):
    """Model for updating an existing conversation."""

    title: str | None = Field(None, min_length=1, max_length=100)
    model_id: str | None = None


class MessageCreate(BaseModel):
    """Model for creating a new message in a conversation."""

    content: str = Field(..., description="The message content")
    role: str = Field("user", description="Message role (user or assistant)")
    image_data: str | None = Field(
        None, description="Optional base64-encoded image data"
    )
    vision_detail: str = Field(
        "auto", description="Vision detail level for image processing"
    )
    enable_thinking: bool = Field(
        False, description="Enable AI thinking/reasoning steps"
    )
    thinking_budget: int | None = Field(None, description="Maximum tokens for thinking")
    reasoning_effort: str | None = Field(
        None, description="Effort level (e.g. 'low','medium','high')"
    )
    temperature: float | None = Field(None, description="Model temperature")
    max_tokens: int | None = Field(None, description="Maximum tokens for response")


# --------------------------------------------------------------------------
# Create Conversation
# --------------------------------------------------------------------------
@router.post("/{project_id}/conversations", response_model=dict)
async def create_conversation(
    project_id: UUID,
    conversation_data: ConversationCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """
    Create a new conversation within a project.
    Sets up a conversation with the specified AI model.
    """
    # Validate project access
    await validate_project_access(project_id, current_user, db)

    try:
        conv = await conv_service.create_conversation(
            user_id=current_user.id,
            title=conversation_data.title,
            model_id=conversation_data.model_id,
            project_id=project_id,
        )

        logger.info(
            f"Created conversation '{conversation_data.title}' in project {project_id} "
            f"for user {current_user.id} with model {conversation_data.model_id}"
        )

        return await create_standard_response(
            serialize_conversation(conv), "Conversation created successfully"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Conversation creation failed: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to create conversation: {str(e)}"
        ) from e


# --------------------------------------------------------------------------
# List Conversations
# --------------------------------------------------------------------------
@router.get("/{project_id}/conversations", response_model=dict)
async def list_project_conversations(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = Query(0, ge=0, description="Number of conversations to skip"),
    limit: int = Query(
        100, ge=1, le=500, description="Max number of conversations to return"
    ),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """
    List all conversations within a project.
    Returns conversations in descending order of creation date.
    """
    await validate_project_access(project_id, current_user, db)

    conversations = await conv_service.list_conversations(
        user_id=current_user.id,
        project_id=project_id,
        skip=skip,
        limit=limit,
    )

    logger.info(
        f"Retrieved {len(conversations)} conversations for project {project_id}"
    )

    return await create_standard_response(
        {
            "conversations": [serialize_conversation(conv) for conv in conversations],
            "count": len(conversations),
            "project_id": str(project_id),
        }
    )


# --------------------------------------------------------------------------
# Get Conversation
# --------------------------------------------------------------------------
@router.get("/{project_id}/conversations/{conversation_id}", response_model=dict)
async def get_project_conversation(
    project_id: UUID,
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """
    Retrieve metadata about a specific conversation within a project.
    """
    # Validate project access
    await validate_project_access(project_id, current_user, db)

    try:
        conv_data = await conv_service.get_conversation(
            conversation_id=conversation_id,
            user_id=current_user.id,
            project_id=project_id,
        )
        logger.info(
            f"Retrieved conversation {conversation_id} from project {project_id}"
        )

        return await create_standard_response(conv_data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving conversation: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Failed to retrieve conversation"
        ) from e


# --------------------------------------------------------------------------
# Update Conversation
# --------------------------------------------------------------------------
@router.patch("/{project_id}/conversations/{conversation_id}", response_model=dict)
async def update_project_conversation(
    project_id: UUID,
    conversation_id: UUID,
    update_data: ConversationUpdate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """
    Update a conversation's title or model_id within a project.
    """
    await validate_project_access(project_id, current_user, db)

    try:
        conv_dict = await conv_service.update_conversation(
            conversation_id=conversation_id,
            user_id=current_user.id,
            project_id=project_id,
            title=update_data.title,
            model_id=update_data.model_id,
            # If you need to allow use_knowledge_base or AI settings updates here,
            # you can pass them in similarly: use_knowledge_base=..., ai_settings=...
        )

        logger.info(f"Updated conversation {conversation_id} in project {project_id}")

        return await create_standard_response(
            conv_dict, "Conversation updated successfully"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating conversation: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to update conversation: {str(e)}"
        ) from e


# --------------------------------------------------------------------------
# Delete Conversation
# --------------------------------------------------------------------------
@router.delete("/{project_id}/conversations/{conversation_id}", response_model=dict)
async def delete_project_conversation(
    project_id: UUID,
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """
    Soft-delete a conversation within a project.
    The conversation is marked as deleted but not removed from the database.
    """
    try:
        deleted_id = await conv_service.delete_conversation(
            conversation_id=conversation_id,
            user_id=current_user.id,
            project_id=project_id,
        )

        logger.info(f"Deleted conversation {conversation_id} from project {project_id}")

        return await create_standard_response(
            {"conversation_id": str(deleted_id)}, "Conversation deleted successfully"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting conversation: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to delete conversation: {str(e)}"
        ) from e


# --------------------------------------------------------------------------
# Restore Conversation
# --------------------------------------------------------------------------
@router.post(
    "/{project_id}/conversations/{conversation_id}/restore", response_model=dict
)
async def restore_project_conversation(
    project_id: UUID,
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """
    Restore a previously soft-deleted conversation within a project.
    """
    await validate_project_access(project_id, current_user, db)

    try:
        conv_dict = await conv_service.restore_conversation(
            conversation_id=conversation_id,
            user_id=current_user.id,
            project_id=project_id,
        )
        logger.info(f"Restored conversation {conversation_id} in project {project_id}")

        return await create_standard_response(
            conv_dict, "Conversation restored successfully"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to restore conversation: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to restore conversation: {str(e)}"
        ) from e


# --------------------------------------------------------------------------
# List Conversation Messages
# --------------------------------------------------------------------------
@router.get(
    "/{project_id}/conversations/{conversation_id}/messages", response_model=dict
)
async def list_project_conversation_messages(
    project_id: UUID,
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = Query(0, ge=0, description="Number of messages to skip"),
    limit: int = Query(
        100, ge=1, le=500, description="Maximum number of messages to return"
    ),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """
    Retrieve messages in a project conversation.
    Returns messages in ascending order of creation date.
    """
    await validate_project_access(project_id, current_user, db)

    try:
        messages = await conv_service.list_messages(
            conversation_id=conversation_id,
            user_id=current_user.id,
            project_id=project_id,
            skip=skip,
            limit=limit,
        )

        logger.info(
            f"Retrieved {len(messages)} messages from conversation {conversation_id}"
        )

        # Optionally fetch conversation metadata
        conv_data = await conv_service.get_conversation(
            conversation_id=conversation_id,
            user_id=current_user.id,
            project_id=project_id,
        )

        return await create_standard_response(
            {
                "messages": messages,
                "metadata": {
                    "title": conv_data["title"],
                    "model_id": conv_data["model_id"],
                    "count": len(messages),
                },
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing messages: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Failed to retrieve messages"
        ) from e


# --------------------------------------------------------------------------
# Create New Message
# --------------------------------------------------------------------------
@router.post(
    "/{project_id}/conversations/{conversation_id}/messages",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
)
async def create_project_conversation_message(
    project_id: UUID,
    conversation_id: UUID,
    new_msg: MessageCreate,
    current_user: User = Depends(get_current_user_and_token),
    conv_service: ConversationService = Depends(get_conversation_service),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Add a new message to a project conversation.
    If the message role is 'user', an AI response will be automatically generated.
    """
    logger.debug(
        f"Creating message in conversation {conversation_id}, project {project_id}, user {current_user.id}"
    )

    # Validate project access
    await validate_project_access(project_id, current_user, db)

    try:
        response = await conv_service.create_message(
            conversation_id=conversation_id,
            user_id=current_user.id,
            content=new_msg.content.strip(),
            role=new_msg.role.lower().strip(),
            project_id=project_id,
            image_data=new_msg.image_data,
            vision_detail=new_msg.vision_detail,
            enable_thinking=new_msg.enable_thinking,
            thinking_budget=new_msg.thinking_budget,
            reasoning_effort=new_msg.reasoning_effort,
            temperature=new_msg.temperature,
            max_tokens=new_msg.max_tokens,
        )

        logger.info(
            f"Created message in conversation {conversation_id}, project {project_id}"
        )

        return await create_standard_response(response, "Message created successfully")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating message: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to create message: {str(e)}"
        ) from e


# --------------------------------------------------------------------------
# Title Suggestion
# --------------------------------------------------------------------------
@router.post(
    "/{project_id}/conversations/{conversation_id}/title-suggestion",
    response_model=dict,
)
async def suggest_conversation_title(
    project_id: UUID,
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """
    Generate a suggested title for a conversation based on its content.
    """
    await validate_project_access(project_id, current_user, db)

    try:
        # We'll list the first few messages and pass them to the service
        messages = await conv_service.list_messages(
            conversation_id=conversation_id,
            user_id=current_user.id,
            project_id=project_id,
            skip=0,
            limit=10,
        )

        # Get model_id from conversation
        conv_data = await conv_service.get_conversation(
            conversation_id=conversation_id,
            user_id=current_user.id,
            project_id=project_id,
        )
        model_id = conv_data.get("model_id", "")

        if not messages:
            return await create_standard_response(
                {"title": conv_data["title"], "generated": False},
                "No messages to generate title from",
            )

        suggested_title = await conv_service.generate_conversation_title(
            conversation_id=conversation_id, messages=messages, model_id=model_id
        )

        logger.info(
            f"Generated title suggestion for conversation {conversation_id}: {suggested_title}"
        )

        return await create_standard_response(
            {
                "title": suggested_title,
                "original_title": conv_data["title"],
                "generated": True,
            },
            "Title suggestion generated",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate title suggestion: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to generate title suggestion: {str(e)}"
        ) from e


# --------------------------------------------------------------------------
# Summarize Conversation
# --------------------------------------------------------------------------
@router.post(
    "/{project_id}/conversations/{conversation_id}/summarize", response_model=dict
)
async def summarize_conversation(
    project_id: UUID,
    conversation_id: UUID,
    max_length: int = Query(
        200, ge=50, le=500, description="Maximum summary length in characters"
    ),
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """
    Generate a summary of the conversation content.
    """
    await validate_project_access(project_id, current_user, db)

    try:
        messages = await conv_service.list_messages(
            conversation_id=conversation_id,
            user_id=current_user.id,
            project_id=project_id,
            skip=0,
            limit=9999,  # get all messages for a full summary
        )

        if not messages:
            return await create_standard_response(
                {"summary": "No messages in conversation", "message_count": 0},
                "No messages to summarize",
            )

        # Get model_id from conversation
        conv_data = await conv_service.get_conversation(
            conversation_id=conversation_id,
            user_id=current_user.id,
            project_id=project_id,
        )
        model_id = conv_data.get("model_id", "")

        summary = await conv_service.generate_conversation_summary(
            conversation_id=conversation_id,
            messages=messages,
            model_id=model_id,
            max_length=max_length,
        )

        logger.info(f"Generated summary for conversation {conversation_id}")

        return await create_standard_response(
            {
                "summary": summary,
                "title": conv_data["title"],
                "message_count": len(messages),
            },
            "Conversation summary generated",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate conversation summary: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to generate conversation summary: {str(e)}"
        ) from e


# --------------------------------------------------------------------------
# Batch Operations
# --------------------------------------------------------------------------
class BatchConversationIds(BaseModel):
    """Model for batch operations on multiple conversations."""

    conversation_ids: list[UUID] = Field(..., min_length=1, max_length=100)


@router.post("/{project_id}/conversations/batch-delete", response_model=dict)
async def batch_delete_conversations(
    project_id: UUID,
    batch_data: BatchConversationIds,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """
    Batch delete multiple conversations within a project (soft delete).
    """
    await validate_project_access(project_id, current_user, db)

    try:
        deleted_ids = []
        failed_ids = []

        for conversation_id in batch_data.conversation_ids:
            try:
                await conv_service.delete_conversation(
                    conversation_id=conversation_id,
                    user_id=current_user.id,
                    project_id=project_id,
                )
                deleted_ids.append(str(conversation_id))
            except Exception as e:
                logger.warning(
                    f"Failed to delete conversation {conversation_id}: {str(e)}"
                )
                failed_ids.append(str(conversation_id))

        logger.info(
            f"Batch deleted {len(deleted_ids)} conversations in project {project_id}"
        )

        return await create_standard_response(
            {
                "deleted": deleted_ids,
                "failed": failed_ids,
                "total_requested": len(batch_data.conversation_ids),
                "total_deleted": len(deleted_ids),
                "total_failed": len(failed_ids),
            },
            f"Batch deleted {len(deleted_ids)} conversations, {len(failed_ids)} failed",
        )
    except Exception as e:
        logger.error(f"Batch delete failed: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Batch delete operation failed: {str(e)}"
        ) from e


# --------------------------------------------------------------------------
# Search Conversations
# --------------------------------------------------------------------------
class ConversationSearchQuery(BaseModel):
    """Model for searching conversations."""

    query: str = Field(..., min_length=1, max_length=200)
    include_messages: bool = Field(
        True, description="Whether to search in message content"
    )


@router.post("/{project_id}/conversations/search", response_model=dict)
async def search_project_conversations(
    project_id: UUID,
    search_query: ConversationSearchQuery,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """
    Search for conversations within a project by title and optionally message content.
    """
    await validate_project_access(project_id, current_user, db)

    try:
        search_results = await conv_service.search_conversations(
            project_id=project_id,
            user_id=current_user.id,
            query=search_query.query,
            include_messages=search_query.include_messages,
            skip=skip,
            limit=limit,
        )

        conversations = search_results["conversations"]
        total = search_results["total"]
        highlighted = search_results.get("highlighted_messages", {})

        logger.info(
            f"Search for '{search_query.query}' returned {len(conversations)} results"
        )

        return await create_standard_response(
            {
                "conversations": [serialize_conversation(c) for c in conversations],
                "total": total,
                "query": search_query.query,
                "highlighted_messages": highlighted,
            }
        )
    except Exception as e:
        logger.error(f"Conversation search failed: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Search operation failed: {str(e)}"
        ) from e
