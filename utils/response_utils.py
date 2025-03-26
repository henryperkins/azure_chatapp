from datetime import datetime
import httpx
import logging
from uuid import uuid4
from config import settings


logger = logging.getLogger(__name__)

# Azure OpenAI Configuration
AZURE_OPENAI_ENDPOINT = settings.AZURE_OPENAI_ENDPOINT.rstrip("/")
AZURE_OPENAI_API_KEY = settings.AZURE_OPENAI_API_KEY
API_VERSION = "2025-02-01-preview"


async def create_standard_response(data=None, message="Success", success=True, status_code=200, headers=None):
    """Ensure consistent response structure with support for headers"""
    response_data = {
        "status": "success" if success else "error",
        "message": message,
        "data": data if data is not None else ([] if isinstance(data, list) else {}),
        "timestamp": datetime.now().isoformat(),
        "request_id": str(uuid4())  # Add unique ID for tracking
    }
    return JSONResponse(
        content=response_data,
        status_code=status_code,
        headers=headers or {}
    )


async def azure_api_request(
    endpoint_path,
    method="GET",
    data=None,
    params=None,
    headers=None
):
    """
    Makes an HTTP request to the Azure OpenAI API.
    """
    url = f"{AZURE_OPENAI_ENDPOINT}/{endpoint_path}?api-version={API_VERSION}"
    
    # Set default headers
    request_headers = {
        "Content-Type": "application/json",
        "api-key": AZURE_OPENAI_API_KEY
    }
    
    # Add custom headers if provided
    if headers:
        request_headers.update(headers)
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.request(
                method,
                url,
                json=data,
                params=params,
                headers=request_headers,
                timeout=60
            )
            response.raise_for_status()
            return response.json()
    except httpx.RequestError as e:
        logger.error(f"Error calling Azure API: {e}")
        raise RuntimeError(f"Unable to reach Azure API endpoint: {str(e)}")
    except httpx.HTTPStatusError as e:
        logger.error(f"Azure API error: {e.response.text}")
        raise RuntimeError(
            f"Azure API request failed: {e.response.status_code} => "
            f"{e.response.text}"
        )
