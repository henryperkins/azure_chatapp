import logging
import os
import jwt
from fastapi import WebSocket, Cookie
from fastapi import HTTPException
from fastapi.security import OAuth2PasswordBearer
from fastapi import Depends, HTTPException, Request, Header
from sqlalchemy import select
from models.user import User
from db import get_async_session
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)
JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"

def verify_token(token: str):
    """
    Verifies and decodes a JWT token.
    """
    try:
        decoded = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return decoded
    except jwt.ExpiredSignatureError:
        logger.warning("Token has expired.")
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        logger.warning("Invalid token.")
        raise HTTPException(status_code=401, detail="Invalid token")

async def get_current_user_and_token(
    request: Request,
    session: AsyncSession = Depends(get_async_session)
):
    """
    Updated to inject session properly
    """
    # Try to get from cookie first
    token = None
    
    if isinstance(request, WebSocket):
        cookies = request.cookies
        token = cookies.get("access_token")
        # For WebSocket, also check the query parameters
        if not token and "token" in request.query_params:
            token = request.query_params["token"]
    else:
        # For regular HTTP requests
        token = request.cookies.get("access_token")
        
        # Log all cookies for debugging
        logger.debug(f"All cookies: {request.cookies}")
        
        # Fallback to Authorization header if no cookie
        if not token:
            auth_header = request.headers.get("Authorization")
            if auth_header and auth_header.startswith("Bearer "):
                token = auth_header.replace("Bearer ", "")
    
    if not token:
        logger.warning("No token found in cookies or Authorization header")
        raise HTTPException(status_code=401, detail="No access token provided")
        
    return await _get_user_from_token(token, session)

async def _get_user_from_token(token: str, session: AsyncSession):
    """
    Gets user from token using injected session
    """
    try:
        decoded = verify_token(token)
        username = decoded.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid token payload")

        result = await session.execute(select(User).where(User.username == username))
        user = result.scalars().first()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        if not user.is_active:
            raise HTTPException(status_code=403, detail="Account disabled")
        return user
    except Exception as e:
        logger.error(f"Error authenticating user: {str(e)}")
        raise HTTPException(status_code=401, detail=str(e))
