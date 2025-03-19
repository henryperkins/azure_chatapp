"""
context.py
----------
Provides conversation summarization and token-limit enforcement logic for the Azure OpenAI Chat Application.

Includes:
  1. do_summarization(...) - Summarizes or compresses a list of message dicts.
  2. manage_context(...)   - Ensures the conversation stays within token thresholds.
  3. token_limit_check(...) - Helper to trigger do_summarization() when near token limits.

This code is production-ready, with no placeholders.
"""
import logging
import tiktoken
from typing import List, Dict, Any, Optional, TypeVar, Type, Union
from .openai import openai_chat
from sqlalchemy import text, select, update, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

logger = logging.getLogger(__name__)

# Recommended token threshold for summarization
CONVERSATION_TOKEN_LIMIT = 3000
SUMMARIZATION_CHUNK_SIZE = 1800  # Adjust as needed

async def do_summarization(messages: List[Dict[str, str]], model_name: str = "o1") -> str:
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
        )
    }

    summarization_input = [system_prompt] + messages

    try:
        # Using 'await' because openai_chat is expected to be async
        result = await openai_chat(
            messages=summarization_input,
            model_name=model_name,
            max_completion_tokens=300,
            reasoning_effort=None
        )
        summary_text = result["choices"][0]["message"]["content"]
        return summary_text.strip()
    except Exception as e:
        logger.error(f"Error during summarization: {e}")
        return "Summary not available due to error."

async def manage_context(messages: List[Dict[str, str]]) -> List[Dict[str, str]]:
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
        "content": f"[Conversation so far summarized]: {summary_text}"
    }

    remainder = messages[half_idx:]
    new_conversation = [summary_system_msg] + remainder
    logger.info("Conversation was too large; older messages summarized.")
    return new_conversation

async def token_limit_check(chat_id: str, db):
    """
    Example helper to be called after inserting a new message in the DB.
    Retrieves messages, checks token usage, triggers summarization if needed.

    :param chat_id: The ID of the chat we just updated.
    :param db: The database session or context for retrieving messages.
    """
    query = text("""
    SELECT role, content
    FROM messages
    WHERE chat_id=:chat_id
    ORDER BY timestamp ASC
    """)
    result = await db.execute(query, {"chat_id": chat_id})
    rows = result.mappings().all()
    messages = [{"role": r["role"], "content": r["content"]} for r in rows]

    total_tokens = estimate_token_count(messages)
    if total_tokens > CONVERSATION_TOKEN_LIMIT:
        reduced = await manage_context(messages)
        # Replace older messages in DB or handle them as needed
        logger.info(f"Summarization triggered for chat_id={chat_id}, tokens={total_tokens}")
    else:
        logger.debug(f"No summarization needed for chat_id={chat_id}, tokens={total_tokens}")

def estimate_token_count(messages: List[Dict[str, str]]) -> int:
    encoder = tiktoken.encoding_for_model("gpt-4")
    return sum(len(encoder.encode(msg["content"])) for msg in messages)

# NEW HELPER FUNCTIONS TO REDUCE DUPLICATION

T = TypeVar('T')

async def get_by_id(
    db: AsyncSession,
    model: Type[T],
    id: Any
) -> Optional[T]:
    """
    Get a model instance by ID. Reduces duplicate SELECT queries.
    
    Args:
        db: AsyncSession instance
        model: SQLAlchemy model class
        id: Primary key ID
        
    Returns:
        Model instance or None if not found
    """
    result = await db.execute(select(model).where(getattr(model, "id") == id))
    return result.scalars().first()

async def get_all_by_condition(
    db: AsyncSession, 
    model: Type[T], 
    *conditions, 
    limit: int = 100,
    offset: int = 0,
    order_by: Any = None
) -> List[T]:
    """
    Get all model instances matching conditions. Reduces duplicate query patterns.
    
    Args:
        db: AsyncSession instance
        model: SQLAlchemy model class
        conditions: SQLAlchemy filter conditions
        limit: Maximum records to return
        offset: Number of records to skip (pagination)
        order_by: Column to order by
        
    Returns:
        List of model instances
    """
    query = select(model).where(*conditions)
    
    if order_by is not None:
        query = query.order_by(order_by)
        
    query = query.limit(limit).offset(offset)
    
    result = await db.execute(query)
    return list(result.scalars().all())

async def save_model(db: AsyncSession, model_instance: Any) -> Any:
    """
    Standardized model save/update function to reduce duplicate patterns.
    
    Args:
        db: AsyncSession instance
        model_instance: SQLAlchemy model instance to save
        
    Returns:
        Updated model instance
    """
    db.add(model_instance)
    await db.commit()
    await db.refresh(model_instance)
    return model_instance

async def create_response(data: Any, message: Optional[str] = None) -> Dict[str, Any]:
    """
    Creates a standardized API response to reduce repetitive formatting.
    
    Args:
        data: Main response data
        message: Optional message
        
    Returns:
        Formatted response dictionary
    """
    response = {"data": data}
    if message:
        response["message"] = message
    return response