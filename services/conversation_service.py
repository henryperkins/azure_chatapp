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
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.exc import IntegrityError

from config import settings
from db import get_async_session
from models.conversation import Conversation
from models.message import Message
from models.project import Project
from utils.ai_response import generate_ai_response, get_model_config
from utils.db_utils import get_all_by_condition, save_model
from utils.serializers import serialize_conversation, serialize_message


logger = logging.getLogger(__name__)


class ConversationError(Exception):
    """Base exception for conversation-related errors."""

    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def validate_model_and_params(model_id: str, params: dict[str, Any]) -> None:
    """
    Validate if the model exists in config and if provided params are supported.
    Raises ConversationError on failure.
    """
    model_config = get_model_config(model_id, settings)
    if not model_config:
        raise ConversationError(
            f"Unsupported or unknown model ID: {model_id}", status_code=400
        )

    capabilities = model_config.get("capabilities", [])
    parameters_config = model_config.get("parameters", {})

    # Validate Vision parameters
    if params.get("image_data"):
        if "vision" not in capabilities:
            raise ConversationError(f"Model {model_id} does not support vision.", 400)
        vision_detail = params.get("vision_detail", "auto")
        valid_details = parameters_config.get("vision_detail")
        if valid_details and vision_detail not in valid_details:
            raise ConversationError(
                f"Invalid vision_detail '{vision_detail}' for {model_id}. Valid: {valid_details}",
                400,
            )

    # Validate Reasoning Effort
    if params.get("reasoning_effort"):
        if "reasoning_effort" not in capabilities:
            raise ConversationError(
                f"Model {model_id} does not support reasoning_effort.", 400
            )
        reasoning_effort = params.get("reasoning_effort")
        valid_efforts = parameters_config.get("reasoning_effort")
        if valid_efforts and reasoning_effort not in valid_efforts:
            raise ConversationError(
                f"Invalid reasoning_effort '{reasoning_effort}' for {model_id}. Valid: {valid_efforts}",
                400,
            )

    # Validate Extended Thinking (Claude)
    if params.get("enable_thinking"):
        if "extended_thinking" not in capabilities:
            raise ConversationError(
                f"Model {model_id} does not support extended thinking.", 400
            )
        thinking_budget = params.get("thinking_budget")
        extended_thinking_config = model_config.get("extended_thinking_config")
        if thinking_budget and extended_thinking_config:
            min_budget = extended_thinking_config.get("min_budget", 0)
            if thinking_budget < min_budget:
                raise ConversationError(
                    f"Thinking budget ({thinking_budget}) is below minimum ({min_budget}) for {model_id}.",
                    400,
                )
    # Additional validations (temperature, max_tokens, etc.) can be added here.


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

        query = select(Conversation)

        if project_id is not None:
            # Ensure project_id is UUID for comparison
            try:
                pid = UUID(str(project_id))
            except ValueError:
                raise ConversationError("Invalid project ID format", 400) from None

            filters.append(Conversation.project_id == pid)
            # Eager load project and knowledge_base only when project_id is specified
            query = query.options(
                joinedload(Conversation.project),
                joinedload(Conversation.knowledge_base)
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
        else:
            # Standalone conversation: project_id must be NULL
            filters.append(Conversation.project_id.is_(None))
            result = await self.db.execute(query.where(and_(*filters)))
            conv = result.scalar_one_or_none()

        if not conv:
            logger.warning(
                f"Conversation NOT FOUND. "
                f"ID: {conversation_id}, User: {user_id}, Project: {project_id}, Found: {bool(conv)}"
            )
            raise ConversationError("Conversation not found", 404)

        # If project_id was provided, ensure the loaded conversation's project is accessible
        if project_id and conv.project:
            if conv.project.user_id != user_id:
                logger.error(
                    f"ACCESS DENIED: Project {project_id} (for conversation {conversation_id}) "
                    f"belongs to user {conv.project.user_id} but tried by user {user_id}"
                )
                raise ConversationError("Access denied to conversation (invalid permissions or ownership)", 403)

        return conv

    async def _validate_project_access(self, project_id: UUID, user_id: int) -> Project:
        """Validate project ownership."""
        project = await self.db.get(Project, project_id)
        if not project:
            raise ConversationError("Project not found", 404)
        if project.user_id != user_id:
            logger.warning(
                f"User {user_id} attempted to access project {project_id} owned by {project.user_id}"
            )
            raise ConversationError("Project access denied", 403)
        return project

    async def create_conversation(
        self,
        user_id: int,
        title: str,
        model_id: str,
        project_id: Optional[UUID] = None,
        knowledge_base_id: Optional[UUID] = None,
        use_knowledge_base: bool = False,
        ai_settings: Optional[dict[str, Any]] = None,
    ) -> Conversation:
        """Create new conversation with validation and optional AI settings."""
        try:
            validate_model_and_params(model_id, ai_settings or {})
        except ConversationError as e:
            raise HTTPException(status_code=e.status_code, detail=e.message) from e

        # Validate project access and KB consistency if project_id is provided
        if project_id:
            project = await self._validate_project_access(project_id, user_id)
            if use_knowledge_base:
                await self.db.refresh(project, ['knowledge_base'])
                if not project.knowledge_base:
                    raise ConversationError("Project has no knowledge base, cannot set use_knowledge_base=True.", 400)
                if knowledge_base_id != project.knowledge_base.id:
                    # This should ideally be caught by the route, but as a safeguard:
                    logger.error(f"KnowledgeBase ID mismatch for project {project_id}. "
                                 f"Passed: {knowledge_base_id}, Project's KB: {project.knowledge_base.id}")
                    raise ConversationError("Knowledge base ID mismatch for the specified project.", 400)
            elif knowledge_base_id is not None:
                raise ConversationError("knowledge_base_id should not be provided if use_knowledge_base is False for a project.", 400)

        conv = Conversation(
            user_id=user_id,
            title=title.strip(),
            model_id=model_id,
            project_id=project_id,
            knowledge_base_id=knowledge_base_id,
            use_knowledge_base=use_knowledge_base,
            extra_data={"ai_settings": ai_settings} if ai_settings else None,
        )

        # The logic for auto-enabling KB based on project.knowledge_base is now
        # effectively handled by the route, which determines kb_id and use_knowledge_base
        # before calling this service method. The validation above ensures consistency.

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

        # Define eager loading options
        load_options = [
            joinedload(Conversation.project),
            joinedload(Conversation.knowledge_base)
        ]

        return await get_all_by_condition(
            self.db,
            Conversation,
            *filters,
            order_by=Conversation.created_at.desc(),
            limit=limit,
            offset=skip,
            options=cast(List[Any], load_options)
        )

    async def update_conversation(
        self,
        conversation_id: UUID,
        user_id: int,
        project_id: Optional[UUID] = None,
        title: Optional[str] = None,
        model_id: Optional[str] = None,
        use_knowledge_base: Optional[bool] = None,
        ai_settings: Optional[dict[str, Any]] = None,
    ) -> dict:
        """Update conversation attributes."""
        conv = await self._validate_conversation_access(
            conversation_id, user_id, project_id
        )

        updated = False
        if title is not None and title.strip() != conv.title:
            conv.title = title.strip()
            updated = True
        if model_id is not None and model_id != conv.model_id:
            try:
                validate_model_and_params(
                    model_id,
                    (
                        (ai_settings or conv.extra_data.get("ai_settings", {}))
                        if conv.extra_data
                        else {}
                    ),
                )
                conv.model_id = model_id
                updated = True
            except ConversationError as e:
                raise HTTPException(status_code=e.status_code, detail=e.message) from e

        # Only for standalone conversations if toggling KB
        if (
            use_knowledge_base is not None
            and conv.use_knowledge_base != use_knowledge_base
        ):
            if conv.project_id:
                project = await self._validate_project_access(
                    UUID(str(conv.project_id)), user_id
                )
                # Access knowledge base through the relationship
                if project.knowledge_base and not use_knowledge_base:
                    logger.warning(
                        f"Attempt to disable KB for project conversation {conv.id} is ignored."
                    )
                elif project.knowledge_base:
                    conv.use_knowledge_base = True
                    conv.knowledge_base_id = project.knowledge_base.id
                    updated = True
                else:
                    # If project has no KB, we cannot enable it
                    if use_knowledge_base:
                        raise ConversationError(
                            "Cannot enable knowledge base: Project has no associated knowledge base.",
                            400,
                        )
            else:
                conv.use_knowledge_base = use_knowledge_base
                updated = True

        if ai_settings is not None:
            current_model_id = model_id or conv.model_id
            if not current_model_id:
                raise ConversationError("Model ID is required", 400)
            try:
                validate_model_and_params(str(current_model_id), ai_settings)
            except ConversationError as e:
                raise HTTPException(status_code=e.status_code, detail=e.message) from e

            if conv.extra_data is None:
                conv.extra_data = {}
            conv.extra_data["ai_settings"] = {
                **conv.extra_data.get("ai_settings", {}),
                **ai_settings,
            }

            flag_modified(conv, "extra_data")
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
        if not project_id:
            raise ConversationError(
                "Restore operation typically applies to project conversations.", 400
            )

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
    ) -> dict:
        """Create a new message in the conversation and, if role=user, generate AI response."""
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
                message_history = await self._get_conversation_context(
                    conversation_id, include_system_prompt=True
                )
                ai_settings = (
                    conv.extra_data.get("ai_settings", {}) if conv.extra_data else {}
                )

                final_enable_thinking = (
                    enable_thinking
                    if enable_thinking is not None
                    else ai_settings.get("enable_thinking")
                )
                final_thinking_budget = (
                    thinking_budget
                    if thinking_budget is not None
                    else ai_settings.get("thinking_budget")
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

                # Validate final parameters with the model
                params_for_validation = {
                    "image_data": image_data,
                    "vision_detail": final_vision_detail,
                    "enable_thinking": final_enable_thinking,
                    "thinking_budget": final_thinking_budget,
                    "reasoning_effort": final_reasoning_effort,
                }
                # We can also pass temperature, max_tokens if needed in the config
                if final_temperature is not None:
                    params_for_validation["temperature"] = final_temperature
                if final_max_tokens is not None:
                    params_for_validation["max_tokens"] = final_max_tokens

                validate_model_and_params(conv.model_id, params_for_validation)

                assistant_msg_obj = await generate_ai_response(
                    conversation_id=conversation_id,
                    messages=message_history,
                    model_id=str(conv.model_id),
                    db=self.db,
                    image_data=image_data,
                    vision_detail=final_vision_detail,
                    enable_thinking=final_enable_thinking,
                    thinking_budget=final_thinking_budget,
                    reasoning_effort=final_reasoning_effort,
                    temperature=final_temperature,
                    max_tokens=final_max_tokens,
                    enable_markdown_formatting=ai_settings.get(
                        "enable_markdown_formatting", False
                    ),
                )

                if assistant_msg_obj:
                    serialized_assistant_msg = serialize_message(assistant_msg_obj)
                    # Attach thinking or redacted_thinking if present
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
        """Create and save a message, handling image data if present."""
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

        message = Message(
            conversation_id=conversation_id,
            content=content.strip() if content else "",
            role=role,
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
            message_dict = {"role": msg.role, "content": msg.content}
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
                enable_markdown_formatting=False,
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
                enable_markdown_formatting=False,
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
            total_query = select(func.count()).select_from(  # Corrected: func.count()
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
            count_stmt = select(func.count()).select_from(  # Corrected: func.count()
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
