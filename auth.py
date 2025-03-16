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
from utils.auth_deps import verify_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

logger = logging.getLogger(__name__)

router = APIRouter()

# JWT Configuration
JWT_SECRET = os.getenv("JWT_SECRET", "")
if not JWT_SECRET:
    logger.warning("Using default JWT secret - insecure for production!")
# Replace with a secure random key in production
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60  # 1 hour expiry note


class UserCredentials(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str




def validate_password(password: str):
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters")
    if not any(c.isupper() for c in password):
        raise ValueError("Password must contain uppercase letters")

@router.post("/register")
async def register_user(
    creds: UserCredentials,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Registers a new user with hashed password.
    Fails if the username already exists.
    """
    lower_username = creds.username.lower()
    validate_password(creds.password)
    result = await db.execute(select(User).where(User.username == lower_username))
    existing_user = result.scalars().first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already taken")

    hashed_pw = bcrypt.hashpw(creds.password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    user = User(username=lower_username, password_hash=hashed_pw)
    db.add(user)
    await db.commit()
    await db.refresh(user)

    logger.info(f"User registered successfully: {user.username}")
    return {"message": f"User '{user.username}' registered successfully"}


@router.post("/login")
async def login_user(
    response: Response,
    creds: UserCredentials,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Authenticates the user and returns a JWT if valid.
    """
    from fastapi import Response
    lower_username = creds.username.lower()
    result = await db.execute(select(User).where(User.username == lower_username))
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
        "exp": expire
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    logger.info(f"User '{user.username}' logged in successfully.")
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="Lax",
        max_age=3600
    )
    return {
        "message": "Login successful",
        "access_token": token,
        "token_type": "bearer"
    }


# ------------------------------
# JWT Verification & Dependencies
# ------------------------------



async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Retrieves the current user from JWT.
    """
    if not token:
        raise HTTPException(
            status_code=401,
            detail="Authorization token not provided"
        )

    # Check if this is coming directly (with Bearer prefix) or via oauth2_scheme (just token)
    if token.lower().startswith("bearer "):
        # Direct call with full Authorization header
        _, _, param = token.partition(" ")
        token = param
    
    # Now we can safely verify the token itself
    try:
        decoded = verify_token(token)
        username = decoded.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid token payload")
    
        result = await db.execute(select(User).where(User.username == username))
        user = result.scalars().first()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except Exception as e:
        # Add this for debugging
        logger.error(f"Token verification error: {str(e)}")
        raise HTTPException(status_code=401, detail="Invalid token")


@router.get("/refresh")
def refresh_token(current_user: User = Depends(get_current_user)):
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
