import logging
import os
import jwt
from fastapi import HTTPException
from fastapi.security import OAuth2PasswordBearer
from fastapi import Depends, HTTPException
from sqlalchemy import select
from models.user import User
from db import get_async_session

logger = logging.getLogger(__name__)
JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

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

async def get_current_user_and_token(token: str = Depends(oauth2_scheme)):
    # First try header token
    try:
        return await _get_user_from_token(token)
    except HTTPException:
        # Fallback to cookie token
        pass

    # Check cookies directly
    from fastapi import Request
    request: Request = Request()
    cookie_token = request.cookies.get("access_token")
    if cookie_token:
        return await _get_user_from_token(cookie_token)

    raise HTTPException(status_code=401, detail="Not authenticated")

async def _get_user_from_token(token: str):
    async for session in get_async_session():
        decoded = verify_token(token)
        username = decoded.get("sub")
        result = await session.execute(select(User).where(User.username == username))
        user = result.scalars().first()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
