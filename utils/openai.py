import random
import time
from typing import List, Optional, Any, AsyncGenerator, Union

import httpx
from fastapi import HTTPException
from sentry_sdk import start_transaction, capture_exception, metrics

from utils.model_registry import get_model_config as _central_get_model_config
from utils.model_registry import validate_model_and_params as _validate_model_params
from utils.tokens import count_tokens_messages
from config import settings
from utils.async_context import get_request_id, get_trace_id
import logging

OPENAI_SAMPLE_RATE = 0.5
AZURE_SAMPLE_RATE = 1.0
CLAUDE_SAMPLE_RATE = 1.0

RESPONSES_API_MODELS = {
    "o3",
    "o3-mini",
    "o4-mini",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
}

def is_reasoning_model(model_name: str) -> bool:
    """Check if a model supports reasoning."""
    return model_name in {
        "o1",
        "o3",
        "o3-mini",
        "o4-mini",
        "gpt-4.1",
        "gpt-4.1-mini",
        "gpt-4.1-nano",
    }

def get_azure_api_version(model_config: dict[str, Any]) -> str:
    """Retrieve Azure API version or fall back to default."""
    return model_config.get("api_version", settings.AZURE_DEFAULT_API_VERSION)

# -----------------------------
# Unified Chat Entry Point
# -----------------------------

async def openai_chat(
    messages: List[dict[str, Any]], model_name: str, logger=None, **kwargs
) -> Union[dict[str, Any], AsyncGenerator[bytes, None]]:
    """Entry point that routes chat requests to Azure or Anthropic (Claude)."""
    # Ensure the variable exists for type-checking tools even if an exception is
    # raised before the ``start_transaction`` context manager is entered.
    transaction = None  # noqa: F841 – will be reassigned inside the context
    if logger is None:
        logger = logging.getLogger(__name__)

    request_id = get_request_id()
    trace_id = get_trace_id()
    logger.info(
        "OpenAI chat request started",
        extra={
            "model_name": model_name,
            "message_count": len(messages),
            "request_id": request_id,
            "trace_id": trace_id,
        },
    )

    try:
        with start_transaction(
            op="ai", name=f"OpenAI Chat - {model_name}", sampled=random.random() < OPENAI_SAMPLE_RATE
        ) as transaction:
            transaction.set_tag("ai.model", model_name)
            transaction.set_tag("request_id", request_id)
            transaction.set_tag("trace_id", trace_id)
            metrics.incr("ai.request.count", tags={"model": model_name})
            start_time = time.time()

            model_config = _central_get_model_config(model_name, settings)
            if not model_config:
                supported = list(settings.AZURE_OPENAI_MODELS.keys()) + list(
                    settings.CLAUDE_MODELS.keys()
                )
                logger.error(
                    "Unsupported model requested",
                    extra={"model_name": model_name, "request_id": request_id},
                )
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported model: {model_name}. Valid: {supported}",
                )

            provider = model_config.get("provider")
            transaction.set_tag("ai.provider", provider)

            if provider == "azure":
                result = await azure_chat(messages, model_name, model_config, logger=logger, **kwargs)
            elif provider == "anthropic":
                result = await claude_chat(messages, model_name, model_config, logger=logger, **kwargs)
            else:
                logger.error(
                    "Unknown model provider",
                    extra={"model_name": model_name, "provider": provider},
                )
                raise HTTPException(
                    status_code=500,
                    detail=f"Unknown provider '{provider}' for model {model_name}",
                )

            duration_ms = (time.time() - start_time) * 1000
            metrics.distribution(
                "ai.request.duration",
                duration_ms,
                unit="millisecond",
                tags={"model": model_name, "provider": provider or "unknown"},
            )
            logger.info(
                "OpenAI chat request finished",
                extra={"model_name": model_name, "duration_ms": duration_ms},
            )
            return result

    except HTTPException as http_exc:
        if transaction is not None:
            transaction.set_tag("error.type", "http")
            transaction.set_data("status_code", http_exc.status_code)
        metrics.incr(
            "ai.request.failure",
            tags={"model": model_name, "reason": "http_error", "status_code": http_exc.status_code},
        )
        logger.error(
            "HTTP error in openai_chat",
            extra={"model_name": model_name, "status_code": http_exc.status_code, "detail": http_exc.detail},
        )
        raise
    except Exception as e:
        if transaction is not None:
            transaction.set_tag("error", True)
        capture_exception(e)
        metrics.incr("ai.request.failure", tags={"model": model_name, "reason": "exception"})
        logger.error(
            "Unexpected error in openai_chat",
            extra={"model_name": model_name, "error_type": type(e).__name__},
        )
        raise HTTPException(status_code=500, detail=f"AI request failed: {str(e)}") from e

# -----------------------------
# Azure Chat Handler
# -----------------------------

async def azure_chat(
    messages: List[dict[str, Any]],
    model_name: str,
    model_config: dict[str, Any],
    logger=None,
    **kwargs,
) -> Union[dict[str, Any], AsyncGenerator[bytes, None]]:
    """Entry point for Azure chat or Responses API."""
    # Declare here so that it is always defined for the ``except`` block below
    transaction = None  # noqa: F841 – reassigned inside ``start_transaction``
    if logger is None:
        logger = logging.getLogger(__name__)

    request_id = get_request_id()
    trace_id = get_trace_id()
    logger.info(
        "Azure chat request",
        extra={
            "model_name": model_name,
            "message_count": len(messages),
            "request_id": request_id,
            "trace_id": trace_id,
        },
    )

    try:
        with start_transaction(
            op="ai.azure",
            name=f"Azure Chat - {model_name}",
            sampled=random.random() < AZURE_SAMPLE_RATE,
        ) as transaction:
            transaction.set_tag("model.id", model_name)
            transaction.set_tag("request_id", request_id)
            transaction.set_tag("trace_id", trace_id)
            await validate_azure_params(model_name, model_config, kwargs, logger=logger)

            if model_name in RESPONSES_API_MODELS:
                payload = build_azure_payload(messages, model_name, model_config, logger=logger, **kwargs)
                api_version = get_azure_api_version(model_config)
                response = await _send_azure_responses_request(payload, model_name, api_version, logger=logger)
                return response
            else:
                payload = build_azure_payload(messages, model_name, model_config, logger=logger, **kwargs)
                api_version = get_azure_api_version(model_config)

                if kwargs.get("stream") and "streaming" in model_config.get("capabilities", []):
                    return _stream_azure_response(payload, model_name, api_version, logger=logger)
                else:
                    response = await _send_azure_request(payload, model_name, api_version, logger=logger)
                    if response.get("usage"):
                        usage = response["usage"]
                        logger.info(
                            "Azure usage",
                            extra={
                                "model_name": model_name,
                                "completion_tokens": usage.get("completion_tokens"),
                                "prompt_tokens": usage.get("prompt_tokens"),
                                "reasoning_tokens": usage.get("reasoning_tokens"),
                            },
                        )
                        if "completion_tokens" in usage:
                            metrics.distribution(
                                "ai.azure.completion_tokens",
                                usage["completion_tokens"],
                                tags={"model": model_name},
                            )
                        if usage.get("reasoning_tokens"):
                            metrics.distribution(
                                "ai.azure.reasoning_tokens",
                                usage["reasoning_tokens"],
                                tags={"model": model_name},
                            )
                    return response
    except Exception as e:
        # ``transaction`` may still be ``None`` if the failure happened before
        # the context manager was entered.
        if transaction is not None:
            transaction.set_tag("error", True)
        capture_exception(e)
        metrics.incr("ai.azure.request.failure", tags={"model": model_name})
        logger.error(
            "Azure chat request failed",
            extra={
                "model_name": model_name,
                "error_type": type(e).__name__,
                "request_id": request_id,
                "trace_id": trace_id,
            },
        )
        raise

def _convert_messages_to_responses_format(
    messages: List[dict[str, Any]],
) -> List[dict[str, Any]]:
    """Convert standard Chat messages to the Responses API input format."""
    converted_messages = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if isinstance(content, str):
            converted_messages.append(
                {"type": "message", "role": role, "content": [{"type": "input_text", "text": content}]}
            )
        elif isinstance(content, list):
            parts = []
            for part in content:
                if isinstance(part, dict):
                    ptype = part.get("type", "text")
                    if ptype == "text":
                        parts.append({"type": "input_text", "text": part.get("text", "")})
                    elif ptype == "image_url":
                        parts.append(
                            {"type": "input_image", "image_url": part.get("image_url", {}).get("url", "")}
                        )
                    else:
                        parts.append(part)
                else:
                    parts.append({"type": "input_text", "text": str(part)})
            converted_messages.append({"type": "message", "role": role, "content": parts})
        else:
            converted_messages.append(
                {"type": "message", "role": role, "content": [{"type": "input_text", "text": str(content)}]}
            )
    return converted_messages

def _convert_responses_to_chat_format(
    data: dict[str, Any],
    message_text: Optional[str],
    reasoning_summary: Optional[str],
    usage: dict[str, Any],
    reasoning_tokens: Optional[int],
) -> dict[str, Any]:
    """Converts a Responses API answer back into standardized Chat format."""
    chat_response = {
        "id": data.get("id", ""),
        "object": "chat.completion",
        "created": int(data.get("created_at", 0)),
        "model": data.get("model", ""),
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": message_text or ""},
                "finish_reason": data.get("status", "completed"),
            }
        ],
        "usage": {
            "prompt_tokens": usage.get("input_tokens", 0),
            "completion_tokens": usage.get("output_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
        },
    }
    if reasoning_summary:
        chat_response["reasoning_summary"] = reasoning_summary
    if reasoning_tokens is not None:
        chat_response["reasoning_tokens"] = reasoning_tokens
        usage_dict = chat_response.get("usage")
        if isinstance(usage_dict, dict):
            usage_dict["reasoning_tokens"] = reasoning_tokens
    chat_response["raw_response"] = data
    return chat_response

async def _send_azure_responses_request(
    payload: dict[str, Any], model_name: str, api_version: str, logger=None
) -> dict[str, Any]:
    """Send request to the Azure Responses API."""
    if logger is None:
        logger = logging.getLogger(__name__)

    if not settings.AZURE_OPENAI_ENDPOINT or not settings.AZURE_OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="Azure config missing")

    url = f"{settings.AZURE_OPENAI_ENDPOINT.rstrip('/')}/openai/responses?api-version={api_version}"
    headers = {
        "Content-Type": "application/json",
        "api-key": settings.AZURE_OPENAI_API_KEY,
    }

    # Convert messages to the Responses API format.
    input_messages = _convert_messages_to_responses_format(payload.get("messages", []))
    responses_payload = {"model": model_name, "input": input_messages}
    if "reasoning" in payload and payload["reasoning"]:
        responses_payload["reasoning"] = payload["reasoning"]
    if "max_completion_tokens" in payload:
        responses_payload["max_output_tokens"] = payload["max_completion_tokens"]
    elif "max_tokens" in payload:
        responses_payload["max_output_tokens"] = payload["max_tokens"]
    if "stream" in payload:
        responses_payload["stream"] = payload["stream"]

    try:
        data = await _send_azure_post_request(url, responses_payload, headers, timeout=120, logger=logger)
        if data.get("object") == "response" and "output" in data:
            output_items = data["output"]
            message_item = next((it for it in output_items if it.get("type") == "message"), None)
            message_text = None
            if message_item:
                text_block = next(
                    (block for block in message_item.get("content", []) if block.get("type") == "output_text"), None
                )
                if text_block:
                    message_text = text_block.get("text", "")
            reasoning_item = next((it for it in output_items if it.get("type") == "reasoning"), None)
            reasoning_summary = None
            if reasoning_item and "summary" in reasoning_item:
                summary_texts = [s.get("text") for s in reasoning_item.get("summary", []) if s.get("text")]
                if summary_texts:
                    reasoning_summary = "\n".join(summary_texts)

            usage = data.get("usage", {})
            reasoning_tokens = None
            if usage.get("output_tokens_details"):
                reasoning_tokens = usage["output_tokens_details"].get("reasoning_tokens")
            return _convert_responses_to_chat_format(data, message_text, reasoning_summary, usage, reasoning_tokens)
        return data
    except httpx.RequestError as e:
        logger.error(f"Azure Responses request error: {str(e)}")
        raise HTTPException(status_code=503, detail="Unable to reach Azure Responses API") from e

async def validate_azure_params(
    model_name: str, model_config: dict[str, Any], kwargs: dict, logger=None
) -> None:
    """Check Azure-specific parameters after generic validation."""
    if logger is None:
        logger = logging.getLogger(__name__)

    _validate_model_params(model_name, kwargs)

    capabilities = model_config.get("capabilities", [])
    if kwargs.get("enable_markdown_formatting") and "markdown_formatting" not in capabilities:
        raise ValueError(f"{model_name} doesn't support markdown formatting")

    reasoning_summary = kwargs.get("reasoning_summary") or kwargs.get("summary")
    if reasoning_summary and "reasoning_summary" not in capabilities and "reasoning" not in capabilities:
        raise ValueError(f"{model_name} doesn't support reasoning summaries.")

def build_azure_payload(
    messages: List[dict[str, Any]],
    model_name: str,
    model_config: dict[str, Any],
    logger=None,
    **kwargs,
) -> dict[str, Any]:
    """Construct an Azure request payload with default logic.

    The *logger* parameter is optional and is only used for emitting a verbose
    debug message. Accepting it keeps the public function signature stable so
    that callers can forward their logger instance without special-casing it
    out of **kwargs.
    """

    if logger is None:
        logger = logging.getLogger(__name__)

    logger.debug(
        "Building Azure payload",
        extra={"model_name": model_name, "message_count": len(messages)},
    )

    payload: dict[str, Any] = {"messages": list(messages)}
    model_max_completion = model_config.get("max_completion_tokens")
    model_max_tokens = model_config.get("max_tokens")
    client_max_tokens = kwargs.get("max_tokens")

    if model_max_completion is not None:
        payload["max_completion_tokens"] = (
            min(client_max_tokens, model_max_completion) if client_max_tokens else model_max_completion
        )
        payload.pop("max_tokens", None)
    elif model_max_tokens is not None:
        if client_max_tokens:
            payload["max_tokens"] = min(client_max_tokens, model_max_tokens)
        else:
            payload["max_tokens"] = model_max_tokens
        payload.pop("max_completion_tokens", None)
    else:
        if client_max_tokens:
            payload["max_tokens"] = client_max_tokens
            payload.pop("max_completion_tokens", None)

    unsupported = model_config.get("unsupported_params", [])
    if "temperature" not in unsupported and kwargs.get("temperature") is not None:
        payload["temperature"] = kwargs["temperature"]

    if kwargs.get("enable_markdown_formatting") and "markdown_formatting" in model_config.get("capabilities", []):
        payload["enable_markdown_formatting"] = True

    if is_reasoning_model(model_name):
        if model_name in RESPONSES_API_MODELS:
            reasoning_obj = {"effort": kwargs.get("reasoning_effort", "medium")}
            if kwargs.get("reasoning_summary") is not None:
                reasoning_obj["summary"] = kwargs["reasoning_summary"]
            payload["reasoning"] = reasoning_obj
            payload.pop("reasoning_effort", None)
            payload.pop("reasoning_summary", None)
        else:
            if kwargs.get("reasoning_effort"):
                payload["reasoning_effort"] = kwargs["reasoning_effort"]

    if kwargs.get("image_data") and "vision" in model_config.get("capabilities", []):
        payload["messages"] = process_vision_messages(
            payload["messages"], kwargs["image_data"], kwargs.get("vision_detail", "auto")
        )

    if kwargs.get("stream") and "streaming" in model_config.get("capabilities", []):
        payload["stream"] = True

    return payload

def process_vision_messages(
    messages: List[dict[str, Any]], image_data: Union[str, List[str]], vision_detail: str = "auto"
) -> List[dict[str, Any]]:
    """Add images to the last user message for Vision models."""
    if not messages:
        raise ValueError("No messages to attach vision data to.")

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

    if isinstance(image_data, str):
        images_to_process = [image_data]
    else:
        images_to_process = image_data

    for img_data in images_to_process:
        base64_str = extract_base64_data(img_data)
        if base64_str:
            user_msg["content"].append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{base64_str}",
                        "detail": vision_detail,
                    },
                }
            )
    messages[last_user_index] = user_msg
    return messages

def extract_base64_data(image_data: str, logger=None) -> Optional[str]:
    """Extract base64 data from either a data URI or a raw base64 string."""
    if "base64," in image_data:
        parts = image_data.split("base64,")
        if len(parts) == 2:
            return parts[1]
    elif image_data.strip():
        return image_data.strip()

    if logger is None:
        logger = logging.getLogger(__name__)
    logger.warning("Could not parse base64 data.")
    return None

async def _send_azure_request(
    payload: dict[str, Any], model_name: str, api_version: str, logger=None
) -> dict[str, Any]:
    """Send non-streaming Azure Chat Completions request."""
    if logger is None:
        logger = logging.getLogger(__name__)

    if not settings.AZURE_OPENAI_ENDPOINT or not settings.AZURE_OPENAI_API_KEY:
        logger.error("Azure config missing")
        raise HTTPException(status_code=500, detail="Azure config missing")

    deployment_name = model_name
    url = f"{settings.AZURE_OPENAI_ENDPOINT.rstrip('/')}/openai/deployments/{deployment_name}/chat/completions?api-version={api_version}"
    headers = {
        "Content-Type": "application/json",
        "api-key": settings.AZURE_OPENAI_API_KEY,
    }
    try:
        data = await _send_azure_post_request(url, payload, headers, timeout=120, logger=logger)
        return data
    except httpx.RequestError as e:
        logger.error(f"Azure request error: {str(e)}")
        raise HTTPException(status_code=503, detail="Unable to reach Azure service") from e

async def _stream_azure_response(
    payload: dict[str, Any], model_name: str, api_version: str, logger=None
) -> AsyncGenerator[bytes, None]:
    """Stream Azure Chat response."""
    if logger is None:
        logger = logging.getLogger(__name__)
    if not settings.AZURE_OPENAI_ENDPOINT or not settings.AZURE_OPENAI_API_KEY:
        logger.error("Azure config missing for streaming")
        raise HTTPException(status_code=500, detail="Azure config missing")

    deployment_name = model_name
    url = f"{settings.AZURE_OPENAI_ENDPOINT.rstrip('/')}/openai/deployments/{deployment_name}/chat/completions?api-version={api_version}"
    headers = {
        "Content-Type": "application/json",
        "api-key": settings.AZURE_OPENAI_API_KEY,
    }
    try:
        async with httpx.AsyncClient() as client:
            async with client.stream("POST", url, json=payload, headers=headers, timeout=180) as resp:
                resp.raise_for_status()
                async for chunk in resp.aiter_bytes():
                    yield chunk
    except httpx.RequestError as e:
        logger.error(f"Error streaming from Azure: {str(e)}")
        raise RuntimeError(f"Unable to stream from Azure: {e}") from e
    except httpx.HTTPStatusError as e:
        detail = f"Azure streaming error: {e.response.status_code} - {e.response.text[:200]}"
        logger.error(detail)
        raise RuntimeError(detail) from e

# Unified “post request” helper to reduce code repetition
async def _send_azure_post_request(
    url: str,
    data: dict[str, Any],
    headers: dict[str, str],
    timeout: int,
    logger=None,
) -> dict[str, Any]:
    """Posts JSON data to Azure, raising HTTPException on error."""
    if logger is None:
        logger = logging.getLogger(__name__)
    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json=data, headers=headers, timeout=timeout)
        resp.raise_for_status()
        return resp.json()

# -----------------------------
# Anthropic / Claude Handler
# -----------------------------

async def claude_chat(
    messages: List[dict[str, Any]],
    model_name: str,
    model_config: dict[str, Any],
    **kwargs,
) -> Union[dict[str, Any], AsyncGenerator[bytes, None]]:
    """Route a chat request to Claude."""
    # Predeclare for type-checkers; reassigned once the Sentry transaction is
    # successfully started.
    transaction = None  # noqa: F841 – reassigned later when available
    logger = kwargs.get("logger", logging.getLogger(__name__))
    try:
        with start_transaction(
            op="ai.claude", name=f"Claude Chat - {model_name}", sampled=random.random() < CLAUDE_SAMPLE_RATE
        ) as transaction:
            transaction.set_tag("model.id", model_name)
            if not settings.CLAUDE_API_KEY:
                raise HTTPException(status_code=500, detail="Claude API key missing")

            payload = build_claude_payload(messages, model_name, model_config, logger=logger, **kwargs)
            headers = {
                "x-api-key": settings.CLAUDE_API_KEY,
                "anthropic-version": settings.CLAUDE_API_VERSION,
                "content-type": "application/json",
            }
            if model_config.get("beta_headers"):
                headers.update(model_config["beta_headers"])

            if payload.get("stream"):
                return claude_stream_generator(payload, headers)
            else:
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        settings.CLAUDE_BASE_URL, json=payload, headers=headers, timeout=120
                    )
                    response.raise_for_status()
                    return _parse_claude_response(response.json())
    except httpx.RequestError as e:
        if transaction is not None:
            transaction.set_tag("error", True)
        capture_exception(e)
        raise HTTPException(status_code=503, detail="Unable to reach Claude service") from e
    except httpx.HTTPStatusError as e:
        detail = f"Claude request failed ({e.response.status_code}): {e.response.text[:200]}"
        if transaction is not None:
            transaction.set_tag("error", True)
        capture_exception(e)
        raise HTTPException(e.response.status_code, detail=detail) from e
    except Exception as e:
        if transaction is not None:
            transaction.set_tag("error", True)
        capture_exception(e)
        raise HTTPException(status_code=500, detail=f"Claude chat error: {str(e)}") from e

def build_claude_payload(
    messages: List[dict[str, Any]],
    model_name: str,
    model_config: dict[str, Any],
    logger=None,
    **kwargs,
) -> dict[str, Any]:
    """Build a payload for Claude, including optional extended thinking."""
    if logger is None:
        logger = logging.getLogger(__name__)

    payload = {
        "model": model_name,
        "messages": _filter_claude_messages(messages),
        "stream": kwargs.get("stream", False),
    }
    final_max_tokens = model_config.get("max_tokens", 4096)
    user_max = kwargs.get("max_tokens")
    if user_max:
        final_max_tokens = min(final_max_tokens, user_max)
    payload["max_tokens"] = final_max_tokens

    if kwargs.get("enable_thinking"):
        thinking_config = model_config.get("extended_thinking_config", {})
        if "extended_thinking" in model_config.get("capabilities", []):
            budget = kwargs.get("thinking_budget") or thinking_config.get("default_budget", 16000)
            min_budget = thinking_config.get("min_budget", 1024)
            if budget < min_budget:
                budget = min_budget
            payload["thinking"] = {"type": "enabled", "budget_tokens": budget}
        else:
            logger.warning("Thinking requested but not supported by this Claude model.")

    if kwargs.get("temperature") is not None:
        payload["temperature"] = kwargs["temperature"]
    return payload

def _filter_claude_messages(messages: List[dict[str, Any]]) -> List[dict[str, Any]]:
    """Filter messages for Claude's format."""
    filtered = []
    for msg in messages:
        role = msg.get("role")
        content = msg.get("content")
        if role in ("system", "user", "assistant") and content:
            filtered.append({"role": role, "content": content})
    return filtered

def _parse_claude_response(response_data: dict[str, Any]) -> dict[str, Any]:
    """Parse a non-stream Claude response into standard form."""
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
            {"message": {"content": final_text, "role": "assistant"}, "finish_reason": parsed["stop_reason"]}
        ]
        if thinking_parts:
            parsed["thinking"] = "\n".join(thinking_parts)
        if redacted_parts:
            parsed["redacted_thinking"] = "\n".join(redacted_parts)
    elif "choices" in response_data:
        parsed["choices"] = response_data["choices"]
        if "usage" in response_data:
            parsed["usage"] = response_data["usage"]
    else:
        parsed["choices"] = [
            {
                "message": {"content": "Error: Invalid Claude response format", "role": "assistant"},
                "finish_reason": "error",
            }
        ]
    return parsed

async def claude_stream_generator(
    payload: dict[str, Any], headers: dict[str, str]
) -> AsyncGenerator[bytes, None]:
    """Stream Claude output via an async generator."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(settings.CLAUDE_BASE_URL, json=payload, headers=headers, timeout=180)
        resp.raise_for_status()
        async for chunk in resp.aiter_bytes():
            yield chunk

# -----------------------------
# Misc Utilities
# -----------------------------

async def count_claude_tokens(messages: List[dict[str, Any]], model_name: str) -> int:
    """Proxy token counting to shared helper."""
    return count_tokens_messages(messages, model_id=model_name)

async def get_moderation(text: str) -> dict[str, Any]:
    """Example function calling Azure or other moderation endpoint."""
    logger = logging.getLogger(__name__)
    if not settings.AZURE_OPENAI_ENDPOINT or not settings.AZURE_OPENAI_API_KEY:
        logger.warning("Moderation not configured")
        return {"flagged": False, "reason": "Not configured"}

    moderation_api_version = "2024-02-15-preview"
    endpoint_path = f"openai/deployments/text-moderation-005/moderations?api-version={moderation_api_version}"
    url = f"{settings.AZURE_OPENAI_ENDPOINT.rstrip('/')}/{endpoint_path}"
    headers = {
        "Content-Type": "application/json",
        "api-key": settings.AZURE_OPENAI_API_KEY,
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
    prompt: str, model_name: str = "o3-mini", max_tokens: int = 500, **kwargs
) -> str:
    """Retrieve a simple text completion."""
    logger = logging.getLogger(__name__)
    messages = [{"role": "user", "content": prompt}]
    try:
        response_data = await openai_chat(
            messages=messages, model_name=model_name, max_tokens=max_tokens, **kwargs
        )
        if isinstance(response_data, AsyncGenerator):
            raise RuntimeError("Streaming not supported in get_completion.")
        if isinstance(response_data, dict) and response_data.get("choices"):
            return response_data["choices"][0]["message"]["content"]
        logger.warning("Unexpected response format in get_completion.")
        return "No valid completion."

    except HTTPException as e:
        logger.error(f"HTTP error in get_completion for {model_name}: {e.detail}")
        raise RuntimeError(f"Completion failed ({e.status_code}): {e.detail}") from e
    except Exception as e:
        logger.exception(f"Unexpected error in get_completion: {str(e)}")
        raise RuntimeError(f"Completion error: {str(e)}") from e
