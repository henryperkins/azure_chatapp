# conversation_service.py
# -----------------------
# Provides a ConversationService class for managing conversation data
# and AI-related operations, including parameter validation and
# generating AI responses.

import logging
from typing import List, Optional, Any, Union, cast
from uuid import UUID
from datetime import datetime

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, or_
from sqlalchemy.orm import joinedload, aliased
from sqlalchemy.exc import IntegrityError

# Central model helpers
from utils.model_registry import validate_model_and_params
from db import get_async_session
from models.conversation import Conversation
from models.message import Message
from utils.ai_response import generate_ai_response, AIResponseOptions
from utils.db_utils import get_all_by_condition, save_model
from utils.serializers import serialize_conversation, serialize_message
from services.project_service import validate_project_access
from models.user import User  # required inside helper


logger = logging.getLogger(__name__)


class ConversationError(Exception):
    """Base exception for conversation-related errors."""

    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


# NOTE: conversation_service now relies on utils.model_registry.validate_model_and_params.


class ConversationService:
    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def _require_project_id(project_id: Optional[UUID]) -> UUID:
        if not project_id:
            raise ConversationError(
                "Global conversations are no longer supported – project_id is required",
                400,
            )
        return project_id

    async def _validate_conversation_access(
        self,
        conversation_id: UUID,
        user_id: int,
        project_id: Optional[UUID] = None,
        include_deleted: bool = False,
    ) -> Conversation:
        """Centralized conversation access validation."""
        project_id = self._require_project_id(project_id)
        user = await self.db.get(User, user_id)
        if not user:
            raise ConversationError("User not found", 404)
        # canonical permission check (raises on failure)
        await validate_project_access(project_id, user, self.db)

        filters = [Conversation.id == conversation_id, Conversation.user_id == user_id]

        if not include_deleted:
            filters.append(Conversation.is_deleted.is_(False))

        # Ensure project_id is UUID for comparison
        try:
            pid = UUID(str(project_id))
        except ValueError:
            raise ConversationError("Invalid project ID format", 400) from None

        filters.append(Conversation.project_id == pid)
        # Eager load project and knowledge_base only when project_id is specified
        query = select(Conversation).options(
            joinedload(Conversation.project), joinedload(Conversation.knowledge_base)
        )

        result = await self.db.execute(query.where(and_(*filters)))
        conv = result.scalar_one_or_none()

        # Double-check project mismatch
        if conv and conv.project_id != pid:
            logger.error(
                f"Conversation {conversation_id} found but project mismatch: "
                f"expected {pid}, got {conv.project_id}"
            )
            conv = None

        if not conv:
            logger.warning(
                f"Conversation NOT FOUND. "
                f"ID: {conversation_id}, User: {user_id}, Project: {project_id}, Found: {bool(conv)}"
            )
            raise ConversationError("Conversation not found", 404)

        return conv

    async def create_conversation(
        self,
        user_id: int,
        title: str,
        model_id: str,
        project_id: UUID,
        model_config: dict | None = None,
        kb_enabled: bool = False,
    ) -> Conversation:
        """Create new conversation with validation and new Conversation columns."""
        project_id = self._require_project_id(project_id)
        try:
            validate_model_and_params(model_id, model_config or {})
        except ConversationError as e:
            raise HTTPException(status_code=e.status_code, detail=e.message) from e
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        # ------------------------------------------------------------------
        # Project & permission validation
        # ------------------------------------------------------------------
        user = await self.db.get(User, user_id)
        await validate_project_access(project_id, user, self.db)

        # Ensure project has an associated knowledge base when KB is requested
        if kb_enabled:
            from sqlalchemy.orm import selectinload
            from models.project import Project

            stmt = (
                select(Project)
                .options(selectinload(Project.knowledge_base))
                .where(Project.id == project_id)
            )
            result = await self.db.execute(stmt)
            project = result.scalar_one_or_none()
            from fastapi import HTTPException as _HTTPExc

            if not project:
                raise _HTTPExc(status_code=404, detail="Project not found")
            if not getattr(project, "knowledge_base", None):
                raise _HTTPExc(status_code=400, detail="Project has no knowledge base")

        conv = Conversation(
            user_id=user_id,
            title=title.strip(),
            model_id=model_id,
            project_id=project_id,
            model_config=model_config or {},
            kb_enabled=kb_enabled,
            use_knowledge_base=kb_enabled,
        )

        try:
            await save_model(self.db, conv)
        except IntegrityError as db_exc:
            logger.exception(
                f"[create_conversation] Database error saving conversation with project_id={project_id}, user_id={user_id}"
            )
            raise ConversationError(
                "Database error. Possibly a foreign key violation or concurrency issue",
                500,
            ) from db_exc
        logger.info(
            f"Conversation {conv.id} created by user {user_id} with model {model_id}. Project: {project_id}"
        )
        return conv

    async def get_conversation(
        self,
        conversation_id: UUID,
        user_id: int,
        project_id: Optional[UUID] = None,
    ) -> dict:
        """Get single conversation with validation."""
        project_id = self._require_project_id(project_id)
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
        project_id = self._require_project_id(project_id)
        filters = [Conversation.user_id == user_id, Conversation.is_deleted.is_(False)]
        filters.append(Conversation.project_id == project_id)

        # Define eager loading options
        load_options = [
            joinedload(Conversation.project),
            joinedload(Conversation.knowledge_base),
        ]

        return await get_all_by_condition(
            self.db,
            Conversation,
            *filters,
            order_by=Conversation.created_at.desc(),
            limit=limit,
            offset=skip,
            options=cast(List[Any], load_options),
        )

    async def update_conversation(
        self,
        conversation_id: UUID,
        user_id: int,
        project_id: Optional[UUID] = None,
        title: Optional[str] = None,
        model_id: Optional[str] = None,
        model_config: Optional[dict] = None,
        kb_enabled: Optional[bool] = None,
    ) -> dict:
        """Update conversation attributes in new schema."""
        project_id = self._require_project_id(project_id)
        conv = await self._validate_conversation_access(
            conversation_id, user_id, project_id
        )

        updated = False
        if title is not None and title.strip() != conv.title:
            conv.title = title.strip()
            updated = True
        if model_id is not None and model_id != conv.model_id:
            try:
                validate_model_and_params(model_id, model_config or {})
                conv.model_id = model_id
                updated = True
            except ConversationError as e:
                raise HTTPException(status_code=e.status_code, detail=e.message) from e
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e)) from e
        if model_config is not None:
            conv.model_config = model_config
            updated = True
        if kb_enabled is not None:
            conv.kb_enabled = kb_enabled
            conv.use_knowledge_base = kb_enabled
            updated = True

        if updated:
            await save_model(self.db, conv)
            logger.info(f"Conversation {conversation_id} updated by user {user_id}.")
        else:
            logger.info(
                f"No changes detected for conversation {conversation_id} update."
            )

        return serialize_conversation(conv)

    async def delete_conversation(
        self,
        conversation_id: UUID,
        user_id: int,
        project_id: Optional[UUID] = None,
    ) -> UUID:
        """Soft delete conversation."""
        project_id = self._require_project_id(project_id)
        conv = await self._validate_conversation_access(
            conversation_id, user_id, project_id
        )
        if conv.is_deleted:
            logger.warning(f"Conversation {conversation_id} is already deleted.")
            return UUID(str(conv.id))

        conv.is_deleted = True
        conv.deleted_at = datetime.utcnow()
        await save_model(self.db, conv)
        logger.info(f"Conversation {conversation_id} soft-deleted by user {user_id}.")
        return UUID(str(conv.id))

    async def restore_conversation(
        self,
        conversation_id: UUID,
        user_id: int,
        project_id: Optional[UUID] = None,
    ) -> dict:
        """Restore a previously soft-deleted conversation."""
        project_id = self._require_project_id(project_id)

        # Validate access including possibly deleted conversations
        conv = await self._validate_conversation_access(
            conversation_id, user_id, project_id, include_deleted=True
        )
        if not conv.is_deleted:
            logger.warning(f"Conversation {conversation_id} is not deleted.")
            return serialize_conversation(conv)

        conv.is_deleted = False
        conv.deleted_at = None
        await save_model(self.db, conv)
        logger.info(f"Conversation {conversation_id} restored by user {user_id}.")
        return serialize_conversation(conv)

    async def list_messages(
        self,
        conversation_id: UUID,
        user_id: int,
        project_id: Optional[UUID] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[dict]:
        """List messages in a conversation."""
        project_id = self._require_project_id(project_id)
        # Validate conversation
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
        image_data: Optional[Union[str, List[str]]] = None,
        vision_detail: Optional[str] = "auto",
        enable_thinking: Optional[bool] = None,
        thinking_budget: Optional[int] = None,
        reasoning_effort: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        enable_web_search: Optional[bool] = False,
    ) -> dict:
        """Create a new message in the conversation and, if role=user, generate AI response."""
        from services.context_manager import ContextManager

        conv = await self._validate_conversation_access(
            conversation_id, user_id, project_id
        )

        user_message = await self._create_user_message(
            conversation_id, content, role, image_data
        )
        response = {"user_message": serialize_message(user_message)}

        # Only auto-generate AI response for user messages
        if user_message.role == "user":
            if not conv.model_id:
                raise ConversationError(
                    "Cannot generate AI response: No model configured for conversation",
                    400,
                )
            try:
                ctx_mgr = ContextManager(
                    self.db, conv.model_id, enable_web_search or False
                )
                # History: raw list of message dicts
                history = await self._get_conversation_context(conversation_id)
                prompt_msgs, stats = await ctx_mgr.build(conv, content, history)
                ai_settings = (
                    conv.extra_data.get("ai_settings", {}) if conv.extra_data else {}
                )

                # Check if the model supports extended thinking before applying settings
                from utils.model_registry import get_model_config

                model_cfg = get_model_config(conv.model_id)
                model_supports_thinking = (
                    model_cfg
                    and "extended_thinking" in model_cfg.get("capabilities", [])
                )

                final_enable_thinking = (
                    enable_thinking
                    if enable_thinking is not None
                    else (
                        ai_settings.get("enable_thinking")
                        if model_supports_thinking
                        else False
                    )
                )
                final_thinking_budget = (
                    thinking_budget
                    if thinking_budget is not None
                    else (
                        ai_settings.get("thinking_budget")
                        if model_supports_thinking
                        else None
                    )
                )
                final_reasoning_effort = (
                    reasoning_effort
                    if reasoning_effort is not None
                    else ai_settings.get("reasoning_effort")
                )
                final_vision_detail = (
                    vision_detail
                    if vision_detail is not None
                    else ai_settings.get("vision_detail", "auto")
                )
                final_temperature = (
                    temperature
                    if temperature is not None
                    else ai_settings.get("temperature")
                )
                final_max_tokens = (
                    max_tokens
                    if max_tokens is not None
                    else ai_settings.get("max_tokens")
                )

                # Validate final parameters with the model – gracefully downgrade if
                # the model lacks extended-thinking support.
                params_for_validation = {
                    "image_data": image_data,
                    "vision_detail": final_vision_detail,
                    "enable_thinking": final_enable_thinking,
                    "thinking_budget": final_thinking_budget,
                    "reasoning_effort": final_reasoning_effort,
                }
                if final_temperature is not None:
                    params_for_validation["temperature"] = final_temperature
                if final_max_tokens is not None:
                    params_for_validation["max_tokens"] = final_max_tokens

                try:
                    validate_model_and_params(conv.model_id, params_for_validation)
                except ValueError as ve:
                    # Detect the specific “extended thinking” capability error
                    if "extended thinking" in str(ve):
                        logger.info(
                            "[create_message] Model %s does not support extended thinking – "
                            "disabling feature and retrying validation",
                            conv.model_id,
                        )
                        # Force-disable related flags and re-validate
                        final_enable_thinking = False
                        final_thinking_budget = None
                        final_reasoning_effort = None
                        # Remove thinking-related parameters completely from validation
                        params_for_validation = {
                            k: v
                            for k, v in params_for_validation.items()
                            if k
                            not in [
                                "enable_thinking",
                                "thinking_budget",
                                "reasoning_effort",
                            ]
                        }
                        validate_model_and_params(conv.model_id, params_for_validation)
                    else:
                        # Propagate unrelated validation errors
                        raise

                opts = AIResponseOptions(
                    image_data=image_data,
                    vision_detail=final_vision_detail,
                    enable_thinking=final_enable_thinking,
                    thinking_budget=final_thinking_budget,
                    enable_markdown_formatting=ai_settings.get(
                        "enable_markdown_formatting", False
                    ),
                    max_tokens=final_max_tokens,
                    temperature=final_temperature,
                    reasoning_effort=final_reasoning_effort,
                    stream=False,
                )

                assistant_msg_obj = await generate_ai_response(
                    conversation_id=conversation_id,
                    messages=prompt_msgs,
                    model_id=str(conv.model_id),
                    db=self.db,
                    options=opts,
                )

                if assistant_msg_obj:
                    serialized_assistant_msg = serialize_message(assistant_msg_obj)
                    if hasattr(assistant_msg_obj, "thinking"):
                        serialized_assistant_msg["thinking"] = (
                            assistant_msg_obj.thinking
                        )
                    if hasattr(assistant_msg_obj, "redacted_thinking"):
                        serialized_assistant_msg["redacted_thinking"] = (
                            assistant_msg_obj.redacted_thinking
                        )
                    response["assistant_message"] = serialized_assistant_msg
                else:
                    logger.error(
                        f"AI response generation returned None for conversation {conversation_id}"
                    )
                    response["assistant_error"] = {
                        "message": "Failed to generate AI response."
                    }

                # Update conv.context_token_usage after assistant message saved
                conv.context_token_usage = stats["prompt_tokens"]
                await save_model(self.db, conv)

                # Attach stats and structured truncation details to API response and assistant_message
                response["token_stats"] = stats
                response["truncation_details"] = stats.get("truncation_details", {})
                if "assistant_message" in response and response["assistant_message"]:
                    response["assistant_message"]["token_stats"] = stats
                    response["assistant_message"]["truncation_details"] = stats.get(
                        "truncation_details", {}
                    )
            except HTTPException as http_exc:
                logger.error(
                    f"HTTP error during AI generation for conv {conversation_id}: "
                    f"{http_exc.status_code} - {http_exc.detail}"
                )
                response["assistant_error"] = {
                    "message": http_exc.detail,
                    "status_code": http_exc.status_code,
                }
            except Exception as e:
                logger.exception(
                    f"Unexpected error during AI response generation for conv {conversation_id}: {e}"
                )
                response["assistant_error"] = {
                    "message": f"Internal server error: {str(e)}"
                }

        return response

    async def _create_user_message(
        self,
        conversation_id: UUID,
        content: str,
        role: str,
        image_data: Optional[Union[str, List[str]]] = None,
    ) -> Message:
        """Create and save a message with new columns, handling image data if present."""
        from utils.message_render import render_markdown_to_html
        from utils.tokens import count_tokens_text

        extra_data = {}
        if image_data:
            images_to_store = []
            if isinstance(image_data, str):
                image_list = [image_data]
            else:
                image_list = image_data

            for idx, img in enumerate(image_list):
                if isinstance(img, str) and img.startswith("data:image"):
                    parts = img.split(";")
                    if len(parts) >= 2 and parts[1].startswith("base64,"):
                        images_to_store.append(
                            {"index": idx, "format": parts[0].split(":")[1]}
                        )
                    else:
                        logger.warning(
                            f"Invalid image data URL format for image {idx}."
                        )
                else:
                    logger.warning(
                        f"Invalid image data type or format for image {idx}: {type(img)}"
                    )

            if images_to_store:
                extra_data["image_count"] = len(images_to_store)
                extra_data["image_formats"] = [img["format"] for img in images_to_store]
                logger.info(f"User message includes {len(images_to_store)} images.")

        # Retrieve the conversation to get model_id for token counting.
        conv = await self.db.get(Conversation, conversation_id)
        model_id = conv.model_id if conv else None

        msg_text = content.strip() if content else ""
        html = render_markdown_to_html(msg_text)
        token_count = count_tokens_text(msg_text, model_id)

        message = Message(
            conversation_id=conversation_id,
            raw_text=msg_text,
            formatted_text=html,
            role=role,
            token_count=token_count,
            content=msg_text,
            extra_data=extra_data if extra_data else None,
        )
        await save_model(self.db, message)
        logger.debug(
            f"Saved {role} message {message.id} to conversation {conversation_id}"
        )
        return message

    async def _get_conversation_context(
        self, conversation_id: UUID, include_system_prompt: bool = False
    ) -> List[dict[str, Any]]:
        """Get formatted message history for AI context."""
        messages = await get_all_by_condition(
            self.db,
            Message,
            Message.conversation_id == conversation_id,
            order_by=Message.created_at.asc(),
            limit=100,  # limit to avoid extremely long histories
        )

        context = []
        if include_system_prompt:
            system_prompt = "You are a helpful assistant."
            conv = await self.db.get(Conversation, conversation_id)
            if (
                conv
                and conv.extra_data
                and conv.extra_data.get("ai_settings", {}).get("system_prompt")
            ):
                system_prompt = conv.extra_data["ai_settings"]["system_prompt"]
            context.append({"role": "system", "content": system_prompt})

        for msg in messages:
            message_dict = {"role": msg.role, "content": getattr(msg, "raw_text", None)}
            # Additional logic for images could go here, but currently we only pass text
            context.append(message_dict)

        return context

    async def generate_conversation_title(
        self, conversation_id: UUID, messages: List[dict[str, Any]], model_id: str
    ) -> str:
        """
        Generate a suggested title for the conversation by calling AI with a prompt.
        """
        system_prompt = (
            "You are an expert at summarizing. "
            "Please provide a short and descriptive title (no more than a few words) "
            "that captures the essence of the conversation. "
            "Output only the title without extra commentary."
        )
        temp_messages = [{"role": "system", "content": system_prompt}]
        for msg in messages:
            temp_messages.append({"role": msg["role"], "content": msg["content"]})
        temp_messages.append(
            {
                "role": "user",
                "content": "Please provide a short title for the conversation above.",
            }
        )

        try:
            assistant_msg_obj = await generate_ai_response(
                conversation_id=conversation_id,
                messages=temp_messages,
                model_id=model_id,
                db=self.db,
                options=AIResponseOptions(enable_markdown_formatting=False),
            )
            if assistant_msg_obj and assistant_msg_obj.content:
                return assistant_msg_obj.content.strip()
            else:
                return "Untitled Conversation"
        except Exception as e:
            logger.exception(f"Error generating conversation title: {e}")
            return "Untitled Conversation"

    async def generate_conversation_summary(
        self,
        conversation_id: UUID,
        messages: List[dict[str, Any]],
        model_id: str,
        max_length: int = 200,
    ) -> str:
        """
        Generate a summary for the conversation by calling AI with a summary prompt.
        """
        system_prompt = (
            "You are an expert at summarizing. "
            f"Provide a concise summary no longer than {max_length} characters. "
            "Do not include extraneous text."
        )
        temp_messages = [{"role": "system", "content": system_prompt}]
        for msg in messages:
            temp_messages.append({"role": msg["role"], "content": msg["content"]})
        temp_messages.append(
            {
                "role": "user",
                "content": f"Please summarize this conversation in <= {max_length} characters.",
            }
        )

        try:
            assistant_msg_obj = await generate_ai_response(
                conversation_id=conversation_id,
                messages=temp_messages,
                model_id=model_id,
                db=self.db,
                options=AIResponseOptions(enable_markdown_formatting=False),
            )
            if assistant_msg_obj and assistant_msg_obj.content:
                summary_text = assistant_msg_obj.content.strip()
                return summary_text[:max_length]
            else:
                return "No summary available."
        except Exception as e:
            logger.exception(f"Error generating conversation summary: {e}")
            return "No summary available."

    async def search_conversations(
        self,
        project_id: UUID,
        user_id: int,
        query: str,
        include_messages: bool,
        skip: int,
        limit: int,
    ) -> dict[str, Any]:
        """
        Search for conversations by title and optionally by message content.
        Returns a dict with keys: 'conversations', 'total', 'highlighted_messages'.
        """

        q_str = f"%{query}%"
        base_filters = [
            Conversation.user_id == user_id,
            Conversation.is_deleted.is_(False),
            Conversation.project_id == project_id,
        ]

        if include_messages:
            c_alias = aliased(Conversation)
            m_alias = aliased(Message)

            join_stmt = (
                select(c_alias)
                .join(m_alias, m_alias.conversation_id == c_alias.id, isouter=True)
                .where(
                    and_(
                        *base_filters,
                        or_(c_alias.title.ilike(q_str), m_alias.content.ilike(q_str)),
                    )
                )
                .distinct()
                .order_by(c_alias.created_at.desc())
            )
            total_query = select(func.count).select_from(  # Corrected: func.count
                join_stmt.order_by(None).subquery()
            )

            result_count = await self.db.execute(total_query)
            total = result_count.scalar() or 0

            join_stmt = join_stmt.offset(skip).limit(limit)
            result = await self.db.execute(join_stmt)
            conversations = result.scalars().all()
        else:

            search_filter = or_(Conversation.title.ilike(q_str))
            query_stmt = (
                select(Conversation)
                .where(and_(*base_filters, search_filter))
                .order_by(Conversation.created_at.desc())
            )
            count_stmt = select(func.count).select_from(  # Corrected: func.count
                query_stmt.order_by(None).subquery()
            )
            result_count = await self.db.execute(count_stmt)
            total = result_count.scalar() or 0

            query_stmt = query_stmt.offset(skip).limit(limit)
            result = await self.db.execute(query_stmt)
            conversations = result.scalars().all()

        return {
            "conversations": conversations,
            "total": total,
            "highlighted_messages": {},
        }


async def conversation_exception_handler(request, call_next):
    try:
        return await call_next(request)
    except ConversationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


async def get_conversation_service(
    db: AsyncSession = Depends(get_async_session),
) -> ConversationService:
    """Provide a fully-capable ConversationService instance."""
    return ConversationService(db)
