"""
conversation_service.py
----------------------
Enhanced service layer with full support for both project-based and standalone conversations.
"""

import logging
from typing import Dict, List, Optional, Any, Tuple
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


class ConversationError(Exception):
    """Base exception for conversation-related errors."""

    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def validate_model(model_id: str) -> None:
    """Validate if model is supported"""
    if model_id not in settings.AZURE_OPENAI_MODELS and model_id not in settings.CLAUDE_MODELS:
        raise ConversationError(f"Unsupported model: {model_id}", status_code=400)


def validate_model_params(model_id: str, params: dict) -> None:
    """Validate parameters based on model capabilities"""
    model_config = {}
    if isinstance(settings.AZURE_OPENAI_MODELS, dict):
        model_config = settings.AZURE_OPENAI_MODELS.get(model_id, {})
    if not model_config and isinstance(settings.CLAUDE_MODELS, dict):
        model_config = settings.CLAUDE_MODELS.get(model_id, {})
    
    if not model_config or not isinstance(model_config, dict):
        raise ConversationError(f"Invalid model {model_id}", status_code=400)
    
    # Validate required parameters
    required_params = []
    if isinstance(model_config, dict):
        requires = model_config.get("requires")
        if isinstance(requires, (list, tuple)):
            required_params = [str(p) for p in requires if p is not None and str(p)]
    for required_param in required_params:
        if required_param not in params:
            raise ConversationError(
                f"{required_param} is required for this model",
                status_code=400
            )
            
    # Validate vision parameters
    # Get capabilities with proper type checking
    capabilities = []
    if isinstance(model_config, dict):
        caps = model_config.get("capabilities")
        if isinstance(caps, (list, tuple)):
            capabilities = [c for c in caps if isinstance(c, str)]
    
    # Validate vision support if needed
    if isinstance(params, dict) and "image_data" in params and params["image_data"]:
        if not any(isinstance(c, str) and c == "vision" for c in capabilities):
            raise ConversationError("Model doesn't support vision", 400)
        raise ConversationError(
            "This model doesn't support vision",
            status_code=400
        )


class ConversationService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _validate_conversation_access(
        self,
        conversation_id: UUID,
        user_id: int,
        project_id: Optional[UUID] = None,
        include_deleted: bool = False,
    ) -> Conversation:
        """Centralized conversation access validation."""
        filters = [Conversation.id == conversation_id, Conversation.user_id == user_id]

        if not include_deleted:
            filters.append(Conversation.is_deleted.is_(False))

        if project_id is not None:
            filters.append(Conversation.project_id == project_id)
            result = await self.db.execute(
                select(Conversation)
                .where(and_(*filters))
                .options(joinedload(Conversation.project))
            )
            conv = result.scalar_one_or_none()

            if not conv or str(conv.project_id) != str(project_id):
                raise ConversationError("Conversation not in specified project", 403)
        else:
            filters.append(Conversation.project_id.is_(None))
            result = await self.db.execute(select(Conversation).where(and_(*filters)))
            conv = result.scalar_one_or_none()

        if not conv:
            raise ConversationError("Conversation not found or access denied", 404)
        return conv

    async def _validate_project_access(self, project_id: UUID, user_id: int) -> Project:
        """Validate project ownership."""
        project = await self.db.get(Project, project_id)
        if not project or project.user_id != user_id:
            raise ConversationError("Project access denied", 403)
        return project

    async def create_conversation(
        self,
        user_id: int,
        title: str,
        model_id: str,
        project_id: Optional[UUID] = None,
        use_knowledge_base: bool = False,
    ) -> Conversation:
        """Create new conversation with validation."""
        validate_model(model_id)

        # Create base conversation object
        conv = Conversation(
            user_id=user_id,
            title=title.strip(),
            model_id=model_id,
            project_id=project_id,
            use_knowledge_base=use_knowledge_base,
        )

        # Auto-enable knowledge base if project has one
        if project_id:
            project = await self._validate_project_access(project_id, user_id)
            if project and project.knowledge_base_id:
                conv.use_knowledge_base = True
                conv.knowledge_base_id = project.knowledge_base_id
                try:
                    # Add explicit numeric type casting
                    usage = project.token_usage or 0
                    limit = project.max_tokens or 0

                    if int(usage) > int(limit):
                        raise ValueError("Project token limit exceeded")

                    await conv.validate_knowledge_base(self.db)
                except Exception as e:
                    logger.warning(f"Knowledge base setup issue: {str(e)}")
                    conv.use_knowledge_base = False

        # Verify project assignment before saving
        if project_id and str(conv.project_id) != str(project_id):
            raise ConversationError(
                "Conversation cannot be created outside designated project", 403
            )

        await save_model(self.db, conv)
        return conv

    async def get_conversation(
        self,
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
        user_id: int,
        project_id: Optional[UUID] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Conversation]:
        """List conversations with pagination."""
        filters = [Conversation.user_id == user_id, Conversation.is_deleted.is_(False)]

        if project_id is not None:
            filters.append(Conversation.project_id == project_id)
        else:
            filters.append(Conversation.project_id.is_(None))

        return await get_all_by_condition(
            self.db,
            Conversation,
            *filters,
            order_by=Conversation.created_at.desc(),
            limit=limit,
            offset=skip,
        )

    async def update_conversation(
        self,
        conversation_id: UUID,
        user_id: int,
        project_id: Optional[UUID] = None,
        title: Optional[str] = None,
        model_id: Optional[str] = None,
        use_knowledge_base: Optional[bool] = None,
    ) -> Dict:
        """Update conversation attributes."""
        conv = await self._validate_conversation_access(
            conversation_id, user_id, project_id
        )

        if title is not None:
            conv.title = title.strip()
        if model_id is not None:
            validate_model(model_id)
            conv.model_id = model_id
        if use_knowledge_base is not None:
            if use_knowledge_base and not conv.project_id:
                raise ConversationError(
                    "Knowledge base requires project association", 400
                )
            conv.use_knowledge_base = use_knowledge_base

        await save_model(self.db, conv)
        return serialize_conversation(conv)

    async def delete_conversation(
        self,
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
        if conv.id is None:
            raise ConversationError("Invalid conversation ID", 400)
        return conv.id  # Assuming conv.id is already a UUID

    async def restore_conversation(
        self,
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
        conversation_id: UUID,
        user_id: int,
        project_id: Optional[UUID] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Dict]:
        """List messages in conversation."""
        await self._validate_conversation_access(conversation_id, user_id, project_id)

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
        message = await self._create_user_message(
            conversation_id, content, role, image_data
        )
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
                    thinking = getattr(assistant_msg, "thinking", None)
                    if thinking is not None:
                        response["thinking"] = {"value": thinking}
            except Exception as e:
                logger.error(f"AI response failed: {str(e)}")
                response["assistant_error"] = {"message": str(e)}

        return response

    async def _create_user_message(
        self,
        conversation_id: UUID,
        content: str,
        role: str,
        image_data: Optional[str] = None,
    ) -> Message:
        """Create and save a user message."""
        extra_data = {}
        if image_data:
            # Basic validation of image data format
            if not image_data.startswith(
                ("data:image/jpeg;base64,", "data:image/png;base64,")
            ):
                raise ConversationError("Invalid image data format", 400)
            extra_data["image_data"] = image_data

        message = Message(
            conversation_id=conversation_id,
            content=content.strip(),
            role=role,
            extra_data=extra_data if extra_data else None,
        )
        await save_model(self.db, message)
        return message

    async def _generate_ai_response(
        self,
        conversation: Conversation,
        user_message: str,
        image_data: Optional[str] = None,
        vision_detail: str = "auto",
        reasoning_effort: Optional[str] = None,
    ) -> Optional[Message]:
        """Generate and save AI response."""
        # Get conversation context
        messages = await self._get_conversation_context(
            conversation.id, include_system_prompt=True
        )

        # Augment with knowledge if enabled
        if conversation.use_knowledge_base:
            kb_context = await augment_with_knowledge(
                if conversation.id is None:
                    raise ConversationError("Invalid conversation ID", 400)
                conversation_id=conversation.id,
                user_message=user_message,
                db=self.db,
            )
            messages = kb_context + messages

        model_config = settings.AZURE_OPENAI_MODELS.get(conversation.model_id) if conversation.model_id in settings.AZURE_OPENAI_MODELS else None
        
        params = {
        # Initialize empty dictionary
        params = {}
        
        # Helper function for safe conversion
        def set_param(key, value, convert_type, default=None):
            try:
                params[key] = convert_type(value) if value is not None else default
            except (TypeError, ValueError):
                params[key] = default
        
        # Set all parameters with type conversion
        set_param("temperature", getattr(conversation, "temperature", None), float, 0.7)
        set_param("max_tokens", getattr(conversation, "max_tokens", None), int)
        set_param("image_data", image_data, str)
        set_param("vision_detail", vision_detail, str, "auto")
        set_param("reasoning_effort", reasoning_effort, str)
        set_param("stream", getattr(conversation, "stream", None), bool, False)
        set_param("enable_thinking", getattr(conversation, "enable_thinking", None), bool, False)
        set_param("thinking_budget", getattr(conversation, "thinking_budget", None), int)
        
        if isinstance(model_config, dict):
            try:
                max_temp = float(model_config.get("max_temp", 1.0))
                params["temperature"] = min(float(params["temperature"]), max_temp)
            except (TypeError, ValueError):
                pass
            
            if isinstance(model_config.get("max_tokens"), (int, float)):
                params["max_tokens"] = int(model_config["max_tokens"])
            "max_tokens": int(conversation.max_tokens) if conversation.max_tokens else None,
            "image_data": str(image_data) if image_data else None,
            "vision_detail": str(vision_detail) if vision_detail else "auto",
            "reasoning_effort": str(reasoning_effort) if reasoning_effort else None,
            "stream": bool(getattr(conversation, "stream", False)),
            "enable_thinking": bool(getattr(conversation, "enable_thinking", False)),
            "thinking_budget": int(getattr(conversation, "thinking_budget", 0)) if getattr(conversation, "thinking_budget", None) is not None else None
        }

        if model_config:
            # Vision handling
            capabilities = model_config.get("capabilities", []) if isinstance(model_config.get("capabilities"), list) else []
            if "vision" in capabilities and image_data:
                params["image_data"] = image_data
                params["vision_detail"] = vision_detail or ("auto" if conversation.model_id == "gpt-4o" else "high")
            
            # Reasoning effort
            if "reasoning_effort" in capabilities:
                params["reasoning_effort"] = reasoning_effort or "medium"
                
            # Token budgeting for vision
            if params.get("image_data"):
                params["max_tokens"] = min(
                    int(params["max_tokens"]) if params["max_tokens"] else 0,
                    int(model_config.get("max_tokens", 0)) - int(settings.AZURE_MAX_IMAGE_TOKENS)
                )

        # Generate response
        assistant_msg = await generate_ai_response(
            if conversation.id is None:
                raise ConversationError("Invalid conversation ID", 400)
            conversation_id=conversation.id,
            messages=messages,
            model_id=str(conversation.model_id),
            db=self.db,
            **params
        )

        if assistant_msg:
            await save_model(self.db, assistant_msg)
            return assistant_msg
        return None

    async def _get_conversation_context(
        self, conversation_id: UUID, include_system_prompt: bool = False
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
            context.append(
                {"role": "system", "content": "You are a helpful assistant."}
            )

        for msg in messages:
            message_dict = {"role": msg.role, "content": msg.content}
            if msg.extra_data and "image_data" in msg.extra_data:
                message_dict["image_data"] = msg.extra_data["image_data"]
            context.append(message_dict)

        return context

    async def handle_ws_message(
        self,
        websocket: WebSocket,
        conversation_id: UUID,
        user_id: int,
        message_data: Dict[str, Any],
        project_id: Optional[UUID] = None,
    ) -> Dict[str, Any]:
        """Process WebSocket message and return response."""
        await self._validate_conversation_access(conversation_id, user_id, project_id)

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
        return {
            "type": "message",
            "messageId": message_data.get("messageId"),
            **message,
        }


# Middleware to translate custom exceptions to HTTP responses
async def conversation_exception_handler(request, call_next):
    try:
        return await call_next(request)
    except ConversationError as exc:
        return HTTPException(status_code=exc.status_code, detail=exc.message)


# Service instance factory for dependency injection
async def get_conversation_service(db: AsyncSession = Depends(get_async_session)):
    try:
        yield ConversationService(db)
    except ConversationError as e:
        # Convert custom exceptions to HTTP exceptions at the service boundary
        raise HTTPException(status_code=e.status_code, detail=e.message)
