"""
ai_response.py
--------------
Handles AI response generation logic for chat conversations.
Centralizes model API calls and response processing.

This module supports:
 - Knowledge base context retrieval
 - Extended thinking with Claude
 - Vision processing with Azure/OpenAI
 - WebSocket response streaming
"""

import logging
from typing import Dict, Optional, List
from uuid import UUID

from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from models.conversation import Conversation
from models.message import Message
from models.project import Project
from utils.openai import openai_chat, claude_chat, CLAUDE_MODELS
from config import settings
from utils.db_utils import get_by_id, save_model
from utils.response_utils import create_standard_response
from utils.message_handlers import get_conversation_messages, update_project_token_usage

logger = logging.getLogger(__name__)


async def retrieve_knowledge_context(
    query: str,
    project_id: Optional[UUID] = None,
    db: Optional[AsyncSession] = None,
    top_k: int = 3,
) -> Optional[str]:
    """
    Retrieve relevant knowledge context for a query if the project has a knowledge base.

    Args:
        query:       User query to search for context.
        project_id:  Project UUID to search within.
        db:          Async database session.
        top_k:       Number of top results to include.

    Returns:
        A formatted context string or None if no relevant context is found.
    """
    if not project_id or not db or not query:
        return None

    try:
        # Inline import to avoid circular references
        from services import knowledgebase_service

        # Fetch top_k search results
        search_results = await knowledgebase_service.search_project_context(
            project_id=project_id, query=query, db=db, top_k=top_k
        )

        if not search_results:
            return None

        # Format context blocks
        context_blocks = []
        for i, result in enumerate(search_results):
            if not isinstance(result, dict):
                continue

            score = result.get("score", 0)
            if score < 0.6:
                # Skip low-confidence matches
                continue

            text = result.get("text", "")
            if not text:
                continue

            file_info = result.get("file_info", {})
            filename = file_info.get("filename", "Unknown source")

            context_blocks.append(f"[Source {i + 1}: {filename}]\n{text}\n")

        if not context_blocks:
            return None

        # Combine blocks with a header
        context_text = "RELEVANT CONTEXT FROM PROJECT FILES:\n\n" + "\n".join(
            context_blocks
        )
        return context_text

    except Exception as e:
        logger.error(f"Error retrieving knowledge context: {e}")
        return None


async def calculate_tokens(content: str, model: str) -> int:
    """
    Calculate token usage for a given content string and model.
    If precise counting fails, returns a fallback estimation.

    Args:
        content: Text content for which to count tokens.
        model:   Model identifier (e.g., 'claude-3-7-sonnet-20250219').

    Returns:
        Estimated number of tokens used.
    """
    try:
        if model in CLAUDE_MODELS:
            from utils.openai import count_claude_tokens  # Inline import for clarity

            return await count_claude_tokens(
                messages=[{"role": "assistant", "content": content}],
                model_name=model,
            )
        # TODO: Insert Azure/OpenAI specific token counters if desired
    except Exception as e:
        logger.warning(f"Token counting failed, using estimate: {e}")

    # Fallback simple heuristic
    return len(content) // 4


async def generate_ai_response(
    conversation_id: UUID,
    messages: List[Dict[str, str]],
    model_id: str = "claude-3-7-sonnet-20250219",  # Default model
    image_data: Optional[str] = None,
    vision_detail: str = "auto",
    enable_thinking: Optional[bool] = None,
    thinking_budget: Optional[int] = None,
    stream: bool = False,
    max_tokens: Optional[int] = None,
    reasoning_effort: Optional[str] = None,
    db: Optional[AsyncSession] = None,
) -> Optional[Message]:
    """
    Generate AI response for a conversation using either Claude or Azure/OpenAI.

    Args:
        conversation_id:   Conversation UUID.
        messages:          List of message dicts (role, content).
        model_id:          Model identifier.
        image_data:        Base64-encoded image data for vision tasks.
        vision_detail:     Vision detail setting ("auto" by default).
        enable_thinking:   Enable extended thinking for Claude.
        thinking_budget:   Budget for extended thinking in tokens.
        stream:            Whether to use streaming responses (for websockets).
        max_tokens:        Max tokens for generation (Claude/OpenAI differ).
        reasoning_effort:  Additional argument for advanced usage.
        db:                Async DB session.

    Returns:
        A newly created assistant Message object, or None if an error occurs.
    """
    if not db:
        logger.error("No database session provided to generate_ai_response.")
        return None

    # Retrieve conversation once
    conversation = await get_by_id(db, Conversation, conversation_id)
    if not conversation:
        logger.error(f"Conversation not found: {conversation_id}")
        return None

    # Basic model routing. If using images, can override model if needed.
    chosen_model = "o1" if image_data else model_id

    # --- 1) Retrieve Knowledge Context ---
    last_user_message = next(
        (msg["content"] for msg in reversed(messages) if msg["role"] == "user"), None
    )
    knowledge_context = None
    project_id = conversation.project_id

    if project_id and last_user_message:
        try:
            project_uuid = UUID(str(project_id))
            knowledge_context = await retrieve_knowledge_context(
                query=last_user_message, project_id=project_uuid, db=db
            )
        except (ValueError, AttributeError):
            pass

    # Inject knowledge context as a system message if found
    if knowledge_context:
        # Find system message index or default insertion point
        system_index = next(
            (i + 1 for i, m in enumerate(messages) if m["role"] == "system"), 0
        )
        messages.insert(system_index, {"role": "system", "content": knowledge_context})

    # --- 2) Generate using Claude or Azure/OpenAI ---

    # Decide if it's a Claude model
    is_claude_model = chosen_model in CLAUDE_MODELS
    assistant_content = ""
    thinking_content = None
    redacted_thinking = None
    has_thinking = False

    try:
        if is_claude_model:
            logger.info(f"Generating response with Claude model: {chosen_model}")

            # Use configured max_tokens or fallback
            claude_max = max_tokens or settings.CLAUDE_MAX_TOKENS.get(
                chosen_model, 1500
            )
            # Extended thinking defaults
            extended_thinking_enabled = (
                enable_thinking
                if enable_thinking is not None
                else settings.CLAUDE_EXTENDED_THINKING_ENABLED
            )
            extended_thinking_budget = (
                thinking_budget
                if thinking_budget is not None
                else settings.CLAUDE_EXTENDED_THINKING_BUDGET
            )

            claude_response = await claude_chat(
                messages=messages,
                model_name=chosen_model,
                max_tokens=claude_max,
                enable_thinking=extended_thinking_enabled,
                thinking_budget=extended_thinking_budget,
                stream=False,  # handle streaming via websockets
                image_data=(
                    image_data
                    if CLAUDE_MODELS[chosen_model].get("supports_vision", False)
                    else None
                ),
            )
            assistant_content = claude_response["choices"][0]["message"]["content"]
            thinking_content = claude_response.get("thinking")
            redacted_thinking = claude_response.get("redacted_thinking")
            has_thinking = claude_response.get("has_thinking", False)

        elif chosen_model in settings.AZURE_OPENAI_MODELS:
            logger.info(f"Generating response with Azure/OpenAI model: {chosen_model}")

            azure_max = max_tokens or settings.AZURE_MAX_TOKENS
            openai_response = await openai_chat(
                messages=messages,
                model_name=chosen_model,
                image_data=image_data,
                vision_detail=vision_detail,
                stream=False,  # WebSocket handles streaming if needed
                max_tokens=azure_max,
            )
            assistant_content = openai_response["choices"][0]["message"]["content"]
        else:
            logger.error(f"Unsupported model requested: {chosen_model}")
            return None

        # --- 3) Construct and save the assistant message ---
        metadata = {}
        if knowledge_context:
            metadata["used_knowledge_context"] = True
        if has_thinking:
            metadata["has_thinking"] = True
        if thinking_content:
            metadata["thinking"] = thinking_content
        if redacted_thinking:
            metadata["redacted_thinking"] = redacted_thinking

        assistant_msg = Message(
            conversation_id=conversation_id,
            role="assistant",
            content=assistant_content,
            extra_data=metadata if metadata else None,
        )

        await save_model(db, assistant_msg)

        # Update token usage
        token_count = await calculate_tokens(assistant_content, chosen_model)
        try:
            await update_project_token_usage(conversation, token_count, db)
        except Exception as e:
            logger.error(f"Failed to update token usage: {str(e)}")

        return assistant_msg

    except Exception as e:
        logger.error(f"Error generating AI response: {e}")
        return None


async def handle_websocket_response(
    conversation_id: UUID, db: AsyncSession, websocket: WebSocket
) -> None:
    """
    Handle AI response generation for WebSocket connections (Claude or Azure/OpenAI).

    Args:
        conversation_id: Conversation UUID.
        db:              Database session.
        websocket:       FastAPI WebSocket connection.
    """
    await websocket.accept()

    try:
        conversation = await get_by_id(db, Conversation, conversation_id)
        if not conversation:
            await websocket.send_json(
                await create_standard_response(
                    None, "Conversation not found", success=False
                )
            )
            return

        # Retrieve conversation messages from DB
        msg_dicts = await get_conversation_messages(conversation_id, db)

        # If the project has specific AI settings, override defaults
        enable_thinking = None
        thinking_budget = None

        if conversation.project_id:
            try:
                project_uuid = UUID(str(conversation.project_id))
                project = await get_by_id(db, Project, project_uuid)
                if project and project.extra_data:
                    ai_settings = project.extra_data.get("ai_settings", {})
                    if "extended_thinking" in ai_settings:
                        enable_thinking = ai_settings["extended_thinking"]
                    if "thinking_budget" in ai_settings:
                        thinking_budget = ai_settings["thinking_budget"]
            except (ValueError, AttributeError):
                logger.warning("Invalid project UUID or missing project data.")

        # Generate response (non-streaming from the function, streaming logic handled below if needed)
        assistant_msg = await generate_ai_response(
            conversation_id=conversation_id,
            messages=msg_dicts,
            model_id=conversation.model_id,
            enable_thinking=enable_thinking,
            thinking_budget=thinking_budget,
            db=db,
        )

        if assistant_msg:
            # Prepare JSON response data
            response_data = {
                "id": str(assistant_msg.id),
                "role": assistant_msg.role,
                "content": assistant_msg.content,
                "type": "message",
            }

            # Include thinking blocks if present
            metadata = assistant_msg.get_metadata_dict()
            if metadata.get("has_thinking"):
                if "thinking" in metadata:
                    response_data["thinking"] = metadata["thinking"]
                if "redacted_thinking" in metadata:
                    response_data["redacted_thinking"] = metadata["redacted_thinking"]
            if metadata.get("used_knowledge_context"):
                response_data["used_knowledge_context"] = True

            await websocket.send_json(response_data)
        else:
            await websocket.send_json(
                {"type": "error", "content": "Failed to generate AI response"}
            )

    except Exception as e:
        logger.error(f"WebSocket AI response error: {e}")
        await websocket.send_json(
            {"type": "error", "content": f"Error generating response: {str(e)}"}
        )
    finally:
        await websocket.close()
