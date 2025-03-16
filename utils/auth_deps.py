from fastapi.security import OAuth2PasswordBearer
from fastapi import Depends, HTTPException
from sqlalchemy import select
from models.user import User
from db import get_async_session
from auth import verify_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

async def get_current_user_and_token(token: str = Depends(oauth2_scheme)):
    async for session in get_async_session():
        try:
            decoded = verify_token(token)
            username = decoded.get("sub")
            result = await session.execute(select(User).where(User.username == username))
            user = result.scalars().first()
            if not user:
                raise HTTPException(status_code=401, detail="User not found")
            return user
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid credentials")
