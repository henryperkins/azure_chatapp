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
from typing import List, Dict, Optional, Any
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .openai import openai_chat


logger = logging.getLogger(__name__)

# Flag for tiktoken availability
TIKTOKEN_AVAILABLE = True

# Recommended token threshold for summarization
CONVERSATION_TOKEN_LIMIT = 3000
SUMMARIZATION_CHUNK_SIZE = 1800  # Adjust as needed


async def do_summarization(
    messages: List[Dict[str, str]], model_name: str = "o1"
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
        # Using 'await' because openai_chat is expected to be async
        result = await openai_chat(
            messages=summarization_input,
            model_name=model_name,
            max_completion_tokens=300,
            reasoning_effort=None,
        )
        summary_text = result["choices"][0]["message"]["content"]
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
            raise ValueError(f"Token limit exceeded (used {self.used_tokens}/{self.max_tokens})")
        self.used_tokens += tokens

async def manage_context(
    messages: List[Dict[str, str]],
    user_message: Optional[str] = None,
    search_results: Optional[Dict[str, Any]] = None,
    max_tokens: Optional[int] = None
) -> List[Dict[str, str]]:
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
            chunk_ids = [str(r["id"]) for r in search_results["results"] if r and "id" in r]
        
        msg["context_used"] = {
            "query": user_message,
            "chunk_ids": chunk_ids,
            "token_count": total_tokens,
            "summary": summary_text
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
    if total_tokens > CONVERSATION_TOKEN_LIMIT:
        await manage_context(messages)
        # Replace older messages in DB or handle them as needed
        logger.info(
            f"Summarization triggered for chat_id={chat_id}, tokens={total_tokens}"
        )
    else:
        logger.debug(
            f"No summarization needed for chat_id={chat_id}, tokens={total_tokens}"
        )


async def estimate_token_count(messages: List[Dict[str, str]], model: str = "claude-3-sonnet-20240229") -> int:
    """
    Count tokens using Claude's API with proper fallback handling
    
    Args:
        messages: List of message dicts with role/content
        model: Claude model name
        
    Returns:
        Accurate token count when possible, fallback estimate otherwise
    """
    try:
        # Use Claude's official token counting endpoint
        response = await api_request(
            "/v1/messages/count_tokens",
            "POST",
            {
                "model": model,
                "messages": messages,
                "thinking": {
                    "type": "enabled",
                    "budget_tokens": 1024  # Minimum for counting purposes
                } if any(m.get('thinking') for m in messages) else None
            }
        )
        return response["input_tokens"]
    except Exception as e:
        logger.warning(f"Token counting API failed, falling back to estimation: {str(e)}")
        # Fallback to tiktoken if available
        if TIKTOKEN_AVAILABLE:
            try:
                encoding = tiktoken.get_encoding("cl100k_base")
                return sum(len(encoding.encode(msg["content"])) for msg in messages)
            except Exception:
                pass
        # Final fallback
        return sum(len(msg["content"]) // 4 for msg in messages)

async def estimate_tokens(text: str, model: str = "claude-3-sonnet-20240229") -> int:
    """Count tokens with model-specific handling"""
    if not text:
        return 0
    return await estimate_token_count([{"role": "user", "content": text}], model)
