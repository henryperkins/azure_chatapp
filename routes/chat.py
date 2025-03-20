"""
chat.py
-------
Revised routes for conversations with enhanced utility functions.
Each conversation is tied to exactly one project (project_id).
"""

import logging
import json
from uuid import UUID
from datetime import datetime
from typing import Optional, List, Dict

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from db import get_async_session
from models.user import User
from models.project import Project
from models.conversation import Conversation
from models.message import Message
from utils.auth_deps import (
    get_current_user_and_token, 
    validate_resource_ownership,
    verify_project_access, 
    process_standard_response
)
from utils.openai import openai_chat
from utils.context import (
    manage_context, 
    token_limit_check, 
    get_by_id, 
    get_all_by_condition,
    save_model, 
    create_response
)

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
    project_id: Optional[UUID] = Field(None, description="Optional project ID to associate with this conversation")


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

@router.post("/conversations", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    conversation_data: ConversationCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Creates a new conversation, optionally associated with a project.
    """
    project_id = conversation_data.project_id
    project = None
    
    # Validate project ownership if a project_id is provided
    if project_id:
        project = await verify_project_access(project_id, current_user, db)
    
    # Create new conversation
    new_conversation = Conversation(
        user_id=current_user.id,
        project_id=project.id if project else None,
        title=conversation_data.title.strip(),
        model_id=conversation_data.model_id,
        is_deleted=False,
        created_at=datetime.now()
    )

    # Save using utility function
    await save_model(db, new_conversation)

    if project:
        logger.info("Conversation created with id=%s under project %s by user_id=%s", 
                    new_conversation.id, project_id, current_user.id)
    else:
        logger.info("Standalone conversation created with id=%s by user_id=%s", 
                    new_conversation.id, current_user.id)
                
    # Return standardized response
    return await process_standard_response({
        "conversation_id": str(new_conversation.id),
        "title": new_conversation.title,
        "created_at": new_conversation.created_at.isoformat(),
        "project_id": str(project_id) if project_id else None
    })


@router.get("/projects/{project_id}/conversations", response_model=dict)
async def list_conversations(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Returns a list of conversations for a specific project, owned by the current user.
    """
    # Validate project access
    await verify_project_access(project_id, current_user, db)

    # Use enhanced database function
    conversations = await get_all_by_condition(
        db,
        Conversation,
        Conversation.project_id == project_id,
        Conversation.user_id == current_user.id,
        Conversation.is_deleted.is_(False),
        order_by=Conversation.created_at.desc()
    )

    items = [
        {
            "id": str(conv.id),
            "title": conv.title,
            "model_id": conv.model_id,
            "created_at": conv.created_at
        }
        for conv in conversations
    ]
    
    return await process_standard_response({"conversations": items})


@router.get("/conversations", response_model=dict)
async def list_all_conversations(
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Returns a list of all conversations for the current user, including those not tied to a project.
    """
    # Use enhanced database function to get all conversations including those without a project
    conversations = await get_all_by_condition(
        db,
        Conversation,
        Conversation.user_id == current_user.id,
        Conversation.is_deleted.is_(False),
        order_by=Conversation.created_at.desc()
    )

    items = [
        {
            "id": str(conv.id),
            "title": conv.title,
            "model_id": conv.model_id,
            "created_at": conv.created_at,
            "project_id": str(conv.project_id) if conv.project_id else None
        }
        for conv in conversations
    ]
    
    return await process_standard_response({"conversations": items})


@router.get("/projects/{project_id}/conversations/{conversation_id}", response_model=dict)
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
    conversation = await validate_resource_ownership(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [
            Conversation.project_id == project_id,
            Conversation.is_deleted.is_(False)
        ]
    )
    
    return await process_standard_response({
        "id": str(conversation.id),
        "title": conversation.title,
        "model_id": conversation.model_id,
        "created_at": conversation.created_at
    })


@router.get("/conversations/{conversation_id}", response_model=dict)
async def get_standalone_conversation(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Retrieve metadata about a specific standalone conversation.
    """
    # Validate resource without requiring project relationship
    conversation = await validate_resource_ownership(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [
            Conversation.is_deleted.is_(False)
        ]
    )
    
    return await process_standard_response({
        "id": str(conversation.id),
        "title": conversation.title,
        "model_id": conversation.model_id,
        "created_at": conversation.created_at,
        "project_id": str(conversation.project_id) if conversation.project_id else None
    })


@router.patch("/conversations/{conversation_id}", response_model=dict)
async def update_standalone_conversation(
    conversation_id: UUID,
    update_data: ConversationUpdate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Updates a standalone conversation's title or model_id.
    """
    # Validate conversation ownership
    conversation = await validate_resource_ownership(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [
            Conversation.is_deleted.is_(False)
        ]
    )
    
    # Update fields
    if update_data.title is not None:
        conversation.title = update_data.title.strip()
    if update_data.model_id is not None:
        conversation.model_id = update_data.model_id

    # Save using utility function
    await save_model(db, conversation)
    
    logger.info(f"Conversation {conversation_id} updated by user {current_user.id}")

    return await process_standard_response({
        "id": str(conversation.id),
        "title": conversation.title,
        "model_id": conversation.model_id
    })


@router.patch("/projects/{project_id}/conversations/{conversation_id}", response_model=dict)
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
    # Validate conversation ownership
    conversation = await validate_resource_ownership(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [
            Conversation.project_id == project_id,
            Conversation.is_deleted.is_(False)
        ]
    )
    
    # Update fields
    if update_data.title is not None:
        conversation.title = update_data.title.strip()
    if update_data.model_id is not None:
        conversation.model_id = update_data.model_id

    # Save using utility function
    await save_model(db, conversation)
    
    logger.info(f"Conversation {conversation_id} updated by user {current_user.id}")

    return await process_standard_response({
        "id": str(conversation.id),
        "title": conversation.title,
        "model_id": conversation.model_id
    })


@router.delete("/projects/{project_id}/conversations/{conversation_id}", response_model=dict)
async def delete_conversation(
    project_id: UUID,
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Soft-deletes a conversation by setting is_deleted = True.
    """
    # Validate conversation ownership
    conversation = await validate_resource_ownership(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [
            Conversation.project_id == project_id,
            Conversation.is_deleted.is_(False)
        ]
    )
    
    conversation.is_deleted = True
    await save_model(db, conversation)
    
    logger.info(f"Conversation {conversation_id} soft-deleted by user {current_user.id}")

    return await process_standard_response(
        {"conversation_id": str(conversation.id)},
        message="Conversation deleted successfully"
    )


# ============================
# Message Endpoints
# ============================

@router.get("/projects/{project_id}/conversations/{conversation_id}/messages", response_model=dict)
async def list_messages(
    project_id: UUID,
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Retrieves all messages for a conversation, sorted by creation time ascending.
    """
    # Validate conversation ownership
    conversation = await validate_resource_ownership(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [
            Conversation.project_id == project_id,
            Conversation.is_deleted.is_(False)
        ]
    )

    # Get messages using enhanced function
    messages = await get_all_by_condition(
        db,
        Message,
        Message.conversation_id == conversation.id,
        order_by=Message.created_at.asc()
    )
    
    output = [
        {
            "id": str(msg.id),
            "role": msg.role,
            "content": msg.content,
            "metadata": msg.get_metadata_dict(),
            "timestamp": msg.created_at
        }
        for msg in messages
    ]
    
    return await process_standard_response({"messages": output})


@router.post("/projects/{project_id}/conversations/{conversation_id}/messages", response_model=dict, status_code=status.HTTP_201_CREATED)
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
    # Validate conversation ownership
    conversation = await validate_resource_ownership(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [
            Conversation.project_id == project_id,
            Conversation.is_deleted.is_(False)
        ]
    )

    try:
        # Create user message
        message = Message(
            conversation_id=conversation.id,
            role=new_msg.role.lower().strip(),
            content=new_msg.content.strip()
        )
        
        # Save using utility function
        await save_model(db, message)
        
        logger.info(f"Message {message.id} saved for conversation {conversation.id}")
    except Exception as e:
        await db.rollback()
        logger.error(f"Message save failed: {str(e)}")
        raise HTTPException(500, "Failed to save message")

    # Check token limit
    await token_limit_check(str(conversation.id), db)

    response_payload = {
        "success": True,
        "message_id": str(message.id),
        "role": message.role,
        "content": message.content
    }

    # Handle image data if provided
    if new_msg.image_data:
        from utils.openai import extract_base64_data
        import base64
        try:
            base64_str = extract_base64_data(new_msg.image_data)
            base64.b64decode(base64_str, validate=True)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid image data")

    # Generate AI response if user message
    if message.role == "user":
        # Get all messages using enhanced function
        conv_messages = await get_all_by_condition(
            db,
            Message,
            Message.conversation_id == conversation.id,
            order_by=Message.created_at.asc()
        )

        msg_dicts = [{"role": str(m.role), "content": str(m.content)} for m in conv_messages]
        
        # Get project for custom instructions
        project = await get_by_id(db, Project, conversation.project_id)
        
        if project and project.custom_instructions:
            msg_dicts.insert(0, {"role": "system", "content": project.custom_instructions})
        
        # Manage context to prevent token overflow
        msg_dicts = await manage_context(msg_dicts)

        try:
            # Determine model and settings
            chosen_model = "o1" if new_msg.image_data else (conversation.model_id or "o1")
            chosen_vision = new_msg.vision_detail if new_msg.vision_detail else "auto"

            # Call OpenAI API
            openai_response = await openai_chat(
                messages=msg_dicts,
                model_name=chosen_model,
                image_data=new_msg.image_data,
                vision_detail=chosen_vision
            )
            
            assistant_content = openai_response["choices"][0]["message"]["content"]
            
            # Create assistant message
            assistant_msg = Message(
                conversation_id=conversation.id,
                role="assistant",
                content=assistant_content
            )
            
            # Save using utility function
            await save_model(db, assistant_msg)
            
            # Update project token usage
            if project:
                token_estimate = len(assistant_content) // 4
                project.token_usage += token_estimate
                await save_model(db, project)

            # Add assistant message to response
            response_payload["assistant_message"] = {
                "id": str(assistant_msg.id),
                "role": assistant_msg.role,
                "content": assistant_msg.content
            }
        except Exception as e:
            logger.error(f"Error calling OpenAI: {e}")
            response_payload["assistant_error"] = str(e)

    return await process_standard_response(response_payload)


# ============================
# WebSocket for Real-time Chat
# ============================

@router.websocket("/ws/projects/{project_id}/conversations/{conversation_id}")
async def websocket_chat_endpoint(
    websocket: WebSocket,
    project_id: UUID,
    conversation_id: UUID
):
    """
    Real-time chat updates for the specified conversation.
    Must authenticate via query param or cookies (token).
    """
    from db import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        try:
            await websocket.accept()
            token = websocket.query_params.get("token")
            if not token:
                logger.warning("WebSocket connection rejected: No token provided")
                await websocket.close(code=1008)
                return

            # Use enhanced token validation with proper error handling
            from utils.auth_deps import _get_user_from_token
            try:
                # Directly get the user from the token using the enhanced function
                user = await _get_user_from_token(token, db, "access")
            except Exception as e:
                logger.warning(f"WebSocket authentication failed: {str(e)}")
                await websocket.close(code=1008)
                return
                
            if not user or not user.is_active:
                logger.warning(f"WebSocket auth failed: inactive or invalid user")
                await websocket.close(code=1008)
                return

            # Validate conversation ownership
            conversation = await validate_resource_ownership(
                conversation_id,
                Conversation,
                user,
                db,
                "Conversation",
                [
                    Conversation.project_id == project_id,
                    Conversation.is_deleted.is_(False)
                ]
            )

            while True:
                data = await websocket.receive_text()
                data_dict = json.loads(data)

                # Create message
                message = Message(
                    conversation_id=conversation.id,
                    role=data_dict["role"],
                    content=data_dict["content"]
                )
                await save_model(db, message)

                if message.role == "user":
                    from uuid import UUID as StdUUID
                    await handle_assistant_response(StdUUID(str(conversation.id)), db, websocket)

        except WebSocketDisconnect:
            logger.info("WebSocket disconnected")
        except HTTPException:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        finally:
            await db.close()


@router.delete("/conversations/{conversation_id}", response_model=dict)
async def delete_standalone_conversation(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Soft-deletes a standalone conversation by setting is_deleted = True.
    """
    # Validate conversation ownership
    conversation = await validate_resource_ownership(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [
            Conversation.is_deleted.is_(False)
        ]
    )
    
    conversation.is_deleted = True
    await save_model(db, conversation)
    
    logger.info(f"Standalone conversation {conversation_id} soft-deleted by user {current_user.id}")

    return await process_standard_response(
        {"conversation_id": str(conversation.id)},
        message="Conversation deleted successfully"
    )


@router.get("/conversations/{conversation_id}/messages", response_model=dict)
async def list_standalone_messages(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Retrieves all messages for a standalone conversation, sorted by creation time ascending.
    """
    # Validate conversation ownership
    conversation = await validate_resource_ownership(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [
            Conversation.is_deleted.is_(False)
        ]
    )

    # Get messages using enhanced function
    messages = await get_all_by_condition(
        db,
        Message,
        Message.conversation_id == conversation.id,
        order_by=Message.created_at.asc()
    )
    
    output = [
        {
            "id": str(msg.id),
            "role": msg.role,
            "content": msg.content,
            "metadata": msg.get_metadata_dict(),
            "timestamp": msg.created_at
        }
        for msg in messages
    ]
    
    return await process_standard_response({"messages": output, "metadata": {"title": conversation.title}})


@router.post("/conversations/{conversation_id}/messages", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_standalone_message(
    conversation_id: UUID,
    new_msg: MessageCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Adds a new user or system message to the specified standalone conversation,
    optionally triggers an assistant response if role='user'.
    """
    # Validate conversation ownership
    conversation = await validate_resource_ownership(
        conversation_id,
        Conversation,
        current_user,
        db,
        "Conversation",
        [
            Conversation.is_deleted.is_(False)
        ]
    )

    try:
        # Create user message
        message = Message(
            conversation_id=conversation.id,
            role=new_msg.role.lower().strip(),
            content=new_msg.content.strip()
        )
        
        # Save using utility function
        await save_model(db, message)
        
        logger.info(f"Message {message.id} saved for conversation {conversation.id}")
    except Exception as e:
        await db.rollback()
        logger.error(f"Message save failed: {str(e)}")
        raise HTTPException(500, "Failed to save message")

    # Check token limit
    await token_limit_check(str(conversation.id), db)

    response_payload = {
        "success": True,
        "message_id": str(message.id),
        "role": message.role,
        "content": message.content
    }

    # Handle image data if provided
    if new_msg.image_data:
        from utils.openai import extract_base64_data
        import base64
        try:
            base64_str = extract_base64_data(new_msg.image_data)
            base64.b64decode(base64_str, validate=True)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid image data")

    # Generate AI response if user message
    if message.role == "user":
        # Get all messages using enhanced function
        conv_messages = await get_all_by_condition(
            db,
            Message,
            Message.conversation_id == conversation.id,
            order_by=Message.created_at.asc()
        )

        msg_dicts = [{"role": str(m.role), "content": str(m.content)} for m in conv_messages]
        
        # Get project for custom instructions if the conversation has a project
        if conversation.project_id:
            project = await get_by_id(db, Project, conversation.project_id)
            if project and project.custom_instructions:
                msg_dicts.insert(0, {"role": "system", "content": project.custom_instructions})
        
        # Manage context to prevent token overflow
        msg_dicts = await manage_context(msg_dicts)

        try:
            # Determine model and settings
            chosen_model = "o1" if new_msg.image_data else (conversation.model_id or "o1")
            chosen_vision = new_msg.vision_detail if new_msg.vision_detail else "auto"

            # Call OpenAI API
            openai_response = await openai_chat(
                messages=msg_dicts,
                model_name=chosen_model,
                image_data=new_msg.image_data,
                vision_detail=chosen_vision
            )
            
            assistant_content = openai_response["choices"][0]["message"]["content"]
            
            # Create assistant message
            assistant_msg = Message(
                conversation_id=conversation.id,
                role="assistant",
                content=assistant_content
            )
            
            # Save using utility function
            await save_model(db, assistant_msg)
            
            # Update project token usage if conversation has a project
            if conversation.project_id:
                project = await get_by_id(db, Project, conversation.project_id)
                if project:
                    token_estimate = len(assistant_content) // 4
                    project.token_usage += token_estimate
                    await save_model(db, project)

            # Add assistant message to response
            response_payload["assistant_message"] = {
                "id": str(assistant_msg.id),
                "role": assistant_msg.role,
                "content": assistant_msg.content
            }
        except Exception as e:
            logger.error(f"Error calling OpenAI: {e}")
            response_payload["assistant_error"] = str(e)

    return await process_standard_response(response_payload)


@router.websocket("/ws/{conversation_id}")
async def websocket_standalone_chat_endpoint(
    websocket: WebSocket,
    conversation_id: UUID
):
    """
    Real-time chat updates for a standalone conversation.
    Must authenticate via query param or cookies (token).
    """
    from db import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        try:
            await websocket.accept()
            token = websocket.query_params.get("token")
            if not token:
                logger.warning("WebSocket connection rejected: No token provided")
                await websocket.close(code=1008)
                return

            # Use enhanced token validation with proper error handling
            from utils.auth_deps import _get_user_from_token
            try:
                # Directly get the user from the token using the enhanced function
                user = await _get_user_from_token(token, db, "access")
            except Exception as e:
                logger.warning(f"WebSocket authentication failed: {str(e)}")
                await websocket.close(code=1008)
                return
                
            if not user or not user.is_active:
                logger.warning(f"WebSocket auth failed: inactive or invalid user")
                await websocket.close(code=1008)
                return

            # Validate conversation ownership without requiring project
            conversation = await validate_resource_ownership(
                conversation_id,
                Conversation,
                user,
                db,
                "Conversation",
                [
                    Conversation.is_deleted.is_(False)
                ]
            )

            while True:
                data = await websocket.receive_text()
                data_dict = json.loads(data)

                # Create message
                message = Message(
                    conversation_id=conversation.id,
                    role=data_dict["role"],
                    content=data_dict["content"]
                )
                await save_model(db, message)

                if message.role == "user":
                    from uuid import UUID as StdUUID
                    await handle_assistant_response(StdUUID(str(conversation.id)), db, websocket)

        except WebSocketDisconnect:
            logger.info("WebSocket disconnected")
        except HTTPException:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        finally:
            await db.close()


async def handle_assistant_response(
    conv_id: UUID,
    session: AsyncSession,
    websocket: WebSocket
):
    """
    Handles the assistant response for a given conversation via WebSocket.
    """
    # Get conversation
    conversation = await get_by_id(session, Conversation, conv_id)
    if not conversation:
        await websocket.send_json({"error": "Conversation not found"})
        return

    # Get messages using enhanced function
    messages = await get_all_by_condition(
        session,
        Message,
        Message.conversation_id == conversation.id,
        order_by=Message.created_at.asc()
    )
    
    # Format messages for API
    msg_dicts = [{"role": str(m.role), "content": str(m.content)} for m in messages]
    
    # Get project for custom instructions if the conversation has a project
    if conversation.project_id:
        project = await get_by_id(session, Project, conversation.project_id)
        if project and project.custom_instructions:
            msg_dicts.insert(0, {"role": "system", "content": project.custom_instructions})
    
    # Manage context
    msg_dicts = await manage_context(msg_dicts)

    chosen_model = conversation.model_id or "o1"
    try:
        # Call OpenAI API
        openai_response = await openai_chat(messages=msg_dicts, model_name=chosen_model)
        assistant_content = openai_response["choices"][0]["message"]["content"]
        
        # Create assistant message
        assistant_msg = Message(
            conversation_id=conversation.id,
            role="assistant",
            content=assistant_content
        )
        await save_model(session, assistant_msg)

        # Update project token usage if conversation has a project
        if conversation.project_id:
            project = await get_by_id(session, Project, conversation.project_id)
            if project:
                token_estimate = len(assistant_content) // 4
                project.token_usage += token_estimate
                await save_model(session, project)

        # Send response via WebSocket
        await websocket.send_json({
            "id": str(assistant_msg.id),
            "role": assistant_msg.role,
            "content": assistant_msg.content
        })
    except Exception as e:
        logger.error(f"Error calling OpenAI: {e}")
        await websocket.send_json({"error": f"OpenAI error: {str(e)}"})
