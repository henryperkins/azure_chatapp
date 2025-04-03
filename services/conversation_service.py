"""
conversation_service.py
----------------------
Enhanced service layer with full support for both project-based and standalone conversations.
"""

import logging
from typing import Dict, List, Optional
from uuid import UUID
from datetime import datetime

from fastapi import Depends, HTTPException, WebSocket
from db import get_async_session
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import joinedload

from models.conversation import Conversation
from models.message import Message
from models.project import Project
from utils.ai_response import generate_ai_response
from config import settings
from services.context_integration import augment_with_knowledge
from utils.db_utils import get_all_by_condition, save_model
from utils.serializers import serialize_conversation, serialize_message

logger = logging.getLogger(__name__)

def validate_model(model_id: str) -> bool:
    """Validate model against allowed configurations."""
    if model_id not in settings.CLAUDE_MODELS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model ID. Allowed: {', '.join(settings.CLAUDE_MODELS)}"
        )
    return True

class ConversationService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _validate_conversation_access(
        self,
        conversation_id: UUID,
        user_id: int,
        project_id: Optional[UUID] = None,
        include_deleted: bool = False
    ) -> Conversation:
        """Centralized conversation access validation."""
        filters = [
            Conversation.id == conversation_id,
            Conversation.user_id == user_id
        ]
        
        if not include_deleted:
            filters.append(Conversation.is_deleted.is_(False))
        
        if project_id is not None:
            filters.append(Conversation.project_id == project_id)
        else:
            filters.append(Conversation.project_id.is_(None))

        result = await self.db.execute(
            select(Conversation).where(and_(*filters))
            .options(joinedload(Conversation.project))
        )
        conv = result.scalar_one_or_none()
        
        if not conv:
            raise HTTPException(
                status_code=404,
                detail="Conversation not found or access denied"
            )
        return conv

    async def _validate_project_access(self, project_id: UUID, user_id: int) -> Project:
        """Validate project ownership."""
        project = await self.db.get(Project, project_id)
        if not project or project.user_id != user_id:
            raise HTTPException(403, "Project access denied")
        return project

    async def validate_model(self, model_id: str) -> bool:
        """Validate model against allowed configurations (instance method)."""
        return validate_model(model_id)

    async def create_conversation(
        self,
        *,
        user_id: int,
        title: str,
        model_id: str,
        project_id: Optional[UUID] = None,
        use_knowledge_base: bool = False,
    ) -> Conversation:
        """Create new conversation with validation."""
        # Create base conversation object
        conv = Conversation(
            user_id=user_id,
            title=title.strip(),
            model_id=model_id,
            project_id=project_id,
            use_knowledge_base=use_knowledge_base
        )

        # Auto-enable knowledge base if project has one
        if project_id:
            project = await self._validate_project_access(project_id, user_id)
            if project and project.knowledge_base_id:
                conv.use_knowledge_base = True
                conv.knowledge_base_id = project.knowledge_base_id
                try:
                    if project.token_usage is None or project.max_tokens is None:
                        raise ValueError("Project token limits not configured")
                    
                    if project.token_usage > project.max_tokens:
                        raise ValueError("Project token limit exceeded")
                    
                    await conv.validate_knowledge_base(self.db)
                except ValueError as e:
                    logger.warning(f"Knowledge base validation failed: {str(e)}")
                    conv.use_knowledge_base = False
                except Exception as e:
                    logger.error(f"KB validation error: {str(e)}")
                    conv.use_knowledge_base = False

        await save_model(self.db, conv)
        return conv

    async def get_conversation(
        self,
        *,
        conversation_id: UUID,
        user_id: int,
        project_id: Optional[UUID] = None,
    ) -> Dict:
        """Get single conversation with validation."""
        conv = await self._validate_conversation_access(
            conversation_id, user_id, project_id
        )
        return serialize_conversation(conv)

    async def list_conversations(
        self,
        *,
        user_id: int,
        project_id: Optional[UUID] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Dict]:
        """List conversations with pagination."""
        filters = [
            Conversation.user_id == user_id,
            Conversation.is_deleted.is_(False)
        ]
        
        if project_id is not None:
            filters.append(Conversation.project_id == project_id)
        else:
            filters.append(Conversation.project_id.is_(None))

        conversations = await get_all_by_condition(
            self.db,
            Conversation,
            *filters,
            order_by=Conversation.created_at.desc(),
            limit=limit,
            offset=skip,
        )
        return [serialize_conversation(c) for c in conversations]

    async def update_conversation(
        self,
        *,
        conversation_id: UUID,
        user_id: int,
        title: Optional[str] = None,
        model_id: Optional[str] = None,
        use_knowledge_base: Optional[bool] = None,
        project_id: Optional[UUID] = None,
    ) -> Dict:
        """Update conversation attributes."""
        conv = await self._validate_conversation_access(
            conversation_id, user_id, project_id
        )

        if title is not None:
            conv.title = title.strip()
        if model_id is not None:
            await self.validate_model(model_id)
            conv.model_id = model_id
        if use_knowledge_base is not None:
            if use_knowledge_base and not conv.project_id:
                raise HTTPException(400, "Knowledge base requires project association")
            conv.use_knowledge_base = use_knowledge_base

        await save_model(self.db, conv)
        return serialize_conversation(conv)

    async def delete_conversation(
        self,
        *,
        conversation_id: UUID,
        user_id: int,
        project_id: Optional[UUID] = None,
    ) -> UUID:
        """Soft delete conversation."""
        conv = await self._validate_conversation_access(
            conversation_id, user_id, project_id
        )
        conv.is_deleted = True
        conv.deleted_at = datetime.utcnow()
        await save_model(self.db, conv)
        return conv.id

    async def restore_conversation(
        self,
        *,
        conversation_id: UUID,
        user_id: int,
        project_id: Optional[UUID] = None,
    ) -> Dict:
        """Restore soft-deleted conversation."""
        conv = await self._validate_conversation_access(
            conversation_id, user_id, project_id, include_deleted=True
        )
        conv.is_deleted = False
        conv.deleted_at = None
        await save_model(self.db, conv)
        return serialize_conversation(conv)

    async def list_messages(
        self,
        *,
        conversation_id: UUID,
        user_id: int,
        project_id: Optional[UUID] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Dict]:
        """List messages in conversation."""
        await self._validate_conversation_access(
            conversation_id, user_id, project_id
        )

        messages = await get_all_by_condition(
            self.db,
            Message,
            Message.conversation_id == conversation_id,
            order_by=Message.created_at.asc(),
            limit=limit,
            offset=skip,
        )
        return [serialize_message(m) for m in messages]

    async def create_message(
        self,
        *,
        conversation_id: UUID,
        user_id: int,
        content: str,
        role: str = "user",
        project_id: Optional[UUID] = None,
        image_data: Optional[str] = None,
        vision_detail: str = "auto",
    ) -> Dict:
        """Create message and generate AI response."""
        conv = await self._validate_conversation_access(
            conversation_id, user_id, project_id
        )

        # Create user message
        message = Message(
            conversation_id=conversation_id,
            content=content.strip(),
            role=role,
            image_data=image_data,
        )
        await save_model(self.db, message)
        response = {"user_message": serialize_message(message)}

        # Generate AI response if needed
        if role == "user":
            try:
                assistant_msg = await self._generate_ai_response(
                    conversation=conv,
                    user_message=content,
                    image_data=image_data,
                    vision_detail=vision_detail,
                )
                if assistant_msg:
                    response["assistant_message"] = serialize_message(assistant_msg)
                    response["thinking"] = getattr(assistant_msg, "thinking", None)
            except Exception as e:
                logger.error(f"AI response failed: {str(e)}")
                response["assistant_error"] = str(e)

        return response

    async def _generate_ai_response(
        self,
        *,
        conversation: Conversation,
        user_message: str,
        image_data: Optional[str] = None,
        vision_detail: str = "auto",
    ) -> Optional[Message]:
        """Generate and save AI response."""
        # Get conversation context
        messages = await self._get_conversation_context(
            conversation.id, include_system_prompt=True
        )

        # Augment with knowledge if enabled
        if conversation.use_knowledge_base:
            kb_context = await augment_with_knowledge(
                conversation_id=conversation.id,
                user_message=user_message,
                db=self.db,
            )
            messages = kb_context + messages

        # Generate response
        assistant_msg = await generate_ai_response(
            conversation_id=conversation.id,
            messages=messages,
            model_id=conversation.model_id,
            image_data=image_data,
            vision_detail=vision_detail,
            db=self.db,
        )

        if assistant_msg:
            await save_model(self.db, assistant_msg)
            return assistant_msg
        return None

    async def _get_conversation_context(
        self,
        conversation_id: UUID,
        include_system_prompt: bool = False
    ) -> List[Dict[str, str]]:
        """Get formatted message history for AI context."""
        messages = await get_all_by_condition(
            self.db,
            Message,
            Message.conversation_id == conversation_id,
            order_by=Message.created_at.asc(),
        )

        context = []
        if include_system_prompt:
            context.append({
                "role": "system",
                "content": "You are a helpful assistant."
            })

        context.extend([{
            "role": msg.role,
            "content": msg.content,
            "image_data": msg.image_data
        } for msg in messages])

        return context

    async def handle_ws_message(
        self,
        *,
        websocket: WebSocket,
        conversation_id: UUID,
        user_id: int,
        message_data: Dict,
        project_id: Optional[UUID] = None,
    ) -> Dict:
        """Process WebSocket message and return response."""
        await self._validate_conversation_access(
            conversation_id, user_id, project_id
        )

        # Handle token refresh
        if message_data.get("type") == "token_refresh":
            return {"type": "token_refresh_success"}

        # Create message
        message = await self.create_message(
            conversation_id=conversation_id,
            user_id=user_id,
            content=message_data["content"],
            role=message_data.get("role", "user"),
            project_id=project_id,
            image_data=message_data.get("image_data"),
            vision_detail=message_data.get("vision_detail", "auto"),
        )

        # Format WebSocket response
        response = {
            "type": "message",
            "messageId": message_data.get("messageId"),
            **message
        }
        return response


# Service instance factory for dependency injection
async def get_conversation_service(db: AsyncSession = Depends(get_async_session)):
    yield ConversationService(db)
