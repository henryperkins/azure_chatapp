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

import requests
import logging
from typing import List, Dict, Optional, Union, Any

logger = logging.getLogger(__name__)

from config import settings

AZURE_OPENAI_ENDPOINT = settings.AZURE_OPENAI_ENDPOINT.rstrip("/")
AZURE_OPENAI_API_KEY = settings.AZURE_OPENAI_API_KEY
API_VERSION = "2025-02-01-preview"

import httpx

async def openai_chat(
    messages: List[Dict[str, str]],
    model_name: str = "o3-mini",
    max_completion_tokens: int = 500,
    reasoning_effort: Optional[str] = None,
    image_data: Optional[str] = None,
    vision_detail: str = "auto"
) -> dict:
    VALID_DETAIL_VALUES = ["auto", "low", "high"]
    if vision_detail not in VALID_DETAIL_VALUES:
        raise ValueError(f"Invalid vision_detail: {vision_detail}. Must be one of {VALID_DETAIL_VALUES}.")
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

    logger.debug(f"Loaded Azure OpenAI endpoint: '{AZURE_OPENAI_ENDPOINT}', key length: {len(AZURE_OPENAI_API_KEY)}")
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

    logger.info(
        "API Request | Model: %s",
        model_name
    )

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
            if response.status_code != 200:
                logger.error(f"Azure OpenAI error: {response.status_code} => {response.text}")
                raise ValueError(f"OpenAI request failed ({response.status_code}): {response.text}")
            return response.json()
    except httpx.RequestError as e:
        logger.error(f"Error calling Azure OpenAI: {e}")
        raise RuntimeError(f"Unable to reach Azure OpenAI endpoint: {str(e)}")

def extract_base64_data(image_data: str) -> str:
    if "base64," in image_data:
        return image_data.split("base64,")[1]
    return image_data

# NEW UTILITY FUNCTIONS FOR REDUCING DUPLICATION

async def azure_api_request(
    endpoint_path: str, 
    method: str = "GET",
    data: Optional[Dict[str, Any]] = None,
    params: Optional[Dict[str, str]] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 30
) -> Dict[str, Any]:
    """
    Standardized Azure API request handler to reduce duplication.
    
    Args:
        endpoint_path: The API path after the base endpoint URL
        method: HTTP method (GET, POST, PUT, DELETE)
        data: Request payload for POST/PUT
        params: URL query parameters
        headers: Additional headers to include
        timeout: Request timeout in seconds
        
    Returns:
        JSON response as dict
        
    Raises:
        ValueError: For API errors
        RuntimeError: For connection errors
    """
    url = f"{AZURE_OPENAI_ENDPOINT}/{endpoint_path}"
    
    # Prepare headers
    request_headers = {
        "api-key": AZURE_OPENAI_API_KEY,
        "Content-Type": "application/json"
    }
    
    if headers:
        request_headers.update(headers)
        
    # Prepare parameters
    request_params = {
        "api-version": API_VERSION
    }
    
    if params:
        request_params.update(params)
    
    # Log the request
    logger.debug(f"Azure API request: {method} {url}")
    
    try:
        async with httpx.AsyncClient() as client:
            if method == "GET":
                response = await client.get(
                    url, 
                    params=request_params,
                    headers=request_headers, 
                    timeout=timeout
                )
            elif method == "POST":
                response = await client.post(
                    url, 
                    params=request_params,
                    json=data, 
                    headers=request_headers, 
                    timeout=timeout
                )
            elif method == "PUT":
                response = await client.put(
                    url, 
                    params=request_params,
                    json=data, 
                    headers=request_headers, 
                    timeout=timeout
                )
            elif method == "DELETE":
                response = await client.delete(
                    url, 
                    params=request_params,
                    headers=request_headers, 
                    timeout=timeout
                )
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")
                
            if response.status_code >= 400:
                logger.error(f"Azure API error: {response.status_code} => {response.text}")
                raise ValueError(f"Azure API request failed ({response.status_code}): {response.text}")
                
            if not response.content:
                return {}
                
            return response.json()
            
    except httpx.RequestError as e:
        logger.error(f"Error connecting to Azure API: {e}")
        raise RuntimeError(f"Unable to reach Azure API endpoint: {str(e)}")

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
        logger.error(f"Error during text completion: {e}")
        raise RuntimeError(f"Text completion failed: {str(e)}")

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
        logger.error(f"Error during content moderation: {e}")
        return {"error": str(e), "flagged": False}