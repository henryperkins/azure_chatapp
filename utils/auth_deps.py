from fastapi.security import OAuth2PasswordBearer
from fastapi import Depends, HTTPException
from auth import verify_token, get_current_user

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

async def get_current_user_and_token(token: str = Depends(oauth2_scheme)):
    user = await get_current_user(token)
    return user
