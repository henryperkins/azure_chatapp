# MODIFIED: openai.py
# Reason: Use config.settings for model info, handle reasoning params, vision, headers.

import logging
from typing import List, Dict, Optional, Any, Literal, AsyncGenerator, Union
from typing_extensions import TypedDict

import httpx
from fastapi import HTTPException

from config import settings  # Use centralized settings
from utils.response_utils import (
    azure_api_request,
)  # Keep if used elsewhere, but direct httpx used here

logger = logging.getLogger(__name__)

# Removed internal CLAUDE_MODELS and AZURE_MODELS dictionaries


# Helper to get model config safely
def get_model_config(model_name: str) -> Optional[Dict[str, Any]]:
    """Retrieve model configuration from settings."""
    if model_name in settings.AZURE_OPENAI_MODELS:
        return settings.AZURE_OPENAI_MODELS[model_name]
    if model_name in settings.CLAUDE_MODELS:
        return settings.CLAUDE_MODELS[model_name]
    return None


# Helper function to get API version for Azure model
def get_azure_api_version(model_config: Dict[str, Any]) -> str:
    return model_config.get("api_version", settings.AZURE_DEFAULT_API_VERSION)


#
# Unified top-level function
#
async def openai_chat(
    messages: List[Dict[str, Any]], model_name: str, **kwargs
) -> Union[
    Dict[str, Any], AsyncGenerator[bytes, None]
]:  # Return type can be dict or generator
    """
    Route to the appropriate provider handler based on the model_name.
    Handles parameter validation and model-specific logic.
    """
    model_config = get_model_config(model_name)
    if not model_config:
        supported_models = list(settings.AZURE_OPENAI_MODELS.keys()) + list(
            settings.CLAUDE_MODELS.keys()
        )
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported model: {model_name}. " f"Valid models: {supported_models}"
            ),
        )

    provider = model_config.get("provider")

    if provider == "azure":
        return await azure_chat(messages, model_name, model_config, **kwargs)
    elif provider == "anthropic":
        # Claude doesn't support streaming via this function structure easily, handle separately if needed
        if kwargs.get("stream"):
            raise NotImplementedError(
                "Streaming for Claude is not directly supported via this unified function yet."
            )
        return await claude_chat(messages, model_name, model_config, **kwargs)
    else:
        raise HTTPException(
            status_code=500,
            detail=f"Unknown provider '{provider}' for model {model_name}",
        )


#
# Azure Chat Handler
#
async def validate_azure_params(
    model_name: str, model_config: Dict[str, Any], kwargs: dict
) -> None:
    """
    Validate Azure-specific parameters against model capabilities defined in settings.
    """
    capabilities = model_config.get("capabilities", [])
    parameters_config = model_config.get("parameters", {})

    # Vision parameters
    if kwargs.get("image_data"):
        if "vision" not in capabilities:
            raise ValueError(f"{model_name} doesn't support vision")

        vision_detail = kwargs.get("vision_detail", "auto")
        valid_details = parameters_config.get("vision_detail", [])
        if valid_details and vision_detail not in valid_details:
            raise ValueError(
                f"Invalid vision_detail for {model_name}: {vision_detail}. Must be one of {valid_details}"
            )
        # Check max images
        max_images = model_config.get("max_images", 1)  # Default to 1 if not specified
        # Assuming image_data is a list of base64 strings if multiple images
        num_images = (
            len(kwargs["image_data"]) if isinstance(kwargs["image_data"], list) else 1
        )
        if num_images > max_images:
            raise ValueError(
                f"{model_name} supports a maximum of {max_images} images, but {num_images} were provided."
            )

    # Reasoning effort
    if kwargs.get("reasoning_effort"):
        if "reasoning_effort" not in capabilities:
            raise ValueError(f"{model_name} doesn't support reasoning_effort")
        valid_efforts = parameters_config.get("reasoning_effort", [])
        if valid_efforts and kwargs["reasoning_effort"] not in valid_efforts:
            raise ValueError(
                f"Invalid reasoning_effort for {model_name}: {kwargs['reasoning_effort']}. Must be one of {valid_efforts}"
            )


async def azure_chat(
    messages: List[Dict[str, Any]],
    model_name: str,
    model_config: Dict[str, Any],
    # Common parameters, potentially overridden by model config
    max_tokens: Optional[int] = None,  # User requested max output tokens
    temperature: Optional[float] = 0.7,
    # Azure specific parameters
    reasoning_effort: Optional[Literal["low", "medium", "high"]] = None,
    image_data: Optional[Union[str, List[str]]] = None,  # Can be single base64 or list
    vision_detail: Optional[Literal["auto", "low", "high"]] = "auto",
    stream: bool = False,
    # Allow passing other valid API params
    **kwargs,
) -> Union[Dict[str, Any], AsyncGenerator[bytes, None]]:
    """
    Handle Azure OpenAI chat completions using configuration from settings.
    """
    # 1. Validate Parameters
    await validate_azure_params(
        model_name,
        model_config,
        {
            "reasoning_effort": reasoning_effort,
            "image_data": image_data,
            "vision_detail": vision_detail,
            **kwargs,  # Pass other potential future params for validation if needed
        },
    )

    # 2. Determine API Version
    api_version = get_azure_api_version(model_config)

    # 3. Prepare Payload
    payload: Dict[str, Any] = {
        "messages": messages,
        # Handle max tokens: Reasoning models use max_completion_tokens
        # Other models use max_tokens within context limits.
    }

    # Use model-specific max completion tokens if defined, otherwise use user-provided max_tokens
    model_max_completion = model_config.get("max_completion_tokens")
    model_max_tokens = model_config.get(
        "max_tokens"
    )  # General max tokens (e.g., for GPT-4o)
    model_max_context = model_config.get("max_context_tokens")

    final_max_tokens = None
    if model_max_completion is not None:
        # Reasoning model: use max_completion_tokens
        payload["max_completion_tokens"] = (
            min(max_tokens, model_max_completion)
            if max_tokens is not None
            else model_max_completion
        )
        final_max_tokens = payload[
            "max_completion_tokens"
        ]  # Store for potential logging/usage calculation
    elif model_max_tokens is not None:
        # Standard model: use max_tokens, ensure it's reasonable within context
        calculated_max = model_max_tokens  # Default to model's suggested max
        if max_tokens is not None:  # User override
            calculated_max = max_tokens
        # Optional: Add check against model_max_context if prompt tokens were known
        payload["max_tokens"] = calculated_max
        final_max_tokens = payload["max_tokens"]
    elif max_tokens is not None:
        # Model config lacks specific limits, use user request directly
        payload["max_tokens"] = max_tokens
        final_max_tokens = max_tokens

    # Add parameters IF NOT in unsupported_params for this model
    unsupported = model_config.get("unsupported_params", [])

    if temperature is not None and "temperature" not in unsupported:
        payload["temperature"] = temperature
    if kwargs.get("top_p") is not None and "top_p" not in unsupported:
        payload["top_p"] = kwargs["top_p"]
    # Add other standard params similarly (presence_penalty, frequency_penalty, logit_bias etc.)

    # Add model-specific capabilities
    capabilities = model_config.get("capabilities", [])

    # Developer Messages (for reasoning models to enable markdown)
    if (
        "developer_messages" in capabilities
        and messages
        and messages[0]["role"] == "system"
    ):
        # Check if caller wants markdown formatting
        if kwargs.get("enable_markdown_formatting", False):
            # Prepend "Formatting re-enabled" to the system message content
            original_content = messages[0].get("content", "")
            messages[0][
                "content"
            ] = f"Formatting re-enabled. {original_content}".strip()
            messages[0]["role"] = "developer"  # Change role
        elif messages[0].get("content", "").startswith("Formatting re-enabled"):
            # If content already has the prefix, change role
            messages[0]["role"] = "developer"
        # If system message doesn't request formatting, leave role as system or user
        # Note: o-series treats system as developer anyway, but explicit might be clearer
        payload["messages"] = messages  # Update payload messages

    # Reasoning Effort
    if reasoning_effort and "reasoning_effort" in capabilities:
        payload["reasoning_effort"] = reasoning_effort

    # Vision Processing
    if image_data and "vision" in capabilities:
        # Use the provided vision_detail, default to auto if not set
        final_vision_detail = vision_detail if vision_detail is not None else "auto"
        payload["messages"] = process_vision_messages(
            messages, image_data, final_vision_detail
        )

    # Streaming
    if stream and "streaming" in capabilities:
        payload["stream"] = True
        return _stream_azure_response(
            payload, model_name, api_version
        )  # Pass api_version

    # 4. Send Request
    return await _send_azure_request(
        payload, model_name, api_version
    )  # Pass api_version


def process_vision_messages(
    messages: List[Dict[str, Any]],
    image_data: Union[str, List[str]],
    vision_detail: str = "auto",
) -> List[Dict[str, Any]]:
    """
    Formats the messages list to include image data for Azure vision models.
    Handles single or multiple images.
    """
    if not messages:
        raise ValueError("Messages list cannot be empty for vision processing")

    last_message_index = -1
    for i in range(len(messages) - 1, -1, -1):
        if messages[i].get("role") == "user":
            last_message_index = i
            break

    if last_message_index == -1:
        # Should not happen in normal chat flow, but handle defensively
        # Insert a new user message at the end
        messages.append({"role": "user", "content": []})
        last_message_index = len(messages) - 1

    last_message = messages[last_message_index]

    # Ensure content is a list
    if isinstance(last_message.get("content"), str):
        last_message["content"] = [{"type": "text", "text": last_message["content"]}]
    elif not isinstance(last_message.get("content"), list):
        last_message["content"] = []  # Start fresh if content is invalid type

    # Add image(s)
    images_to_process = [image_data] if isinstance(image_data, str) else image_data

    for img_data in images_to_process:
        base64_str = extract_base64_data(img_data)
        if base64_str:
            last_message["content"].append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{base64_str}",  # Assume jpeg, consider png?
                        "detail": vision_detail,
                    },
                }
            )

    # Update the message in the list
    messages[last_message_index] = last_message
    return messages


def extract_base64_data(image_data: str) -> Optional[str]:
    """
    Extract base64 data from data URL string.
    Returns None if format is invalid.
    """
    if isinstance(image_data, str) and "base64," in image_data:
        parts = image_data.split("base64,")
        if len(parts) == 2:
            return parts[1]
    logger.warning(f"Could not extract base64 data from image_data.")
    return None


async def _send_azure_request(
    payload: Dict[str, Any], model_name: str, api_version: str
) -> Dict[str, Any]:
    """
    Send a standard (non-streaming) Azure OpenAI request.
    """
    if not settings.AZURE_OPENAI_ENDPOINT or not settings.AZURE_OPENAI_API_KEY:
        raise HTTPException(
            status_code=500, detail="Azure OpenAI endpoint or API key not configured"
        )

    # Use deployment name which might be different from model_name key in config
    deployment_name = model_name  # Assume deployment name matches config key for now
    url = f"{settings.AZURE_OPENAI_ENDPOINT.rstrip('/')}/openai/deployments/{deployment_name}/chat/completions?api-version={api_version}"
    headers: Dict[str, str] = {
        "Content-Type": "application/json",
        "api-key": settings.AZURE_OPENAI_API_KEY,
    }

    logger.debug(f"Sending Azure request to {url} with payload: {payload}")

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                url, json=payload, headers=headers, timeout=120
            )  # Increased timeout
            response.raise_for_status()
            response_data = response.json()
            logger.debug(f"Received Azure response: {response_data}")
            # Include reasoning tokens in usage if present (for o-series models)
            if response_data.get("usage") and response_data["usage"].get(
                "completion_tokens_details"
            ):
                reasoning_tokens = response_data["usage"][
                    "completion_tokens_details"
                ].get("reasoning_tokens", 0)
                if reasoning_tokens > 0:
                    response_data["usage"]["reasoning_tokens"] = reasoning_tokens
            return response_data
    except httpx.RequestError as e:
        logger.error(f"Error calling Azure OpenAI endpoint {url}: {e}")
        raise HTTPException(
            status_code=503, detail="Unable to reach Azure OpenAI service"
        ) from e
    except httpx.HTTPStatusError as e:
        logger.error(
            f"Azure OpenAI error ({e.response.status_code}) for {url}: {e.response.text}"
        )
        detail = f"Azure OpenAI request failed: {e.response.status_code}"
        try:
            # Try to parse Azure's error message
            err_data = e.response.json()
            if err_data.get("error", {}).get("message"):
                detail += f" - {err_data['error']['message']}"
        except Exception:
            detail += f" - {e.response.text[:200]}"  # Include raw response snippet
        raise HTTPException(status_code=e.response.status_code, detail=detail) from e


async def _stream_azure_response(
    payload: Dict[str, Any], model_name: str, api_version: str
) -> AsyncGenerator[bytes, None]:
    """
    Handle streaming responses from Azure OpenAI.
    """
    if not settings.AZURE_OPENAI_ENDPOINT or not settings.AZURE_OPENAI_API_KEY:
        raise HTTPException(
            status_code=500, detail="Azure OpenAI endpoint or API key not configured"
        )

    deployment_name = model_name
    url = f"{settings.AZURE_OPENAI_ENDPOINT.rstrip('/')}/openai/deployments/{deployment_name}/chat/completions?api-version={api_version}"
    headers = {
        "Content-Type": "application/json",
        "api-key": settings.AZURE_OPENAI_API_KEY,
    }

    logger.debug(f"Streaming Azure request to {url} with payload: {payload}")

    try:
        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST",
                url,
                json=payload,
                headers=headers,
                timeout=180,  # Longer timeout for streaming
            ) as response:
                response.raise_for_status()
                async for chunk in response.aiter_bytes():
                    yield chunk
    except httpx.RequestError as e:
        logger.error(f"Error streaming from Azure OpenAI endpoint {url}: {e}")
        # How to communicate this error back through the generator? Raise runtime error.
        raise RuntimeError(f"Unable to stream from Azure OpenAI: {e}") from e
    except httpx.HTTPStatusError as e:
        logger.error(
            f"Azure OpenAI streaming error ({e.response.status_code}) for {url}: {e.response.text}"
        )
        # Difficult to raise HTTPException inside generator. Raise runtime error.
        detail = f"Azure OpenAI streaming request failed: {e.response.status_code} - {e.response.text[:200]}"
        raise RuntimeError(detail) from e


#
# Claude Chat Handler
#
async def claude_chat(
    messages: list,
    model_name: str,
    model_config: Dict[str, Any],
    max_tokens: Optional[int] = None,
    enable_thinking: Optional[bool] = None,
    thinking_budget: Optional[int] = None,
    stream: bool = False,  # Note: Stream handling might need adjustment in caller
    image_data: Optional[
        Union[str, List[str]]
    ] = None,  # Can be single base64/URL or list
    **kwargs,  # Catch other potential args
) -> dict:
    """
    Handle Claude API requests using configuration from settings.
    """
    if not settings.CLAUDE_API_KEY:
        logger.error("CLAUDE_API_KEY is not set.")
        raise HTTPException(status_code=500, detail="Claude API key not configured")

    # 1. Determine Max Tokens
    # Use user request, capped by model default, or use model default
    final_max_tokens = model_config.get("max_tokens", 4096)  # Default if not in config
    if max_tokens is not None:
        final_max_tokens = min(max_tokens, final_max_tokens)

    # 2. Check Streaming Requirement
    streaming_threshold = model_config.get("streaming_threshold")
    if streaming_threshold and final_max_tokens > streaming_threshold and not stream:
        raise HTTPException(
            status_code=400,
            detail=f"Streaming is required for Claude model {model_name} when max_tokens > {streaming_threshold}",
        )

    # 3. Handle Vision
    processed_messages = messages
    if (
        image_data
        and model_config.get("capabilities", [])
        and "vision" in model_config["capabilities"]
    ):
        processed_messages = _handle_claude_vision_data(messages, image_data)
    elif image_data:
        logger.warning(
            f"Image data provided but Claude model {model_name} does not support vision. Ignoring image."
        )

    # 4. Prepare Headers
    headers = {
        "x-api-key": settings.CLAUDE_API_KEY,
        "anthropic-version": settings.CLAUDE_API_VERSION,
        "content-type": "application/json",
    }
    # Add beta headers if applicable
    if model_config.get("beta_headers"):
        headers.update(model_config["beta_headers"])

    # 5. Prepare Payload
    payload = {
        "model": model_name,
        "max_tokens": final_max_tokens,
        "messages": _filter_claude_messages(processed_messages),
        "stream": stream,
    }

    # Add temperature if provided by user and supported (most Claude models support it)
    if kwargs.get("temperature") is not None:
        payload["temperature"] = kwargs["temperature"]
    # Add top_p, top_k if provided

    # 6. Handle Extended Thinking
    thinking_enabled_flag = (
        enable_thinking
        if enable_thinking is not None
        else settings.CLAUDE_EXTENDED_THINKING_ENABLED
    )
    extended_thinking_config = model_config.get("extended_thinking_config")

    if (
        thinking_enabled_flag
        and extended_thinking_config
        and "extended_thinking" in model_config.get("capabilities", [])
    ):
        # Determine budget
        budget = thinking_budget or extended_thinking_config.get(
            "default_budget", 16000
        )
        min_budget = extended_thinking_config.get("min_budget", 1024)
        budget = max(budget, min_budget)

        # Validate budget vs max_tokens
        if budget >= final_max_tokens:
            logger.warning(
                f"Thinking budget ({budget}) is >= max_tokens ({final_max_tokens}). Adjusting budget."
            )
            # Adjust budget to be slightly less than max_tokens, ensuring space for response
            budget = max(min_budget, final_max_tokens - 50)
            if budget < min_budget:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot enable thinking: max_tokens ({final_max_tokens}) too small for minimum thinking budget ({min_budget})",
                )

        payload["thinking"] = {"type": "enabled", "budget_tokens": budget}
        # Some Claude features turn off temperature when thinking is enabled
        if "temperature" in payload:
            logger.debug(
                "Removing temperature parameter as extended thinking is enabled for Claude."
            )
            payload.pop("temperature", None)
    elif enable_thinking:
        logger.warning(
            f"Extended thinking requested but not supported by model {model_name} or config missing."
        )

    # 7. Send Request
    logger.debug(f"Sending Claude request with payload: {payload}")
    try:
        async with httpx.AsyncClient() as client:
            # Handle streaming vs non-streaming response parsing
            if stream:
                # Streaming handled by caller using the generator directly
                # This function should return the generator for streaming
                async def stream_generator():
                    async with client.stream(
                        "POST",
                        settings.CLAUDE_BASE_URL,
                        json=payload,
                        headers=headers,
                        timeout=180,
                    ) as response:
                        response.raise_for_status()
                        async for chunk in response.aiter_bytes():
                            yield chunk

                return stream_generator()  # Return the async generator
            else:
                # Non-streaming request
                response = await client.post(
                    settings.CLAUDE_BASE_URL,
                    json=payload,
                    headers=headers,
                    timeout=120,  # Increased timeout
                )
                response.raise_for_status()
                response_data = response.json()
                logger.debug(f"Received Claude response: {response_data}")
                return _parse_claude_response(response_data)

    except httpx.RequestError as e:
        logger.error(f"Claude API Request Error: {str(e)}")
        raise HTTPException(
            status_code=503, detail="Unable to reach Claude API service"
        ) from e
    except httpx.HTTPStatusError as e:
        logger.error(
            f"Claude API HTTP Error: {e.response.status_code} => {e.response.text}"
        )
        detail = f"Claude API Error ({e.response.status_code})"
        try:
            err_data = e.response.json()
            if err_data.get("error", {}).get("message"):
                detail += f": {err_data['error']['message']}"
            else:
                detail += f" - {e.response.text[:200]}"
        except Exception:
            detail += f" - {e.response.text[:200]}"
        raise HTTPException(status_code=e.response.status_code, detail=detail) from e
    except Exception as e:
        logger.exception(
            f"Claude API Unexpected Error: {str(e)}"
        )  # Use exception for stack trace
        raise HTTPException(
            status_code=500, detail=f"Claude service error: {str(e)}"
        ) from e


def _handle_claude_vision_data(
    messages: list, image_data: Union[str, List[str]]
) -> list:
    """
    Insert vision data into the final user message for Claude.
    Handles single or multiple images (base64 or URL).
    """
    if not messages:
        messages = [{"role": "user", "content": []}]  # Add placeholder if empty

    # Find the last user message or create one
    last_user_message_index = -1
    for i in range(len(messages) - 1, -1, -1):
        if messages[i].get("role") == "user":
            last_user_message_index = i
            break

    if last_user_message_index == -1:
        messages.append({"role": "user", "content": []})
        last_user_message_index = len(messages) - 1

    user_message = messages[last_user_message_index]

    # Ensure content is a list
    if isinstance(user_message.get("content"), str):
        user_message["content"] = [{"type": "text", "text": user_message["content"]}]
    elif not isinstance(user_message.get("content"), list):
        user_message["content"] = []

    # Process images
    images_to_process = [image_data] if isinstance(image_data, str) else image_data
    if len(images_to_process) > 20:  # Claude general limit
        logger.warning(
            f"Too many images ({len(images_to_process)}) for Claude request. Limiting to 20."
        )
        images_to_process = images_to_process[:20]

    for img_src in images_to_process:
        if isinstance(img_src, str):
            if img_src.startswith(("http://", "https://")):
                # URL - Currently Claude doesn't support URLs directly in API v1, needs base64
                logger.warning(
                    "Claude API requires base64 image data, URL provided and ignored. Implement URL fetching if needed."
                )
                # TODO: Optionally fetch URL content and convert to base64 here
                continue
            elif img_src.startswith("data:image"):
                # Base64 data URL
                base64_str = extract_base64_data(img_src)
                media_type = img_src.split(";")[0].split(":")[1]  # e.g., image/jpeg
                if base64_str and media_type:
                    user_message["content"].append(
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": base64_str,
                            },
                        }
                    )
                else:
                    logger.warning(
                        f"Could not parse base64 data URL: {img_src[:50]}..."
                    )
            else:
                # Assume raw base64 string - need to know media type
                logger.warning(
                    "Raw base64 string provided for Claude vision without media type. Assuming image/jpeg."
                )
                user_message["content"].append(
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",  # Best guess
                            "data": img_src,
                        },
                    }
                )
        else:
            logger.warning(f"Invalid image data type for Claude: {type(img_src)}")

    messages[last_user_message_index] = user_message
    return messages


def _filter_claude_messages(messages: list) -> list:
    """
    Filters and formats messages for the Claude API.
    Ensures roles are valid and content exists.
    Handles potential list/string content mixing in user messages after vision processing.
    """
    filtered = []
    for msg in messages:
        role = msg.get("role")
        content = msg.get("content")

        if role not in ["system", "user", "assistant"] or not content:
            logger.warning(
                f"Skipping invalid message: role={role}, content exists={bool(content)}"
            )
            continue

        # Ensure user content is properly formatted (list or string)
        if role == "user":
            if isinstance(content, list):
                # If list, ensure it's not empty and contains valid blocks
                valid_blocks = []
                has_text = False
                for item in content:
                    if (
                        isinstance(item, dict)
                        and item.get("type") == "text"
                        and isinstance(item.get("text"), str)
                    ):
                        valid_blocks.append(item)
                        has_text = True
                    elif (
                        isinstance(item, dict)
                        and item.get("type") == "image"
                        and isinstance(item.get("source"), dict)
                    ):
                        valid_blocks.append(item)
                    else:
                        logger.warning(
                            f"Skipping invalid block in user message content list: {item}"
                        )
                # Add a placeholder text if only images were added and no original text existed
                if not has_text and valid_blocks:
                    valid_blocks.insert(
                        0, {"type": "text", "text": "Image analysis request"}
                    )
                if valid_blocks:  # Only add if there's valid content
                    filtered.append({"role": role, "content": valid_blocks})

            elif isinstance(content, str):
                # Simple text message
                filtered.append({"role": role, "content": content})
            else:
                logger.warning(
                    f"Skipping user message with invalid content type: {type(content)}"
                )
        else:
            # System or assistant message (should always be string)
            if isinstance(content, str):
                filtered.append({"role": role, "content": content})
            else:
                logger.warning(
                    f"Skipping {role} message with invalid content type: {type(content)}"
                )

    # Ensure conversation structure alternates user/assistant after first user message if possible
    # (Claude API requirement) - This basic filtering doesn't enforce alternation strictly,
    # but removes obviously invalid messages. More robust alternation logic could be added if needed.

    return filtered


def _parse_claude_response(response_data: dict) -> dict:
    """
    Parse Claude's extended response structure into a standard format with `choices`.
    Extracts text, thinking, and redacted thinking blocks.
    Includes usage information.
    """
    parsed_response = {
        "id": response_data.get("id"),
        "model": response_data.get("model"),
        "usage": response_data.get("usage", {"input_tokens": 0, "output_tokens": 0}),
        "stop_reason": response_data.get("stop_reason"),
        "choices": [],
        "thinking": None,
        "redacted_thinking": None,
        "has_thinking": False,
    }

    if "content" in response_data and isinstance(response_data["content"], list):
        content_parts = []
        thinking_parts = []
        redacted_thinking_parts = []

        for block in response_data["content"]:
            block_type = block.get("type")
            if block_type == "text" and "text" in block:
                content_parts.append(block["text"])
            elif block_type == "thinking" and "thinking" in block:
                thinking_parts.append(block["thinking"])
                parsed_response["has_thinking"] = True
            elif block_type == "redacted_thinking" and "redacted_thinking" in block:
                # Note: Claude might return 'redacted_thinking' without a nested key
                redacted_content = block.get(
                    "redacted_thinking", "[Redacted]"
                )  # Provide fallback text
                redacted_thinking_parts.append(redacted_content)
                parsed_response["has_thinking"] = True  # Mark thinking was attempted

        final_content = "".join(content_parts)
        parsed_response["choices"] = [
            {
                "message": {"content": final_content, "role": "assistant"},
                "finish_reason": parsed_response["stop_reason"],
            }
        ]
        if thinking_parts:
            parsed_response["thinking"] = "\n".join(thinking_parts)
        if redacted_thinking_parts:
            parsed_response["redacted_thinking"] = "\n".join(redacted_thinking_parts)

    elif (
        "choices" in response_data
    ):  # Handle potential standard OpenAI format just in case
        parsed_response["choices"] = response_data["choices"]
        if not parsed_response["usage"] and response_data.get("usage"):
            parsed_response["usage"] = response_data["usage"]

    else:
        # Unexpected structure
        logger.error(f"Received unexpected Claude response format: {response_data}")
        parsed_response["choices"] = [
            {
                "message": {
                    "content": "Error: Invalid response format from AI.",
                    "role": "assistant",
                },
                "finish_reason": "error",
            }
        ]

    return parsed_response


#
# Additional Utilities (Keep count_claude_tokens and get_moderation)
#
async def count_claude_tokens(messages: List[Dict[str, str]], model_name: str) -> int:
    """
    Count tokens using Claude's token counting endpoint (if available).
    Fallback to rough estimation if the endpoint fails or isn't implemented.
    Note: This requires a separate API call to Claude.
    """
    # This functionality is often implemented within the Anthropic SDK directly.
    # Re-implementing it via HTTP requires careful payload construction and API endpoint knowledge.
    # For now, fallback to estimation.
    # TODO: Implement Claude token counting API call if needed.
    logger.warning("Claude token counting via API not implemented, using estimation.")
    total_chars = 0
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, str):
            total_chars += len(content)
        elif isinstance(content, list):  # Handle vision message format
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    total_chars += len(item.get("text", ""))
                # Image token counting is complex, skip for estimation
    return total_chars // 4  # Rough fallback: ~4 chars per token


async def get_moderation(text: str) -> Dict[str, Any]:
    """
    Call the Azure OpenAI moderation endpoint.
    """
    if not settings.AZURE_OPENAI_ENDPOINT or not settings.AZURE_OPENAI_API_KEY:
        logger.error("Azure moderation endpoint or API key not configured.")
        return {"error": "Moderation service not configured", "flagged": False}

    # Moderation API might have a different versioning scheme or path
    moderation_api_version = "2024-02-15-preview"  # Or check Azure docs for latest
    endpoint_path = f"openai/deployments/text-moderation-005/moderations?api-version={moderation_api_version}"  # Example path/deployment
    url = f"{settings.AZURE_OPENAI_ENDPOINT.rstrip('/')}/{endpoint_path}"
    headers = {
        "Content-Type": "application/json",
        "api-key": settings.AZURE_OPENAI_API_KEY,
    }
    payload = {"input": text}

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload, headers=headers, timeout=15)
            response.raise_for_status()
            return response.json()  # Should include 'flagged' status and categories
    except Exception as e:
        logger.error(f"Error during content moderation call to {url}: {e}")
        return {"error": f"Moderation call failed: {str(e)}", "flagged": False}


#
# Example Helper for Simple Completion
#
async def get_completion(
    prompt: str, model_name: str = "o3-mini", max_tokens: int = 500, **kwargs
) -> str:
    """
    Simple wrapper for text completion using the chat API.
    """
    messages = [{"role": "user", "content": prompt}]
    try:
        # Pass kwargs through for flexibility (e.g., temperature)
        response_data = await openai_chat(
            messages=messages, model_name=model_name, max_tokens=max_tokens, **kwargs
        )
        # Handle potential streaming response (take first chunk?) - This helper is NON-STREAMING
        if isinstance(response_data, AsyncGenerator):
            # Consume the generator to get the full response (less efficient for streaming)
            full_response_bytes = b""
            async for chunk in response_data:
                # Assuming chunks are JSON strings like "data: {...}\n\n"
                # Need proper SSE parsing here if streaming is used in get_completion
                # For simplicity, let's assume openai_chat won't stream for get_completion
                # If it might, this needs full SSE parsing.
                # For now, error out if it streams unexpectedly.
                raise RuntimeError("get_completion received unexpected stream")
            # This part is unreachable if the above assumption holds
            # Need to parse full_response_bytes if SSE parsing were implemented
            return "Error: Streaming not handled in simple get_completion"
        elif isinstance(response_data, dict) and response_data.get("choices"):
            return response_data["choices"][0]["message"]["content"]
        else:
            logger.error(
                f"Unexpected response format from openai_chat in get_completion: {response_data}"
            )
            return "Error: Could not get completion."

    except HTTPException as e:
        logger.error(
            f"HTTP error during text completion for model {model_name}: {e.detail}"
        )
        raise RuntimeError(
            f"Text completion failed ({e.status_code}): {e.detail}"
        ) from e
    except Exception as e:
        logger.exception(
            f"Unexpected error during text completion for model {model_name}: {e}"
        )
        raise RuntimeError(f"Text completion failed: {str(e)}") from e
