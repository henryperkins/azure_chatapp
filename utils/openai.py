"""
openai.py
---------
Provides all Azure OpenAI HTTP requests for the Azure OpenAI Chat Application.

Includes:
  1. openai_chat(...) - Submits a chat completion request to Azure OpenAI.
     - Supports model_name, max_completion_tokens, optional reasoning_effort, vision data (if needed).
  2. Additional helper methods for token usage logging or partial requests.

This version has been trimmed to remove the general API request function that moved to response_utils.py.
"""

import logging
import os
from typing import List, Dict, Optional, Any

import httpx

from config import settings
from utils.response_utils import azure_api_request

logger = logging.getLogger(__name__)

# Azure OpenAI Configuration
AZURE_OPENAI_ENDPOINT = settings.AZURE_OPENAI_ENDPOINT.rstrip("/")
AZURE_OPENAI_API_KEY = settings.AZURE_OPENAI_API_KEY
API_VERSION = "2025-02-01-preview"


async def openai_chat(
    messages: List[Dict[str, str]],
    model_name: str = "o3-mini",
    max_completion_tokens: int = 500,
    reasoning_effort: Optional[str] = None,
    image_data: Optional[str] = None,
    vision_detail: str = "auto"
) -> dict:
    """
    Calls Azure OpenAI's chat completion API.
    Allows optional 'reasoning_effort' if using "o3-mini" or "o1".
    Includes optional image_data for the "o1" model's vision capabilities.

    :param messages: List of dicts with 'role': 'user'|'assistant'|'system', 'content': str
    :param model_name: The name of the Azure deployment to target (e.g. "o3-mini", "o1")
    :param max_completion_tokens: How many tokens the model can produce at most.
    :param reasoning_effort: 'low', 'medium', or 'high' for "o3-mini"/"o1" if relevant.
    :param image_data: If using "o1" vision support, pass raw image bytes here.
    :param vision_detail: Detail level for vision - "auto", "low", or "high"
    :return: The JSON response from Azure if successful, or raises an HTTPException otherwise.
    """
    valid_detail_values = ["auto", "low", "high"]
    if vision_detail not in valid_detail_values:
        raise ValueError(f"Invalid vision_detail: {vision_detail}. Must be one of {valid_detail_values}.")

    logger.debug("Loaded Azure OpenAI endpoint: '%s', key length: %d", AZURE_OPENAI_ENDPOINT, len(AZURE_OPENAI_API_KEY))
    if not AZURE_OPENAI_ENDPOINT or not AZURE_OPENAI_API_KEY:
        logger.error("Azure OpenAI endpoint or key is empty or missing.")
        raise ValueError("Azure OpenAI credentials not configured")

    url = f"{AZURE_OPENAI_ENDPOINT}/openai/deployments/{model_name}/chat/completions?api-version={API_VERSION}"
    headers = {
        "Content-Type": "application/json",
        "api-key": AZURE_OPENAI_API_KEY
    }

    payload = {
        "messages": messages,
        "max_completion_tokens": max_completion_tokens
    }

    logger.info("API Request | Model: %s", model_name)

    if reasoning_effort and model_name in ["o3-mini", "o1"]:
        payload["reasoning_effort"] = reasoning_effort

    if model_name == "o1" and image_data:
        # Check if multiple images exceed limit
        if image_data.count("base64,") > 1:
            # For now, we only handle a single image, but let's enforce a max 10
            if image_data.count("base64,") > 10:
                raise ValueError("Exceeded maximum of 10 images for vision API.")
            # If multiple images are present, we are not fully handling them, but let's proceed with the first
            logger.warning("Multiple images detected, using only the first one for now.")
            base64_str = image_data.split("base64,")[1]
        else:
            if "base64," in image_data:
                base64_str = image_data.split("base64,")[1]
            else:
                base64_str = image_data

        vision_message = {
            "role": "user",
            "content": [
                {"type": "text", "text": messages[-1]['content']},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{base64_str}",
                        "detail": vision_detail
                    }
                }
            ]
        }
        payload["messages"] = messages[:-1] + [vision_message]
        payload["max_completion_tokens"] = 1500

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
        raise RuntimeError(f"Azure OpenAI request failed: {e.response.status_code} => {e.response.text}") from e


def extract_base64_data(image_data: str) -> str:
    """
    Extract base64 data from image URL or raw base64 string.

    Args:
        image_data: Base64 image data, possibly with data URL prefix

    Returns:
        Raw base64 string without prefix
    """
    if "base64," in image_data:
        return image_data.split("base64,")[1]
    return image_data


async def get_completion(prompt: str, model_name: str = "o3-mini", max_tokens: int = 500) -> str:
    """
    Simple wrapper for text completion to reduce duplication of chat message formatting.

    Args:
        prompt: Text prompt to complete
        model_name: Azure OpenAI model to use
        max_tokens: Maximum tokens to generate

    Returns:
        Generated text content
    """
    messages = [{"role": "user", "content": prompt}]

    try:
        response = await openai_chat(
            messages=messages,
            model_name=model_name,
            max_completion_tokens=max_tokens
        )
        return response["choices"][0]["message"]["content"]
    except Exception as e:
        logger.error("Error during text completion: %s", e)
        raise RuntimeError(f"Text completion failed: {str(e)}") from e


async def claude_chat(messages: list, model_name: str, max_tokens: int = 1000) -> dict:
    """Handle Claude API requests"""
    from config import settings
    
    headers = {
        "x-api-key": settings.CLAUDE_API_KEY,
        "anthropic-version": settings.CLAUDE_API_VERSION,
        "content-type": "application/json"
    }

    payload = {
        "model": model_name,
        "messages": messages,
        "max_tokens": max_tokens,
        "stream": False
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                settings.CLAUDE_BASE_URL,
                json=payload,
                headers=headers,
                timeout=30
            )
            response.raise_for_status()
            return response.json()
    except Exception as e:
        logging.error(f"Claude API Error: {str(e)}")
        raise HTTPException(500, "Claude service unavailable")


async def get_moderation(text: str) -> Dict[str, Any]:
    """
    Call the Azure OpenAI moderation endpoint.

    Args:
        text: Text to moderate

    Returns:
        Moderation results
    """
    try:
        return await azure_api_request(
            endpoint_path="openai/moderations",
            method="POST",
            data={"input": text}
        )
    except Exception as e:
        logger.error("Error during content moderation: %s", e)
        return {"error": str(e), "flagged": False}
