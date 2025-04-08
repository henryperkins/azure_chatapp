# MODIFIED: conversation_service.py
# Reason: Validate model parameters, pass parameters down to _generate_ai_response.

import logging
from typing import Dict, List, Optional, Any, Tuple, Union
from uuid import UUID
from datetime import datetime

from fastapi import Depends, HTTPException, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import joinedload

# Use centralized settings
from config import settings, Settings
from db import get_async_session
from models.conversation import Conversation
from models.message import Message
from models.project import Project

# Use generate_ai_response from ai_response module directly
from utils.ai_response import generate_ai_response, get_model_config
from utils.ai_helper import augment_with_knowledge
from utils.db_utils import get_all_by_condition, save_model
from utils.serializers import serialize_conversation, serialize_message
from utils.message_handlers import update_project_token_usage  # Import needed function

logger = logging.getLogger(__name__)


class ConversationError(Exception):
    """Base exception for conversation-related errors."""

    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def validate_model_and_params(model_id: str, params: Dict[str, Any]) -> None:
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
        # Further validation (e.g., budget vs max_tokens) might happen in the API call layer

    # Add validation for other parameters like temperature range, max_tokens limits etc. if needed


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
        # (Keep existing implementation)
        filters = [Conversation.id == conversation_id, Conversation.user_id == user_id]

        if not include_deleted:
            filters.append(Conversation.is_deleted.is_(False))

        query = select(Conversation)

        if project_id is not None:
            # Ensure project_id is UUID for comparison
            try:
                pid = UUID(str(project_id))
            except ValueError:
                raise ConversationError("Invalid project ID format", 400)

            filters.append(Conversation.project_id == pid)
            # Eager load project only when project_id is specified
            query = query.options(joinedload(Conversation.project))

            result = await self.db.execute(query.where(and_(*filters)))
            conv = result.scalar_one_or_none()

            # Check if found conversation actually belongs to the project
            # This check might be redundant if the filter works correctly, but adds safety
            if conv and conv.project_id != pid:
                logger.error(
                    f"Conversation {conversation_id} found but project mismatch: expected {pid}, got {conv.project_id}"
                )
                # Treat as not found or access denied
                conv = None

        else:
            # Standalone conversation: project_id must be NULL
            filters.append(Conversation.project_id.is_(None))
            result = await self.db.execute(query.where(and_(*filters)))
            conv = result.scalar_one_or_none()

        if not conv:
            logger.warning(
                f"Conversation access validation failed. "
                f"ID: {conversation_id}, User: {user_id}, Project: {project_id}, Found: {bool(conv)}"
            )
            raise ConversationError("Conversation not found or access denied", 404)

        # If project_id was provided, ensure the loaded conversation's project is accessible
        if project_id and conv.project:
            if conv.project.user_id != user_id:
                logger.error(
                    f"Project access denied for project {project_id} linked to conversation {conversation_id}. User: {user_id}"
                )
                raise ConversationError("Project access denied", 403)
        elif project_id and not conv.project:
            # Should not happen if eager loading worked and project_id matched filter
            logger.error(
                f"Conversation {conversation_id} linked to project {project_id}, but project data could not be loaded."
            )
            raise ConversationError("Internal error loading project data", 500)

        return conv

    async def _validate_project_access(self, project_id: UUID, user_id: int) -> Project:
        """Validate project ownership."""
        # (Keep existing implementation)
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
        use_knowledge_base: bool = False,  # Allow explicitly setting KB usage
        # Allow passing initial AI settings
        ai_settings: Optional[Dict[str, Any]] = None,
    ) -> Conversation:
        """Create new conversation with validation and optional AI settings."""
        try:
            validate_model_and_params(model_id, ai_settings or {})
        except ConversationError as e:
            # Re-raise validation errors as HTTPException for the endpoint
            raise HTTPException(status_code=e.status_code, detail=e.message) from e

        # Create base conversation object
        conv = Conversation(
            user_id=user_id,
            title=title.strip(),
            model_id=model_id,
            project_id=project_id,
            use_knowledge_base=use_knowledge_base,
            # Store initial AI settings if provided
            extra_data={"ai_settings": ai_settings} if ai_settings else None,
        )

        # Auto-enable knowledge base if project has one and not explicitly disabled
        if project_id:
            project = await self._validate_project_access(
                project_id, user_id
            )  # Raises on failure
            if (
                project and project.knowledge_base_id and not use_knowledge_base
            ):  # Check if explicitly disabled
                logger.info(
                    f"Project {project_id} has KB, but use_knowledge_base is false for new conversation."
                )
                conv.use_knowledge_base = False
            elif project and project.knowledge_base_id:
                logger.info(
                    f"Project {project_id} has KB, enabling for new conversation {conv.id}."
                )
                conv.use_knowledge_base = True
                conv.knowledge_base_id = project.knowledge_base_id
                # Token usage check is better done when messages are added, not on creation
                # try:
                #     await conv.validate_knowledge_base(self.db)
                # except Exception as e:
                #     logger.warning(f"Knowledge base validation issue during creation: {str(e)}")
                #     conv.use_knowledge_base = False # Disable if validation fails

        # Verify project assignment before saving (redundant if _validate_project_access works)
        if project_id and conv.project_id != project_id:
            logger.error(
                f"Project ID mismatch during conversation creation: conv.project_id={conv.project_id}, expected={project_id}"
            )
            raise ConversationError(
                "Internal error: Conversation project assignment failed", 500
            )

        await save_model(self.db, conv)
        logger.info(
            f"Conversation {conv.id} created by user {user_id} with model {model_id}. Project: {project_id}"
        )
        return conv

    async def get_conversation(
        self,
        conversation_id: UUID,
        user_id: int,
        project_id: Optional[UUID] = None,
    ) -> Dict:
        """Get single conversation with validation."""
        # (Keep existing implementation, _validate handles errors)
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
        # (Keep existing implementation)
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
        # Allow updating AI settings
        ai_settings: Optional[Dict[str, Any]] = None,
    ) -> Dict:
        """Update conversation attributes."""
        conv = await self._validate_conversation_access(
            conversation_id, user_id, project_id
        )

        updated = False
        if title is not None and conv.title != title.strip():
            conv.title = title.strip()
            updated = True
        if model_id is not None and conv.model_id != model_id:
            try:
                # Validate the new model before assigning
                validate_model_and_params(
                    model_id,
                    (
                        ai_settings or conv.extra_data.get("ai_settings", {})
                        if conv.extra_data
                        else {}
                    ),
                )
                conv.model_id = model_id
                updated = True
            except ConversationError as e:
                raise HTTPException(status_code=e.status_code, detail=e.message) from e
        if (
            use_knowledge_base is not None
            and conv.use_knowledge_base != use_knowledge_base
        ):
            if use_knowledge_base and not conv.project_id:
                raise ConversationError(
                    "Knowledge base requires project association", 400
                )
            # If enabling KB, link to project's KB ID if not already set
            if use_knowledge_base and conv.project_id and not conv.knowledge_base_id:
                project = await self._validate_project_access(UUID(str(conv.project_id)), user_id)
                if project.knowledge_base_id:
                    conv.knowledge_base_id = project.knowledge_base_id
                else:
                    # Project doesn't have a KB, cannot enable
                    raise ConversationError(
                        "Cannot enable knowledge base: Project has no associated knowledge base.",
                        400,
                    )

            conv.use_knowledge_base = use_knowledge_base
            updated = True

        # Update AI settings (merge or replace)
        if ai_settings is not None:
            # Validate new settings against the current/new model
            current_model_id = model_id or conv.model_id
            if not current_model_id:
                raise ConversationError("Model ID is required", 400)
            try:
                validate_model_and_params(str(current_model_id), ai_settings)
            except ConversationError as e:
                raise HTTPException(status_code=e.status_code, detail=e.message) from e

            if conv.extra_data is None:
                conv.extra_data = {}
            # Merge new settings, overwriting existing keys
            conv.extra_data["ai_settings"] = {
                **conv.extra_data.get("ai_settings", {}),
                **ai_settings,
            }
            # Important: Ensure extra_data is marked as modified for SQLAlchemy JSON mutation tracking
            from sqlalchemy.orm.attributes import flag_modified

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
        # (Keep existing implementation, _validate handles errors)
        conv = await self._validate_conversation_access(
            conversation_id, user_id, project_id
        )
        if conv.is_deleted:
            logger.warning(f"Conversation {conversation_id} is already deleted.")
            # Return ID even if already deleted? Or raise error? Returning ID is idempotent.
            return UUID(str(conv.id))

        conv.is_deleted = True
        conv.deleted_at = datetime.utcnow()
        await save_model(self.db, conv)
        logger.info(f"Conversation {conversation_id} soft-deleted by user {user_id}.")
        if conv.id is None:  # Should not happen after save
            raise ConversationError(
                "Failed to retrieve conversation ID after delete operation", 500
            )
        return UUID(str(conv.id))

    async def restore_conversation(
        self,
        conversation_id: UUID,
        user_id: int,
        project_id: Optional[UUID] = None,  # Project ID is necessary context here
    ) -> Dict:
        """Restore soft-deleted conversation."""
        if not project_id:
            # Standalone conversations usually aren't soft-deleted/restorable in this design
            raise ConversationError(
                "Restore operation typically applies to project conversations.", 400
            )

        # Validate access including deleted conversations within the project
        conv = await self._validate_conversation_access(
            conversation_id, user_id, project_id, include_deleted=True
        )
        if not conv.is_deleted:
            logger.warning(
                f"Conversation {conversation_id} is not deleted, cannot restore."
            )
            # Return current state? Or raise error? Let's return current state.
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
    ) -> List[Dict]:
        """List messages in conversation."""
        # (Keep existing implementation, _validate handles errors)
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
        # AI generation parameters
        image_data: Optional[Union[str, List[str]]] = None,
        vision_detail: Optional[str] = "auto",
        enable_thinking: Optional[bool] = None,
        thinking_budget: Optional[int] = None,
        reasoning_effort: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        # Add other params as needed
    ) -> Dict:
        """Create user message and trigger AI response generation."""
        conv = await self._validate_conversation_access(
            conversation_id, user_id, project_id
        )

        # 1. Create and save the user message
        user_message = await self._create_user_message(
            conversation_id, content, role, image_data
        )
        response = {"user_message": serialize_message(user_message)}

        # 2. Generate AI response if the created message was from the 'user'
        if user_message.role == "user":
            if not conv.model_id:
                raise ConversationError(
                    "Cannot generate AI response: No model configured for conversation",
                    400
                )
            try:
                # Prepare message history for AI
                # Pass include_system_prompt=True if you have a default system prompt defined elsewhere
                message_history = await self._get_conversation_context(
                    conversation_id,
                    include_system_prompt=True,  # Or False depending on design
                )

                # Get AI settings from conversation or use defaults/passed params
                ai_settings = (
                    conv.extra_data.get("ai_settings", {}) if conv.extra_data else {}
                )

                # Prioritize parameters passed directly to create_message, then conv settings, then defaults
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

                # Call the centralized generate_ai_response function
                assistant_msg_obj = await generate_ai_response(
                    conversation_id=conversation_id,
                    messages=message_history,
                    model_id=str(conv.model_id),
                    db=self.db,
                    # Pass validated & prioritized parameters
                    image_data=image_data,  # Image data comes from the user input directly
                    vision_detail=final_vision_detail,
                    enable_thinking=final_enable_thinking,
                    thinking_budget=final_thinking_budget,
                    reasoning_effort=final_reasoning_effort,
                    temperature=final_temperature,
                    max_tokens=final_max_tokens,
                    # Pass enable_markdown_formatting if needed, e.g., from ai_settings
                    enable_markdown_formatting=ai_settings.get(
                        "enable_markdown_formatting", False
                    ),
                )

                if assistant_msg_obj:
                    # Serialize the Message object including metadata
                    serialized_assistant_msg = serialize_message(assistant_msg_obj)

                    # Add thinking/redacted thinking to the top level for convenience if present
                    if (
                        hasattr(assistant_msg_obj, "thinking")
                        and assistant_msg_obj.thinking
                    ):
                        serialized_assistant_msg["thinking"] = (
                            assistant_msg_obj.thinking
                        )
                    if (
                        hasattr(assistant_msg_obj, "redacted_thinking")
                        and assistant_msg_obj.redacted_thinking
                    ):
                        serialized_assistant_msg["redacted_thinking"] = (
                            assistant_msg_obj.redacted_thinking
                        )

                    response["assistant_message"] = serialized_assistant_msg
                else:
                    # Handle case where generate_ai_response returned None (error occurred)
                    logger.error(
                        f"AI response generation failed for conversation {conversation_id}"
                    )
                    response["assistant_error"] = {
                        "message": "Failed to generate AI response."
                    }

            except HTTPException as http_exc:
                # Catch HTTP exceptions raised during generation (e.g., model API errors)
                logger.error(
                    f"HTTP error during AI generation for conv {conversation_id}: {http_exc.status_code} - {http_exc.detail}"
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
        """Create and save a user message, handling image data."""
        if role != "user":  # This internal helper is specifically for user messages
            logger.warning(f"Attempted to use _create_user_message with role '{role}'")
            # Or raise error depending on desired strictness
            # For now, allow but log

        extra_data = {}
        # Validate and store image data if provided
        if image_data:
            # Basic format check - more robust validation could be added
            images_to_store = []
            image_list = [image_data] if isinstance(image_data, str) else image_data
            for idx, img in enumerate(image_list):
                if isinstance(img, str) and img.startswith("data:image"):
                    parts = img.split(";")
                    if len(parts) >= 2 and parts[1].startswith("base64,"):
                        images_to_store.append(
                            {"index": idx, "format": parts[0].split(":")[1]}
                        )
                        # Store only metadata, not the full base64 in DB extra_data?
                        # Or store the full base64 if needed for recall? Let's store it for now.
                        # Consider size limits if storing full base64 in JSONB.
                        # extra_data[f"image_{idx}_data"] = img # Example: store full data
                    else:
                        logger.warning(
                            f"Invalid image data URL format detected for image {idx}. Skipping."
                        )
                else:
                    logger.warning(
                        f"Invalid image data type or format for image {idx}: {type(img)}. Skipping."
                    )

            # Store the image data itself separately or pass it directly to AI call?
            # Storing it in the message object extra_data might be large.
            # Let's assume image_data is passed transiently and not stored long-term in extra_data.
            # We'll just log that an image was present.
            if images_to_store:
                extra_data["image_count"] = len(images_to_store)
                extra_data["image_formats"] = [img["format"] for img in images_to_store]
                logger.info(f"User message includes {len(images_to_store)} image(s).")

        message = Message(
            conversation_id=conversation_id,
            content=(
                content.strip() if content else ""
            ),  # Ensure content is string and handle None
            role=role,
            extra_data=extra_data if extra_data else None,
        )
        await save_model(self.db, message)
        logger.debug(
            f"Saved {role} message {message.id} to conversation {conversation_id}"
        )
        return message

    # Removed _generate_ai_response as logic is now in ai_response.generate_ai_response

    async def _get_conversation_context(
        self, conversation_id: UUID, include_system_prompt: bool = False
    ) -> List[Dict[str, Any]]:
        """Get formatted message history for AI context, handling potential image data."""
        messages = await get_all_by_condition(
            self.db,
            Message,
            Message.conversation_id == conversation_id,
            order_by=Message.created_at.asc(),
            # Add a reasonable limit to prevent loading excessively long histories
            # The AI model itself has token limits, so loading everything might be wasteful
            limit=100,  # Example limit, adjust as needed
        )

        context: List[Dict[str, Any]] = []
        if include_system_prompt:
            # TODO: Get system prompt from conversation settings or a global default
            system_prompt = "You are a helpful assistant."  # Placeholder
            conv = await self.db.get(Conversation, conversation_id)
            if (
                conv
                and conv.extra_data
                and conv.extra_data.get("ai_settings", {}).get("system_prompt")
            ):
                system_prompt = conv.extra_data["ai_settings"]["system_prompt"]
            context.append({"role": "system", "content": system_prompt})

        for msg in messages:
            message_dict: Dict[str, Any] = {"role": msg.role}
            # Handle potential image data stored in extra_data (if design requires it)
            # Current design passes image_data transiently, so check msg.content format
            if (
                msg.role == "user"
                and msg.extra_data
                and "image_count" in msg.extra_data
            ):
                # If user message had images, format for multimodal models
                # This assumes the image data itself isn't stored in extra_data,
                # but passed transiently during the create_message call.
                # The context needs to represent the *intent* including images.
                # How to reconstruct this? Maybe store image references?
                # For now, we'll just pass the text content.
                # The actual image data needs to be passed separately to the AI call.
                message_dict["content"] = msg.content
                logger.debug(
                    f"User message {msg.id} originally included images, adding text content to context."
                )
            else:
                message_dict["content"] = msg.content

            # Skip empty messages?
            if message_dict["content"]:
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
        """Process WebSocket message: create message, trigger streaming AI response."""
        try:
            conv = await self._validate_conversation_access(
                conversation_id, user_id, project_id
            )

            # Handle non-message types (like ping, token refresh) if necessary
            msg_type = message_data.get("type", "message")
            if msg_type != "message":
                logger.debug(f"Received non-message WebSocket type: {msg_type}")
                # Handle other types like 'ping', 'token_refresh' if defined
                if msg_type == "token_refresh":
                    return {"type": "token_refresh_success"}
                elif msg_type == "ping":
                    await websocket.send_json({"type": "pong"})
                    return {}  # Indicate message handled, no further action needed
                else:
                    return {
                        "type": "error",
                        "message": f"Unsupported WebSocket message type: {msg_type}",
                    }

            # --- Process User Message ---
            content = message_data.get("content", "")
            role = message_data.get("role", "user")
            image_data = message_data.get(
                "image_data"
            )  # Expecting base64 string or list

            if not content and not image_data:
                return {"type": "error", "message": "Cannot process empty message"}

            # 1. Create and save the user message
            user_message = await self._create_user_message(
                conversation_id, content, role, image_data
            )
            # Send user message confirmation back immediately
            await websocket.send_json(
                {
                    "type": "user_message_saved",
                    "message": serialize_message(user_message),
                }
            )

            # 2. Trigger AI Streaming Response (using ai_response.handle_websocket_response)
            # This function will handle the streaming back to the *same* websocket
            from utils.ai_response import (
                handle_websocket_response as stream_ai_response,
            )

            # We need to pass the necessary context and parameters
            # Note: handle_websocket_response expects the *incoming* message data
            # to extract parameters like vision_detail, reasoning_effort etc.
            await stream_ai_response(
                conversation_id=conversation_id,
                db=self.db,
                websocket=websocket,
                message_data=message_data,  # Pass the original incoming data
            )

            # Since streaming is handled by stream_ai_response, return an empty dict
            # to indicate the main message flow is done here.
            return {}

        except ConversationError as e:
            logger.warning(
                f"Conversation access error in WebSocket: {e.message} (Status: {e.status_code})"
            )
            # Try sending error back to client
            try:
                await websocket.send_json(
                    {
                        "type": "error",
                        "status_code": e.status_code,
                        "message": e.message,
                    }
                )
            except Exception as ws_err:
                logger.error(f"Failed to send error to WebSocket: {ws_err}")
            return {"error": e.message}  # Return error structure if needed by caller
        except HTTPException as e:
            # Catch errors from validation or AI generation if they bubble up
            logger.error(
                f"HTTP Exception during WebSocket processing: {e.status_code} - {e.detail}"
            )
            try:
                await websocket.send_json(
                    {"type": "error", "status_code": e.status_code, "message": e.detail}
                )
            except Exception as ws_err:
                logger.error(f"Failed to send error to WebSocket: {ws_err}")
            return {"error": e.detail}
        except Exception as e:
            logger.exception(
                f"Unexpected error processing WebSocket message for conv {conversation_id}: {e}"
            )
            try:
                await websocket.send_json(
                    {"type": "error", "message": f"Internal server error: {str(e)}"}
                )
            except Exception as ws_err:
                logger.error(f"Failed to send error to WebSocket: {ws_err}")
            return {"error": str(e)}


# Middleware for custom exceptions (Keep as is)
async def conversation_exception_handler(request, call_next):
    try:
        return await call_next(request)
    except ConversationError as exc:
        # Use standard HTTPException for FastAPI compatibility
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


# Service instance factory (Keep as is)
async def get_conversation_service(
    db: AsyncSession = Depends(get_async_session),
) -> ConversationService:
    # Removed try-except block here - let exceptions propagate to FastAPI handler or middleware
    # The middleware 'conversation_exception_handler' should catch ConversationError
    # Other exceptions will be caught by FastAPI's default handlers.
    return ConversationService(db)
