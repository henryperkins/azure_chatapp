"""
context_integration.py
----------------------
Handles integration between conversations and knowledge bases.
Manages context injection, token budgeting, and search result formatting.
"""

import logging
from typing import List, Dict, Optional
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
    max_context_tokens: Optional[int] = None
) -> List[Dict[str, str]]:
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
    conversation = await db.get(Conversation, conversation_id)
    if not conversation or not conversation.project_id:
        return []  # No KB for standalone conversations

    if not conversation.use_knowledge_base:
        return []

    # Get project ID from conversation
    if not conversation.project_id:
        logger.warning(f"Conversation {conversation_id} has no project")
        return []
    
    try:
        # Search knowledge base
        search_results = await search_project_context(
            project_id=conversation.project_id,
            query=user_message,
            db=db,
            top_k=5  # Default to 5 results
        )
        
        if not search_results.get("results"):
            return []

        # Format results as context messages
        context_messages = []
        total_tokens = 0
        
        for result in search_results["results"]:
            # Estimate tokens for this result
            result_tokens = estimate_token_count([
                {"role": "user", "content": result["text"]}
            ])
            
            # Check token budget if specified
            if max_context_tokens and (total_tokens + result_tokens) > max_context_tokens:
                break
                
            context_messages.append({
                "role": "system",
                "content": f"Knowledge base context: {result['text']}",
                "metadata": {
                    "source": "knowledge_base",
                    "file_id": result.get("metadata", {}).get("file_id"),
                    "score": result.get("score")
                }
            })
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
