import logging
from typing import Dict, Optional, List, Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from config import settings, Settings
from utils.openai import count_claude_tokens  # Use updated token counter if needed

logger = logging.getLogger(__name__)


def get_model_config(model_name: str, config: Settings) -> Optional[Dict[str, Any]]:
    """
    Retrieve model configuration from settings.
    """
    if model_name in config.AZURE_OPENAI_MODELS:
        return config.AZURE_OPENAI_MODELS[model_name]
    if model_name in config.CLAUDE_MODELS:
        return config.CLAUDE_MODELS[model_name]
    return None


async def retrieve_knowledge_context(
    query: str,
    project_id: Optional[UUID] = None,
    db: Optional[AsyncSession] = None,
    top_k: int = 3,
) -> Optional[str]:
    """
    Retrieve relevant knowledge context for a query if the project has a knowledge base.
    """
    if not project_id or not db or not query:
        return None

    try:
        from services import knowledgebase_service

        search_results_list = await knowledgebase_service.search_project_context(
            project_id=project_id, query=query, db=db, top_k=top_k
        )

        if not search_results_list:
            logger.info(f"No knowledge context found for query in project {project_id}")
            return None

        # Some results might come as a dict like {'results': [...]}
        results_to_process = search_results_list
        if isinstance(search_results_list, dict) and 'results' in search_results_list:
            results_to_process = search_results_list['results']

        if not isinstance(results_to_process, list):
            logger.warning(
                f"Unexpected format for search results: {type(results_to_process)}"
            )
            return None

        context_blocks = []
        for i, result in enumerate(results_to_process):
            if not isinstance(result, dict):
                logger.warning(f"Skipping invalid search result item: {result}")
                continue

            score = result.get("score", 0)
            # Adjust threshold if needed
            if score < 0.6:
                continue

            text = result.get("text", "")
            if not text:
                continue

            metadata = result.get("metadata", {})
            filename = "Unknown source"
            if isinstance(metadata, dict):
                filename = metadata.get("file_name", metadata.get("source", "Unknown source"))

            context_blocks.append(f"[Source {i + 1}: {filename}]\n{text}\n")

        if not context_blocks:
            logger.info("No high-confidence knowledge context found after filtering.")
            return None

        context_text = "RELEVANT CONTEXT FROM PROJECT FILES:\n\n" + "\n".join(context_blocks)
        logger.info(f"Retrieved {len(context_blocks)} knowledge context blocks.")
        return context_text

    except ImportError:
        logger.warning("Knowledgebase service not available.")
        return None
    except Exception as e:
        logger.error(f"Error retrieving knowledge context: {e}")
        return None


async def calculate_tokens(
    content: str,
    model_id: str,
    db: AsyncSession = None,
) -> int:
    """
    Calculate token usage for a given content string and model.
    Uses specific counters if available, otherwise estimates.
    """
    from .search_utils import get_model_config  # or refactor to avoid circular import if needed

    model_config = get_model_config(model_id, settings)
    if not model_config:
        logger.warning(f"Unknown model '{model_id}' for token calculation, using estimate.")
        return len(content) // 4

    provider = model_config.get("provider")
    try:
        if provider == "anthropic":
            # Fallback estimate for Claude, or integrate count_claude_tokens if ready
            logger.debug(f"Using estimate for Claude model {model_id}")
            return len(content) // 4

        elif provider == "azure":
            # Use tiktoken for Azure/OpenAI
            import tiktoken
            try:
                encoding = tiktoken.get_encoding("cl100k_base")
                return len(encoding.encode(content))
            except Exception as tiktoken_error:
                logger.warning(
                    f"Tiktoken encoding failed for model {model_id}: {tiktoken_error}. "
                    "Falling back to estimate."
                )
                return len(content) // 4

        else:
            logger.warning(
                f"Unknown provider '{provider}' for token calculation, using estimate."
            )
            return len(content) // 4

    except Exception as e:
        logger.warning(f"Token counting failed for model {model_id}, using estimate: {e}")
        return len(content) // 4
