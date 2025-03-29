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

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status, Query
from pydantic import BaseModel, Field
from schemas.chat_schemas import MessageCreate
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
from utils.auth_utils import get_current_user_and_token, extract_token, get_user_from_token
from utils.db_utils import validate_resource_access, get_all_by_condition, save_model
from utils.response_utils import create_standard_response
from utils.serializers import serialize_message, serialize_conversation

logger = logging.getLogger(__name__)
router = APIRouter()

# ============================
# Pydantic Schemas
# ============================

class ConversationCreate(BaseModel):
    """Model for creating a new conversation."""
    title: str = Field(..., min_length=1, max_length=100, description="User-friendly title")
    model_id: Optional[str] = Field(None, description="Optional model ID referencing the chosen model deployment")


class ConversationUpdate(BaseModel):
    """Model for updating an existing conversation."""
    title: Optional[str] = Field(None, min_length=1, max_length=100)
    model_id: Optional[str] = None

# ============================
# Conversation Endpoints
# ============================

@router.post("/", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    project_id: UUID,
    conversation_data: ConversationCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Create a new conversation within a given project."""
    project = await project_service.validate_project_access(project_id, current_user, db)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

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
    skip: int = Query(0, ge=0, description="Number of items to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum number of items to return")
):
    """
    List project conversations using the conversation service.
    Enforces skip >= 0 and 1 <= limit <= 500 to prevent 422 errors for out-of-range values.
    """
    logger.info(f"Loading project conversations for project {project_id} (user {current_user.id})")
    
    try:
        # Validate project access
        await project_service.validate_project_access(project_id, current_user, db)
        logger.info(f"Project access validated for project {project_id}")
    except HTTPException as e:
        logger.error(f"Project access denied: {str(e)}")
        raise
    
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
    """Retrieve metadata about a specific conversation."""
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
    return await create_standard_response(serialize_conversation(conversation))

@router.patch("/{conversation_id}", response_model=dict)
async def update_conversation(
    project_id: UUID,
    conversation_id: UUID,
    update_data: ConversationUpdate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Update the conversation's title or model_id."""
    additional_filters_project = [
        Project.user_id == current_user.id,
        Project.archived.is_(False)
    ]
    await validate_resource_access(project_id, Project, current_user, db, "Project", additional_filters_project)

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

    if update_data.title is not None:
        conversation.title = update_data.title.strip()
    if update_data.model_id is not None:
        conversation.model_id = update_data.model_id

    await save_model(db, conversation)
    logger.info(f"Conversation {conversation_id} updated by user {current_user.id}")

    return await create_standard_response(
        {
            "id": str(conversation.id),
            "title": conversation.title,
            "model_id": conversation.model_id,
            "project_id": str(conversation.project_id)
        },
        "Conversation updated successfully"
    )

@router.delete("/{conversation_id}", response_model=dict)
async def delete_conversation(
    project_id: UUID,
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Soft-deletes a conversation by setting is_deleted = True."""
    additional_filters_project = [
        Project.user_id == current_user.id,
        Project.archived.is_(False)
    ]
    await validate_resource_access(project_id, Project, current_user, db, "Project", additional_filters_project)

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
        "Conversation deleted successfully"
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
    skip: int = Query(0, ge=0, description="Number of messages to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum number of messages to return")
):
    """
    Retrieves messages for a project conversation.
    Enforces skip >= 0 and 1 <= limit <= 500 to reduce the chance of 422 errors.
    """
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

    messages = await get_all_by_condition(
        db,
        Message,
        Message.conversation_id == conversation.id,
        order_by=Message.created_at.asc(),
        limit=limit,
        offset=skip
    )

    return await create_standard_response(
        {
            "messages": [serialize_message(msg) for msg in messages],
            "metadata": {"title": conversation.title}
        }
    )

@router.websocket("/{conversation_id}/ws")
async def project_websocket_chat_endpoint(
    websocket: WebSocket,
    project_id: UUID,
    conversation_id: UUID
):
    """Real-time chat updates for project conversations."""
    from db import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        try:
            token = extract_token(websocket)
            if not token:
                logger.warning("WebSocket rejected: No token provided")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                logger.debug("No token. Headers: %s, Query Params: %s", websocket.headers, websocket.query_params)
                return

            # Validate user and token version
            user = await get_user_from_token(token, db, "access")
            db_user = await db.get(User, user.id)
            decoded = jwt.decode(token, options={"verify_signature": False})
            
            if db_user.token_version != decoded.get("version", 0):
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            # Validate project access
            project = await project_service.validate_project_access(project_id, user, db)
            if not project:
                logger.warning("WebSocket rejected: Invalid project access")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                logger.debug("Invalid project access for user_id=%s, project_id=%s", user.id, project_id)
                return

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
            )
            if not conversation:
                logger.warning("WebSocket rejected: Invalid conversation access")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                logger.debug("Invalid conversation access for user_id=%s, conv_id=%s", user.id, conversation_id)
                return

            # Validate all access before accepting connection
            # Validate conversation belongs to project
            conversation = await validate_resource_access(
                conversation_id,
                Conversation,
                user,
                db,
                "Conversation",
                [
                    Conversation.project_id == project_id,  # ✅ Correct filter
                    Conversation.is_deleted.is_(False)
                ]
            )

            # All validations complete - now accept connection
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
                    try:
                        await handle_websocket_response(conversation_id, db, websocket)
                    except Exception as e:
                        logger.error(f"Error handling websocket response: {str(e)}")
                        await websocket.send_json({
                            "type": "error",
                            "message": f"Error generating response: {str(e)}"
                        })

        except WebSocketDisconnect:
            logger.info("WebSocket disconnected")
        except HTTPException as he:
            logger.error(f"WebSocket HTTP error: {he.detail}")
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
    """Adds a new message to the specified conversation, triggers AI response if it's a user message."""
    additional_filters_project = [
        Project.user_id == current_user.id,
        Project.archived.is_(False)
    ]
    await validate_resource_access(
        project_id,
        Project,
        current_user,
        db,
        "Project",
        additional_filters_project
    )

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

    # Create user message
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
        msg_dicts = await get_conversation_messages(conversation_id, db, include_system_prompt=True)
        try:
            assistant_msg = await generate_ai_response(
                conversation_id=conversation_id_uuid,
                messages=msg_dicts,
                model_id=conversation.model_id,
                image_data=new_msg.image_data,
                vision_detail=new_msg.vision_detail or "auto",
                db=db
            )
            if assistant_msg:
                # Get metadata from the message
                metadata = assistant_msg.get_metadata_dict() if hasattr(assistant_msg, 'get_metadata_dict') else {}
                
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
                
                # Add thinking metadata if available
                if metadata:
                    if "thinking" in metadata:
                        response_payload["thinking"] = metadata["thinking"]
                    if "redacted_thinking" in metadata:
                        response_payload["redacted_thinking"] = metadata["redacted_thinking"]
                
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
async def project_websocket_endpoint(
    websocket: WebSocket,
    project_id: UUID,
    conversation_id: UUID
):
    """Alternate real-time chat endpoint for a project conversation."""
    from db import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        try:
            token = extract_token(websocket)
            if not token:
                logger.warning("WebSocket rejected: No token provided")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                logger.debug("Headers: %s, Query Params: %s", websocket.headers, websocket.query_params)
                return

            # Validate user and token version
            user = await get_user_from_token(token, db, "access")
            db_user = await db.get(User, user.id)
            decoded = jwt.decode(token, options={"verify_signature": False})
            
            if db_user.token_version != decoded.get("version", 0):
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            additional_filters_project = [
                Project.user_id == user.id,
                Project.archived.is_(False)
            ]
            await validate_resource_access(project_id, Project, user, db, "Project", additional_filters_project)

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
                logger.warning("WebSocket rejected: Invalid conversation")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                logger.debug("conversation_id=%s, project_id=%s, user_id=%s", conversation_id, project_id, user.id)
                return

            await websocket.accept()
            while True:
                data = await websocket.receive_text()
                try:
                    data_dict = json.loads(data)
                except json.JSONDecodeError:
                    data_dict = {"content": data, "role": "user"}

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
