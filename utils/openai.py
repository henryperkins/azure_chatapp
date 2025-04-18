# MODIFIED: openai.py
# Reason: Use config.settings for model info, handle reasoning params, vision, headers.
#         Enhanced with Sentry integration for error tracking, performance tracing, and metrics.

import logging
import random
import time
from typing import List, Dict, Optional, Any, Literal, AsyncGenerator, Union

import httpx
from fastapi import HTTPException
import sentry_sdk
from sentry_sdk import (
    start_transaction,
    capture_exception,
    configure_scope,
    set_tag,
    set_context,
    metrics
)

from config import settings  # Use centralized settings
from utils.response_utils import azure_api_request  # If used in other parts
from utils.sentry_utils import sentry_span, tag_transaction

logger = logging.getLogger(__name__)

# Replace or supplement these with environment-based sampling if desired
OPENAI_SAMPLE_RATE = 0.5  # 50% sampling for top-level calls
AZURE_SAMPLE_RATE = 1.0    # Always sample Azure calls
CLAUDE_SAMPLE_RATE = 1.0   # Always sample Claude calls

# -----------------------------
# Model Config Helpers
# -----------------------------

def get_model_config(model_name: str) -> Optional[Dict[str, Any]]:
    """Retrieve model configuration from settings."""
    if model_name in settings.AZURE_OPENAI_MODELS:
        return settings.AZURE_OPENAI_MODELS[model_name]
    if model_name in settings.CLAUDE_MODELS:
        return settings.CLAUDE_MODELS[model_name]
    return None

def get_azure_api_version(model_config: Dict[str, Any]) -> str:
    """Get the Azure API version from model config or fallback to default."""
    return model_config.get("api_version", settings.AZURE_DEFAULT_API_VERSION)

# -----------------------------
# Unified Chat Entry Point
# -----------------------------

async def openai_chat(
    messages: List[Dict[str, Any]], 
    model_name: str, 
    **kwargs
) -> Union[Dict[str, Any], AsyncGenerator[bytes, None]]:
    """
    Route to the appropriate provider handler based on the model_name.
    Includes Sentry-based tracing, error monitoring, and usage metrics.
    """
    transaction = start_transaction(
        op="ai",
        name=f"OpenAI Chat - {model_name}",
        sampled=random.random() < OPENAI_SAMPLE_RATE
    )

    try:
        with transaction:
            transaction.set_tag("ai.model", model_name)
            transaction.set_data("message_count", len(messages))
            transaction.set_data("streaming", kwargs.get("stream", False))

            # Track usage metrics
            metrics.incr("ai.request.count", tags={"model": model_name})
            request_start = time.time()

            # Retrieve model config
            model_config = get_model_config(model_name)
            if not model_config:
                supported = list(settings.AZURE_OPENAI_MODELS.keys()) + list(settings.CLAUDE_MODELS.keys())
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported model: {model_name}. Valid: {supported}"
                )
            transaction.set_tag("ai.provider", model_config.get("provider"))

            # Route to the appropriate provider
            provider = model_config.get("provider")
            if provider == "azure":
                result = await azure_chat(messages, model_name, model_config, **kwargs)
            elif provider == "anthropic":
                result = await claude_chat(messages, model_name, model_config, **kwargs)
            else:
                raise HTTPException(
                    status_code=500,
                    detail=f"Unknown provider '{provider}' for model {model_name}"
                )

            # Record success metrics
            duration_ms = (time.time() - request_start) * 1000
            metrics.distribution(
                "ai.request.duration",
                duration_ms,
                unit="millisecond",
                tags={"model": model_name, "provider": provider or "unknown"}
            )

            return result

    except HTTPException as http_exc:
        transaction.set_tag("error.type", "http")
        transaction.set_data("status_code", http_exc.status_code)
        metrics.incr("ai.request.failure", tags={
            "model": model_name, 
            "reason": "http_error",
            "status_code": http_exc.status_code
        })
        raise
    except Exception as e:
        transaction.set_tag("error", True)
        capture_exception(e)
        metrics.incr("ai.request.failure", tags={
            "model": model_name,
            "reason": "exception"
        })
        logger.error(f"Unified conversation error: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"AI request failed: {str(e)}"
        ) from e

# -----------------------------
# Azure Chat Handler
# -----------------------------

async def azure_chat(
    messages: List[Dict[str, Any]],
    model_name: str,
    model_config: Dict[str, Any],
    **kwargs
) -> Union[Dict[str, Any], AsyncGenerator[bytes, None]]:
    """
    Handle Azure OpenAI chat completions with Sentry-based monitoring.
    """
    transaction = start_transaction(
        op="ai.azure",
        name=f"Azure Chat - {model_name}",
        sampled=random.random() < AZURE_SAMPLE_RATE
    )
    try:
        with transaction:
            transaction.set_tag("model.id", model_name)

            # Validate parameters
            await validate_azure_params(model_name, model_config, kwargs)

            # Build payload
            payload = build_azure_payload(messages, model_name, model_config, **kwargs)
            api_version = get_azure_api_version(model_config)
            transaction.set_tag("azure.api_version", api_version)

            # Identify streaming
            if kwargs.get("stream") and "streaming" in model_config.get("capabilities", []):
                return _stream_azure_response(payload, model_name, api_version)
            else:
                response = await _send_azure_request(payload, model_name, api_version)
                # Check usage
                if response.get("usage"):
                    if "completion_tokens" in response["usage"]:
                        metrics.distribution(
                            "ai.azure.completion_tokens",
                            response["usage"]["completion_tokens"],
                            tags={"model": model_name}
                        )
                    # Reasoning tokens for advanced capability
                    if response["usage"].get("reasoning_tokens"):
                        metrics.distribution(
                            "ai.azure.reasoning_tokens",
                            response["usage"]["reasoning_tokens"],
                            tags={"model": model_name}
                        )
                return response

    except Exception as e:
        transaction.set_tag("error", True)
        capture_exception(e)
        metrics.incr("ai.azure.request.failure", tags={"model": model_name})
        logger.error(f"Azure chat error ({model_name}): {str(e)}")
        raise

# -----------------------------
# Azure Parameter Validation
# -----------------------------

async def validate_azure_params(
    model_name: str, 
    model_config: Dict[str, Any], 
    kwargs: dict
) -> None:
    """Validate Azure-specific parameters against model capabilities."""
    with sentry_span(op="ai.azure.validate_params", description="Validate Azure Chat Params"):
        capabilities = model_config.get("capabilities", [])
        parameters_config = model_config.get("parameters", {})

        # Check vision
        if kwargs.get("image_data"):
            if "vision" not in capabilities:
                raise ValueError(f"{model_name} doesn't support vision")
            vision_detail = kwargs.get("vision_detail", "auto")
            valid_details = parameters_config.get("vision_detail", [])
            if valid_details and vision_detail not in valid_details:
                raise ValueError(
                    f"Invalid vision_detail: {vision_detail}. Must be one of {valid_details}"
                )
            max_images = model_config.get("max_images", 1)
            num_images = (
                len(kwargs["image_data"]) if isinstance(kwargs["image_data"], list) else 1
            )
            if num_images > max_images:
                raise ValueError(
                    f"{model_name} supports max {max_images} images, but got {num_images}"
                )

        # Reasoning effort
        if kwargs.get("reasoning_effort"):
            if "reasoning_effort" not in capabilities:
                raise ValueError(f"{model_name} doesn't support reasoning_effort")
            valid_efforts = parameters_config.get("reasoning_effort", [])
            if valid_efforts and kwargs["reasoning_effort"] not in valid_efforts:
                raise ValueError(
                    f"Invalid reasoning_effort '{kwargs['reasoning_effort']}', must be in {valid_efforts}"
                )

def build_azure_payload(
    messages: List[Dict[str, Any]],
    model_name: str,
    model_config: Dict[str, Any],
    **kwargs
) -> Dict[str, Any]:
    """
    Construct the Azure request payload with error handling and default logic.
    Includes max_tokens, temperature, streaming, etc.
    """
    with sentry_span(op="ai.azure.build_payload", description="Build Azure Payload"):
        payload: Dict[str, Any] = {
            "messages": list(messages),  
        }

        # Max tokens approach
        model_max_completion = model_config.get("max_completion_tokens")
        model_max_tokens = model_config.get("max_tokens") 
        client_max_tokens = kwargs.get("max_tokens")
        
        if model_max_completion is not None:
            payload["max_completion_tokens"] = (
                min(client_max_tokens, model_max_completion)
                if client_max_tokens else model_max_completion
            )
        elif model_max_tokens is not None:
            # Standard model
            if client_max_tokens:
                payload["max_tokens"] = min(client_max_tokens, model_max_tokens)
            else:
                payload["max_tokens"] = model_max_tokens
        else:
            # Direct fallback to user request
            if client_max_tokens:
                payload["max_tokens"] = client_max_tokens

        # Unsupported params
        unsupported = model_config.get("unsupported_params", [])
        # Temperature
        if "temperature" not in unsupported and kwargs.get("temperature") is not None:
            payload["temperature"] = kwargs["temperature"]
        # Similarly handle top_p, presence_penalty, frequency_penalty, etc.

        # Reasoning effort
        if kwargs.get("reasoning_effort") and "reasoning_effort" in model_config.get("capabilities", []):
            payload["reasoning_effort"] = kwargs["reasoning_effort"]

        # Vision
        if kwargs.get("image_data") and "vision" in model_config.get("capabilities", []):
            payload["messages"] = process_vision_messages(
                payload["messages"], 
                kwargs["image_data"], 
                kwargs.get("vision_detail", "auto")
            )

        # Streaming
        if kwargs.get("stream") and "streaming" in model_config.get("capabilities", []):
            payload["stream"] = True

        # Developer message logic (o-series reasoning)
        if "developer_messages" in model_config.get("capabilities", []):
            # Example logic for rewriting system -> developer messages
            # ... Possibly modify messages[0] if role == 'system',...
            pass

        return payload

def process_vision_messages(
    messages: List[Dict[str, Any]],
    image_data: Union[str, List[str]],
    vision_detail: str = "auto"
) -> List[Dict[str, Any]]:
    """
    Insert images into the last user message for Azure vision models.
    If no existing user message, create one.
    """
    if not messages:
        raise ValueError("Messages list cannot be empty when adding vision data")

    last_user_index = -1
    for i in range(len(messages) - 1, -1, -1):
        if messages[i].get("role") == "user":
            last_user_index = i
            break
    if last_user_index == -1:
        messages.append({"role": "user", "content": []})
        last_user_index = len(messages) - 1

    user_msg = messages[last_user_index]
    if isinstance(user_msg.get("content"), str):
        user_msg["content"] = [{"type": "text", "text": user_msg["content"]}]

    images_to_process = [image_data] if isinstance(image_data, str) else image_data
    for img_data in images_to_process:
        base64_str = extract_base64_data(img_data)
        if base64_str:
            user_msg["content"].append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{base64_str}",
                    "detail": vision_detail
                }
            })
    messages[last_user_index] = user_msg
    return messages

def extract_base64_data(image_data: str) -> Optional[str]:
    """Extract base64 data from a data URI or raw base64 string."""
    if "base64," in image_data:
        parts = image_data.split("base64,")
        if len(parts) == 2:
            return parts[1]
    elif image_data.strip():
        # Possibly raw base64
        return image_data.strip()
    logger.warning("Could not parse base64 data from image_data.")
    return None

async def _send_azure_request(
    payload: Dict[str, Any],
    model_name: str,
    api_version: str
) -> Dict[str, Any]:
    """Send non-streaming Azure request with Sentry context."""
    if not settings.AZURE_OPENAI_ENDPOINT or not settings.AZURE_OPENAI_API_KEY:
        raise HTTPException(
            status_code=500, 
            detail="Azure configuration missing"
        )

    deployment_name = model_name
    url = f"{settings.AZURE_OPENAI_ENDPOINT.rstrip('/')}/openai/deployments/{deployment_name}/chat/completions?api-version={api_version}"
    headers = {
        "Content-Type": "application/json",
        "api-key": settings.AZURE_OPENAI_API_KEY
    }

    logger.debug(f"Azure request to {url} with payload: {payload}")

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                url,
                json=payload,
                headers=headers,
                timeout=120
            )
            response.raise_for_status()
            data = response.json()
            return data

    except httpx.RequestError as e:
        logger.error(f"Azure request error: {str(e)}")
        raise HTTPException(
            status_code=503,
            detail="Unable to reach Azure OpenAI service"
        ) from e
    except httpx.HTTPStatusError as e:
        detail = f"Azure request failed ({e.response.status_code})"
        try:
            err_data = e.response.json()
            if err_data.get("error", {}).get("message"):
                detail += f" - {err_data['error']['message']}"
        except Exception:
            detail += f" - {e.response.text[:200]}"
        logger.error(detail)
        raise HTTPException(status_code=e.response.status_code, detail=detail) from e

async def _stream_azure_response(
    payload: Dict[str, Any],
    model_name: str,
    api_version: str
) -> AsyncGenerator[bytes, None]:
    """Handle streaming Azure responses via an async generator."""
    if not settings.AZURE_OPENAI_ENDPOINT or not settings.AZURE_OPENAI_API_KEY:
        raise HTTPException(
            status_code=500, 
            detail="Azure configuration missing"
        )

    deployment_name = model_name
    url = f"{settings.AZURE_OPENAI_ENDPOINT.rstrip('/')}/openai/deployments/{deployment_name}/chat/completions?api-version={api_version}"
    headers = {
        "Content-Type": "application/json",
        "api-key": settings.AZURE_OPENAI_API_KEY
    }

    logger.debug(f"Streaming Azure request to {url} with payload: {payload}")

    try:
        async with httpx.AsyncClient() as client:
            async with client.stream("POST", url, json=payload, headers=headers, timeout=180) as resp:
                resp.raise_for_status()
                async for chunk in resp.aiter_bytes():
                    yield chunk
    except httpx.RequestError as e:
        logger.error(f"Error streaming from Azure OpenAI: {str(e)}")
        raise RuntimeError(f"Unable to stream from Azure: {e}") from e
    except httpx.HTTPStatusError as e:
        logger.error(f"Streaming HTTP error {e.response.status_code}: {e.response.text}")
        detail = f"Azure streaming error: {e.response.status_code} - {e.response.text[:200]}"
        raise RuntimeError(detail) from e

# -----------------------------
# Claude Chat Handler
# -----------------------------

async def claude_chat(
    messages: List[Dict[str, Any]],
    model_name: str,
    model_config: Dict[str, Any],
    **kwargs
) -> Dict[str, Any]:
    """Handle Claude requests with Sentry-based tracing."""
    transaction = start_transaction(
        op="ai.claude",
        name=f"Claude Chat - {model_name}",
        sampled=random.random() < CLAUDE_SAMPLE_RATE
    )
    try:
        with transaction:
            transaction.set_tag("model.id", model_name)

            if not settings.CLAUDE_API_KEY:
                raise HTTPException(status_code=500, detail="Claude API key not set")

            # Build payload
            payload = build_claude_payload(messages, model_name, model_config, **kwargs)

            # Prepare headers
            headers = {
                "x-api-key": settings.CLAUDE_API_KEY,
                "anthropic-version": settings.CLAUDE_API_VERSION,
                "content-type": "application/json",
            }
            if model_config.get("beta_headers"):
                headers.update(model_config["beta_headers"])

            # Streaming vs non-streaming
            if payload.get("stream"):
                # Return a generator for streaming
                return claude_stream_generator(payload, headers)
            else:
                # Non-streaming
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        settings.CLAUDE_BASE_URL,
                        json=payload,
                        headers=headers,
                        timeout=120
                    )
                    response.raise_for_status()
                    response_data = response.json()
                    return _parse_claude_response(response_data)

    except httpx.RequestError as e:
        transaction.set_tag("error", True)
        capture_exception(e)
        raise HTTPException(
            status_code=503,
            detail="Unable to reach Claude service"
        ) from e
    except httpx.HTTPStatusError as e:
        detail = f"Claude request failed ({e.response.status_code}): {e.response.text[:200]}"
        transaction.set_tag("error", True)
        capture_exception(e)
        raise HTTPException(e.response.status_code, detail=detail) from e
    except Exception as e:
        transaction.set_tag("error", True)
        capture_exception(e)
        raise HTTPException(
            status_code=500,
            detail=f"Claude chat error: {str(e)}"
        ) from e

def build_claude_payload(
    messages: List[Dict[str, Any]],
    model_name: str,
    model_config: Dict[str, Any],
    **kwargs
) -> Dict[str, Any]:
    """Construct the payload for Claude requests, including extended thinking and streaming."""
    with sentry_span(op="ai.claude.build_payload", description="Build Claude Payload"):
        payload = {
            "model": model_name,
            "messages": _filter_claude_messages(messages),
            "stream": kwargs.get("stream", False),
        }
        # Max tokens
        final_max_tokens = model_config.get("max_tokens", 4096)
        user_max = kwargs.get("max_tokens")
        if user_max:
            final_max_tokens = min(final_max_tokens, user_max)
        payload["max_tokens"] = final_max_tokens

        # Extended thinking
        if kwargs.get("enable_thinking"):
            thinking_config = model_config.get("extended_thinking_config", {})
            if "extended_thinking" in model_config.get("capabilities", []):
                budget = kwargs.get("thinking_budget") or thinking_config.get("default_budget", 16000)
                min_budget = thinking_config.get("min_budget", 1024)
                if budget < min_budget:
                    budget = min_budget
                payload["thinking"] = {"type": "enabled", "budget_tokens": budget}
                # Possibly remove temperature if thinking is on
                if "temperature" in kwargs:
                    logger.debug("Removing temperature param due to thinking enabled.")
            else:
                logger.warning("Thinking requested but not supported by this Claude model.")
        
        # Temperature
        if kwargs.get("temperature") is not None:
            payload["temperature"] = kwargs["temperature"]
        # Support top_p, top_k, etc. if relevant

        return payload

def _filter_claude_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Filter/transform messages to meet Claude's expected structure.
    Possibly handle vision data or advanced content here.
    """
    # Basic example: remove unsupported roles, ensure content is present
    filtered = []
    for msg in messages:
        role = msg.get("role")
        content = msg.get("content")
        if role not in ("system", "user", "assistant") or not content:
            continue
        filtered.append({"role": role, "content": content})
    return filtered

def _parse_claude_response(response_data: Dict[str, Any]) -> Dict[str, Any]:
    """Parse a non-streaming Claude response into a standard format."""
    parsed = {
        "id": response_data.get("id"),
        "model": response_data.get("model"),
        "usage": response_data.get("usage", {}),
        "stop_reason": response_data.get("stop_reason"),
        "choices": [],
        "thinking": None,
        "redacted_thinking": None,
        "has_thinking": False,
    }

    # Check content structure
    if "content" in response_data and isinstance(response_data["content"], list):
        text_parts = []
        thinking_parts = []
        redacted_parts = []
        for block in response_data["content"]:
            btype = block.get("type")
            if btype == "text":
                text_parts.append(block.get("text", ""))
            elif btype == "thinking":
                thinking_parts.append(block.get("thinking", ""))
                parsed["has_thinking"] = True
            elif btype == "redacted_thinking":
                redacted_parts.append(block.get("redacted_thinking", "[redacted]"))
                parsed["has_thinking"] = True

        final_text = "".join(text_parts)
        parsed["choices"] = [
            {
                "message": {"content": final_text, "role": "assistant"},
                "finish_reason": parsed["stop_reason"],
            }
        ]
        if thinking_parts:
            parsed["thinking"] = "\n".join(thinking_parts)
        if redacted_parts:
            parsed["redacted_thinking"] = "\n".join(redacted_parts)

    elif "choices" in response_data:
        # Possibly OpenAI-like fallback
        parsed["choices"] = response_data["choices"]
        if "usage" in response_data:
            parsed["usage"] = response_data["usage"]
    else:
        # Unexpected
        parsed["choices"] = [
            {
                "message": {"content": "Error: Invalid Claude response format", "role": "assistant"},
                "finish_reason": "error"
            }
        ]
    return parsed

async def claude_stream_generator(payload: Dict[str, Any], headers: Dict[str, str]) -> AsyncGenerator[bytes, None]:
    """Return a streaming async generator for Claude responses."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            settings.CLAUDE_BASE_URL,
            json=payload,
            headers=headers,
            timeout=180
        )
        resp.raise_for_status()

        async for chunk in resp.aiter_bytes():
            yield chunk

# -----------------------------
# Misc Utilities
# -----------------------------

async def count_claude_tokens(messages: List[Dict[str, Any]], model_name: str) -> int:
    """
    Rough token estimation for Claude if official token counting isn't available.
    """
    total_chars = 0
    for msg in messages:
        c = msg.get("content")
        if isinstance(c, str):
            total_chars += len(c)
    return total_chars // 4  # ~4 chars per token

async def get_moderation(text: str) -> Dict[str, Any]:
    """
    Example function calling Azure or other moderation endpoint.
    """
    # Adjust to your moderation API
    if not settings.AZURE_OPENAI_ENDPOINT or not settings.AZURE_OPENAI_API_KEY:
        logger.warning("Moderation service not configured")
        return {"flagged": False, "reason": "Not configured"}

    moderation_api_version = "2024-02-15-preview"
    endpoint_path = f"openai/deployments/text-moderation-005/moderations?api-version={moderation_api_version}"
    url = f"{settings.AZURE_OPENAI_ENDPOINT.rstrip('/')}/{endpoint_path}"
    headers = {
        "Content-Type": "application/json",
        "api-key": settings.AZURE_OPENAI_API_KEY
    }
    payload = {"input": text}
    
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(url, json=payload, headers=headers, timeout=15)
            r.raise_for_status()
            return r.json()
    except Exception as e:
        logger.error(f"Moderation call failed: {str(e)}")
        return {"error": str(e), "flagged": False}

async def get_completion(
    prompt: str, 
    model_name: str = "o3-mini", 
    max_tokens: int = 500, 
    **kwargs
) -> str:
    """
    Simple helper to retrieve a text completion without streaming.
    """
    messages = [{"role": "user", "content": prompt}]
    try:
        response_data = await openai_chat(
            messages=messages,
            model_name=model_name,
            max_tokens=max_tokens,
            **kwargs
        )
        if isinstance(response_data, AsyncGenerator):
            # If streaming was triggered inadvertently
            raise RuntimeError("Streaming not supported in get_completion method.")
        if isinstance(response_data, dict) and response_data.get("choices"):
            return response_data["choices"][0]["message"]["content"]
        logger.warning("Unexpected response format in get_completion")
        return "No valid completion."

    except HTTPException as e:
        logger.error(f"HTTP error in get_completion for {model_name}: {e.detail}")
        raise RuntimeError(f"Completion failed ({e.status_code}): {e.detail}") from e
    except Exception as e:
        logger.exception(f"Unexpected error in get_completion: {str(e)}")
        raise RuntimeError(f"Completion error: {str(e)}") from e