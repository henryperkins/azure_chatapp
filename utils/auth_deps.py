import logging
import os
import jwt
from fastapi import HTTPException
from fastapi.security import OAuth2PasswordBearer
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from models.user import User
from db import get_async_session

logger = logging.getLogger(__name__)
JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"
# Removed OAuth2PasswordBearer since we rely solely on cookies now

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

async def get_current_user_and_token(request: Request):
    # Rely solely on the HttpOnly cookie
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="No access token provided in cookies")
    return await _get_user_from_token(token)

async def _get_user_from_token(token: str):
    if token.startswith("Bearer "):
        token = token[7:]
    async for session in get_async_session():
        decoded = verify_token(token)
        username = decoded.get("sub")
        result = await session.execute(select(User).where(User.username == username))
        user = result.scalars().first()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        if not user.is_active:
            raise HTTPException(status_code=403, detail="Account disabled")
        return user
