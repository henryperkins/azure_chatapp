# -*- coding: utf-8 -*-
"""
knowledge_context_utils.py

This module provides utilities for integrating knowledge base context into AI interactions,
including retrieving context, augmenting conversation prompts, and calculating token counts.
It combines functionalities previously separated, related to model configuration,
knowledge retrieval, and token estimation.
"""

import logging

from typing import Any, List, Optional, Union
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload
from config import settings, Settings
from models.conversation import Conversation
# The utils.model_registry module may be stubbed or monkey-patched in unit tests
# (e.g. tests that only need get_model_config).  Access to
# `validate_model_and_params` is optional for those scenarios.  We therefore
# import it defensively so that the absence of the symbol does **not** break
# import-time execution – the missing function will only raise if actually
# called at runtime.

from utils.model_registry import get_model_config as _central_get_model_config

try:
    from utils.model_registry import validate_model_and_params as _central_validate  # type: ignore
except (ImportError, AttributeError):  # pragma: no cover
    # Provide a stub that immediately raises to preserve call-site semantics
    def _central_validate(*_a, **_kw):  # type: ignore[override]
        raise RuntimeError(
            "validate_model_and_params is unavailable in the current "
            "test context. This stub should never be invoked – if you see "
            "this error, adjust the test or provide a suitable monkeypatch."
        )
from utils.tokens import count_tokens_messages, count_tokens_text  # Canonical token counters

# Forward-compat shim – most helpers now live in *utils.model_registry* and
# *utils.tokens*.  We re-export them here so existing imports keep working.

# Central wrappers -----------------------------------------------------------

def get_model_config(model_name: str, config: Settings = settings):  # type: ignore[override]
    return _central_get_model_config(model_name, config)

validate_model_and_params = _central_validate  # alias for callers

# --- Backward compatibility: token counting wrapper ---

async def calculate_tokens(
    content: Union[str, List[dict[str, Any]]],
    model_id: Optional[str] = None,
) -> int:
    """
    Back-compat token estimator.

    Accepts either raw text or a list of message dicts and forwards to
    utils.tokens helpers.
    """
    if isinstance(content, list):
        return count_tokens_messages(content, model_id=model_id)
    return count_tokens_text(str(content), model_id=model_id)


# tiktoken is optional; utils.tokens handles absence gracefully.
# Remove this unused import if nothing in this file calls tiktoken directly.
# import tiktoken  # type: ignore  # noqa: F401 – retained for callers that import directly

# from utils.openai import count_claude_tokens # Keep if you implement specific Claude counting

# --- Constants ---
DEFAULT_KB_SEARCH_TOP_K = 5
DEFAULT_MAX_CONTEXT_TOKENS = 2000
DEFAULT_SCORE_THRESHOLD = 0.6
MIN_EXTENDED_THINKING_TOKENS = 1024  # Example minimum for extended thinking feature

# --- Logger Setup ---
logger = logging.getLogger(__name__)
# Ensure logging is configured elsewhere in your application entry point
# Example basic config (if run standalone, but usually configured globally):
# logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')


# --- Core Functions (legacy implementations kept for backward compatibility) ---

async def retrieve_knowledge_context(
    query: str,
    project_id: UUID,
    db: AsyncSession,
    top_k: int = DEFAULT_KB_SEARCH_TOP_K,
    score_threshold: float = DEFAULT_SCORE_THRESHOLD,
) -> str | None:
    """
    Retrieve relevant knowledge context chunks from a project's knowledge base.

    Searches the knowledge base associated with the project ID for context
    relevant to the query, filters by relevance score, and formats the results.

    Args:
        query: The user query to find relevant context for.
        project_id: The UUID of the project whose knowledge base should be searched.
        db: The asynchronous database session.
        top_k: The maximum number of search results to retrieve initially.
        score_threshold: The minimum relevance score for a chunk to be included.

    Returns:
        A formatted string containing the relevant context and sources,
        or None if no suitable context is found or an error occurs.
    """
    from services.knowledgebase_service import search_project_context  # noqa: E402

    if not all([query, project_id, db]):
        logger.warning("retrieve_knowledge_context called with missing arguments.")
        return None

    logger.info(
        f"Retrieving knowledge context for project {project_id} with query: '{query[:50]}...'"
    )

    try:
        # Call the knowledge base search service function
        search_results_data = await search_project_context(
            project_id=project_id, query=query, db=db, top_k=top_k
        )

        # Validate search results structure
        if not search_results_data or not isinstance(search_results_data, dict):
            logger.info(
                f"No valid search results structure returned for project {project_id}."
            )
            return None

        results_list = search_results_data.get("results")
        if not isinstance(results_list, list):
            logger.warning(
                f"Search results 'results' key is not a list for project {project_id}: {type(results_list)}"
            )
            return None

        if not results_list:
            logger.info(
                f"No knowledge context search results found for query in project {project_id}"
            )
            return None

        # Filter and format the results
        context_blocks = []
        valid_results_count = 0
        for i, result in enumerate(results_list):
            if not isinstance(result, dict):
                logger.warning(
                    f"Skipping invalid search result item (not a dict): {result}"
                )
                continue

            score = result.get("score", 0.0)
            text = result.get("text", "").strip()
            metadata = result.get("metadata", {})

            if not isinstance(metadata, dict):
                logger.warning(
                    f"Skipping result with invalid metadata (not a dict): {metadata}"
                )
                continue

            # Apply filtering
            if score < score_threshold:
                logger.debug(
                    f"Skipping result below threshold ({score:.2f} < {score_threshold}): {result.get('id', 'N/A')}"
                )
                continue
            if not text:
                logger.debug(
                    f"Skipping result with empty text: {result.get('id', 'N/A')}"
                )
                continue

            valid_results_count += 1
            filename = metadata.get(
                "file_name", metadata.get("source", "Unknown Source")
            )
            # Consider adding chunk ID or other metadata if useful
            context_blocks.append(
                f"[Source {valid_results_count}: {filename} (Score: {score:.2f})]\n{text}\n"
            )

        if not context_blocks:
            logger.info(
                f"No high-confidence knowledge context found after filtering (threshold: {score_threshold})."
            )
            return None

        # Combine blocks into a single context string
        context_header = "RELEVANT CONTEXT FROM PROJECT FILES:\n"
        context_text = context_header + "\n".join(context_blocks)
        logger.info(
            f"Retrieved {len(context_blocks)} relevant knowledge context blocks for project {project_id}."
        )
        return context_text

    except ImportError:
        # This might occur if knowledgebase_service is optional or fails to import
        logger.error("Knowledgebase service is not available or failed to import.")
        return None
    except Exception as e:
        logger.error(
            f"Error retrieving knowledge context for project {project_id}: {e}",
            exc_info=True,
        )
        return None


async def augment_with_knowledge(
    conversation_id: UUID,
    user_message: str,
    db: AsyncSession,
    max_context_tokens: int = DEFAULT_MAX_CONTEXT_TOKENS,
    model_config_override: dict[str, Any] | None = None,  # Allow passing specific model config
    results_limit: int = 5,
) -> list[dict[str, Any]]:
    """
    Augments a conversation prompt by retrieving and formatting relevant knowledge.

    Fetches the conversation, checks if knowledge base usage is enabled,
    searches the associated project's knowledge base, filters results by relevance
    and token limits, and formats them as system messages with metadata.

    Args:
        conversation_id: UUID of the conversation to augment.
        user_message: The user's message text (used for KB query).
        db: The asynchronous database session.
        max_context_tokens: The maximum number of tokens allowed for the added context.
        model_config_override: Optional dictionary with model config, e.g., for extended_thinking checks.

    Returns:
        A list of message dictionaries (role: 'system') containing the
        formatted knowledge context, ready to be prepended to the main prompt.
        Returns an empty list if KB is disabled, no context is found, or an error occurs.
    """
    logger.info(
        f"Attempting to augment conversation {conversation_id} with knowledge context."
    )

    try:
        # Load conversation with its project relationship eagerly
        conversation = await db.get(
            Conversation,
            conversation_id,
            options=[joinedload(Conversation.project)],  # Eager load project details
        )

        # --- Pre-checks ---
        if not conversation:
            logger.warning(f"Conversation {conversation_id} not found.")
            return []
        if not conversation.project_id:
            logger.warning(
                f"Conversation {conversation_id} is not associated with a project."
            )
            return []
        if not conversation.use_knowledge_base:
            logger.info(
                f"Knowledge base usage is disabled for conversation {conversation_id}."
            )
            return []

        project = conversation.project  # Access the eagerly loaded project
        if not project:
            logger.error(
                f"Project data could not be loaded for conversation {conversation_id}, project_id {conversation.project_id}."
            )
            return []
        if not project.knowledge_base_id:
            logger.info(
                f"Project {project.id} associated with conversation {conversation_id} does not have an active knowledge base ID."
            )
            return []

        # --- Retrieve KB context via shared helper ------------------------
        ctx_text = await retrieve_knowledge_context(
            query=user_message,
            project_id=project.id,        # type: ignore[arg-type]
            db=db,
            top_k=results_limit,
            score_threshold=DEFAULT_SCORE_THRESHOLD,
        )
        if not ctx_text:
            logger.info(
                f"No suitable knowledge context found for conversation {conversation_id}."
            )
            return []

        token_count = count_tokens_text(ctx_text)
        logger.debug(
            f"Injecting knowledge context into conversation {conversation_id} "
            f"({token_count} tokens)."
        )

        return [
            {
                "role": "system",
                "content": ctx_text,
                "metadata": {
                    "kb_context": True,
                    "tokens": token_count,
                },
            }
        ]
