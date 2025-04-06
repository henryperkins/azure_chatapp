# MODIFIED: ai_response.py
# Reason: Pass correct params based on model config, handle token calculation and usage update.

import logging
from typing import Dict, Optional, List, Any, Union
from uuid import UUID

from fastapi import WebSocket, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from models.conversation import Conversation
from models.message import Message
from models.project import Project
from utils.openai import openai_chat, count_claude_tokens # Use updated openai_chat and token counter
from config import settings, Settings # Import settings
from utils.db_utils import get_by_id, save_model
from utils.response_utils import create_standard_response
from utils.message_handlers import get_conversation_messages, update_project_token_usage

logger = logging.getLogger(__name__)


# Helper to get model config safely (could be moved to a shared utils)
def get_model_config(model_name: str, config: Settings) -> Optional[Dict[str, Any]]:
    """Retrieve model configuration from settings."""
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
    (Keep existing implementation)
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

        # Format context blocks
        context_blocks = []
        # search_results is often a dict like {'results': [...]}, adjust if needed
        results_to_process = search_results_list
        if isinstance(search_results_list, dict) and 'results' in search_results_list:
            results_to_process = search_results_list['results']

        if not isinstance(results_to_process, list):
             logger.warning(f"Unexpected format for search results: {type(results_to_process)}")
             return None

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

            # Get source info robustly
            metadata = result.get("metadata", {})
            filename = "Unknown source"
            if isinstance(metadata, dict):
                 filename = metadata.get("file_name", metadata.get("source", "Unknown source"))

            context_blocks.append(f"[Source {i + 1}: {filename}]\n{text}\n")

        if not context_blocks:
            logger.info(f"No high-confidence knowledge context found after filtering.")
            return None

        context_text = "RELEVANT CONTEXT FROM PROJECT FILES:\n\n" + "\n".join(
            context_blocks
        )
        logger.info(f"Retrieved {len(context_blocks)} knowledge context blocks.")
        return context_text

    except ImportError:
         logger.warning("Knowledgebase service not available.")
         return None
    except Exception as e:
        logger.error(f"Error retrieving knowledge context: {e}")
        return None


async def calculate_tokens(content: str, model_id: str, db: AsyncSession = None) -> int:
    """
    Calculate token usage for a given content string and model.
    Uses specific counters if available, otherwise estimates.

    Args:
        content: Text content for which to count tokens.
        model_id:   Model identifier (e.g., 'claude-3-7-sonnet-20250219').
        db:      DB session (optional, currently unused but for future expansion).

    Returns:
        Estimated number of tokens used.
    """
    model_config = get_model_config(model_id, settings)
    if not model_config:
        logger.warning(f"Unknown model '{model_id}' for token calculation, using estimate.")
        return len(content) // 4

    provider = model_config.get("provider")

    try:
        if provider == "anthropic":
            # Use Claude specific counter if implemented, otherwise estimate
            # return await count_claude_tokens(messages=[{"role": "assistant", "content": content}], model_name=model_id)
            logger.debug(f"Using estimate for Claude model {model_id}")
            return len(content) // 4 # Fallback estimate for Claude
        elif provider == "azure":
            # Use tiktoken for Azure/OpenAI models
            import tiktoken
            try:
                # Use cl100k_base encoding for GPT-3.5+, GPT-4, Claude v2+
                encoding = tiktoken.get_encoding("cl100k_base")
                return len(encoding.encode(content))
            except Exception as tiktoken_error:
                logger.warning(f"Tiktoken encoding failed for model {model_id}: {tiktoken_error}. Falling back to estimate.")
                return len(content) // 4
        else:
             logger.warning(f"Unknown provider '{provider}' for token calculation, using estimate.")
             return len(content) // 4

    except Exception as e:
        logger.warning(f"Token counting failed for model {model_id}, using estimate: {e}")
        return len(content) // 4


async def generate_ai_response(
    conversation_id: UUID,
    messages: List[Dict[str, Any]], # Allow Any for potential image data dicts
    model_id: str, # Explicitly require model_id
    db: AsyncSession, # Make DB session required
    # Optional parameters matching frontend/API capabilities
    image_data: Optional[Union[str, List[str]]] = None,
    vision_detail: Optional[str] = "auto",
    enable_thinking: Optional[bool] = None,
    thinking_budget: Optional[int] = None,
    enable_markdown_formatting: Optional[bool] = False, # For Azure reasoning markdown
    stream: bool = False, # Controls if openai_chat returns generator
    max_tokens: Optional[int] = None, # User requested max output tokens
    reasoning_effort: Optional[str] = None, # low, medium, high
    temperature: Optional[float] = None, # Allow overriding default temperature
    # Add other passthrough parameters if needed (top_p, etc.)
    **kwargs
) -> Optional[Message]:
    """
    Generate AI response, handling model specifics based on config.settings.

    Args:
        conversation_id: Conversation UUID.
        messages: List of message dicts (role, content). Content can be string or list for vision.
        model_id: Model identifier (e.g., 'o1', 'claude-3-7-sonnet-20250219').
        db: Async DB session.
        image_data: Base64-encoded image data or list for vision tasks.
        vision_detail: Vision detail setting ('auto', 'low', 'high').
        enable_thinking: Enable extended thinking for supported Claude models.
        thinking_budget: Budget for extended thinking in tokens.
        enable_markdown_formatting: Hint for Azure reasoning models to use markdown.
        stream: Whether to request a streaming response. (NOTE: This function returns Message, not stream)
        max_tokens: Max tokens for generation override.
        reasoning_effort: Reasoning effort for supported Azure models.
        temperature: Temperature override.
        kwargs: Additional parameters passed to the model API if supported.

    Returns:
        A newly created assistant Message object, or None if an error occurs.
    """
    if not db:
        logger.error("Database session is required for generate_ai_response.")
        # Raise error or return None? Returning None for now.
        return None

    # Retrieve conversation
    conversation = await get_by_id(db, Conversation, conversation_id)
    if not conversation:
        logger.error(f"Conversation not found: {conversation_id}")
        return None

    # Get model configuration from settings
    model_config = get_model_config(model_id, settings)
    if not model_config:
         logger.error(f"Configuration not found for model: {model_id}")
         # Maybe fallback to a default model or raise? Raising is safer.
         raise HTTPException(status_code=400, detail=f"Invalid or unsupported model_id: {model_id}")

    provider = model_config.get("provider")
    logger.info(f"Generating AI response for conversation {conversation_id} using {provider} model: {model_id}")


    # --- 1) Prepare messages (including knowledge context) ---
    final_messages = list(messages) # Create a copy to modify

    # Inject knowledge context if applicable
    project_id = conversation.project_id
    if project_id and conversation.use_knowledge_base:
        last_user_message_content = next(
            (msg.get("content") for msg in reversed(final_messages) if msg.get("role") == "user" and isinstance(msg.get("content"), str)),
            None
        )
        if last_user_message_content:
            try:
                project_uuid = UUID(str(project_id))
                knowledge_context_str = await retrieve_knowledge_context(
                    query=last_user_message_content, project_id=project_uuid, db=db
                )
                if knowledge_context_str:
                    # Inject after system message or at the beginning
                    system_indices = [i for i, m in enumerate(final_messages) if m.get("role") == "system"]
                    insert_index = system_indices[-1] + 1 if system_indices else 0
                    final_messages.insert(insert_index, {"role": "system", "content": knowledge_context_str})
                    logger.info("Injected knowledge base context.")
            except (ValueError, AttributeError, ImportError) as e:
                 logger.error(f"Failed to retrieve or inject knowledge context: {e}")
            except Exception as e:
                 logger.exception(f"Unexpected error during knowledge context retrieval: {e}")


    # --- 2) Prepare parameters for the API call ---
    api_params = {
        "messages": final_messages,
        "model_name": model_id,
        "stream": stream, # Pass stream flag
        "image_data": image_data,
        "vision_detail": vision_detail,
        "max_tokens": max_tokens, # Pass user override
        "temperature": temperature, # Pass user override
        **kwargs # Pass any other specific params from caller
    }

    # Add provider-specific parameters based on model config
    capabilities = model_config.get("capabilities", [])

    if provider == "azure":
        if "reasoning_effort" in capabilities and reasoning_effort:
            api_params["reasoning_effort"] = reasoning_effort
        if "developer_messages" in capabilities and enable_markdown_formatting:
             api_params["enable_markdown_formatting"] = True # Hint for openai.py
             # openai.py will modify the message list based on this flag
             # Ensure first message is system or user to allow modification
             if final_messages and final_messages[0].get("role") not in ["system", "user"]:
                  logger.warning("Cannot enable markdown formatting hint: First message is not system/user.")
                  api_params.pop("enable_markdown_formatting", None)

    elif provider == "anthropic":
        if "extended_thinking" in capabilities:
            # Use passed value or default from settings
            final_enable_thinking = enable_thinking if enable_thinking is not None else settings.CLAUDE_EXTENDED_THINKING_ENABLED
            if final_enable_thinking:
                 api_params["enable_thinking"] = True
                 # Use passed budget or default from settings
                 final_thinking_budget = thinking_budget if thinking_budget is not None else settings.CLAUDE_EXTENDED_THINKING_BUDGET
                 api_params["thinking_budget"] = final_thinking_budget


    # --- 3) Call the appropriate model API ---
    assistant_content = ""
    thinking_content = None
    redacted_thinking = None
    has_thinking = False
    response_usage = None
    response_id = None
    stop_reason = None

    try:
        # Use the unified openai_chat function
        response_data = await openai_chat(**api_params)

        # Handle response (assuming non-streaming for Message object return)
        # If streaming is used, this function's purpose changes, or needs adaptation
        if stream:
            # This function is designed to return a Message object, not a stream.
            # If streaming is required, the caller (e.g., WebSocket handler)
            # should handle the stream directly from openai_chat.
            logger.error("Streaming requested but generate_ai_response returns a Message object, not a stream.")
            # For now, we'll raise an error or return None.
            # Alternatively, consume the stream here (inefficient) to build the Message.
            # Let's return None for now to indicate mismatch.
            # raise NotImplementedError("generate_ai_response does not support returning streams directly.")
            logger.warning("Streaming output requested. This function will consume the stream to create a Message object.")
            full_content = ""
            async for chunk_bytes in response_data:
                # Basic SSE parsing assumption
                lines = chunk_bytes.decode('utf-8').splitlines()
                for line in lines:
                    if line.startswith('data: '):
                        try:
                            data_str = line[len('data: '):]
                            if data_str.strip() == '[DONE]':
                                break
                            chunk_data = json.loads(data_str)
                            delta = chunk_data.get('choices', [{}])[0].get('delta', {})
                            if 'content' in delta:
                                full_content += delta['content']
                            # TODO: Extract usage, stop_reason etc. from final chunk if available
                        except json.JSONDecodeError:
                            logger.warning(f"Failed to decode stream chunk: {line}")
                        except Exception as e:
                            logger.error(f"Error processing stream chunk: {e}")
                            break # Stop processing stream on error
            assistant_content = full_content
            # Usage data might be lost or require specific handling in streaming

        elif isinstance(response_data, dict):
            # Standard non-streaming response
            response_id = response_data.get("id")
            response_usage = response_data.get("usage")
            stop_reason = response_data.get("stop_reason") # Claude format
            choices = response_data.get("choices", [])

            if choices:
                message_data = choices[0].get("message", {})
                assistant_content = message_data.get("content", "")
                # Claude thinking blocks are parsed in openai.py into top-level keys
                thinking_content = response_data.get("thinking")
                redacted_thinking = response_data.get("redacted_thinking")
                has_thinking = response_data.get("has_thinking", False)
                # Use finish_reason if stop_reason isn't present (OpenAI format)
                if not stop_reason:
                     stop_reason = choices[0].get("finish_reason")
            else:
                 logger.error(f"No 'choices' found in AI response: {response_data}")
                 assistant_content = "[Error: No response content generated]"
                 stop_reason = "error"
        else:
             logger.error(f"Unexpected response type from openai_chat: {type(response_data)}")
             assistant_content = "[Error: Unexpected response format]"
             stop_reason = "error"


        # --- 4) Construct and save the assistant message ---
        metadata = {}
        if knowledge_context_str: # Check if context was actually added
            metadata["used_knowledge_context"] = True
        if has_thinking:
            metadata["has_thinking"] = True
        if thinking_content:
            metadata["thinking"] = thinking_content # Store raw thinking
        if redacted_thinking:
            metadata["redacted_thinking"] = redacted_thinking # Store redacted
        if response_usage:
             metadata["usage"] = response_usage # Store token usage
        if response_id:
             metadata["response_id"] = response_id
        if stop_reason:
             metadata["stop_reason"] = stop_reason

        assistant_msg = Message(
            conversation_id=conversation_id,
            role="assistant",
            content=assistant_content or "[No content generated]", # Ensure content is not empty
            extra_data=metadata if metadata else None,
        )

        # Attach metadata directly to the object for potential use before saving
        # (e.g., in conversation_service)
        assistant_msg.thinking = thinking_content
        assistant_msg.redacted_thinking = redacted_thinking
        assistant_msg.metadata_dict = metadata # Store parsed metadata


        await save_model(db, assistant_msg)
        logger.info(f"Saved assistant message {assistant_msg.id} for conversation {conversation_id}")

        # --- 5) Update token usage ---
        prompt_tokens = response_usage.get("prompt_tokens", 0) if response_usage else 0
        completion_tokens = response_usage.get("completion_tokens", 0) if response_usage else 0
        # Include reasoning tokens if available (from Azure o-series)
        reasoning_tokens = response_usage.get("reasoning_tokens", 0) if response_usage else 0
        total_used = completion_tokens + reasoning_tokens # Count generated + internal reasoning

        # If usage data is missing, estimate completion tokens
        if not response_usage and assistant_content:
             completion_tokens = await calculate_tokens(assistant_content, model_id, db)
             total_used = completion_tokens
             logger.warning(f"API response missing usage data for model {model_id}. Estimated completion tokens: {completion_tokens}")
             # Prompt token estimation is harder without the exact input message list used by the API
             prompt_tokens = 0 # Cannot estimate prompt tokens easily here

        try:
            # Pass prompt, completion, and reasoning tokens separately if needed
            await update_project_token_usage(conversation, total_used, db, prompt_tokens=prompt_tokens)
        except Exception as e:
            logger.error(f"Failed to update token usage for conversation {conversation_id}: {str(e)}")

        return assistant_msg

    except HTTPException as http_exc:
         logger.error(f"HTTP error during AI response generation: {http_exc.status_code} - {http_exc.detail}")
         # Re-raise HTTP exceptions to be handled by the caller endpoint
         raise
    except Exception as e:
        logger.exception(f"Unexpected error generating AI response for conversation {conversation_id}: {e}")
        # Return None or raise a generic internal server error? Raising is probably better.
        raise HTTPException(status_code=500, detail=f"Failed to generate AI response: {str(e)}") from e


async def handle_websocket_response(
    conversation_id: UUID,
    db: AsyncSession,
    websocket: WebSocket,
    message_data: Dict[str, Any] # Receive message data from client
) -> None:
    """
    Handle AI response generation specifically for WebSocket connections.
    This might involve streaming chunks back to the client.

    Args:
        conversation_id: Conversation UUID.
        db:              Database session.
        websocket:       FastAPI WebSocket connection.
        message_data:    Data received from the client (e.g., content, image_data).
    """
    # This function's original implementation called generate_ai_response,
    # which returns a complete Message object. For true WebSocket streaming,
    # we need to call openai_chat with stream=True and handle the async generator.

    try:
        conversation = await get_by_id(db, Conversation, conversation_id)
        if not conversation:
            await websocket.send_json(
                await create_standard_response(
                    None, "Conversation not found", success=False, status_code=404
                )
            )
            return

        model_id = conversation.model_id
        model_config = get_model_config(model_id, settings)
        if not model_config:
             await websocket.send_json({"type": "error", "content": f"Invalid model configured: {model_id}"})
             return

        # Retrieve conversation messages from DB (including system prompt if needed)
        msg_dicts = await get_conversation_messages(conversation_id, db, include_system_prompt=True)


        # Extract parameters from incoming WebSocket message_data
        content = message_data.get("content", "") # User message text
        image_data = message_data.get("image_data")
        vision_detail = message_data.get("vision_detail", "auto")
        enable_thinking = message_data.get("enable_thinking") # Allow client to request thinking
        thinking_budget = message_data.get("thinking_budget")
        reasoning_effort = message_data.get("reasoning_effort")
        enable_markdown_formatting = message_data.get("enable_markdown_formatting", False)

        # Add the new user message to the history for the API call
        # Determine content format (text or list with image)
        user_message_api_content: Union[str, List[Dict[str, Any]]] = content
        if image_data:
             # Basic structure for user message with image
             user_message_api_content = [{"type": "text", "text": content or "Analyze image"}]
             # Image data will be handled by openai_chat using image_data param


        msg_dicts.append({"role": "user", "content": user_message_api_content})


        # --- Prepare parameters for streaming call ---
        api_params = {
             "conversation_id": conversation_id, # Pass for context if needed by openai_chat later
             "messages": msg_dicts,
             "model_id": model_id,
             "db": db, # Pass DB session if needed by underlying functions
             "stream": True, # Explicitly request streaming
             "image_data": image_data,
             "vision_detail": vision_detail,
             "enable_thinking": enable_thinking,
             "thinking_budget": thinking_budget,
             "reasoning_effort": reasoning_effort,
             "enable_markdown_formatting": enable_markdown_formatting,
             # Pass temperature etc. if sent from client
             "temperature": message_data.get("temperature"),
        }

        logger.info(f"Initiating streaming AI response for conversation {conversation_id}")

        full_response_content = ""
        assistant_message_id = None # We need to save the message *after* streaming
        response_metadata = {}

        # --- Stream the response back to the client ---
        stream_generator = await openai_chat(**api_params)

        if not isinstance(stream_generator, AsyncGenerator):
             # Should not happen if stream=True worked
             logger.error("openai_chat did not return a stream generator.")
             await websocket.send_json({"type": "error", "content": "Failed to initiate streaming response."})
             return

        try:
             async for chunk_bytes in stream_generator:
                 # Assuming Server-Sent Events (SSE) format from Azure/Claude stream
                 lines = chunk_bytes.decode('utf-8').splitlines()
                 for line in lines:
                      if line.startswith('data: '):
                           data_str = line[len('data: '):]
                           if data_str.strip() == '[DONE]':
                               logger.info(f"Stream finished for conversation {conversation_id}")
                               break # End of stream marker

                           try:
                                chunk_data = json.loads(data_str)
                                # --- Process Chunk Data (Adapt based on actual Azure/Claude stream format) ---

                                # Example for OpenAI/Azure format:
                                delta = chunk_data.get('choices', [{}])[0].get('delta', {})
                                chunk_content = delta.get('content')

                                # Example for Claude format (might differ):
                                # if chunk_data.get('type') == 'content_block_delta':
                                #      chunk_content = chunk_data.get('delta', {}).get('text')
                                # elif chunk_data.get('type') == 'message_delta':
                                #      response_usage = chunk_data.get('usage') # Capture usage from delta
                                # # Handle thinking deltas if Claude streams them

                                if chunk_content:
                                     full_response_content += chunk_content
                                     # Send delta to client
                                     await websocket.send_json({
                                         "type": "message_chunk",
                                         "content": chunk_content
                                     })

                                # Check for final usage data in the stream (often in the last chunk or a separate event)
                                if chunk_data.get("usage"): # Azure format
                                     response_metadata["usage"] = chunk_data["usage"]
                                if chunk_data.get("id"): # Capture response ID
                                     response_metadata["response_id"] = chunk_data.get("id")
                                # Capture stop/finish reason
                                finish_reason = chunk_data.get('choices', [{}])[0].get('finish_reason')
                                if finish_reason:
                                     response_metadata["stop_reason"] = finish_reason

                                # TODO: Adapt parsing logic for actual stream formats of Azure and Claude

                           except json.JSONDecodeError:
                                logger.warning(f"Non-JSON data in stream: {data_str}")
                           except Exception as e:
                                logger.error(f"Error processing stream chunk data: {e} - Data: {data_str}")

             # --- Stream finished, send final confirmation and save message ---
             await websocket.send_json({"type": "message_complete", "content": full_response_content})

             # Save the complete assistant message to DB
             if full_response_content:
                  # Add any knowledge context/thinking flags if applicable (though hard to get from stream)
                  # Metadata might be incomplete from stream, rely on final usage if available
                  final_metadata = response_metadata
                  # TODO: Extract thinking/redacted from stream if possible

                  assistant_msg = Message(
                       conversation_id=conversation_id,
                       role="assistant",
                       content=full_response_content,
                       extra_data=final_metadata if final_metadata else None,
                  )
                  await save_model(db, assistant_msg)
                  assistant_message_id = assistant_msg.id
                  logger.info(f"Saved streamed assistant message {assistant_message_id} for conversation {conversation_id}")

                  # Update token usage based on final metadata
                  final_usage = final_metadata.get("usage", {})
                  prompt_tokens = final_usage.get("prompt_tokens", 0)
                  completion_tokens = final_usage.get("completion_tokens", 0)
                  reasoning_tokens = final_usage.get("reasoning_tokens", 0) # Check if included
                  total_used = completion_tokens + reasoning_tokens

                  if total_used == 0 and completion_tokens == 0: # Estimate if usage was missing
                       completion_tokens = await calculate_tokens(full_response_content, model_id, db)
                       total_used = completion_tokens
                       logger.warning("Estimating completion tokens as usage data was missing from stream.")

                  try:
                       await update_project_token_usage(conversation, total_used, db, prompt_tokens=prompt_tokens)
                  except Exception as e:
                       logger.error(f"Failed to update token usage after stream: {e}")

             else:
                  logger.warning(f"Stream completed but no content received for conversation {conversation_id}")
                  await websocket.send_json({"type": "error", "content": "AI produced an empty response."})


        except RuntimeError as e:
             # Catch errors raised from within the stream generator (e.g., connection errors)
             logger.error(f"RuntimeError during AI response stream: {e}")
             await websocket.send_json({"type": "error", "content": f"Stream generation failed: {e}"})
        except Exception as e:
             logger.exception(f"Unhandled error during WebSocket AI response streaming: {e}")
             await websocket.send_json({"type": "error", "content": f"Server error during streaming: {str(e)}"})

    except Exception as e:
        logger.exception(f"Overall error in handle_websocket_response for conversation {conversation_id}: {e}")
        try:
            await websocket.send_json(
                {"type": "error", "content": f"Failed to process request: {str(e)}"}
            )
        except Exception as ws_send_err:
             logger.error(f"Failed to send error to WebSocket: {ws_send_err}")

    # Note: WebSocket connection closing is handled by the caller endpoint (`unified_conversations.py`)
