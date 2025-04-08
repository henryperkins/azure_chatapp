import logging
from typing import Dict, Optional, List, Any, Union, AsyncGenerator, cast
from uuid import UUID

from fastapi import WebSocket, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
import json

from models.conversation import Conversation
from models.message import Message
from utils.openai import openai_chat
from config import settings
from utils.db_utils import get_by_id, save_model
from utils.message_handlers import get_conversation_messages, update_project_token_usage

from .ai_helper import get_model_config, retrieve_knowledge_context, calculate_tokens

logger = logging.getLogger(__name__)


async def generate_ai_response(
    conversation_id: UUID,
    messages: List[Dict[str, Any]],
    model_id: str,
    db: AsyncSession,
    image_data: Optional[Union[str, List[str]]] = None,
    vision_detail: Optional[str] = "auto",
    enable_thinking: Optional[bool] = None,
    thinking_budget: Optional[int] = None,
    enable_markdown_formatting: Optional[bool] = False,
    stream: bool = False,
    max_tokens: Optional[int] = None,
    reasoning_effort: Optional[str] = None,
    temperature: Optional[float] = None,
    **kwargs,
) -> Optional[Message]:
    """
    Generate an AI response for the given conversation, handling model specifics.
    """
    logger = logging.getLogger(__name__)

    # Validate inputs
    if not db:
        logger.error("Database session is required for generate_ai_response.")
        return None

    # Retrieve conversation
    conversation = await get_by_id(db, Conversation, conversation_id)
    if not conversation:
        logger.error(f"Conversation not found: {conversation_id}")
        return None

    # Get model configuration
    model_config = get_model_config(model_id, settings)
    if not model_config:
        logger.error(f"Configuration not found for model: {model_id}")
        raise HTTPException(
            status_code=400, detail=f"Invalid or unsupported model_id: {model_id}"
        )

    provider = model_config.get("provider")
    logger.info(
        f"Generating AI response for conversation {conversation_id} using {provider} model: {model_id}"
    )

    # Prepare messages with knowledge context
    final_messages = list(messages)  # Copy to avoid mutation
    knowledge_context = None

    if conversation.project_id and conversation.use_knowledge_base:
        last_user_content = next(
            (
                msg.get("content")
                for msg in reversed(final_messages)
                if msg.get("role") == "user" and isinstance(msg.get("content"), str)
            ),
            None,
        )
        if last_user_content:
            try:
                if isinstance(conversation.project_id, UUID):
                    knowledge_context = await retrieve_knowledge_context(
                        query=last_user_content, 
                        project_id=conversation.project_id,  # type: ignore[arg-type]
                        db=db
                    )
                else:
                    logger.warning(f"Invalid project_id type: {type(conversation.project_id)}")
                if knowledge_context:
                    system_indices = [
                        i
                        for i, m in enumerate(final_messages)
                        if m.get("role") == "system"
                    ]
                    insert_index = system_indices[-1] + 1 if system_indices else 0
                    final_messages.insert(
                        insert_index,
                        {"role": "system", "content": knowledge_context},
                    )
                    logger.info("Injected knowledge context into messages.")
            except Exception as e:
                logger.error(f"Failed to inject knowledge context: {e}")

    # Prepare API parameters with type hints
    api_params: Dict[str, Any] = {
        "messages": final_messages,  # List[Dict[str, Any]]
        "model_name": str(model_id),  # str
        "stream": stream,  # bool
    }
    
    # Add optional parameters only if they are not None
    if image_data is not None:
        api_params["image_data"] = image_data
    if vision_detail is not None:
        api_params["vision_detail"] = vision_detail
    if max_tokens is not None:
        api_params["max_tokens"] = max_tokens
    if temperature is not None:
        api_params["temperature"] = temperature
    
    # Add any additional parameters
    api_params.update({k: v for k, v in kwargs.items() if v is not None})

    # Adjust parameters based on provider
    capabilities = model_config.get("capabilities", [])
    if provider == "azure":
        if "markdown_formatting" in capabilities and enable_markdown_formatting:
            api_params["enable_markdown_formatting"] = True
            # Additional checks or adjustments specific to Azure can be added here

    elif provider == "anthropic":
        if "extended_thinking" in capabilities:
            final_enable_thinking = (
                enable_thinking
                if enable_thinking is not None
                else settings.CLAUDE_EXTENDED_THINKING_ENABLED
            )
            if final_enable_thinking:
                api_params["enable_thinking"] = True
                final_thinking_budget = (
                    thinking_budget
                    if thinking_budget is not None
                    else settings.CLAUDE_EXTENDED_THINKING_BUDGET
                )
                api_params["thinking_budget"] = final_thinking_budget

    # Generate AI response
    try:
        response_data = await openai_chat(**api_params)

        assistant_content = ""
        thinking_content = None
        redacted_thinking = None
        has_thinking = False
        response_usage = None
        response_id = None
        stop_reason = None

        if stream:
            logger.info("Processing streamed response.")
            full_content = ""
            if isinstance(response_data, AsyncGenerator):
                async for chunk_bytes in response_data:
                    if not isinstance(chunk_bytes, bytes):
                        logger.warning(
                            f"Expected bytes in stream, got {type(chunk_bytes)}"
                        )
                        continue

                    lines = chunk_bytes.decode("utf-8").splitlines()
                    for line in lines:
                        if line.startswith("data: "):
                            data_str = line[len("data: ") :]
                            if data_str.strip() == "[DONE]":
                                break
                            try:
                                chunk_data = json.loads(data_str)
                                choices = chunk_data.get("choices", [{}])
                                if choices:
                                    delta = choices[0].get("delta", {})
                                    if isinstance(delta, dict) and "content" in delta:
                                        content = delta.get("content")
                                        if content is not None:
                                            full_content += content
                            except json.JSONDecodeError:
                                logger.warning(f"Invalid JSON in stream: {data_str}")
                            except Exception as e:
                                logger.error(f"Error processing stream chunk: {e}")
                assistant_content = full_content
            else:
                logger.error(
                    f"Expected AsyncGenerator for stream, got {type(response_data)}"
                )

        elif isinstance(response_data, dict):
            response_id = response_data.get("id")
            response_usage = response_data.get("usage")
            stop_reason = response_data.get("stop_reason")
            choices = response_data.get("choices", [])
            if choices:
                message_data = choices[0].get("message", {})
                assistant_content = message_data.get("content", "")
                thinking_content = response_data.get("thinking")
                redacted_thinking = response_data.get("redacted_thinking")
                has_thinking = response_data.get("has_thinking", False)
                if not stop_reason:
                    stop_reason = choices[0].get("finish_reason")
            else:
                logger.error(f"No 'choices' found in AI response: {response_data}")
                assistant_content = "[Error: No response content generated]"
                stop_reason = "error"
        else:
            logger.error(
                f"Unexpected response type from openai_chat: {type(response_data)}"
            )
            assistant_content = "[Error: Unexpected response format]"
            stop_reason = "error"

        # Construct metadata
        metadata: Dict[str, Any] = {}
        if knowledge_context:
            metadata["used_knowledge_context"] = True
        if has_thinking:
            metadata["has_thinking"] = True
        if thinking_content:
            metadata["thinking"] = thinking_content
        if redacted_thinking:
            metadata["redacted_thinking"] = redacted_thinking
        if response_usage:
            metadata["usage"] = response_usage
        if response_id:
            metadata["response_id"] = response_id
        if stop_reason:
            metadata["stop_reason"] = stop_reason

        # Create and save the assistant message
        assistant_msg = Message(
            conversation_id=conversation_id,
            role="assistant",
            content=assistant_content or "[No content generated]",
            extra_data=metadata if metadata else None,
        )
        assistant_msg.thinking = thinking_content
        assistant_msg.redacted_thinking = redacted_thinking
        assistant_msg.metadata_dict = metadata

        await save_model(db, assistant_msg)
        logger.info(
            f"Saved assistant message {assistant_msg.id} for conversation {conversation_id}"
        )

        # Track token usage
        prompt_tokens = response_usage.get("prompt_tokens", 0) if response_usage else 0
        completion_tokens = (
            response_usage.get("completion_tokens", 0) if response_usage else 0
        )
        reasoning_tokens = (
            response_usage.get("reasoning_tokens", 0) if response_usage else 0
        )
        total_used = completion_tokens + reasoning_tokens

        if not response_usage and assistant_content:
            completion_tokens = await calculate_tokens(assistant_content, model_id)
            total_used = completion_tokens
            logger.warning(
                f"API response missing usage data for model {model_id}. "
                f"Estimated completion tokens: {completion_tokens}"
            )
            prompt_tokens = 0

        try:
            await update_project_token_usage(conversation, total_used, db)
        except Exception as e:
            logger.error(f"Failed to update token usage: {str(e)}")

        return assistant_msg

    except HTTPException as http_exc:
        logger.error(
            f"HTTP error during AI response generation: {http_exc.status_code} - {http_exc.detail}"
        )
        raise
    except Exception as e:
        logger.exception(f"Unexpected error generating AI response: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to generate AI response: {str(e)}"
        ) from e


async def handle_websocket_response(
    conversation_id: UUID,
    db: AsyncSession,
    websocket: WebSocket,
    message_data: Dict[str, Any],
) -> None:
    """
    Handle AI response generation specifically for WebSocket connections (streaming).
    """

    try:
        conversation = await get_by_id(db, Conversation, conversation_id)
        if not conversation:
            await websocket.send_json(
                {
                    "success": False,
                    "status_code": 404,
                    "message": "Conversation not found",
                }
            )
            return

        model_id = conversation.model_id
        model_config = get_model_config(str(model_id) if model_id else "", settings)
        if not model_config:
            await websocket.send_json(
                {"type": "error", "content": f"Invalid model configured: {model_id}"}
            )
            return

        msg_dicts = await get_conversation_messages(
            conversation_id, db, include_system_prompt=True
        )

        # Extract parameters from incoming WebSocket message_data
        content = message_data.get("content", "")
        image_data = message_data.get("image_data")
        vision_detail = message_data.get("vision_detail", "auto")
        enable_thinking = message_data.get("enable_thinking")
        thinking_budget = message_data.get("thinking_budget")
        reasoning_effort = message_data.get("reasoning_effort")
        enable_markdown_formatting = message_data.get(
            "enable_markdown_formatting", False
        )
        temperature = message_data.get("temperature")

        # Add the new user message
        user_message_api_content: Union[str, List[Dict[str, Any]]] = content
        if image_data:
            # Ensure proper formatting for multimodal content
            user_message_api_content = [
                {"type": "text", "text": content or "Analyze image"}
            ]
            if isinstance(image_data, str):
                # Add image data with proper structure
                user_message_api_content.append(
                    {"type": "image", "image_url": {"url": image_data}}
                )
            elif isinstance(image_data, list):
                # Handle multiple images
                for img in image_data:
                    if isinstance(img, str):
                        user_message_api_content.append(
                            {"type": "image", "image_url": {"url": img}}
                        )

        # Cast to Any to handle both string and structured content types
        msg_dicts.append({"role": "user", "content": cast(Any, user_message_api_content)})

        logger.info(
            f"Initiating streaming AI response for conversation {conversation_id}"
        )

        # Prepare parameters for API call
        stream_generator = await openai_chat(
            messages=msg_dicts,
            model_name=str(model_id) if model_id else "",
            stream=True,
            image_data=image_data,
            vision_detail=vision_detail,
            max_tokens=message_data.get("max_tokens"),
            temperature=temperature,
        )

        if not isinstance(stream_generator, AsyncGenerator):
            logger.error(
                f"openai_chat did not return a stream generator for streaming. Got {type(stream_generator)}"
            )
            await websocket.send_json(
                {"type": "error", "content": "Failed to initiate streaming response."}
            )
            return

        full_response_content = ""
        response_metadata: Dict[str, Any] = {}

        async for chunk_bytes in stream_generator:
            if not isinstance(chunk_bytes, bytes):
                logger.warning(f"Expected bytes in stream, got {type(chunk_bytes)}")
                continue

            lines = chunk_bytes.decode("utf-8").splitlines()
            for line in lines:
                if line.startswith("data: "):
                    data_str = line[len("data: ") :]
                    if data_str.strip() == "[DONE]":
                        logger.info(
                            f"Stream finished for conversation {conversation_id}"
                        )
                        break

                    try:
                        chunk_data = json.loads(data_str)
                        # Extract content from delta
                        choices = chunk_data.get("choices", [])
                        if choices and len(choices) > 0:
                            delta = choices[0].get("delta", {})
                            chunk_content = delta.get("content")
                            if chunk_content:
                                full_response_content += chunk_content
                                await websocket.send_json(
                                    {"type": "message_chunk", "content": chunk_content}
                                )

                        # Collect metadata from response
                        if chunk_data.get("usage"):
                            response_metadata["usage"] = chunk_data["usage"]
                        if chunk_data.get("id"):
                            response_metadata["response_id"] = chunk_data["id"]
                        if choices and len(choices) > 0:
                            finish_reason = choices[0].get("finish_reason")
                            if finish_reason:
                                response_metadata["stop_reason"] = finish_reason

                    except json.JSONDecodeError:
                        logger.warning(f"Non-JSON data in stream: {data_str}")
                    except Exception as e:
                        logger.error(
                            f"Error processing stream chunk data: {e} - Data: {data_str}"
                        )

        await websocket.send_json(
            {"type": "message_complete", "content": full_response_content}
        )

        if full_response_content:
            assistant_msg = Message(
                conversation_id=conversation_id,
                role="assistant",
                content=full_response_content,
                extra_data=response_metadata if response_metadata else None,
            )
            await save_model(db, assistant_msg)
            logger.info(
                f"Saved streamed assistant message {assistant_msg.id} for conversation {conversation_id}"
            )

            final_usage = response_metadata.get("usage", {})
            if not isinstance(final_usage, dict):
                final_usage = {}

            prompt_tokens = final_usage.get("prompt_tokens", 0)
            completion_tokens = final_usage.get("completion_tokens", 0)
            reasoning_tokens = final_usage.get("reasoning_tokens", 0)
            total_used = completion_tokens + reasoning_tokens

            if total_used == 0 and completion_tokens == 0:
                model_str = str(model_id) if model_id else ""
                completion_tokens = await calculate_tokens(
                    full_response_content, model_str
                )
                total_used = completion_tokens
                logger.warning(
                    "Estimating completion tokens as usage data was missing from stream."
                )

            try:
                if conversation:  # Ensuring conversation is not None
                    await update_project_token_usage(conversation, total_used, db)
            except Exception as e:
                logger.error(f"Failed to update token usage after stream: {e}")
        else:
            logger.warning(
                f"Stream completed but no content for conversation {conversation_id}"
            )
            await websocket.send_json(
                {"type": "error", "content": "AI produced an empty response."}
            )

    except Exception as e:
        logger.exception(f"Error in handle_websocket_response: {e}")
        try:
            await websocket.send_json(
                {"type": "error", "content": f"Failed to process request: {str(e)}"}
            )
        except Exception as ws_err:
            logger.error(f"Failed to send error to WebSocket: {ws_err}")
