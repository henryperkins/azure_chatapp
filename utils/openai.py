"""
openai.py
---------
Provides Azure and Claude OpenAI HTTP requests for the Azure OpenAI Chat Application.

Includes:
  1. openai_chat(...) - Submits a chat completion request, routing to either Azure or Claude.
     - Supports model_name, max_completion_tokens, optional reasoning_effort, vision data (if needed).
  2. azure_chat(...) - Dedicated function for Azure chat completion, with parameter validation.
  3. claude_chat(...) - Dedicated function for Claude completion, including vision data support.
  4. Additional helper methods: token usage logging, partial requests, and moderation checks.
"""

import logging
from typing import List, Dict, Optional, Any, Literal, AsyncGenerator
from typing_extensions import TypedDict

import httpx
from fastapi import HTTPException

from config import settings
from utils.response_utils import azure_api_request

logger = logging.getLogger(__name__)

# Claude-specific model settings
CLAUDE_MODELS = {
    "claude-3-7-sonnet-20250219": {
        "max_tokens": 128000,
        "min_thinking": 1024,  # Minimum required by API
        "default_thinking": 16000,
        "supports_vision": True,
        "requires_streaming": 21333,  # Tokens threshold requiring streaming
    },
    "claude-3-opus-20240229": {
        "max_tokens": 200000,
        "min_thinking": 1024,
        "default_thinking": 8000,
        "supports_vision": False,
        "requires_streaming": 21333,
    },
    "claude-3-sonnet-20240229": {
        "max_tokens": 200000,
        "min_thinking": 1024,
        "default_thinking": 4000,
        "supports_vision": False,
        "requires_streaming": 21333,
    },
}

# Azure-specific model settings
AZURE_MODELS = {
    "o1": {
        "max_tokens": 128000,
        "supports_vision": True,
        "supports_reasoning_effort": True,
        "vision_detail_levels": ["low", "high"],
        "max_images": int(settings.AZURE_O1_MAX_IMAGES),
    },
    "o3-mini": {"max_tokens": 16385, "supports_reasoning_effort": True},
    "o3": {"max_tokens": 128000, "supports_reasoning_effort": False},
    "gpt-4o": {
        "max_tokens": 128000,
        "supports_vision": True,
        "vision_detail_levels": ["auto", "low", "high"],
        "supports_streaming": True,
        "max_images": 10,
    },
}

# Config settings for Azure
AZURE_OPENAI_ENDPOINT = settings.AZURE_OPENAI_ENDPOINT.rstrip("/")
AZURE_OPENAI_API_KEY = settings.AZURE_OPENAI_API_KEY
API_VERSION = "2025-03-01-preview"  # Recommended version for reasoning models


#
# Unified top-level function
#
async def openai_chat(
    messages: List[Dict[str, str]], model_name: str, **kwargs
) -> dict:
    """
    Route to the appropriate provider handler based on the model_name.
    """
    if model_name in CLAUDE_MODELS:
        return await claude_chat(messages, model_name=model_name, **kwargs)
    elif model_name in AZURE_MODELS:
        return await azure_chat(messages, model_name=model_name, **kwargs)

    raise HTTPException(
        status_code=400,
        detail=(
            f"Unsupported model: {model_name}. "
            f"Valid models: {list(CLAUDE_MODELS.keys()) + list(AZURE_MODELS.keys())}"
        ),
    )


#
# Azure Chat Handler
#
async def validate_azure_params(model_name: str, kwargs: dict) -> None:
    """
    Validate Azure-specific parameters against model capabilities.
    """
    model_config = AZURE_MODELS.get(model_name)
    if not model_config:
        raise ValueError(f"Unsupported Azure model: {model_name}")

    # Vision parameters
    if kwargs.get("image_data"):
        if not model_config.get("supports_vision", False):
            raise ValueError(f"{model_name} doesn't support vision")

        vision_detail = kwargs.get("vision_detail", "auto")
        valid_details = model_config.get("vision_detail_levels", [])
        if vision_detail not in valid_details:
            raise ValueError(
                f"Invalid vision_detail: {vision_detail}. Must be one of {valid_details}"
            )

    # Reasoning effort
    if kwargs.get("reasoning_effort"):
        if not model_config.get("supports_reasoning_effort", False):
            raise ValueError(f"{model_name} doesn't support reasoning_effort")


async def azure_chat(
    messages: List[Dict[str, Any]],
    model_name: str,
    max_tokens: int = 4000,
    temperature: float = 0.7,
    reasoning_effort: Optional[Literal["low", "medium", "high"]] = None,
    image_data: Optional[str] = None,
    vision_detail: Literal["auto", "low", "high"] = "auto",
    stream: bool = False,
) -> Dict[str, Any]:
    """
    Handle Azure OpenAI chat completions with proper validation.
    """
    await validate_azure_params(
        model_name,
        {
            "reasoning_effort": reasoning_effort,
            "image_data": image_data,
            "vision_detail": vision_detail,
        },
    )

    model_config = AZURE_MODELS[model_name]
    payload: Dict[str, Any] = {
        "messages": messages,
        "max_tokens": min(max_tokens, model_config["max_tokens"]),
        "temperature": temperature,
    }

    # Process vision data if applicable
    if image_data and model_config.get("supports_vision"):
        payload["messages"] = process_vision_messages(
            messages, image_data, vision_detail
        )

    if reasoning_effort and model_config.get("supports_reasoning_effort"):
        payload["reasoning_effort"] = reasoning_effort

    if stream and model_config.get("supports_streaming"):
        return await _stream_azure_response(payload, model_name)

    return await _send_azure_request(payload, model_name)


def process_vision_messages(
    messages: List[Dict[str, str]], image_data: str, vision_detail: str = "auto"
) -> List[Dict[str, Any]]:
    """
    Process messages to include vision content with proper formatting.
    """
    last_message = messages[-1]
    base64_str = extract_base64_data(image_data)

    vision_message = {
        "role": "user",
        "content": [
            {"type": "text", "text": last_message["content"]},
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{base64_str}",
                    "detail": vision_detail,
                },
            },
        ],
    }
    return messages[:-1] + [vision_message]


def extract_base64_data(image_data: str) -> str:
    """
    Extract base64 data from image URL or raw base64 string.
    """
    if "base64," in image_data:
        return image_data.split("base64,")[1]
    return image_data


async def _send_azure_request(
    payload: Dict[str, Any], model_name: str
) -> Dict[str, Any]:
    """
    Send a standard (non-streaming) Azure OpenAI request.
    """
    url = f"{AZURE_OPENAI_ENDPOINT}/openai/deployments/{model_name}/chat/completions?api-version={API_VERSION}"
    headers: Dict[str, str] = {
        "Content-Type": "application/json",
        "api-key": AZURE_OPENAI_API_KEY,
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload, headers=headers, timeout=60)
            response.raise_for_status()
            return response.json()
    except httpx.RequestError as e:
        logger.error("Error calling Azure OpenAI: %s", e)
        raise RuntimeError("Unable to reach Azure OpenAI endpoint") from e
    except httpx.HTTPStatusError as e:
        logger.error("Azure OpenAI error: %s", e)
        raise RuntimeError(
            f"Azure OpenAI request failed: {e.response.status_code} => {e.response.text}"
        ) from e


async def _stream_azure_response(
    payload: Dict[str, Any], model_name: str
) -> AsyncGenerator[bytes, None]:
    """
    Handle streaming responses from Azure OpenAI.
    """
    url = f"{AZURE_OPENAI_ENDPOINT}/openai/deployments/{model_name}/chat/completions?api-version={API_VERSION}"
    headers = {"Content-Type": "application/json", "api-key": AZURE_OPENAI_API_KEY}

    try:
        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST", url, json=payload, headers=headers, timeout=60
            ) as response:
                response.raise_for_status()
                async for chunk in response.aiter_bytes():
                    yield chunk
    except httpx.RequestError as e:
        logger.error("Error streaming from Azure OpenAI: %s", e)
        raise RuntimeError("Unable to stream from Azure OpenAI") from e


#
# Claude Chat Handler
#
async def claude_chat(
    messages: list,
    model_name: str,
    max_tokens: int = 1000,
    enable_thinking: bool = False,
    thinking_budget: Optional[int] = None,
    stream: bool = False,
    image_data: Optional[str] = None,
) -> dict:
    """
    Handle Claude API requests with proper validation and error handling.
    """
    if model_name not in CLAUDE_MODELS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported Claude model: {model_name}. "
                f"Supported models: {list(CLAUDE_MODELS.keys())}"
            ),
        )

    model_config = CLAUDE_MODELS[model_name]

    # Vision data, if supported
    if image_data and model_config.get("supports_vision"):
        messages = _handle_claude_vision_data(messages, image_data)

    # Enforce streaming for large responses
    if max_tokens > model_config["requires_streaming"] and not stream:
        raise HTTPException(
            400,
            f"Streaming is required for max_tokens > {model_config['requires_streaming']}",
        )

    # Validate thinking parameters
    if enable_thinking:
        thinking_budget = thinking_budget or model_config["default_thinking"]
        thinking_budget = max(thinking_budget, model_config["min_thinking"])
        if thinking_budget >= max_tokens:
            raise HTTPException(
                400,
                f"Thinking budget ({thinking_budget}) must be less than max_tokens ({max_tokens})",
            )

    api_key = settings.CLAUDE_API_KEY
    if not api_key:
        logger.error("CLAUDE_API_KEY is not set in environment or .env file")
        raise HTTPException(500, "Missing Claude API key configuration in environment")

    headers = {
        "x-api-key": api_key,
        "anthropic-version": settings.CLAUDE_API_VERSION,
        "content-type": "application/json",
    }

    # Potential handling for special extended-thinking or extended contexts
    if model_name == "claude-3-7-sonnet-20250219":
        headers.update(
            {
                "anthropic-beta": "output-128k-2025-02-19",
                "anthropic-features": "extended-thinking-2025-02-19,long-context-2025-02-19",
            }
        )
        max_tokens = min(max_tokens, model_config["max_tokens"])

    payload = {
        "model": model_name,
        "max_tokens": max_tokens,
        "messages": _filter_claude_messages(messages),
    }

    # Extended thinking config
    if enable_thinking:
        budget = thinking_budget or model_config["default_thinking"]
        payload["thinking"] = {"type": "enabled", "budget_tokens": budget}
        # Some Claude features turn off temperature
        if "temperature" in payload:
            payload.pop("temperature")

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                settings.CLAUDE_BASE_URL, json=payload, headers=headers, timeout=30
            )
            response.raise_for_status()
            return _parse_claude_response(response.json())
    except httpx.RequestError as e:
        logger.error(f"Claude API Request Error: {str(e)}")
        raise HTTPException(500, "Unable to reach Claude API service") from e
    except httpx.HTTPStatusError as e:
        logger.error(
            f"Claude API HTTP Error: {e.response.status_code} => {e.response.text}"
        )
        raise HTTPException(
            e.response.status_code, f"Claude API Error: {e.response.text}"
        ) from e
    except Exception as e:
        logger.error(f"Claude API Unexpected Error: {str(e)}")
        raise HTTPException(500, f"Claude service unavailable: {str(e)}") from e


def _handle_claude_vision_data(messages: list, image_data: str) -> list:
    """
    Insert vision data into the final user message for Claude.
    """
    # For simplicity, only handle a single or multiple images as a list:
    if isinstance(image_data, str):
        images = [image_data]
    else:
        images = image_data

    if len(images) > 100:
        raise HTTPException(400, "Maximum 100 images per request with Claude")

    image_blocks = []
    for img in images:
        if img.startswith(("http://", "https://")):
            # URL-based
            image_blocks.append(
                {"type": "image", "source": {"type": "url", "url": img}}
            )
        else:
            # Base64-based
            image_blocks.append(
                {"type": "image", "source": {"type": "base64", "data": img}}
            )

    # Extract any user text from the last user message if present
    last_user_text = ""
    for msg in reversed(messages):
        if msg["role"] == "user" and isinstance(msg["content"], str):
            last_user_text = msg["content"]
            break

    # Remove the last user text-based message
    filtered_messages = [
        m
        for m in messages
        if not (m["role"] == "user" and isinstance(m["content"], str))
    ]

    # Reinsert combined text+image in a single message
    combined_content = []
    if last_user_text:
        combined_content += [{"type": "text", "text": last_user_text}]
    combined_content += image_blocks

    filtered_messages.append({"role": "user", "content": combined_content})
    return filtered_messages


def _filter_claude_messages(messages: list) -> list:
    """
    Convert any 'system' or 'assistant' roles if needed, remove invalid messages, etc.
    """
    filtered = []
    for msg in messages:
        if msg["role"] in ["system", "user", "assistant"] and msg.get("content"):
            filtered.append({"role": msg["role"], "content": msg["content"]})
    return filtered


def _parse_claude_response(response_data: dict) -> dict:
    """
    Parse Claude's extended response structure into a standard format with `choices`.
    """
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
            elif block_type == "redacted_thinking" and "redacted_thinking" in block:
                redacted_thinking_parts.append(block["redacted_thinking"])

        final_content = "".join(content_parts)
        resp_obj = {
            "choices": [{"message": {"content": final_content, "role": "assistant"}}],
            "has_thinking": bool(thinking_parts or redacted_thinking_parts),
        }
        if thinking_parts:
            resp_obj["thinking"] = "\n".join(thinking_parts)
        if redacted_thinking_parts:
            resp_obj["redacted_thinking"] = "\n".join(redacted_thinking_parts)
        return resp_obj

    # Unexpected structure
    return {
        "choices": [
            {
                "message": {
                    "content": "Error: Invalid response format.",
                    "role": "assistant",
                }
            }
        ]
    }


#
# Additional Utilities
#
async def count_claude_tokens(messages: List[Dict[str, str]], model_name: str) -> int:
    """
    Count tokens using Claude's token counting endpoint.
    Fallback to rough estimation if the endpoint fails.
    """
    if model_name not in CLAUDE_MODELS:
        raise ValueError(f"Unsupported model: {model_name}")

    headers = {
        "x-api-key": settings.CLAUDE_API_KEY,
        "anthropic-version": settings.CLAUDE_API_VERSION,
        "content-type": "application/json",
    }
    payload = {"model": model_name, "messages": messages}

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{settings.CLAUDE_BASE_URL}/count_tokens",
                json=payload,
                headers=headers,
                timeout=10,
            )
            response.raise_for_status()
            return response.json()["input_tokens"]
    except Exception as e:
        logger.error(f"Token counting failed: {str(e)}")
        total_chars = sum(len(msg.get("content", "")) for msg in messages)
        return total_chars // 4  # Rough fallback: ~4 chars per token


async def get_moderation(text: str) -> Dict[str, Any]:
    """
    Call the Azure OpenAI moderation endpoint.
    """
    try:
        return await azure_api_request(
            endpoint_path="openai/moderations", method="POST", data={"input": text}
        )
    except Exception as e:
        logger.error("Error during content moderation: %s", e)
        return {"error": str(e), "flagged": False}


#
# Example Helper for Simple Completion
#
async def get_completion(
    prompt: str, model_name: str = "o3-mini", max_tokens: int = 500
) -> str:
    """
    Simple wrapper for text completion to reduce duplication of chat message formatting.
    """
    messages = [{"role": "user", "content": prompt}]
    try:
        response = await openai_chat(
            messages=messages, model_name=model_name, max_tokens=max_tokens
        )
        return response["choices"][0]["message"]["content"]
    except Exception as e:
        logger.error("Error during text completion: %s", e)
        raise RuntimeError(f"Text completion failed: {str(e)}") from e
