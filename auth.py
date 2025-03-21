"""
auth.py
-------
Handles user login and registration using JWT-based authentication,
secure password hashing (bcrypt), and session expiry logic.
"""

import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import OAuth2PasswordBearer
from jose import jwt
import bcrypt
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db import get_async_session
from models.user import User, TokenBlacklist
from utils.auth_utils import (
    JWT_SECRET,
    JWT_ALGORITHM,
    get_current_user_and_token,
)

logger = logging.getLogger(__name__)


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 30))


class UserCredentials(BaseModel):
    """Authentication credentials (username and password)."""
    
    username: str
    password: str


class LoginResponse(BaseModel):
    """Response model for login endpoint."""
    
    access_token: str
    token_type: str


def validate_password(password: str):
    """Validates password meets security requirements."""
    if len(password) < 12:
        raise ValueError("Password must be at least 12 characters")
    if not any(c.isupper() for c in password):
        raise ValueError("Password must contain uppercase letters")
    if not any(c.islower() for c in password):
        raise ValueError("Password must contain lowercase letters")
    if not any(c.isdigit() for c in password):
        raise ValueError("Password must contain numbers")
    if not any(c in "!@#$%^&*()_+-=[]{}|;:,.<>?~" for c in password):
        raise ValueError("Password must contain at least one special character")


router = APIRouter()


@router.post("/register", response_model=dict)
async def register_user(
    creds: UserCredentials, 
    session: AsyncSession = Depends(get_async_session)
):
    """Registers a new user with hashed password."""
    lower_username = creds.username.lower()
    validate_password(creds.password)

    result = await session.execute(
        select(User).where(User.username == lower_username)
    )
    existing_user = result.scalars().first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already taken")

    hashed_pw = bcrypt.hashpw(
        creds.password.encode("utf-8"), 
        bcrypt.gensalt()
    ).decode("utf-8")
    
    user = User(
        username=lower_username, 
        password_hash=hashed_pw
    )
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
    session: AsyncSession = Depends(get_async_session),
) -> LoginResponse:
    """Authenticates user and returns JWT."""
    lower_username = creds.username.lower()
    result = await session.execute(
        select(User).where(User.username == lower_username)
    )
    user = result.scalars().first()
    if not user:
        logger.warning(f"Login attempt for non-existent user: {lower_username}")
        # Use the same error message for security (avoid username enumeration)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    try:
        # Run bcrypt in thread pool to avoid blocking async event loop
        valid_password = await asyncio.get_event_loop().run_in_executor(
            None,
            bcrypt.checkpw,
            creds.password.encode("utf-8"),
            user.password_hash.encode("utf-8")
        )
    except ValueError as exc:
        logger.error("Corrupted password hash for user '%s': %s", 
                    lower_username, exc)
        raise HTTPException(
            status_code=400,
            detail="Corrupted password hash. Please reset account.",
        ) from exc

    if not valid_password:
        logger.warning(f"Failed login attempt for user: {lower_username}")
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not user.is_active:
        logger.warning(f"Login attempt for disabled account: {lower_username}")
        raise HTTPException(
            status_code=403, 
            detail="Account disabled. Contact support."
        )

    # Update last login time
    user.last_login = datetime.utcnow()
    
    token_id = str(uuid.uuid4())
    expire = datetime.utcnow() + timedelta(
        minutes=ACCESS_TOKEN_EXPIRE_MINUTES
    )
    
    # Invalidate previous tokens when issuing new ones
    user.token_version = user.token_version + 1 if user.token_version else 1
    session.add(user)
    await session.commit()

    payload = {
        "sub": lower_username,
        "exp": expire,
        "iat": datetime.utcnow(),
        "jti": token_id,
        "type": "access",
        "version": user.token_version,  # Track token version
        "user_id": user.id
    }

    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    logger.info(
        "User '%s' logged in with token ID %s.",
        lower_username,
        token_id
    )

    secure_cookie = settings.ENV == "production"
    # In production, use 'strict' for better security; otherwise 'lax' for development ease
    samesite_value = "strict" if secure_cookie else "lax"

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

    return LoginResponse(
        access_token=token, 
        token_type="bearer"
    )


@router.post("/refresh", response_model=LoginResponse)
async def refresh_token(
    response: Response,
    request: Request,
    current_user_and_token: User = Depends(get_current_user_and_token),
    session: AsyncSession = Depends(get_async_session)
) -> LoginResponse:
    """Provides new token with rotation for session continuity."""
    username = current_user_and_token.username
    user_id = current_user_and_token.id

    # Update last_login time
    current_user_and_token.last_login = datetime.utcnow()
    session.add(current_user_and_token)
    await session.commit()

    token_id = str(uuid.uuid4())
    expire = datetime.utcnow() + timedelta(
        minutes=ACCESS_TOKEN_EXPIRE_MINUTES
    )

    payload = {
        "sub": username,
        "exp": expire,
        "iat": datetime.utcnow(),
        "jti": token_id,
        "type": "access",
        "version": current_user_and_token.token_version,  # Include token version
        "user_id": user_id
    }

    new_token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    logger.info("Refreshed token for user '%s'", username)

    secure_cookie = settings.ENV == "production"
    # In production, use 'strict' for better security; otherwise 'lax' for development ease
    samesite_value = "strict" if secure_cookie else "lax"

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

    return LoginResponse(
        access_token=new_token, 
        token_type="bearer"
    )


@router.get("/verify")
async def verify_auth_status(
    current_user: User = Depends(get_current_user_and_token),
) -> dict:
    """Verifies valid authentication state."""
    return {
        "authenticated": True,
        "username": current_user.username,
        "user_id": current_user.id,
    }


@router.post("/logout")
async def logout_user(
    response: Response,
    current_user_and_token: User = Depends(get_current_user_and_token),
    session: AsyncSession = Depends(get_async_session)
) -> dict:
    """Invalidates token and clears authentication cookie."""
    # Get JTI from the token
    token_id = current_user_and_token.jti
    expires = current_user_and_token.exp
    user_id = current_user_and_token.id
    
    # Add token to database blacklist
    blacklisted_token = TokenBlacklist(
        jti=token_id,
        expires=expires,
        user_id=user_id
    )
    session.add(blacklisted_token)
    
    # Increment token version to invalidate all existing tokens for this user
    current_user_and_token.token_version = current_user_and_token.token_version + 1 if current_user_and_token.token_version else 1
    session.add(current_user_and_token)
    await session.commit()
    
    # Also add to in-memory blacklist for immediate effect
    from utils.auth_utils import revoke_token_id
    revoke_token_id(token_id)
    
    logger.info("User %s logged out successfully. Token %s invalidated and token version incremented.", 
               current_user_and_token.username, token_id)

    secure_cookie = settings.ENV == "production"
    samesite_value = "strict" if secure_cookie else "lax"

    cookie_params = {
        "key": "access_token",
        "path": "/",
        "httponly": True,
        "secure": secure_cookie,
        "samesite": samesite_value,
    }

    if settings.COOKIE_DOMAIN:
        cookie_params["domain"] = settings.COOKIE_DOMAIN.strip()

    response.delete_cookie(**cookie_params)

    return {"status": "logged out"}
