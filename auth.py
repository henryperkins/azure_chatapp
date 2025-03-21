"""
auth.py
-------
Handles user login and registration using JWT-based authentication,
secure password hashing (bcrypt), and session expiry logic.
"""

import logging
import os
import uuid
from datetime import datetime, timedelta

import bcrypt
from jose import jwt
from fastapi import APIRouter, Depends, Request, Response

logger = logging.getLogger(__name__)
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi.security import OAuth2PasswordBearer
from fastapi import HTTPException

from config import settings
from db import get_async_session
from sqlalchemy import select
from models.user import User
from utils.auth_utils import JWT_SECRET, JWT_ALGORITHM, get_current_user_and_token


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 30))


class UserCredentials(BaseModel):
    """
    Model for user credentials.
    """
    username: str
    password: str


class LoginResponse(BaseModel):
    """
    Model for login response.
    """
    access_token: str
    token_type: str


def validate_password(password: str):
    """
    Validates if the password meets the required criteria.
    """
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


router = APIRouter()


@router.post("/register", response_model=dict)
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

    logger.info("User registered successfully: %s", lower_username)
    user.last_login = datetime.utcnow()
    session.add(user)
    await session.commit()

    return {"message": f"User '{lower_username}' registered successfully"}


@router.post("/login", response_model=LoginResponse)
async def login_user(
    response: Response,
    creds: UserCredentials,
    session: AsyncSession = Depends(get_async_session)
) -> LoginResponse:
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
    except ValueError as exc:
        # Means the stored hash is invalid/corrupt
        logger.error("Corrupted password hash for user '%s': %s", lower_username, exc)
        raise HTTPException(
            status_code=400,
            detail="Corrupted password hash. Please reset or re-register your account."
        ) from exc

    if not valid_password:
        logger.debug("User '%s' tried to login with invalid password.", lower_username)
        raise HTTPException(
            status_code=401,
            detail="Invalid username or password"
        )

    if not user.is_active:
        logger.debug("User '%s' attempted login but is not active.", lower_username)
        raise HTTPException(
            status_code=403,
            detail="Account is disabled or inactive. Contact support."
        )

    # Generate a unique token ID
    token_id = str(uuid.uuid4())
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    payload = {
        "sub": lower_username,
        "exp": expire,
        "iat": datetime.utcnow(),
        "jti": token_id,  # Add JWT ID for uniqueness and tracking
        "type": "access"  # Specify token type for additional validation
    }

    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    logger.info("User '%s' logged in successfully with token ID %s.", lower_username, token_id)

    # Set secure cookie
    secure_cookie = settings.ENV == "production"
    samesite_value = "none" if settings.ENV == "production" else "lax"

    cookie_params = {
        "key": "access_token",
        "value": token,
        "httponly": True,
        "secure": secure_cookie,
        "samesite": samesite_value,
        "max_age": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "path": "/",
    }

    if settings.COOKIE_DOMAIN:
        cookie_params["domain"] = settings.COOKIE_DOMAIN.strip()

    response.set_cookie(**cookie_params)

    return LoginResponse(access_token=token, token_type="bearer")


@router.post("/refresh", response_model=LoginResponse)
async def refresh_token(
    response: Response,
    request: Request,
    current_user_and_token: dict = Depends(get_current_user_and_token)
) -> LoginResponse:
    """
    Provides a new token with rotation, effectively "refreshing" the session if the user is still valid.
    Also sets a new cookie for seamless session continuity.
    Enhanced with token rotation and additional security metadata.
    """
    username = current_user_and_token['user'].username

    # Generate a unique token ID for new access token
    token_id = str(uuid.uuid4())
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    payload = {
        "sub": username,
        "exp": expire,
        "iat": datetime.utcnow(),
        "jti": token_id,  # Add JWT ID for uniqueness and tracking
        "type": "access"  # Specify token type for additional validation
    }

    new_token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    logger.info("Refreshed token for user '%s', previous token revoked if valid.", username)

    # Set secure cookie
    secure_cookie = settings.ENV == "production"
    samesite_value = "none" if settings.ENV == "production" else "lax"

    cookie_params = {
        "key": "access_token",
        "value": new_token,
        "httponly": True,
        "secure": secure_cookie,
        "samesite": samesite_value,
        "max_age": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "path": "/",
    }
    
    if settings.COOKIE_DOMAIN:
        cookie_params["domain"] = settings.COOKIE_DOMAIN.strip()

    response.set_cookie(**cookie_params)

    return LoginResponse(access_token=new_token, token_type="bearer")


@router.get("/verify")
async def verify_auth_status(
    current_user: User = Depends(get_current_user_and_token)
) -> dict:
    """
    Endpoint for frontend to verify valid auth state
    """
    return {
        "authenticated": True,
        "username": current_user.username,
        "user_id": current_user.id
    }


@router.post("/logout")
async def logout_user(
    response: Response
) -> dict:
    """
    Logs out the user by clearing the access token cookie
    """
    logger.info("User logged out successfully.")

    # Determine secure and SameSite settings
    secure_cookie = settings.ENV == "production"
    samesite_value = "none" if settings.ENV == "production" else "lax"

    cookie_params = {
        "key": "access_token",
        "path": "/",
        "httponly": True,
        "secure": secure_cookie,
        "samesite": samesite_value
    }
    
    if settings.COOKIE_DOMAIN:
        cookie_params["domain"] = settings.COOKIE_DOMAIN.strip()

    response.delete_cookie(**cookie_params)

    return {"status": "logged out"}