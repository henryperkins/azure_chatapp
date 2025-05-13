```python
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
import tiktoken
from typing import List, Optional, Any, Union, AsyncGenerator, cast
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import json
from utils.openai import openai_chat


logger = logging.getLogger(__name__)

# Flag for tiktoken availability
TIKTOKEN_AVAILABLE = True

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
        result: Union[dict[str, Any], AsyncGenerator[Union[dict[str, Any], bytes], None]] = await openai_chat(
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


async def manage_context(
    messages: List[dict[str, str]],
    user_message: Optional[str] = None,
    search_results: Optional[dict[str, Any]] = None,
    max_tokens: Optional[int] = None,
) -> List[dict[str, str]]:
    """
    Ensures conversation messages do not exceed a token threshold by summarizing earlier segments.
    This modifies the conversation in-place by replacing older messages with a single summary if needed.

    :param messages: List of messages in chronological order.
    :return: Potentially reduced list of messages, with older parts summarized if necessary.
    """
    total_tokens = estimate_token_count(messages)
    if total_tokens <= CONVERSATION_TOKEN_LIMIT:
        return messages

    half_idx = len(messages) // 2
    partial_msgs = messages[:half_idx]

    # Summarize them using async summarization
    summary_text = await do_summarization(partial_msgs, model_name="o1")

    summary_system_msg = {
        "role": "system",
        "content": f"[Conversation so far summarized]: {summary_text}",
    }

    remainder = messages[half_idx:]
    new_conversation = [summary_system_msg] + remainder
    logger.info("Conversation was too large; older messages summarized.")
    # Store which chunks were used in the first new message
    if len(remainder) > 0 and remainder[0]["role"] == "user":
        # Type the message dictionary directly
        msg: dict[str, Any] = remainder[0]
        # Ensure search_results exists and has results
        chunk_ids = []
        if search_results and search_results.get("results"):
            chunk_ids = [
                str(r["id"]) for r in search_results["results"] if r and "id" in r
            ]

        msg["context_used"] = {
            "query": user_message,
            "chunk_ids": chunk_ids,
            "token_count": total_tokens,
            "summary": summary_text,
        }

    return new_conversation


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

    total_tokens = estimate_token_count(messages)
    if total_tokens and total_tokens > CONVERSATION_TOKEN_LIMIT:
        await manage_context(messages)
        # Replace older messages in DB or handle them as needed
        logger.info(
            f"Summarization triggered for chat_id={chat_id}, tokens={total_tokens}"
        )
    else:
        logger.debug(
            f"No summarization needed for chat_id={chat_id}, tokens={total_tokens}"
        )


def estimate_token_count(
    messages: List[dict[str, str]], model: str = "claude-3-sonnet-20240229"
) -> int:
    """
    Count tokens using available methods with proper fallback handling.

    Args:
        messages: List of message dicts with role/content
        model: Model name (for future model-specific handling)

    Returns:
        Token count estimate
    """
    # First try tiktoken if available
    if TIKTOKEN_AVAILABLE:
        try:
            encoding = tiktoken.get_encoding("cl100k_base")
            return sum(len(encoding.encode(msg.get("content", ""))) for msg in messages)
        except Exception as e:
            logger.debug(f"tiktoken failed: {str(e)}")

    # Fallback to rough estimate (4 chars ≈ 1 token)
    total = 0
    for msg in messages:
        content = msg.get("content", "")
        # Add message content tokens
        total += len(content) // 4
        # Add metadata tokens if present
        if "metadata" in msg and isinstance(msg["metadata"], dict):
            total += len(str(msg["metadata"])) // 8  # Rough estimate for metadata

    return total


async def estimate_tokens(text: str, model: str = "claude-3-sonnet-20240229") -> int:
    """Simplified version for single text strings"""
    if not text:
        return 0
    return estimate_token_count([{"role": "user", "content": text}], model)

```