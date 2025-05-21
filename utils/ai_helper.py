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

        # --- Search Knowledge Base ---
        logger.debug(f"Searching knowledge base for project {project.id}...")

        # Import here to fix Flake8/Pylint E402 outside-toplevel import error.
        from services.knowledgebase_service import search_project_context  # noqa: E402

        try:
            search_results_data = await search_project_context(
                project_id=project.id,
                query=user_message,
                db=db,
                top_k=DEFAULT_KB_SEARCH_TOP_K,
            )
            if not search_results_data or not isinstance(search_results_data, dict):
                logger.info(
                    f"No valid search results structure returned for project {project.id}."
                )
                return []

            results_list = search_results_data.get("results")
            if not isinstance(results_list, list):
                logger.warning(
                    f"Search results 'results' key is not a list for project {project.id}: {type(results_list)}"
                )
                return []
            if not results_list:
                logger.info(
                    f"No knowledge context search results found for query in project {project.id}"
                )
                return []

        except Exception as search_error:
            logger.error(
                f"Error searching knowledge base for project {project.id}: {search_error}",
                exc_info=True,
            )
            return []  # Stop augmentation if search fails

        # --- Format and Filter Results ---
        context_messages = []
        total_tokens = 0
        seen_sources = set()  # Simple deduplication based on source file and text hash

        # Sort by score descending to prioritize most relevant results
        sorted_results = sorted(
            results_list,
            key=lambda x: x.get("score", 0.0) if isinstance(x, dict) else 0.0,
            reverse=True,
        )[:results_limit]

        for idx, result in enumerate(sorted_results):
            # Stop if token budget is exceeded
            if total_tokens >= max_context_tokens:
                logger.info(
                    f"Reached max context token limit ({max_context_tokens}) for conversation {conversation_id}."
                )
                break

            # Validate result structure
            if not isinstance(result, dict):
                logger.warning(
                    f"Skipping invalid search result item (not a dict): {result}"
                )
                continue

            text = result.get("text", "").strip()
            metadata = result.get("metadata", {})
            score = result.get("score", 0.0)

            if not text or not isinstance(metadata, dict):
                logger.warning(
                    f"Skipping result with missing text or invalid metadata: {result}"
                )
                continue

            # Optional: Apply score threshold here as well if desired (retrieve_knowledge_context already does)
            # if score < DEFAULT_SCORE_THRESHOLD: continue

            source = metadata.get("file_name", "Unknown Source")
            file_id = metadata.get("file_id")  # Can be None

            # Deduplication check
            source_key = f"{source}:{hash(text) % 10000}"  # Simple hash-based key
            if source_key in seen_sources:
                logger.debug(f"Skipping duplicate content from source '{source}'.")
                continue
            seen_sources.add(source_key)

            # Calculate tokens for this chunk
            try:
                # Using estimate_token_count from utils.context as per original snippet
                # Consider switching to calculate_tokens defined above for consistency if appropriate
                result_tokens = count_tokens_messages(
                    [{"role": "system", "content": text}]
                )
                # result_tokens = await calculate_tokens(text, model_id="<relevant_model_id>") # Alternative
            except Exception as token_error:
                logger.warning(
                    f"Could not estimate token count for context chunk: {token_error}. Using estimate."
                )
                result_tokens = (len(text) + 3) // 4  # Fallback estimate

            # Check if adding this chunk exceeds the budget
            if total_tokens + result_tokens > max_context_tokens:
                logger.debug(
                    f"Skipping result due to token limit: Current {total_tokens}, Result {result_tokens}, Max {max_context_tokens}"
                )
                continue

            # --- Format the context message ---
            file_meta = {
                "kb_context": True,
                "source": source,
                "file_id": str(file_id) if file_id else None,
                "score": float(score),
                "tokens": result_tokens,
                "chunk_index": metadata.get("chunk_index"),
                "thinking_validated": False,
                "redacted_thinking": None,
            }
            # Handle extended thinking budget validation if enabled via model config
            current_model_config = model_config_override or get_model_config(
                project.default_model
            )
            if current_model_config and current_model_config.get("extended_thinking"):
                if result_tokens < MIN_EXTENDED_THINKING_TOKENS:
                    logger.warning(
                        f"Context chunk from '{source}' has insufficient tokens ({result_tokens}) "
                        f"for extended thinking (min {MIN_EXTENDED_THINKING_TOKENS})."
                    )
                else:
                    logger.debug(
                        f"Adding extended thinking metadata for chunk from '{source}'."
                    )
                    file_meta["thinking_budget"] = result_tokens
                    file_meta["requires_signature_verification"] = True

            context_msg = {
                "role": "system",
                "content": f"Relevant context from {source} (Score: {score:.2f}):\n{text}",
                "metadata": {"citation": f"[{idx}]", **file_meta},
            }

            context_messages.append(context_msg)
            total_tokens += result_tokens

        # --- Store results (optional, depends on requirements) ---
        # Storing results on the conversation object might have persistence implications.
        # Ensure the Conversation model supports this attribute and that changes are saved.
        if hasattr(conversation, "search_results"):
            try:
                conversation.search_results = {
                    "query": user_message,
                    "results_retrieved": len(results_list),
                    "results_used": len(context_messages),
                    "token_count": total_tokens,
                    # Optionally store the raw results_list if needed for debugging
                    # "raw_results": results_list
                }
                # IMPORTANT: If using SQLAlchemy, changes to the conversation object
                # might need explicit commit depending on session management.
                # Consider if this update should happen here or elsewhere.
                # Example:
                # db.add(conversation) # Add instance to session if modified
                # await db.flush() # Flush changes to DB if needed immediately
                # await db.commit() # Commit transaction if appropriate here
                logger.debug(
                    f"Stored search result summary on conversation {conversation_id}."
                )
            except Exception as store_err:
                logger.error(
                    f"Failed to store search results on conversation {conversation_id}: {store_err}",
                    exc_info=True,
                )
        else:
            logger.warning(
                f"Conversation object {conversation_id} does not have 'search_results' attribute for storing summary."
            )

        if context_messages:
            logger.info(
                f"Successfully augmented conversation {conversation_id} with {len(context_messages)} knowledge context messages ({total_tokens} tokens)."
            )
        else:
            logger.info(
                f"No suitable knowledge context found or added for conversation {conversation_id}."
            )

        return context_messages

    except Exception as e:
        logger.error(
            f"Critical error during knowledge augmentation for conversation {conversation_id}: {e}",
            exc_info=True,
        )
        return []  # Return empty list on unexpected errors


# --- End of Module ---
