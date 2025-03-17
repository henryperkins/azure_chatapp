"""
auth.py
-------
Handles user login and registration using JWT-based authentication,
secure password hashing (bcrypt), and session expiry logic.
"""

import logging
import os
from datetime import datetime, timedelta

import bcrypt
import jwt
from fastapi import APIRouter, HTTPException, Depends, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from db import AsyncSessionLocal, get_async_session
from sqlalchemy import select

from models.user import User
from fastapi.security import OAuth2PasswordBearer
from utils.auth_deps import get_current_user_and_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

logger = logging.getLogger(__name__)

router = APIRouter()

# JWT Configuration
from typing import cast

# Explicitly typing JWT_SECRET as str to satisfy Pylance
JWT_SECRET = cast(str, os.getenv("JWT_SECRET"))
if not JWT_SECRET or JWT_SECRET.strip() == "":
    raise SystemExit("Error: JWT_SECRET is not set. Please configure a proper secret before running.")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60  # 1 hour expiry note


class UserCredentials(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str




def validate_password(password: str):
    if len(password) < 12:
        raise ValueError("Password must be at least 12 characters")
    if not any(c.isupper() for c in password):
        raise ValueError("Password must contain uppercase letters")
    if not any(c.islower() for c in password):
        raise ValueError("Password must contain lowercase letters")
    if not any(c.isdigit() for c in password):
        raise ValueError("Password must contain numbers")
    if not any(c in '!@#$%^&*()_+-=[]{}|;:,.<>?~' for c in password):
        raise ValueError("Password must contain at least one special character")

@router.post("/register")
async def register_user(
    creds: UserCredentials,
    session: AsyncSession = Depends(get_async_session)
):
    """
    Registers a new user with hashed password.
    Fails if the username already exists.
    """
    lower_username = creds.username.lower()
    validate_password(creds.password)
    result = await session.execute(select(User).where(User.username == lower_username))
    existing_user = result.scalars().first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already taken")

    hashed_pw = bcrypt.hashpw(creds.password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    user = User(username=lower_username, password_hash=hashed_pw)
    session.add(user)
    await session.commit()
    await session.refresh(user)

    logger.info(f"User registered successfully: {user.username}")
    return {"message": f"User '{user.username}' registered successfully"}


# In the login_user function, update the cookie setting:

@router.post("/login")
async def login_user(
    response: Response,
    creds: UserCredentials,
    session: AsyncSession = Depends(get_async_session)
):
    """
    Authenticates the user and returns a JWT if valid.
    """
    lower_username = creds.username.lower()
    result = await session.execute(select(User).where(User.username == lower_username))
    user = result.scalars().first()
    if not user:
        raise HTTPException(
            status_code=401,
            detail="Invalid username or password"
        )

    # Safely catch corrupt hashes
    try:
        valid_password = bcrypt.checkpw(
            creds.password.encode("utf-8"),
            user.password_hash.encode("utf-8")
        )
    except ValueError:
        # Means the stored hash is invalid/corrupt
        raise HTTPException(
            status_code=400,
            detail="Corrupted password hash. Please reset or re-register your account."
        )

    if not valid_password:
        # Provide more specific debug logging to distinguish issues
        logger.debug(f"User '{user.username}' tried to login with invalid password.")
        raise HTTPException(
            status_code=401,
            detail="Invalid username or password"
        )

    # Construct payload for JWT
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": user.username,
        "exp": expire,
        "iat": datetime.utcnow()
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    logger.info(f"User '{user.username}' logged in successfully.")
    
    # If ENV=production, use secure cookies and samesite=none.
    # If not production, switch samesite to 'lax' and secure=False to ensure local dev cookies aren't blocked.
    production_mode = os.getenv("ENV") == "production"
    if production_mode:
        samesite_value = "none"   # For cross-site in production (requires HTTPS)
        secure_cookie = True      # Must be true if samesite=none in prod
    else:
        samesite_value = "lax"    # Lax samesite for local dev
        secure_cookie = False
    
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=secure_cookie,
        samesite=samesite_value,
        max_age=3600,
        path="/"
    )
    
    return {
        "message": "Login successful",
        "access_token": token,
        "token_type": "bearer"
    }


# ------------------------------
# JWT Verification & Dependencies
# ------------------------------





@router.get("/refresh")
def refresh_token(current_user: User = Depends(get_current_user_and_token)):
    """
    Provides a new token, effectively "refreshing" the session if the user is still valid.
    """
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": current_user.username,
        "exp": expire
    }
    new_token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return {"access_token": new_token, "token_type": "bearer"}

@router.get("/verify")
async def verify_auth_status(current_user: User = Depends(get_current_user_and_token)):
    """
    Endpoint for frontend to verify valid auth state
    """
    return {"authenticated": True, "username": current_user.username, "user_id": current_user.id}

@router.post("/logout")
async def logout_user(response: Response):
    """
    Logs out the user by clearing the access token cookie
    """
    # Delete the cookie with the same parameters as when it was set
    response.delete_cookie(
        key="access_token", 
        path="/",
        httponly=True,
        secure=os.getenv("ENV") == "production"
    )
    return {"status": "logged out"}