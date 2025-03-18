"""
chat.py
-------
Revised routes to align with single-project association.

Each conversation is tied to exactly one project (project_id).
The path now includes /api/projects/{project_id}/conversations, with conversation_id in the path.
Legacy endpoints for /conversations are removed.

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
from models.chat import Conversation
from models.message import Message
from utils.auth_deps import get_current_user_and_token
from utils.openai import openai_chat
from utils.context import manage_context, token_limit_check

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

@router.post("/projects/{project_id}/conversations", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    project_id: UUID,
    conversation_data: ConversationCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Creates a new conversation under a specific project.
    """
    # Validate project ownership
    project = await db.get(Project, project_id)
    if not project or project.user_id != current_user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid or unauthorized project")

    new_conversation = Conversation(
        user_id=current_user.id,
        project_id=project.id,
        title=conversation_data.title.strip(),
        model_id=conversation_data.model_id,
        is_deleted=False,
        created_at=datetime.now()
    )

    db.add(new_conversation)
    await db.commit()
    await db.refresh(new_conversation)

    logger.info("Conversation created with id=%s under project %s by user_id=%s", new_conversation.id, project_id, current_user.id)
    return {
        "conversation_id": str(new_conversation.id),
        "title": new_conversation.title,
        "created_at": new_conversation.created_at.isoformat()
    }


@router.get("/projects/{project_id}/conversations", response_model=dict)
async def list_conversations(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Returns a list of conversations for a specific project, owned by the current user.
    """
    # Validate project ownership
    project = await db.get(Project, project_id)
    if not project or project.user_id != current_user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid or unauthorized project")

    result = await db.execute(
        select(Conversation)
        .where(
            Conversation.project_id == project_id,
            Conversation.user_id == current_user.id,
            Conversation.is_deleted.is_(False)
        )
        .order_by(Conversation.created_at.desc())
    )
    conversations = result.scalars().all()

    items = [
        {
            "id": str(conv.id),
            "title": conv.title,
            "model_id": conv.model_id,
            "created_at": conv.created_at
        }
        for conv in conversations
    ]
    return {"conversations": items}


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
    conversation = await get_valid_conversation(project_id, conversation_id, current_user, db)
    return {
        "id": str(conversation.id),
        "title": conversation.title,
        "model_id": conversation.model_id,
        "created_at": conversation.created_at
    }


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
    conversation = await get_valid_conversation(project_id, conversation_id, current_user, db)
    if update_data.title is not None:
        conversation.title = update_data.title.strip()
    if update_data.model_id is not None:
        conversation.model_id = update_data.model_id

    await db.commit()
    await db.refresh(conversation)
    logger.info(f"Conversation {conversation_id} updated by user {current_user.id}")

    return {
        "id": str(conversation.id),
        "title": conversation.title,
        "model_id": conversation.model_id
    }


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
    conversation = await get_valid_conversation(project_id, conversation_id, current_user, db)
    conversation.is_deleted = True
    await db.commit()
    logger.info(f"Conversation {conversation_id} soft-deleted by user {current_user.id}")

    return {"status": "deleted", "conversation_id": str(conversation.id)}


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
    conversation = await get_valid_conversation(project_id, conversation_id, current_user, db)

    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation.id)
        .order_by(Message.created_at.asc())
    )
    msgs = result.scalars().all()
    output = [
        {
            "id": str(msg.id),
            "role": msg.role,
            "content": msg.content,
            "metadata": msg.get_metadata_dict(),
            "timestamp": msg.timestamp
        }
        for msg in msgs
    ]
    return {"messages": output}


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
    conversation = await get_valid_conversation(project_id, conversation_id, current_user, db)

    try:
        message = Message(
            conversation_id=conversation.id,
            role=new_msg.role.lower().strip(),
            content=new_msg.content.strip()
        )
        db.add(message)
        await db.commit()
        await db.refresh(message)
        logger.info(f"Message {message.id} saved for conversation {conversation.id}")
    except Exception as e:
        await db.rollback()
        logger.error(f"Message save failed: {str(e)}")
        raise HTTPException(500, "Failed to save message")

    await token_limit_check(str(conversation.id), db)

    response_payload = {
        "success": True,
        "message_id": str(message.id),
        "role": message.role,
        "content": message.content
    }

    if new_msg.image_data:
        from utils.openai import extract_base64_data
        import base64
        try:
            base64_str = extract_base64_data(new_msg.image_data)
            base64.b64decode(base64_str, validate=True)
        except Exception:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid image data")

    if message.role == "user":
        # Gather entire conversation messages from DB
        all_msgs = await db.execute(
            select(Message).where(Message.conversation_id == conversation.id).order_by(Message.created_at.asc())
        )
        conv_messages = all_msgs.scalars().all()

        msg_dicts = [{"role": str(m.role), "content": str(m.content)} for m in conv_messages]
        msg_dicts = await manage_context(msg_dicts)

        try:
            chosen_model = "o1" if new_msg.image_data else (conversation.model_id or "o1")
            chosen_vision = new_msg.vision_detail if new_msg.vision_detail else "auto"

            openai_response = await openai_chat(
                messages=msg_dicts,
                model_name=chosen_model,
                image_data=new_msg.image_data,
                vision_detail=chosen_vision
            )
            assistant_content = openai_response["choices"][0]["message"]["content"]
            assistant_msg = Message(
                conversation_id=conversation.id,
                role="assistant",
                content=assistant_content
            )
            db.add(assistant_msg)
            await db.commit()
            await db.refresh(assistant_msg)

            response_payload["assistant_message"] = {
                "id": str(assistant_msg.id),
                "role": assistant_msg.role,
                "content": assistant_msg.content
            }
        except Exception as e:
            logger.error(f"Error calling OpenAI: {e}")
            response_payload["assistant_error"] = str(e)

    return response_payload


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
                await websocket.close(code=1008)
                return

            from utils.auth_deps import verify_token
            decoded = verify_token(token)
            username = decoded.get("sub")
            if not username:
                await websocket.close(code=1008)
                return

            from models.user import User
            from sqlalchemy import select
            result = await db.execute(select(User).where(User.username == username))
            user = result.scalars().first()
            if not user or not user.is_active:
                await websocket.close(code=1008)
                return

            conversation = await get_valid_conversation(project_id, conversation_id, user, db)

            while True:
                data = await websocket.receive_text()
                data_dict = json.loads(data)

                async with db.begin():
                    message = Message(
                        conversation_id=conversation.id,
                        role=data_dict["role"],
                        content=data_dict["content"]
                    )
                    db.add(message)
                    await db.commit()
                    await db.refresh(message)

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
    # Grab conversation
    conv = await session.get(Conversation, conv_id)
    if not conv:
        await websocket.send_json({"error": "Conversation not found"})
        return

    # gather messages
    messages_query = await session.execute(
        select(Message).where(Message.conversation_id == conv.id).order_by(Message.created_at.asc())
    )
    all_msgs = messages_query.scalars().all()
    msg_dicts = [{"role": str(m.role), "content": str(m.content)} for m in all_msgs]
    msg_dicts = await manage_context(msg_dicts)

    chosen_model = conv.model_id or "o1"
    try:
        openai_response = await openai_chat(messages=msg_dicts, model_name=chosen_model)
        assistant_content = openai_response["choices"][0]["message"]["content"]
        assistant_msg = Message(
            conversation_id=conv.id,
            role="assistant",
            content=assistant_content
        )
        session.add(assistant_msg)
        await session.commit()
        await session.refresh(assistant_msg)

        await websocket.send_json({
            "id": str(assistant_msg.id),
            "role": assistant_msg.role,
            "content": assistant_msg.content
        })
    except Exception as e:
        logger.error(f"Error calling OpenAI: {e}")
        await websocket.send_json({"error": f"OpenAI error: {str(e)}"})


# ============================
# Utilities
# ============================

async def get_valid_conversation(project_id: UUID, conversation_id: UUID, user: User, db: AsyncSession):
    """
    Utility to verify that conversation_id belongs to the given project 
    and is owned by the specified user.
    """
    q = await db.execute(
        select(Conversation)
        .where(
            Conversation.id == conversation_id,
            Conversation.project_id == project_id,
            Conversation.user_id == user.id,
            Conversation.is_deleted.is_(False)
        )
    )
    conv = q.scalars().first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv
