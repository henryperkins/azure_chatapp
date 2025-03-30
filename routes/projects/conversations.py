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

import jwt
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status, Query, Request
from pydantic import BaseModel, Field
from schemas.chat_schemas import MessageCreate
from sqlalchemy.ext.asyncio import AsyncSession

from services import conversation_service, project_service
from services.context_integration import augment_with_knowledge
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
from utils.websocket_manager import ConnectionManager
from utils.ai_response import (
    generate_ai_response,
)
from utils.auth_utils import (
    get_current_user_and_token, 
    extract_token, 
    get_user_from_token,
    verify_token
)
from utils.db_utils import validate_resource_access, get_all_by_condition, save_model
from utils.response_utils import create_standard_response
from utils.serializers import serialize_message, serialize_conversation

manager = ConnectionManager()
logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/api/projects/{project_id}/conversations", 
    tags=["Project Conversations"]
)

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
    """List project conversations using the conversation service."""
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

@router.post("/{conversation_id}/restore", response_model=dict)
async def restore_conversation(
    project_id: UUID,
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Restores a soft-deleted conversation"""
    additional_filters = [
        Conversation.project_id == project_id,
        Conversation.is_deleted.is_(True)  # Only restore deleted conversations
    ]
    
    conversation = await validate_resource_access(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        additional_filters
    )

    conversation.is_deleted = False
    conversation.deleted_at = None
    await save_model(db, conversation)
    
    logger.info(f"Conversation {conversation_id} restored by user {current_user.id}")
    return await create_standard_response(
        {"id": str(conversation.id)},
        "Conversation restored successfully"
    )

@router.delete("/{conversation_id}", response_model=dict)
async def delete_conversation(
    project_id: UUID,
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Soft-deletes a conversation through the service layer."""
    try:
        # Service handles all validation and deletion
        deleted_id = await conversation_service.delete_conversation(
            project_id=project_id,
            conversation_id=conversation_id,
            db=db,
            user_id=current_user.id
        )
        
        logger.info(f"Conversation {deleted_id} deleted via service by user {current_user.id}")
        
        return await create_standard_response(
            {"conversation_id": str(deleted_id)},
            "Conversation deleted successfully"
        )
    except HTTPException:
        # Pass through HTTP exceptions from service layer
        raise
    except Exception as e:
        logger.error(f"Error deleting conversation {conversation_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to delete conversation due to internal error"
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
    conversation_id: UUID,
    token: str = Query(None),
    chatId: str = Query(None)
):
    import asyncio
    
    """Real-time chat updates for project conversations."""
    from db import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        try:
            # Extract token from query param, header, or cookie
            user_token = token or extract_token(websocket)
            if not user_token:
                logger.warning("WebSocket rejected: No token provided")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                logger.debug("No token. Headers: %s, Query Params: %s", websocket.headers, websocket.query_params)
                return

            # Validate user and token version
            try:
                user = await get_user_from_token(user_token, db, "access")
                if not user or not user.is_active:
                    await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                    logger.warning(f"Inactive user attempting connection: {user.id if user else 'unknown'}")
                    return
                
                # Explicit token version check
                decoded = jwt.decode(user_token, options={"verify_signature": False})
                db_user = await db.get(User, user.id)
                if not db_user:
                    logger.warning(f"User not found in database: {user.id}")
                    await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                    return
                    
                if db_user.token_version != decoded.get("version", 0):
                    logger.warning(f"Token version mismatch for {db_user.username}")
                    await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                    await websocket.send_json({
                        "type": "auth_error",
                        "code": "TOKEN_VERSION_MISMATCH", 
                        "message": "Token version mismatch - please refresh"
                    })
                    return
                
                # Redundant check - this block can be removed as the token version 
                # is already checked above
                
                if db_user.token_version != decoded.get("version", 0):
                    logger.warning(f"WebSocket rejected: Token version mismatch for user {db_user.username}")
                    await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                    return
            except Exception as auth_error:
                logger.warning(f"WebSocket authentication failed: {str(auth_error)}")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            # Validate project access
            try:
                project = await project_service.validate_project_access(project_id, user, db)
                if not project:
                    logger.warning(f"WebSocket rejected: Invalid project access for user {user.id}, project {project_id}")
                    await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                    return
            except Exception as project_error:
                logger.warning(f"WebSocket project access error: {str(project_error)}")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION) 
                return

            # Validate conversation access
            additional_filters = [
                Conversation.project_id == project_id,
                Conversation.is_deleted.is_(False)
            ]
            try:
                conversation = await validate_resource_access(
                    conversation_id,
                    Conversation,
                    user,
                    db,
                    "Conversation",
                    additional_filters
                )
                if not conversation:
                    logger.warning(f"WebSocket rejected: Invalid conversation access for user {user.id}, conversation {conversation_id}")
                    await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                    return
            except Exception as conversation_error:
                logger.warning(f"WebSocket conversation access error: {str(conversation_error)}")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            # Use the connection manager to handle this WebSocket connection
            connection_success = await manager.connect(websocket, str(conversation_id), str(user.id))
            if not connection_success:
                logger.warning(f"WebSocket connection failed for user {user.id}, conversation {conversation_id}")
                return

            heartbeat_task = None
            try:
                # Start heartbeat
                async def heartbeat():
                    while True:
                        await asyncio.sleep(25)
                        try:
                            await websocket.send_json({"type": "pong"})
                        except Exception as e:
                            logger.warning(f"Heartbeat failed: {str(e)}")
                            break
                
                heartbeat_task = asyncio.create_task(heartbeat())

                # Send a connection success message
                await manager.send_personal_message({
                    "type": "connected", 
                    "message": "WebSocket connection established",
                    "conversation_id": str(conversation_id)
                }, websocket)

                # Process messages
                while True:
                    raw_data = await websocket.receive_text()
                    try:
                        data_dict = json.loads(raw_data)
                        if "content" not in data_dict:
                            raise ValueError("Message missing required 'content' field")
                        
                        # Validate role
                        role = data_dict.get("role", "user")
                        if role not in ["user", "system"]:
                            await manager.send_personal_message({
                                "type": "error",
                                "message": "Invalid message role - must be 'user' or 'system'"
                            }, websocket)
                            continue

                        # Check for token refresh
                        if data_dict.get("type") == "token_refresh" and data_dict.get("token"):
                            try:
                                # Get fresh user data from new token
                                new_token = data_dict.get("token")
                                user = await get_user_from_token(new_token, db, "access")
                                db_user = await db.get(User, user.id)

                                # Update in-memory user reference
                                user = db_user

                                logger.info(f"Token refreshed via WebSocket for user {user.id}")

                                # Send success message using fresh user state
                                await manager.send_personal_message({
                                    "type": "token_refresh_success",
                                    "message": "Token refreshed successfully",
                                    "new_version": db_user.token_version  # Send back to client
                                }, websocket)
                                continue
                            except Exception as token_error:
                                logger.error(f"Token refresh error: {str(token_error)}")
                                await manager.send_personal_message({
                                    "type": "error",
                                    "message": "Token refresh failed"
                                }, websocket)
                                continue

                    except (json.JSONDecodeError, ValueError) as e:
                        await manager.send_personal_message({
                            "type": "error", 
                            "message": f"Invalid message format: {str(e)}"
                        }, websocket)
                        continue

                    # Create message with validated role
                    message_id = data_dict.get("messageId")
                    message = await create_user_message(
                        conversation_id=conversation_id,
                        content=data_dict["content"],
                        role=role,
                        db=db
                    )

                    # Acknowledge receipt
                    if message_id:
                        await manager.send_personal_message({
                            "type": "message_received",
                            "messageId": message_id,
                            "message": "Message received and stored"
                        }, websocket)

                    if message.role == "user":
                        try:
                            # Get conversation history
                            msg_dicts = await get_conversation_messages(conversation_id, db, include_system_prompt=True)
                            
                            # Inject knowledge base context
                            kb_context = await augment_with_knowledge(
                                conversation_id=conversation_id,
                                user_message=data_dict["content"],
                                db=db
                            )
                            
                            # Generate AI response with enhanced context
                            assistant_msg = await generate_ai_response(
                                conversation_id=conversation_id,
                                messages=kb_context + msg_dicts,
                                model_id=conversation.model_id,
                                image_data=data_dict.get("image_data"),
                                vision_detail=data_dict.get("vision_detail", "auto"),
                                enable_thinking=data_dict.get("enable_thinking", False),
                                thinking_budget=data_dict.get("thinking_budget"),
                                db=db
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
                                    response_data["metadata"] = json.dumps(metadata)
                                
                                # Add message ID if present in original request
                                if message_id:
                                    response_data["messageId"] = message_id
                                
                                # Send response to client
                                await manager.send_personal_message(response_data, websocket)
                                
                                # Update token usage
                                token_estimate = len(assistant_msg.content) // 4
                                await update_project_token_usage(conversation, token_estimate, db)
                            else:
                                await manager.send_personal_message({
                                    "type": "error",
                                    "messageId": message_id,
                                    "message": "Failed to generate AI response"
                                }, websocket)
                        except Exception as e:
                            logger.error(f"Error handling WebSocket response: {str(e)}")
                            await manager.send_personal_message({
                                "type": "error",
                                "messageId": message_id,
                                "message": f"Error generating response: {str(e)}"
                            }, websocket)

            except WebSocketDisconnect:
                logger.info(f"WebSocket disconnected for user {user.id}, conversation {conversation_id}")
            finally:
                # Cancel heartbeat task if it exists
                if heartbeat_task is not None:
                    heartbeat_task.cancel()
                    try:
                        await heartbeat_task
                    except asyncio.CancelledError:
                        pass
                
                # Always disconnect properly
                await manager.disconnect(websocket)
                await manager.disconnect(websocket)

        except Exception as e:
            logger.error(f"Unhandled WebSocket error: {str(e)}")
            try:
                await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
            except Exception:
                pass
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
# Debug Endpoints
# ============================

@router.post("/{conversation_id}/debug")
async def debug_conversation(
    request: Request,
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Debug endpoint to test conversation flow"""
    # Get project_id from the parent router's path
    project_id = request.path_params["project_id"]
    
    conversation = await validate_resource_access(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [Conversation.project_id == project_id, Conversation.is_deleted.is_(False)],
    )
    
    return {
        "status": "ok", 
        "conversation_id": str(conversation_id),
        "model": conversation.model_id,
        "message_count": len(conversation.messages) if conversation.messages else 0
    }
