"""
unified_conversations.py
-----------------------
Routes for managing conversations within projects.
Focuses only on project-based conversations to reduce complexity.
"""

import json
import logging
from typing import cast
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
from utils.auth_utils import get_current_user_and_token
from utils.db_utils import validate_resource_access, get_all_by_condition, save_model
from utils.response_utils import create_standard_response
from utils.serializers import serialize_message, serialize_conversation


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
        description="Model deployment ID (Claude, GPT, etc.)"
    )


class ConversationUpdate(BaseModel):
    """Model for updating an existing conversation."""
    title: str | None = Field(None, min_length=1, max_length=100)
    model_id: str | None = None


class MessageCreate(BaseModel):
    """Model for creating a new message in a conversation."""
    content: str = Field(..., description="The message content")
    role: str = Field("user", description="Message role (user or assistant)")
    image_data: str | None = Field(None, description="Optional base64 encoded image data")
    vision_detail: str = Field("auto", description="Vision detail level for image processing")
    enable_thinking: bool = Field(False, description="Enable AI thinking/reasoning steps")
    thinking_budget: int | None = Field(None, description="Maximum tokens for thinking")
    reasoning_effort: float | None = Field(None, description="Effort level for reasoning (0-1)")
    temperature: float | None = Field(None, description="Model temperature")
    max_tokens: int | None = Field(None, description="Maximum tokens for response")


# --------------------------------------------------------------------------
# Create Conversation
# --------------------------------------------------------------------------
@router.post("/projects/{project_id}/conversations", response_model=dict)
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
    try:
        # Validate project access first
        await validate_project_access(project_id, current_user, db)
        
        # Create the conversation
        conv = await conv_service.create_conversation(
            user_id=current_user.id,
            title=conversation_data.title.strip(),
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
        # Re-raise HTTP exceptions directly
        raise
    except Exception as e:
        logger.error(f"Conversation creation failed: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to create conversation: {str(e)}"
        ) from e


# --------------------------------------------------------------------------
# List Conversations
# --------------------------------------------------------------------------
@router.get("/projects/{project_id}/conversations", response_model=dict)
async def list_project_conversations(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = Query(0, ge=0, description="Number of conversations to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum number of conversations to return"),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """
    List all conversations within a project.
    Returns conversations in descending order of creation date.
    """
    # Validate project access first
    await validate_project_access(project_id, current_user, db)
    
    # Get conversations from service
    conversations = await conv_service.list_conversations(
        user_id=current_user.id,
        project_id=project_id,
        skip=skip,
        limit=limit,
    )

    logger.info(f"Retrieved {len(conversations)} conversations for project {project_id}")
    
    return await create_standard_response({
        "conversations": [serialize_conversation(conv) for conv in conversations],
        "count": len(conversations),
        "project_id": str(project_id)
    })


# --------------------------------------------------------------------------
# Get Conversation
# --------------------------------------------------------------------------
@router.get("/projects/{project_id}/conversations/{conversation_id}", response_model=dict)
async def get_project_conversation(
    project_id: UUID,
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Retrieve metadata about a specific conversation within a project.
    """
    # Validate project access first
    project = await validate_project_access(project_id, current_user, db)

    try:
        # Get conversation directly
        conversation = await db.get(Conversation, conversation_id)
        
        # Validate conversation
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")
        if conversation.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized to access this conversation")
        if conversation.is_deleted:
            raise HTTPException(status_code=404, detail="Conversation was deleted")
        if conversation.project_id != project.id:
            raise HTTPException(
                status_code=404,
                detail="Conversation does not belong to the specified project"
            )

        logger.info(f"Retrieved conversation {conversation_id} from project {project_id}")
        
        return await create_standard_response(serialize_conversation(conversation))
    except HTTPException:
        # Re-raise HTTP exceptions directly
        raise
    except Exception as e:
        logger.error(f"Error retrieving conversation: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retrieve conversation") from e


# --------------------------------------------------------------------------
# Update Conversation
# --------------------------------------------------------------------------
@router.patch("/projects/{project_id}/conversations/{conversation_id}", response_model=dict)
async def update_project_conversation(
    project_id: UUID,
    conversation_id: UUID,
    update_data: ConversationUpdate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Update a conversation's title or model_id within a project.
    """
    # Validate project access first
    project = await validate_project_access(project_id, current_user, db)

    # Set filters to validate conversation belongs to this project and is not deleted
    filters_to_use = [
        cast(BinaryExpression[bool], Conversation.project_id == project.id),
        cast(BinaryExpression[bool], Conversation.is_deleted.is_(False)),
    ]

    # Get and validate conversation
    conversation = await validate_resource_access(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        additional_filters=filters_to_use,
    )

    # Update fields if provided
    if update_data.title is not None:
        conversation.title = update_data.title.strip()
    if update_data.model_id is not None:
        conversation.model_id = update_data.model_id

    # Save changes
    await save_model(db, conversation)
    logger.info(f"Updated conversation {conversation_id} in project {project_id}")

    return await create_standard_response(
        serialize_conversation(conversation), 
        "Conversation updated successfully"
    )


# --------------------------------------------------------------------------
# Delete/Restore Conversation
# --------------------------------------------------------------------------
@router.delete("/projects/{project_id}/conversations/{conversation_id}", response_model=dict)
async def delete_project_conversation(
    project_id: UUID,
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """
    Soft-delete a conversation within a project.
    The conversation is marked as deleted but not removed from the database.
    """
    # Use service method to handle deletion
    deleted_id = await conv_service.delete_conversation(
        conversation_id=conversation_id,
        user_id=current_user.id,
        project_id=project_id,
    )
    
    logger.info(f"Deleted conversation {conversation_id} from project {project_id}")
    
    return await create_standard_response(
        {"conversation_id": str(deleted_id)}, 
        "Conversation deleted successfully"
    )


@router.post("/projects/{project_id}/conversations/{conversation_id}/restore", response_model=dict)
async def restore_project_conversation(
    project_id: UUID,
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Restore a previously soft-deleted conversation within a project.
    """
    # Validate project access
    project = await validate_project_access(project_id, current_user, db)

    # Validate conversation belongs to project and is deleted
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

    # Restore conversation
    conversation.is_deleted = False
    conversation.deleted_at = None
    await save_model(db, conversation)

    logger.info(f"Restored conversation {conversation_id} in project {project_id}")
    
    return await create_standard_response(
        {"id": str(conversation.id)}, 
        "Conversation restored successfully"
    )


# --------------------------------------------------------------------------
# List Conversation Messages
# --------------------------------------------------------------------------
@router.get("/projects/{project_id}/conversations/{conversation_id}/messages", response_model=dict)
async def list_project_conversation_messages(
    project_id: UUID,
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = Query(0, ge=0, description="Number of messages to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum number of messages to return"),
):
    """
    Retrieve messages in a project conversation.
    Returns messages in ascending order of creation date.
    """
    # Validate project access
    await validate_project_access(project_id, current_user, db)
    
    # Set filters to validate conversation belongs to this project and is not deleted
    filters_to_use = [
        cast(BinaryExpression[bool], Conversation.project_id == project_id),
        cast(BinaryExpression[bool], Conversation.is_deleted.is_(False)),
    ]

    # Get and validate conversation
    conversation = await validate_resource_access(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        additional_filters=filters_to_use,
    )

    # Get messages for this conversation
    messages = await get_all_by_condition(
        db,
        Message,
        Message.conversation_id == conversation.id,
        order_by=Message.created_at.asc(),
        limit=limit,
        offset=skip,
    )

    logger.info(f"Retrieved {len(messages)} messages from conversation {conversation_id}")
    
    return await create_standard_response({
        "messages": [serialize_message(msg) for msg in messages],
        "metadata": {
            "title": conversation.title,
            "model_id": conversation.model_id,
            "count": len(messages)
        },
    })


# --------------------------------------------------------------------------
# Create New Message
# --------------------------------------------------------------------------
@router.post(
    "/projects/{project_id}/conversations/{conversation_id}/messages",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
)
async def create_project_conversation_message(
    project_id: UUID,
    conversation_id: UUID,
    new_msg: MessageCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """
    Add a new message to a project conversation.
    If the message role is 'user', an AI response will be automatically generated.
    """
    logger.debug(
        f"Creating message in conversation {conversation_id}, project {project_id}, user {current_user.id}"
    )

    try:
        # Extract content from the message
        role = new_msg.role.lower().strip()
        content = new_msg.content.strip()

        # Use the conversation service to create the message and generate AI response
        response = await conv_service.create_message(
            conversation_id=conversation_id,
            user_id=current_user.id,
            content=content,
            role=role,
            project_id=project_id,
            # Pass optional parameters for AI response generation
            image_data=new_msg.image_data,
            vision_detail=new_msg.vision_detail,
            enable_thinking=new_msg.enable_thinking,
            thinking_budget=new_msg.thinking_budget,
            reasoning_effort=new_msg.reasoning_effort,
            temperature=new_msg.temperature,
            max_tokens=new_msg.max_tokens,
        )

        logger.info(f"Created message in conversation {conversation_id}, project {project_id}")
        
        return await create_standard_response(
            response, 
            "Message created successfully"
        )
    except HTTPException:
        # Re-raise HTTP exceptions directly
        raise
    except Exception as e:
        logger.error(f"Error creating message: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to create message: {str(e)}"
        ) from e
# --------------------------------------------------------------------------
# Additional Conversation Features 
# --------------------------------------------------------------------------
@router.post(
    "/projects/{project_id}/conversations/{conversation_id}/title-suggestion",
    response_model=dict
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
    Uses the AI model to analyze the conversation and suggest an appropriate title.
    """
    # Validate project access
    await validate_project_access(project_id, current_user, db)
    
    try:
        # Set filters to validate conversation belongs to this project and is not deleted
        filters_to_use = [
            cast(BinaryExpression[bool], Conversation.project_id == project_id),
            cast(BinaryExpression[bool], Conversation.is_deleted.is_(False)),
        ]

        # Get and validate conversation
        conversation = await validate_resource_access(
            conversation_id,
            Conversation,
            current_user,
            db,
            "Conversation",
            additional_filters=filters_to_use,
        )
        
        # Get conversation messages
        messages = await get_all_by_condition(
            db,
            Message,
            Message.conversation_id == conversation.id,
            order_by=Message.created_at.asc(),
            limit=10,  # Only use first few messages for title generation
        )
        
        if not messages:
            return await create_standard_response(
                {"title": conversation.title, "generated": False},
                "No messages to generate title from"
            )
        
        # Use conversation service to generate title
        suggested_title = await conv_service.generate_conversation_title(
            conversation_id=conversation_id,
            messages=[serialize_message(msg) for msg in messages],
            model_id=conversation.model_id,
        )
        
        logger.info(f"Generated title suggestion for conversation {conversation_id}: {suggested_title}")
        
        return await create_standard_response(
            {"title": suggested_title, "original_title": conversation.title, "generated": True},
            "Title suggestion generated"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate title suggestion: {str(e)}")
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to generate title suggestion: {str(e)}"
        ) from e


@router.post(
    "/projects/{project_id}/conversations/{conversation_id}/summarize", 
    response_model=dict
)
async def summarize_conversation(
    project_id: UUID,
    conversation_id: UUID,
    max_length: int = Query(200, ge=50, le=500, description="Maximum length of summary in characters"),
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """
    Generate a summary of the conversation content.
    Uses the AI model to produce a concise summary of the conversation.
    """
    # Validate project access
    await validate_project_access(project_id, current_user, db)
    
    try:
        # Set filters to validate conversation belongs to this project and is not deleted
        filters_to_use = [
            cast(BinaryExpression[bool], Conversation.project_id == project_id),
            cast(BinaryExpression[bool], Conversation.is_deleted.is_(False)),
        ]

        # Get and validate conversation
        conversation = await validate_resource_access(
            conversation_id,
            Conversation,
            current_user,
            db,
            "Conversation",
            additional_filters=filters_to_use,
        )
        
        # Get conversation messages
        messages = await get_all_by_condition(
            db,
            Message,
            Message.conversation_id == conversation.id,
            order_by=Message.created_at.asc(),
        )
        
        if not messages:
            return await create_standard_response(
                {"summary": "No messages in conversation", "message_count": 0},
                "No messages to summarize"
            )
        
        # Use conversation service to generate summary
        summary = await conv_service.generate_conversation_summary(
            conversation_id=conversation_id,
            messages=[serialize_message(msg) for msg in messages],
            model_id=conversation.model_id,
            max_length=max_length,
        )
        
        logger.info(f"Generated summary for conversation {conversation_id}")
        
        return await create_standard_response(
            {
                "summary": summary,
                "title": conversation.title,
                "message_count": len(messages)
            },
            "Conversation summary generated"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate conversation summary: {str(e)}")
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to generate conversation summary: {str(e)}"
        ) from e


# --------------------------------------------------------------------------
# Batch Operations
# --------------------------------------------------------------------------
class BatchConversationIds(BaseModel):
    """Model for batch operations on multiple conversations."""
    conversation_ids: list[UUID] = Field(..., min_items=1, max_items=100)


@router.post("/projects/{project_id}/conversations/batch-delete", response_model=dict)
async def batch_delete_conversations(
    project_id: UUID,
    batch_data: BatchConversationIds,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """
    Batch delete multiple conversations within a project.
    All conversations are soft-deleted (marked as deleted but not removed from database).
    """
    # Validate project access
    await validate_project_access(project_id, current_user, db)
    
    try:
        deleted_ids = []
        failed_ids = []
        
        for conversation_id in batch_data.conversation_ids:
            try:
                # Use service to delete each conversation
                await conv_service.delete_conversation(
                    conversation_id=conversation_id,
                    user_id=current_user.id,
                    project_id=project_id,
                )
                deleted_ids.append(str(conversation_id))
            except Exception as e:
                logger.warning(f"Failed to delete conversation {conversation_id}: {str(e)}")
                failed_ids.append(str(conversation_id))
        
        logger.info(f"Batch deleted {len(deleted_ids)} conversations in project {project_id}")
        
        return await create_standard_response(
            {
                "deleted": deleted_ids,
                "failed": failed_ids,
                "total_requested": len(batch_data.conversation_ids),
                "total_deleted": len(deleted_ids),
                "total_failed": len(failed_ids)
            },
            f"Batch deleted {len(deleted_ids)} conversations, {len(failed_ids)} failed"
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
    include_messages: bool = Field(True, description="Whether to search in message content")
    

@router.post("/projects/{project_id}/conversations/search", response_model=dict)
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
    Returns conversations that match the search query.
    """
    # Validate project access
    await validate_project_access(project_id, current_user, db)
    
    try:
        # Use service to perform search
        search_results = await conv_service.search_conversations(
            project_id=project_id,
            user_id=current_user.id,
            query=search_query.query,
            include_messages=search_query.include_messages,
            skip=skip,
            limit=limit,
        )
        
        logger.info(f"Search for '{search_query.query}' returned {len(search_results['conversations'])} results")
        
        return await create_standard_response({
            "conversations": [serialize_conversation(conv) for conv in search_results["conversations"]],
            "total": search_results["total"],
            "query": search_query.query,
            "highlighted_messages": search_results.get("highlighted_messages", {})
        })
    except Exception as e:
        logger.error(f"Conversation search failed: {str(e)}")
        raise HTTPException(
            status_code=500, 
            detail=f"Search operation failed: {str(e)}"
        ) from e
