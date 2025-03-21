"""
response_utils.py
---------------
Centralized utilities for HTTP responses, error handling, and API responses.
Provides standardized formatting for consistent API responses.
"""
import logging
import httpx
from typing import Dict, Any, Optional, TypedDict, Union, List, Type
from uuid import UUID
from datetime import datetime

from fastapi import HTTPException, status

from config import settings

logger = logging.getLogger(__name__)


# Type definitions for response consistency
class StandardResponse(TypedDict, total=False):
    """Standard API response format"""
    data: Any
    success: bool
    message: Optional[str]
    errors: Optional[List[Dict[str, Any]]]


async def create_standard_response(
    data: Any, 
    message: Optional[str] = None,
    success: bool = True
) -> StandardResponse:
    """
    Create a standardized API response.
    
    Args:
        data: Main response data
        message: Optional message
        success: Success flag
        
    Returns:
        Formatted response dictionary
    """
    response: StandardResponse = {
        "data": data,
        "success": success
    }
    
    if message:
        response["message"] = message
        
    return response


async def create_error_response(
    error_message: str,
    errors: Optional[List[Dict[str, Any]]] = None,
    data: Any = None
) -> StandardResponse:
    """
    Create a standardized error response.
    
    Args:
        error_message: Main error message
        errors: Detailed error list
        data: Optional data to include
        
    Returns:
        Formatted error response
    """
    response: StandardResponse = {
        "success": False,
        "message": error_message,
        "data": data or {}
    }
    
    if errors:
        response["errors"] = errors
        
    return response


def serialize_datetime(dt: Optional[datetime]) -> Optional[str]:
    """
    Convert datetime to ISO format string.
    
    Args:
        dt: Datetime object
        
    Returns:
        ISO formatted string or None
    """
    if dt is not None:
        return dt.isoformat()
    return None


def serialize_uuid(id_value: Optional[UUID]) -> Optional[str]:
    """
    Convert UUID to string.
    
    Args:
        id_value: UUID object
        
    Returns:
        String representation or None
    """
    if id_value is not None:
        return str(id_value)
    return None


class HTTPClientWrapper:
    """Wrapper for HTTP client with standardized request handling"""
    
    @staticmethod
    async def request(
        url: str,
        method: str = "GET",
        headers: Optional[Dict[str, str]] = None,
        json_data: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, str]] = None,
        timeout: int = 30
    ) -> Dict[str, Any]:
        """
        Make an HTTP request with standardized error handling.
        
        Args:
            url: Request URL
            method: HTTP method
            headers: Request headers
            json_data: JSON request body
            params: Query parameters
            timeout: Request timeout in seconds
            
        Returns:
            Response data as dictionary
            
        Raises:
            HTTPException: For request errors
        """
        try:
            async with httpx.AsyncClient() as client:
                if method == "GET":
                    response = await client.get(
                        url, 
                        headers=headers, 
                        params=params, 
                        timeout=timeout
                    )
                elif method == "POST":
                    response = await client.post(
                        url, 
                        headers=headers, 
                        json=json_data, 
                        params=params, 
                        timeout=timeout
                    )
                elif method == "PUT":
                    response = await client.put(
                        url, 
                        headers=headers, 
                        json=json_data, 
                        params=params, 
                        timeout=timeout
                    )
                elif method == "DELETE":
                    response = await client.delete(
                        url, 
                        headers=headers, 
                        params=params, 
                        timeout=timeout
                    )
                else:
                    raise ValueError(f"Unsupported HTTP method: {method}")
                
                if response.status_code >= 400:
                    logger.error(f"HTTP error: {response.status_code} => {response.text}")
                    raise HTTPException(
                        status_code=response.status_code, 
                        detail=f"Request failed: {response.text}"
                    )
                
                if not response.content:
                    return {}
                
                return response.json()
        except httpx.RequestError as e:
            logger.error(f"Request failed: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Service unavailable: {str(e)}"
            )


async def azure_api_request(
    endpoint_path: str, 
    method: str = "GET",
    data: Optional[Dict[str, Any]] = None,
    params: Optional[Dict[str, str]] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 30
) -> Dict[str, Any]:
    """
    Make a request to Azure API with standardized handling.
    
    Args:
        endpoint_path: API path after base URL
        method: HTTP method
        data: Request payload
        params: Query parameters
        headers: Additional headers
        timeout: Request timeout in seconds
        
    Returns:
        Response data as dictionary
    """
    from config import settings
    
    url = f"{settings.AZURE_OPENAI_ENDPOINT.rstrip('/')}/{endpoint_path}"
    
    # Prepare headers
    request_headers = {
        "api-key": settings.AZURE_OPENAI_API_KEY,
        "Content-Type": "application/json"
    }
    
    if headers:
        request_headers.update(headers)
        
    # Prepare parameters
    request_params = {
        "api-version": "2025-02-01-preview"
    }
    
    if params:
        request_params.update(params)
    
    return await HTTPClientWrapper.request(
        url=url,
        method=method,
        headers=request_headers,
        json_data=data,
        params=request_params,
        timeout=timeout
    )