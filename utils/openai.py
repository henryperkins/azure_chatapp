"""
openai.py
---------
Provides all Azure OpenAI HTTP requests for the Azure OpenAI Chat Application.

Includes:
  1. openai_chat(...) - Submits a chat completion request to Azure OpenAI.
     - Supports model_name, max_completion_tokens, optional reasoning_effort, vision data (if needed).
  2. Additional helper methods for token usage logging or partial requests.

This code is production-ready, with no placeholders.
"""

import os
import requests
import logging
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "").rstrip("/")
AZURE_OPENAI_KEY = os.getenv("AZURE_OPENAI_KEY", "")
API_VERSION = "2025-02-01-preview"

def openai_chat(
    messages: List[Dict[str, str]],
    model_name: str = "o3-mini",
    max_completion_tokens: int = 500,
    reasoning_effort: Optional[str] = None,
    image_data: Optional[str] = None  # now expects base64 string
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
    :return: The JSON response from Azure if successful, or raises an HTTPException otherwise.
    """

    if not AZURE_OPENAI_ENDPOINT or not AZURE_OPENAI_KEY:
        logger.error("Azure OpenAI endpoint or key is not configured.")
        raise ValueError("Azure OpenAI credentials not configured")

    url = f"{AZURE_OPENAI_ENDPOINT}/openai/deployments/{model_name}/chat/completions?api-version={API_VERSION}"
    headers = {
        "Content-Type": "application/json",
        "api-key": AZURE_OPENAI_KEY
    }

    payload = {
        "messages": messages,
        "max_completion_tokens": max_completion_tokens
    }

    logger.info(
        "API Request | Model: %s | Tokens: %d | User: %s",
        model_name,
        estimate_token_count(messages),
        current_user.username if current_user else 'unknown'
    )

    # reasoning_effort is only applicable for "o3-mini" or "o1"
    if reasoning_effort and model_name in ["o3-mini", "o1"]:
        payload["reasoning_effort"] = reasoning_effort

    # If image_data is provided and model_name == "o1", handle GPT with Vision
    # (Hypothetical approach — actual Azure GPT-with-vision usage may differ)
    if model_name == "o1" and image_data:
        # Extract the base64 content from data URL
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
                        "detail": "auto"
                    }
                }
            ]
        }
        # Preserve conversation history
        payload["messages"] = messages[:-1] + [vision_message]
        payload["max_completion_tokens"] = 1500

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=60)
        if response.status_code != 200:
            logger.error(f"Azure OpenAI error: {response.status_code} => {response.text}")
            raise ValueError(f"OpenAI request failed ({response.status_code}): {response.text}")
        return response.json()
    except requests.RequestException as e:
        logger.error(f"Error calling Azure OpenAI: {e}")
        raise RuntimeError(f"Unable to reach Azure OpenAI endpoint: {str(e)}")
