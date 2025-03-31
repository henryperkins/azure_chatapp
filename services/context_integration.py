"""
context_integration.py
----------------------
Handles integration between conversations and knowledge bases.
Manages context injection, token budgeting, and search result formatting.
"""

import logging
from typing import List, Dict, Optional, Any
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession

from models.conversation import Conversation
from services.knowledgebase_service import search_project_context
from utils.context import estimate_token_count

logger = logging.getLogger(__name__)

async def augment_with_knowledge(
    conversation_id: UUID,
    user_message: str,
    db: AsyncSession,
    max_context_tokens: int = 2000  # Default token budget for KB context
) -> List[Dict[str, Any]]:
    """
    Retrieves and formats relevant knowledge for a conversation.
    
    Args:
        conversation_id: ID of the conversation
        user_message: The user's message text
        db: Database session
        max_context_tokens: Optional token limit for context
        
    Returns:
        List of message dicts with injected knowledge context
    """
    from sqlalchemy.orm import joinedload
    from services import knowledgebase_service

    try:
        # Load conversation with project relationship
        conversation = await db.get(Conversation, conversation_id, options=[joinedload(Conversation.project)])
        if not conversation or not conversation.project_id:
            logger.warning(f"Conversation {conversation_id} has no project")
            return []  # No KB for standalone conversations

        if not conversation.use_knowledge_base:
            return []

        # Verify project has an active knowledge base
        if not conversation.project.knowledge_base_id:
            return []

        try:
            # Search knowledge base
            search_results = await search_project_context(
                project_id=UUID(str(conversation.project_id)),
                query=user_message, 
                db=db,
                top_k=5  # Default to 5 results
            )
            
            if not search_results.get("results"):
                return []
        except Exception as e:
            logger.error(f"Error searching knowledge base: {str(e)}")
            return []

        # Format and prioritize results
        context_messages = []
        total_tokens = 0
        seen_sources = set()

        for result in sorted(search_results["results"], 
                           key=lambda x: x.get("score", 0), 
                           reverse=True):
            if total_tokens >= max_context_tokens:
                break

            text = result["text"]
            source = result.get("metadata", {}).get("file_name", "unknown")
            
            # Dedupe similar content from same source
            source_key = f"{source}:{hash(text) % 10000}"
            if source_key in seen_sources:
                continue
            seen_sources.add(source_key)

            # Calculate tokens and check budget
            result_tokens = estimate_token_count([
                {"role": "system", "content": text}
            ])
            if total_tokens + result_tokens > max_context_tokens:
                continue

            # Format as system message with metadata
            context_msg = {
                "role": "system",
                "content": f"Relevant context from {source}:\n{text}",
                "metadata": {
                    "kb_context": True,
                    "source": source,
                    "file_id": result.get("metadata", {}).get("file_id"),
                    "score": float(result.get("score", 0)),
                    "tokens": result_tokens,
                    "chunk_index": result.get("metadata", {}).get("chunk_index")
                }
            }
            context_messages.append(context_msg)
            total_tokens += result_tokens
            total_tokens += result_tokens
            
        # Store search results in conversation
        conversation.search_results = {
            "query": user_message,
            "results": search_results["results"],
            "token_count": total_tokens
        }
        
        return context_messages
        
    except Exception as e:
        logger.error(f"Error augmenting with knowledge: {str(e)}")
        return []
        
    except Exception as e:
        logger.error(f"Error augmenting with knowledge: {str(e)}")
        return []
