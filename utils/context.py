"""
context.py
----------
Provides conversation summarization and token-limit enforcement logic for the Azure OpenAI Chat Application.

Includes:
  1. do_summarization(...) - Summarizes or compresses a list of message dicts.
  2. manage_context(...)   - Ensures the conversation stays within token thresholds.
  3. token_limit_check(...) - Helper to trigger do_summarization() when near token limits.

This code has been trimmed to remove DB functions and response formatting that are now in db_utils.py
and response_utils.py.
"""

import logging
import json
from typing import List, Any, Union, AsyncGenerator, cast

# Unified token helpers
from utils.tokens import count_tokens_messages
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from utils.openai import openai_chat


logger = logging.getLogger(__name__)

# Recommended token threshold for summarization
CONVERSATION_TOKEN_LIMIT = 3000
SUMMARIZATION_CHUNK_SIZE = 1800  # Adjust as needed


async def do_summarization(
    messages: List[dict[str, str]], model_name: str = "o1"
) -> str:
    """
    Summarizes a list of conversation messages. This function calls openai_chat
    with a 'system' prompt instructing the model to produce a concise summary.

    :param messages: A list of dicts, each with { 'role': 'user'/'assistant'/'system', 'content': '...'}
    :param model_name: The Azure OpenAI model to use (e.g. "o1", "o3-mini", etc.).
    :return: A summarized string representing the conversation so far.
    """
    system_prompt = {
        "role": "developer",
        "content": (
            "Formatting re-enabled. You are a summarization assistant. Read the conversation below and provide a concise, coherent summary. "
            "Focus on key points and user requests, omitting extraneous details. Keep it under 200 tokens."
        ),
    }

    summarization_input = [system_prompt] + messages

    try:
        # Collect all response chunks from the async generator
        complete_response: dict[str, Any] = {}
        result: Union[
            dict[str, Any], AsyncGenerator[Union[dict[str, Any], bytes], None]
        ] = await openai_chat(
            messages=summarization_input,
            model_name=model_name,
            max_completion_tokens=300,
            reasoning_effort=None,
        )

        if isinstance(result, dict):
            # Non-streaming case - direct dictionary response
            complete_response = result
        else:
            # Streaming case - collect chunks from async generator
            async for chunk in result:
                if isinstance(chunk, (dict, bytes, bytearray, memoryview)):
                    if isinstance(chunk, dict):
                        complete_response.update(cast(dict[str, Any], chunk))
                    else:
                        try:
                            if isinstance(chunk, memoryview):
                                chunk = chunk.tobytes()
                            chunk_str = chunk.decode("utf-8")
                            chunk_dict = json.loads(chunk_str)
                            if isinstance(chunk_dict, dict):
                                complete_response.update(chunk_dict)
                        except (UnicodeDecodeError, json.JSONDecodeError) as e:
                            logger.error(f"Error decoding chunk: {e}")
                            continue

        summary_text = complete_response["choices"][0]["message"]["content"]
        return summary_text.strip()
    except Exception as e:
        logger.error(f"Error during summarization: {e}")
        return "Summary not available due to error."


class ContextTokenTracker:
    """Tracks token usage during context management"""

    def __init__(self, max_tokens: int):
        self.used_tokens = 0
        self.max_tokens = max_tokens

    def add_context(self, tokens: int) -> None:
        if self.used_tokens + tokens > self.max_tokens:
            raise ValueError(
                f"Token limit exceeded (used {self.used_tokens}/{self.max_tokens})"
            )
        self.used_tokens += tokens


# MOVED: trim_context_to_window() moved to services.context_manager for consolidation
# Import from services.context_manager if needed: from services.context_manager import trim_context_to_window


async def token_limit_check(chat_id: str, db: AsyncSession):
    """
    Helper to be called after inserting a new message in the DB.
    Retrieves messages, checks token usage, triggers summarization if needed.

    :param chat_id: The ID of the chat we just updated.
    :param db: The database session or context for retrieving messages.
    """
    query = text(
        """
    SELECT role, content
    FROM messages
    WHERE conversation_id=:chat_id
    ORDER BY created_at ASC
    """
    )
    result = await db.execute(query, {"chat_id": chat_id})
    rows = result.mappings().all()
    messages = [{"role": r["role"], "content": r["content"]} for r in rows]

    total_tokens = count_tokens_messages(messages)
    if total_tokens and total_tokens > CONVERSATION_TOKEN_LIMIT:
        # Context trimming (summarization) moved to trim_context_to_window; implement as needed in downstream code.
        logger.info(
            f"Context tokens {total_tokens} exceed limit for chat_id={chat_id}, but no legacy summarization performed."
        )
    else:
        logger.debug(
            f"No summarization needed for chat_id={chat_id}, tokens={total_tokens}"
        )
