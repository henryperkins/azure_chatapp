"""
conversations.py
--------------
Routes for managing conversations within a project.
Provides endpoints for creating, retrieving, updating and deleting conversations
and their messages that belong to a specific project.
"""

import json
import logging
from uuid import UUID
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from services import conversation_service, project_service

from db import get_async_session
from models.user import User
from models.project import Project
from models.conversation import Conversation
from models.message import Message

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
from utils.auth_utils import get_current_user_and_token, extract_token_from_websocket, get_user_from_token
from utils.db_utils import validate_resource_access, get_all_by_condition, save_model
from utils.response_utils import create_standard_response
from utils.serializers import serialize_message, serialize_conversation

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

# The duplicate endpoint is removed - the other endpoint (list_conversations) provides the same functionality

@router.post("/", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    project_id: UUID,
    conversation_data: ConversationCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Create a new conversation using the conversation service"""
    # Validate project access using service
    project = await project_service.validate_project_access(
        project_id, current_user, db
    )

    # Get project for model validation
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Create conversation using service with model validation
    conversation = await conversation_service.create_conversation(
        project_id=project_id,
        user_id=current_user.id,
        title=conversation_data.title,
        model_id=conversation_data.model_id or project.default_model,
        db=db
    )

    return await create_standard_response(
        serialize_conversation(conversation),
        "Conversation created successfully"
    )


@router.get("/", response_model=dict)
async def list_conversations(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = 0,
    limit: int = 100
):
    """List project conversations using conversation service"""
    logger.info(f"Loading project conversations for project {project_id} (user {current_user.id})")
    
    # First validate project access
    try:
        await project_service.validate_project_access(
            project_id, current_user, db
        )
        logger.info(f"Project access validated for project {project_id}")
    except HTTPException as e:
        logger.error(f"Project access denied: {str(e)}")
        raise
    
    # Get conversations via service
    try:
        conversations = await conversation_service.list_project_conversations(
            project_id=project_id,
            db=db,
            user_id=current_user.id,
            skip=skip,
            limit=limit
        )
        
        logger.info(f"Successfully loaded {len(conversations)} conversations for project {project_id}")
        return await create_standard_response({
            "conversations": [serialize_conversation(conv) for conv in conversations]
        })
    except Exception as e:
        logger.error(f"Error loading project conversations: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load project conversations: {str(e)}"
        )


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
    additional_filters = [
        Conversation.project_id == project_id,
        Conversation.is_deleted.is_(False)
    ]
    conversation = await validate_resource_access(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        additional_filters
    )

    return await create_standard_response(
        serialize_conversation(conversation)
    )


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
    additional_filters_project = [
        Project.user_id == current_user.id,
        Project.archived.is_(False)  # Cannot modify archived projects
    ]
    await validate_resource_access(
        project_id,
        Project,
        current_user,
        db,
        "Project",
        additional_filters_project
    )

    # Validate conversation ownership
    additional_filters_conv = [
        Conversation.project_id == project_id,
        Conversation.is_deleted.is_(False)
    ]
    conversation = await validate_resource_access(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        additional_filters_conv
    )

    # Update fields
    if update_data.title is not None:
        conversation.title = update_data.title.strip()
    if update_data.model_id is not None:
        conversation.model_id = update_data.model_id

    # Save using utility function
    await save_model(db, conversation)

    logger.info(f"Conversation {conversation_id} updated by user {current_user.id}")

    return await create_standard_response({
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
    additional_filters_project = [
        Project.user_id == current_user.id,
        Project.archived.is_(False)  # Cannot modify archived projects
    ]
    await validate_resource_access(
        project_id,
        Project,
        current_user,
        db,
        "Project",
        additional_filters_project
    )

    # Validate conversation ownership
    additional_filters_conv = [
        Conversation.project_id == project_id,
        Conversation.is_deleted.is_(False)
    ]
    conversation = await validate_resource_access(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        additional_filters_conv
    )

    conversation.is_deleted = True
    await save_model(db, conversation)

    logger.info(f"Conversation {conversation_id} soft-deleted by user {current_user.id}")

    return await create_standard_response(
        {"conversation_id": str(conversation.id)},
        message="Conversation deleted successfully"
    )


# ============================
# Message Endpoints
# ============================

@router.get("/{conversation_id}/messages", response_model=dict)
async def list_conversation_messages(
    project_id: UUID,
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = 0,
    limit: int = 100
):
    """Retrieves messages for a project conversation"""
    # Validate project conversation exists
    additional_filters = [
        Conversation.project_id == project_id,
        Conversation.is_deleted.is_(False)
    ]
    conversation = await validate_resource_access(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        additional_filters
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

    return await create_standard_response({
        "messages": [serialize_message(msg) for msg in messages],
        "metadata": {"title": conversation.title}
    })

@router.websocket("/{conversation_id}/ws")
async def project_websocket_chat_endpoint(
    websocket: WebSocket,
    project_id: UUID,
    conversation_id: UUID
):
    """Real-time chat updates for project conversations"""
    from db import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        try:
            # 1. Extract JWT token first
            token = await extract_token_from_websocket(websocket)
            if not token:
                logger.warning("WebSocket connection rejected: No token provided")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                logger.debug("WebSocket connection rejected - No token. Headers: %s, Query Params: %s", websocket.headers, websocket.query_params)  # ADDED DEBUG LOG
                return

            # 2. Validate token and get user
            user = await get_user_from_token(token, db, "access")

            # 3. Validate project access using project service
            project = await project_service.validate_project_access(
                project_id, user, db  # type: ignore
            )
            if not project:
                logger.warning("WebSocket connection rejected: Project access validation failed")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                logger.debug("Project access validation failed for project_id: %s, user_id: %s", project_id, user.id)  # ADDED DEBUG LOG
                return

            # 4. Validate conversation belongs to project
            additional_filters = [
                Conversation.project_id == project_id,
                Conversation.is_deleted.is_(False)
            ]
            conversation = await validate_resource_access(
                conversation_id,
                Conversation,
                user,
                db,
                "Conversation",
                additional_filters
            )  # type: ignore
            if not conversation:
                logger.warning("WebSocket connection rejected: Conversation access validation failed")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                logger.debug("Conversation access validation failed for conversation_id: %s, project_id: %s, user_id: %s", conversation_id, project_id, user.id)  # ADDED DEBUG LOG
                return

            await websocket.accept()

            while True:
                raw_data = await websocket.receive_text()
                try:
                    data_dict = json.loads(raw_data)
                except json.JSONDecodeError:
                    data_dict = {"content": raw_data, "role": "user"}

                # Create message
                message = await create_user_message(
                    conversation_id=conversation_id,
                    content=data_dict["content"],
                    role=data_dict["role"],
                    db=db
                )

                if message.role == "user":
                    await handle_websocket_response(conversation_id, db, websocket)

        except WebSocketDisconnect:
            logger.info("WebSocket disconnected")
        except HTTPException as he:
            logger.error(f"WebSocket HTTP error: {str(he)}")
            await websocket.close(code=he.status_code)
        except Exception as e:
            logger.error(f"WebSocket error: {str(e)}")
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        finally:
            await db.close()


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
    additional_filters_project = [
        Project.user_id == current_user.id,
        Project.archived.is_(False)  # Cannot modify archived projects
    ]
    await validate_resource_access(
        project_id,
        Project,
        current_user,
        db,
        "Project",
        additional_filters_project
    )

    # Validate conversation ownership
    additional_filters_conv = [
        Conversation.project_id == project_id,
        Conversation.is_deleted.is_(False)
    ]
    conversation = await validate_resource_access(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        additional_filters_conv
    )

    # Validate image data if provided
    if new_msg.image_data:
        await validate_image_data(new_msg.image_data)

    # Create user message - convert to plain UUID to match expected type
    conversation_id_uuid = UUID(str(conversation.id))
    message = await create_user_message(
        conversation_id=conversation_id_uuid,
        content=new_msg.content.strip(),
        role=new_msg.role.lower().strip(),
        db=db
    )

    response_payload = serialize_message(message)

    # Generate AI response if user message
    if message.role == "user":
        # Get formatted messages for API
        msg_dicts = await get_conversation_messages(conversation_id, db, include_system_prompt=True)

        try:
            # Generate AI response
            # Convert to plain UUID to match expected type
            conversation_id_uuid = UUID(str(conversation.id))
            assistant_msg = await generate_ai_response(
                conversation_id=conversation_id_uuid,
                messages=msg_dicts,
                model_id=conversation.model_id,
                image_data=new_msg.image_data,
                vision_detail=new_msg.vision_detail or "auto",
                db=db
            )

            if assistant_msg:
                # Add assistant message to response
                response_payload["assistant_message"] = {  # type: ignore
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

    return await create_standard_response(response_payload)


# ============================
# WebSocket for Real-time Chat
# ============================

@router.websocket("/ws/{conversation_id}")
async def websocket_chat_endpoint(
    websocket: WebSocket,
    project_id: UUID,
    conversation_id: UUID
):
    """Real-time chat updates for project conversations"""
    from db import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        try:
            # 1. Extract JWT token first
            token = await extract_token_from_websocket(websocket)
            if not token:
                logger.warning("WebSocket connection rejected: No token provided")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                logger.debug("WebSocket connection rejected - No token. Headers: %s, Query Params: %s", websocket.headers, websocket.query_params)  # ADDED DEBUG LOG
                return

            # 2. Validate token and get user
            user = await get_user_from_token(token, db, "access")

            # 3. Validate project access
            additional_filters_project = [
                Project.user_id == user.id,
                Project.archived.is_(False)
            ]
            await validate_resource_access(
                project_id,
                Project,
                user,
                db,
                "Project",
                additional_filters_project
            )

            # 4. Validate conversation exists in project
            additional_filters_conv = [
                Conversation.project_id == project_id,
                Conversation.is_deleted.is_(False)
            ]
            validated_conversation = await validate_resource_access(
                conversation_id,
                Conversation,
                user,
                db,
                "Conversation",
                additional_filters_conv
            )
            if not validated_conversation:
                logger.warning("WebSocket connection rejected: Conversation access validation failed")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                logger.debug("Conversation access validation failed for conversation_id: %s, project_id: %s, user_id: %s", conversation_id, project_id, user.id)  # ADDED DEBUG LOG
                return

            await websocket.accept()

            while True:
                data = await websocket.receive_text()
                try:
                    data_dict = json.loads(data)
                except json.JSONDecodeError:
                    data_dict = {"content": data, "role": "user"}

                # Create message
                try:
                    message = await create_user_message(
                        conversation_id=conversation_id,
                        content=data_dict["content"],
                        role=data_dict["role"],
                        db=db
                    )
                    
                    if message.role == "user":
                        await handle_websocket_response(conversation_id, db, websocket)
                except Exception as e:
                    logger.error(f"Error creating message: {str(e)}")
                    await websocket.send_json({
                        "type": "error",
                        "content": f"Error creating message: {str(e)}"
                    })

        except WebSocketDisconnect:
            logger.info("WebSocket disconnected")
        except HTTPException as he:
            logger.error(f"WebSocket HTTP error: {str(he)}")
            await websocket.close(code=he.status_code)
        except Exception as e:
            logger.error(f"WebSocket error: {str(e)}")
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        finally:
            await db.close()
