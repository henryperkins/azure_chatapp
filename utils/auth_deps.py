from fastapi.security import OAuth2PasswordBearer
from fastapi import Depends, HTTPException

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

async def get_current_user_and_token(token: str = Depends(oauth2_scheme)):
    from auth import get_current_user
    return await get_current_user(token)
