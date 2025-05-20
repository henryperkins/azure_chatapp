import logging
from typing import Optional, List, Any, Union, AsyncGenerator
from uuid import UUID
from dataclasses import dataclass, field

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
import json

from models.conversation import Conversation
from models.message import Message
from utils.openai import openai_chat
from config import settings
from utils.db_utils import get_by_id, save_model
from utils.ai_helper import get_model_config, retrieve_knowledge_context, calculate_tokens

logger = logging.getLogger(__name__)

@dataclass(slots=True)
class AIResponseOptions:
    image_data: Optional[Union[str, List[str]]] = None
    vision_detail: str = "auto"
    enable_thinking: Optional[bool] = None
    thinking_budget: Optional[int] = None
    enable_markdown_formatting: bool = False
    stream: bool = False
    max_tokens: Optional[int] = None
    reasoning_effort: Optional[str] = None
    temperature: Optional[float] = None
    extra_params: dict[str, Any] = field(default_factory=dict)

    def to_api_dict(self) -> dict[str, Any]:
        d = {
            "image_data"               : self.image_data,
            "vision_detail"            : self.vision_detail,
            "enable_thinking"          : self.enable_thinking,
            "thinking_budget"          : self.thinking_budget,
            "enable_markdown_formatting": self.enable_markdown_formatting,
            "stream"                   : self.stream,
            "max_tokens"               : self.max_tokens,
            "reasoning_effort"         : self.reasoning_effort,
            "temperature"              : self.temperature,
            **self.extra_params,
        }
        # strip Nones
        return {k: v for k, v in d.items() if v is not None}


async def generate_ai_response(
    conversation_id: UUID,
    messages: List[dict[str, Any]],
    model_id: str,
    db: AsyncSession,
    *,
    options: AIResponseOptions | None = None,
) -> Optional[Message]:
    """
    Generate an AI response for the given conversation, handling model specifics.
    """

    opts = options or AIResponseOptions()

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

    # Prepare API parameters
    api_params: dict[str, Any] = {
        "messages": final_messages,
        "model_name": str(model_id),
        **opts.to_api_dict(),
    }

    # Adjust parameters based on provider
    capabilities = model_config.get("capabilities", [])
    if provider == "azure":
        if "markdown_formatting" in capabilities and opts.enable_markdown_formatting:
            api_params["enable_markdown_formatting"] = True
            # Additional checks or adjustments specific to Azure can be added here

    elif provider == "anthropic":
        if "extended_thinking" in capabilities:
            if opts.enable_thinking:
                api_params["enable_thinking"] = True
                if opts.thinking_budget is not None:
                    api_params["thinking_budget"] = opts.thinking_budget
                else:
                    api_params["thinking_budget"] = settings.CLAUDE_EXTENDED_THINKING_BUDGET

    stream = opts.stream

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
            # stop_reason handled per response type

            # Parse Azure Responses API (o3/gpt-4.1 - object == "response" and "output" in response_data):
            if response_data.get("object") == "response" and "output" in response_data:
                logger.info("[AI_RESPONSE] Parsing Azure Responses API structure.")
                output_items = response_data.get("output", [])
                # Extract assistant content
                message_item = next((item for item in output_items if item.get("type") == "message"), None)
                if message_item and "content" in message_item:
                    content_blocks = message_item.get("content", [])
                    output_text_block = next((block for block in content_blocks if block.get("type") == "output_text"), None)
                    if output_text_block and "text" in output_text_block:
                        assistant_content = output_text_block.get("text", "")
                    else:
                        logger.error(f"[AI_RESPONSE] No 'output_text' block found in Responses API message item: {message_item}")
                        assistant_content = "[Error: No text content in response message]"
                else:
                    logger.error(f"[AI_RESPONSE] No 'message' type found in Responses API 'output' array or content missing: {output_items}")
                    assistant_content = "[Error: No message content in AI response]"

                # Determine stop_reason from status for Responses API
                api_status = response_data.get("status")
                if api_status == "completed":
                    stop_reason = "stop"
                elif api_status == "failed":
                    stop_reason = "error"
                    if response_data.get("error") and response_data["error"].get("message"):
                        assistant_content = f"[Error: {response_data['error']['message']}]"
                    elif assistant_content == "[Error: No message content in AI response]" or not assistant_content:
                        assistant_content = "[Error: AI response failed without details]"
                else:
                    stop_reason = api_status  # e.g., 'requires_action', or None

                # Extract reasoning/thinking for Responses API
                reasoning_item = next((item for item in output_items if item.get("type") == "reasoning"), None)
                if reasoning_item and "summary" in reasoning_item:
                    summary_texts = [s.get("text") for s in reasoning_item.get("summary", []) if s.get("text")]
                    if summary_texts:
                        thinking_content = "\n".join(summary_texts)
                        has_thinking = True
                redacted_thinking = None  # Not standard in Azure Responses API

            else:
                # Parse as standard Chat Completions API (choices) response
                logger.info("[AI_RESPONSE] Parsing non-Responses API dictionary structure (e.g., Chat Completions).")
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
        metadata: dict[str, Any] = {}
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
