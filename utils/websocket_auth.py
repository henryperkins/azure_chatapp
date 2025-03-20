"""
websocket_auth.py
----------------
Provides authentication utilities for WebSocket connections.
Standardizes token extraction, validation, and user verification.
"""
import logging
from typing import Optional, Dict, Tuple, Any
from fastapi import WebSocket, status
from sqlalchemy.ext.asyncio import AsyncSession
from models.user import User
from utils.auth_deps import _get_user_from_token

logger = logging.getLogger(__name__)

async def extract_token_from_websocket(websocket: WebSocket) -> Optional[str]:
    """
    Extract JWT token from WebSocket connection cookies or query parameters.
    
    Args:
        websocket: The WebSocket connection
        
    Returns:
        The token string if found, None otherwise
    """
    # Try to get token from cookies
    token = None
    cookie_header = websocket.headers.get("cookie")
    
    if cookie_header:
        try:
            cookies = dict(cookie.split("=") for cookie in cookie_header.split("; "))
            token = cookies.get("access_token")
        except Exception as e:
            logger.error(f"Failed to parse cookies: {str(e)}")
    
    # If no token in cookies, try query parameters
    if not token and "token" in websocket.query_params:
        token = websocket.query_params["token"]
    
    return token

async def authenticate_websocket(
    websocket: WebSocket, 
    db: AsyncSession
) -> Tuple[bool, Optional[User]]:
    """
    Authenticate a WebSocket connection using JWT.
    
    Args:
        websocket: The WebSocket connection
        db: Database session
        
    Returns:
        Tuple of (success: bool, user: Optional[User])
    """
    await websocket.accept()
    
    # Extract token from request
    token = await extract_token_from_websocket(websocket)
    
    if not token:
        logger.warning("WebSocket connection rejected: No token provided")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return False, None
    
    # Validate token and get user
    try:
        user = await _get_user_from_token(token, db, "access")
        
        if not user or not user.is_active:
            logger.warning("WebSocket auth failed: inactive or invalid user")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return False, None
            
        return True, user
    except Exception as e:
        logger.warning(f"WebSocket authentication failed: {str(e)}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return False, None
