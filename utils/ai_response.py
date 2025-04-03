"""
ai_response.py
------------
Handles AI response generation logic for chat conversations.
Centralizes OpenAI API calls and response processing.

This module supports:
- Knowledge base context retrieval
- Extended thinking with Claude
- Vision processing with OpenAI
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
from utils.message_handlers import (
    get_conversation_messages,
    update_project_token_usage
)

logger = logging.getLogger(__name__)


async def retrieve_knowledge_context(
    query: str,
    project_id: Optional[UUID] = None,
    db: Optional[AsyncSession] = None,
    top_k: int = 3
) -> Optional[str]:
    """
    Retrieve relevant knowledge context for a query if project has knowledge base.
    
    Args:
        query: User query to search for context
        project_id: Optional project ID to search within
        db: Database session
        top_k: Number of top results to include
        
    Returns:
        Formatted context string or None if no relevant context found
    """
    if not project_id or not db:
        return None
        
    try:
        # Import here to avoid circular imports
        from services import knowledgebase_service
        
        # Search for context
        search_results = await knowledgebase_service.search_project_context(
            project_id=project_id,
            query=query,
            db=db,
            top_k=top_k
        )
        
        if not search_results:
            return None
            
        # Format context for inclusion in the prompt
        context_blocks = []
        for i, result in enumerate(search_results):
            # Skip if result is not a dictionary
            if not isinstance(result, dict):
                continue
                
            # Only include high confidence results (score > 0.6)
            score = result.get("score", 0) if isinstance(result, dict) else 0
            if score < 0.6:
                continue
                
            text = result.get("text", "") if isinstance(result, dict) else ""
            if not text:
                continue
                
            # Get file info if available
            file_info = result.get("file_info", {}) if isinstance(result, dict) else {}
            filename = file_info.get("filename", "Unknown source") if isinstance(file_info, dict) else "Unknown source"
            
            # Add context block with source attribution
            context_blocks.append(f"[Source {i + 1}: {filename}]\n{text}\n")
            
        if not context_blocks:
            return None
            
        # Combine all context blocks with a header
        context_text = "RELEVANT CONTEXT FROM PROJECT FILES:\n\n" + "\n".join(context_blocks)
        return context_text
    except Exception as e:
        logger.error(f"Error retrieving knowledge context: {e}")
        return None


async def generate_ai_response(
    conversation_id: UUID,
    messages: List[Dict[str, str]],
    model_id: Optional[str],
    image_data: Optional[str] = None,
    vision_detail: str = "auto",
    enable_thinking: Optional[bool] = None,
    thinking_budget: Optional[int] = None,
    db: Optional[AsyncSession] = None
) -> Optional[Message]:
    """
    Generate an AI response for a conversation using OpenAI or Claude API.
    
    Args:
        conversation_id: Conversation ID
        messages: List of message dictionaries
        model_id: Model ID for OpenAI or Claude
        image_data: Optional base64 image data for vision
        vision_detail: Detail level for vision
        enable_thinking: Whether to enable extended thinking
        thinking_budget: Budget for extended thinking in tokens
        db: Database session
        
    Returns:
        Created assistant Message object or None if error
    """
    # Handle vision data by selecting o1 when image is provided
    chosen_model = "o1" if image_data else (model_id or "claude-3-7-sonnet-20250219")  # Default to Claude 3.7 Sonnet
    
    try:
        # Get conversation to check for project context
        conversation = await get_by_id(db, Conversation, conversation_id) if db else None
        project_id = conversation.project_id if conversation else None
        
        # Get the last user message to use for context retrieval
        last_user_message = None
        for msg in reversed(messages):
            if msg["role"] == "user":
                last_user_message = msg["content"]
                break
                
        # Retrieve knowledge context if available
        knowledge_context = None
        if project_id and last_user_message and db:
            try:
                # Ensure project_id is proper UUID
                from uuid import UUID
                project_uuid = UUID(str(project_id)) if project_id else None
                knowledge_context = await retrieve_knowledge_context(
                    query=last_user_message,
                    project_id=project_uuid,
                    db=db
                )
            except (ValueError, AttributeError):
                pass
            
        # Inject knowledge context as a system message if available
        if knowledge_context:
            # Find the right place to insert the context - after system message but before user messages
            system_message_found = False
            inject_index = 0
            
            for i, msg in enumerate(messages):
                if msg["role"] == "system":
                    system_message_found = True
                    inject_index = i + 1
                elif not system_message_found and msg["role"] == "user":
                    inject_index = i
                    break
                    
            # Insert the context message
            messages.insert(inject_index, {
                "role": "system",
                "content": knowledge_context
            })
        
        # Check if it's a supported Claude model
        is_claude_model = chosen_model in CLAUDE_MODELS
        
        if is_claude_model:
            # Call Claude API with model-specific settings
            logger.info(f"Generating response using Claude model: {chosen_model}")
        
            # Use larger max_tokens for Claude 3.7 Sonnet
            max_response_tokens = 4000 if chosen_model == "claude-3-7-sonnet-20250219" else 1500
        
            claude_response = await claude_chat(
                messages=messages,
                model_name=chosen_model,
                max_tokens=max_response_tokens,
                enable_thinking=enable_thinking if enable_thinking is not None else settings.CLAUDE_EXTENDED_THINKING_ENABLED,
                thinking_budget=thinking_budget if thinking_budget is not None else settings.CLAUDE_EXTENDED_THINKING_BUDGET,
                image_data=image_data,
                stream=False  # WebSocket handles streaming separately
            )
            assistant_content = claude_response["choices"][0]["message"]["content"]
            
            # Extract thinking blocks if available
            thinking_content = claude_response.get("thinking")
            redacted_thinking = claude_response.get("redacted_thinking")
            has_thinking = claude_response.get("has_thinking", False)
        else:
            # Call OpenAI API
            logger.info(f"Generating response using OpenAI model: {chosen_model}")
            openai_response = await openai_chat(
                messages=messages,
                model_name=chosen_model,
                image_data=image_data,
                vision_detail=vision_detail
            )
            assistant_content = openai_response["choices"][0]["message"]["content"]
        
        # Create assistant message
        message_metadata = {}
        
        # Initialize thinking variables
        thinking_content = None
        redacted_thinking = None
        has_thinking = False
        
        # Include thinking blocks in metadata if available
        if is_claude_model and (thinking_content or redacted_thinking or has_thinking):
            message_metadata["has_thinking"] = has_thinking
            
            if thinking_content:
                message_metadata["thinking"] = thinking_content
                
            if redacted_thinking:
                message_metadata["redacted_thinking"] = redacted_thinking
                
        # Include knowledge context info if used
        if knowledge_context:
            message_metadata["used_knowledge_context"] = True
        
        assistant_msg = Message(
            conversation_id=conversation_id,
            role="assistant",
            content=assistant_content,
            extra_data=message_metadata if message_metadata else None
        )
        
        # Save using utility function if db session provided
        if db:
            await save_model(db, assistant_msg)
            
            # Update token usage if applicable - use more accurate estimation for Claude 3.7
            if conversation and conversation.project_id:
                if is_claude_model and chosen_model == "claude-3-7-sonnet-20250219":
                    token_estimate = len(assistant_content) // 3  # More accurate for Claude 3.7
                else:
                    token_estimate = len(assistant_content) // 4
                await update_project_token_usage(conversation, token_estimate, db)
        
        return assistant_msg
    except Exception as e:
        logger.error(f"Error generating AI response: {e}")
        return None


async def handle_websocket_response(
    conversation_id: UUID,
    db: AsyncSession,
    websocket: WebSocket
) -> None:
    """
    Handle AI response generation for WebSocket connections (OpenAI or Claude).
    
    Args:
        conversation_id: Conversation ID
        db: Database session
        websocket: WebSocket connection
    """
    try:
        # Get conversation
        conversation = await get_by_id(db, Conversation, conversation_id)
        if not conversation:
            await websocket.send_json(
                await create_standard_response(None, "Conversation not found", False)
            )
            return
            
        # Get formatted messages for API
        msg_dicts = await get_conversation_messages(conversation_id, db)
        
        # Log which model is being used
        logger.info(f"WebSocket using model: {conversation.model_id}")
        
        # Use stored thinking preference or get it from user model or project preference
        enable_thinking = None  # Let the default logic apply
        thinking_budget = None
        
        # Get project if available to apply project-specific settings
        project = None
        if conversation.project_id:
            project = None
            if conversation.project_id:
                try:
                    # Ensure project_id is proper UUID
                    from uuid import UUID
                    project_uuid = UUID(str(conversation.project_id))
                    project = await get_by_id(db, Project, project_uuid)
                except (ValueError, AttributeError):
                    pass
            if project and project.extra_data:
                # Extract project-specific thinking settings if available
                project_settings = project.extra_data.get("ai_settings", {})
                if "extended_thinking" in project_settings:
                    enable_thinking = project_settings["extended_thinking"]
                if "thinking_budget" in project_settings:
                    thinking_budget = project_settings["thinking_budget"]
        
        # Generate AI response (function now handles both Claude and OpenAI)
        assistant_msg = await generate_ai_response(
            conversation_id=conversation_id,
            messages=msg_dicts,
            model_id=conversation.model_id,
            enable_thinking=enable_thinking,
            thinking_budget=thinking_budget,
            db=db
        )
        
        if assistant_msg:
            # Send response via WebSocket
            response_data = {
                "id": str(assistant_msg.id),
                "role": assistant_msg.role,
                "content": assistant_msg.content,
                "type": "message"  # Add type for consistent handling in frontend
            }
            
            # Include thinking blocks if available
            metadata = assistant_msg.get_metadata_dict()
            if metadata.get("has_thinking"):
                if "thinking" in metadata:
                    response_data["thinking"] = metadata["thinking"]
                if "redacted_thinking" in metadata:
                    response_data["redacted_thinking"] = metadata["redacted_thinking"]
                    
            # Include knowledge context flag if used
            if metadata.get("used_knowledge_context"):
                response_data["used_knowledge_context"] = "true"
            
            await websocket.send_json(response_data)
        else:
            await websocket.send_json({
                "type": "error",
                "content": "Failed to generate AI response"
            })
    except Exception as e:
        logger.error(f"WebSocket AI response error: {e}")
        await websocket.send_json({
            "type": "error",
            "content": f"Error generating response: {str(e)}"
        })
