"""
chat.py
-------
A FastAPI router handling conversation (chat) functionality for the Azure OpenAI Chat Application.

Includes:
- CRUD endpoints for conversations.
- Message listing and creation with Azure OpenAI integration.
- Real-time WebSocket endpoint for live chat updates.
- Summarization logic triggered upon token growth (optional).
- Proper authentication via JWT (get_current_user).
- Production-ready structure with no placeholders.
"""

import logging
import json
from typing import Optional
from uuid import uuid4
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status, Query
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from db import get_async_session  # Ensure this is correctly defined
from models.user import User
from models.chat import Chat
from models.message import Message
from utils.auth_deps import get_current_user_and_token  # Ensure this is correctly defined
from utils.openai import openai_chat
from utils.context import manage_context, token_limit_check


logger = logging.getLogger(__name__)
router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


# -----------------------------
# Pydantic Schemas
# -----------------------------

class ConversationCreate(BaseModel):
    """
    Pydantic model for creating a new conversation.
    """
    title: str = Field(..., min_length=1, max_length=100, description="A user-friendly title for the new conversation")
    model_id: Optional[int] = Field(None, description="Optional numeric ID referencing the chosen model deployment")


class ConversationUpdate(BaseModel):
    """
    Pydantic model for updating an existing conversation.
    """
    title: Optional[str] = Field(None, min_length=1, max_length=100)
    model_id: Optional[int] = None


class MessageCreate(BaseModel):
    """
    Pydantic model for creating a new message.
    """
    content: str = Field(..., min_length=1, description="The text content of the user message")
    role: str = Field(default="user", description="The role: user, assistant, or system.", pattern=r"^(user|assistant|system)$")
    image_data: Optional[str] = None
    vision_detail: Optional[str] = "auto"


# -----------------------------
# Dependency
# -----------------------------

async def get_db():
    """
    Dependency to get an asynchronous database session.
    """
    async with get_async_session() as session:
        yield session


async def get_current_user(token: str = Depends(oauth2_scheme)):
    """
    Dependency to get the current authenticated user.
    """
    user = await get_current_user_and_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    return user


# -----------------------------
# CRUD Endpoints for Conversations
# -----------------------------

@router.post("/conversations", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    conversation_data: ConversationCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Creates a new conversation for the authenticated user.
    Generates a UUID string as the chat ID.
    Stores the initial metadata (title, model_id).
    """
    chat_id = str(uuid4())
    new_chat = Chat(
        id=chat_id,
        user_id=current_user.id,
        title=conversation_data.title.strip(),
        model_id=conversation_data.model_id,
        is_deleted=False,
        created_at=datetime.now(),
        updated_at=datetime.now(),
    )
    db.add(new_chat)
    await db.commit()
    await db.refresh(new_chat)

    logger.info("Conversation created with id=%s by user_id=%s", chat_id, current_user.id)
    return {"conversation_id": chat_id, "title": new_chat.title}


@router.get("/conversations", response_model=dict)
async def list_conversations(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns a list of conversations owned by the current user.
    """
    result = await db.execute(
        select(Chat)
        .where(
            Chat.user_id == current_user.id,
            Chat.is_deleted.is_(False)
        )
        .order_by(Chat.created_at.desc())
    )
    chats = result.scalars().all()
    items = [
        {
            "id": chat.id,
            "title": chat.title,
            "model_id": chat.model_id,
            "created_at": chat.created_at
        } for chat in chats
    ]
    return {"conversations": items}


@router.get("/conversations/{chat_id}", response_model=dict)
async def get_conversation(
    chat_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Retrieve metadata about a specific conversation, verifying ownership.
    """
    result = await db.execute(
        select(Chat)
        .where(
            Chat.id == chat_id,
            Chat.user_id == current_user.id,
            Chat.is_deleted.is_(False)
        )
    )
    chat = result.scalars().first()
    if not chat:
        raise HTTPException(status_code=404, detail="Conversation not found or access denied")

    return {
        "id": chat.id,
        "title": chat.title,
        "model_id": chat.model_id,
        "created_at": chat.created_at
    }


@router.patch("/conversations/{chat_id}", response_model=dict)
async def update_conversation(
    chat_id: str,
    update_data: ConversationUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Updates the conversation's title or model_id.
    """
    result = await db.execute(
        select(Chat)
        .where(
            Chat.id == chat_id,
            Chat.user_id == current_user.id,
            Chat.is_deleted.is_(False)
        )
    )
    chat = result.scalars().first()
    if not chat:
        raise HTTPException(status_code=404, detail="Conversation not found or access denied")

    if update_data.title is not None:
        chat.title = update_data.title.strip()
    if update_data.model_id is not None:
        chat.model_id = update_data.model_id

    await db.commit()
    await db.refresh(chat)
    logger.info("Conversation %s updated by user %s", chat_id, current_user.id)

    return {"id": chat.id, "title": chat.title, "model_id": chat.model_id}


@router.delete("/conversations/{chat_id}", response_model=dict)
async def delete_conversation(
    chat_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Soft-deletes a conversation by updating is_deleted = True.
    Does not permanently remove data from the database by default.
    """
    result = await db.execute(
        select(Chat)
        .where(
            Chat.id == chat_id,
            Chat.user_id == current_user.id,
            Chat.is_deleted.is_(False)
        )
    )
    chat = result.scalars().first()
    if not chat:
        raise HTTPException(status_code=404, detail="Conversation not found or access denied")

    chat.is_deleted = True
    await db.commit()
    logger.info("Conversation %s soft-deleted by user %s", chat_id, current_user.id)
    return {"status": "deleted", "conversation_id": chat_id}


# -----------------------------
# Message Endpoints
# -----------------------------

@router.get("/conversations/{chat_id}/messages", response_model=dict)
async def list_messages(
    chat_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Retrieves all messages for a conversation, sorted by timestamp ascending.
    """
    result = await db.execute(
        select(Chat)
        .where(
            Chat.id == chat_id,
            Chat.user_id == current_user.id,
            Chat.is_deleted.is_(False)
        )
    )
    chat = result.scalars().first()
    if not chat:
        raise HTTPException(status_code=404, detail="Conversation not found or access denied")

    messages = await db.execute(select(Message).where(Message.chat_id == chat_id).order_by(Message.timestamp.asc()))
    messages = messages.scalars().all()
    output = [
        {
            "id": msg.id,
            "role": msg.role,
            "content": msg.content,
            "metadata": msg.get_metadata_dict(),
            "timestamp": msg.timestamp
        } for msg in messages
    ]
    return {"messages": output}


@router.post("/conversations/{chat_id}/messages", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_message(
    chat_id: str,
    new_msg: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Adds a new user or system message to the conversation,
    and optionally triggers an assistant response if role = 'user'.
    """
    chat_query = await db.execute(
        select(Chat)
        .where(
            Chat.id == chat_id,
            Chat.user_id == current_user.id,
            Chat.is_deleted.is_(False)
        )
    )
    chat = chat_query.scalars().first()
    if not chat:
        raise HTTPException(status_code=404, detail="Conversation not found or access denied")

    message = Message(
        chat_id=chat_id,
        role=new_msg.role.lower().strip(),
        content=new_msg.content.strip(),
        metadata=None
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)
    token_limit_check(chat_id, db)

    response_payload = {
        "success": True,
        "message_id": message.id,
        "role": message.role,
        "content": message.content
    }

    if new_msg.image_data:
        try:
            import base64
            if "base64," in new_msg.image_data:
                base64_str = new_msg.image_data.split("base64,")[1]
            else:
                base64_str = new_msg.image_data
            base64.b64decode(base64_str, validate=True)
        except Exception as e:
            raise HTTPException(status_code=400, detail="Invalid image data")

    if message.role == "user":
        messages_query = await db.execute(select(Message).where(Message.chat_id == chat.id).order_by(Message.timestamp.asc()))
        conv_messages = messages_query.scalars().all()
        message_dicts = [{"role": m.role, "content": m.content} for m in conv_messages]
        message_dicts = manage_context(message_dicts)

        try:
            openai_response = openai_chat(
                messages=message_dicts,
                model_name="o1" if new_msg.image_data else chat.model_id,
                image_data=new_msg.image_data,
                vision_detail=new_msg.vision_detail
            )
            assistant_content = openai_response["choices"][0]["message"]["content"]
            assistant_msg = Message(chat_id=chat_id, role="assistant", content=assistant_content)
            db.add(assistant_msg)
            await db.commit()
            await db.refresh(assistant_msg)

            response_payload["assistant_message"] = {
                "id": assistant_msg.id,
                "role": assistant_msg.role,
                "content": assistant_msg.content
            }
        except Exception as e:
            logger.error("Error calling Azure OpenAI: %s", e)
            response_payload["assistant_error"] = str(e)

    return response_payload


# -----------------------------
# WebSocket for Real-time Chat
# -----------------------------

@router.websocket("/ws/{chat_id}")
async def websocket_chat_endpoint(
    websocket: WebSocket,
    chat_id: str,
    token: str = Query(..., description="JWT token for authentication")
):
    """
    Real-time chat updates for conversation {chat_id}.
    Must authenticate via query param or cookies.
    """
    await websocket.accept()

    user = await get_current_user(token)
    if not user:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        while True:
            data = await websocket.receive_text()
            try:
                data_dict = json.loads(data)
                message = Message(
                    chat_id=chat_id,
                    role=data_dict['role'],
                    content=data_dict['content'],
                )
                async with get_async_session() as session:
                    session.add(message)
                    await session.commit()
                    await session.refresh(message)
                    if message.role == "user":
                        await handle_assistant_response(chat_id, session, websocket)
            except json.JSONDecodeError:
                await websocket.send_json({"error": "Invalid JSON format"})
            except Exception as e:
                await websocket.send_json({"error": str(e)})
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected for chat_id=%s", chat_id)
        return


async def handle_assistant_response(
    chat_id: str,
    session: AsyncSession,
    websocket: WebSocket
):
    """
    Handles the assistant response for a given conversation.
    """
    messages_query = await session.execute(select(Message).where(Message.chat_id == chat_id).order_by(Message.timestamp.asc()))
    messages = messages_query.scalars().all()
    message_dicts = [{"role": m.role, "content": m.content} for m in messages]
    message_dicts = manage_context(message_dicts)

    chat_query = await session.execute(select(Chat).where(Chat.id == chat_id))
    chat = chat_query.scalars().first()

    if chat.model_id is not None:
        try:
            chat = await session.get(Chat, chat_id)
            openai_response = openai_chat(messages=message_dicts, model_name=chat.model_id)
            assistant_content = openai_response["choices"][0]["message"]["content"]
            assistant_msg = Message(chat_id=chat_id, role="assistant", content=assistant_content)
            session.add(assistant_msg)
            await session.commit()
            await session.refresh(assistant_msg)

            await websocket.send_json({
                "id": assistant_msg.id,
                "role": assistant_msg.role,
                "content": assistant_msg.content
            })
        except Exception as e:
            logger.error("Error calling Azure OpenAI: %s", e)
            await websocket.send_json({"error": f"Error from OpenAI: {str(e)}"})
