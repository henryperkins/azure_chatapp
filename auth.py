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
import jwt
from jwt.exceptions import PyJWTError
from fastapi import APIRouter, HTTPException, Depends, Response, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from db import AsyncSessionLocal, get_async_session
from sqlalchemy import select

from models.user import User
from fastapi.security import OAuth2PasswordBearer
from utils.auth_deps import (
    get_current_user_and_token, revoke_token_id, verify_token,
    JWT_SECRET, JWT_ALGORITHM, create_access_token
)
from typing import cast

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

logger = logging.getLogger(__name__)

router = APIRouter()

# JWT Configuration

# Import JWT_SECRET and JWT_ALGORITHM from auth_deps to ensure consistency
from utils.auth_deps import JWT_SECRET, JWT_ALGORITHM
from config import settings
ACCESS_TOKEN_EXPIRE_MINUTES = int(settings.ACCESS_TOKEN_EXPIRE_MINUTES)


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
    user.last_login = datetime.utcnow()
    session.add(user)
    await session.commit()
    return {"message": f"User '{user.username}' registered successfully"}


# In the login_user function, update the cookie setting:

@router.post("/login", response_model=LoginResponse)
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
        logger.debug(f"User '{user.username}' tried to login with invalid password.")
        raise HTTPException(
            status_code=401,
            detail="Invalid username or password"
        )

    if not user.is_active:
        logger.debug(f"User '{user.username}' attempted login but is not active.")
        raise HTTPException(
            status_code=403,
            detail="Account is disabled or inactive. Contact support."
        )

    # Generate a unique token ID
    token_id = str(uuid.uuid4())
    
    # Construct enhanced payload for JWT
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": user.username,
        "exp": expire,
        "iat": datetime.utcnow(),
        "jti": token_id,  # Add JWT ID for uniqueness and tracking
        "type": "access"  # Specify token type for additional validation
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    logger.info(f"User '{user.username}' logged in successfully with token ID {token_id}.")
    user.last_login = datetime.utcnow()
    session.add(user)
    await session.commit()

    # Adjust samesite logic to match the comment indicating cross-site usage
    production_mode = settings.ENV == "production"
    if production_mode:
        secure_cookie = True
        samesite_value = "none"
    else:
        secure_cookie = False
        # Default to same-site='lax' for local development
        samesite_value = "lax"

    # Only set domain if configured
    cookie_domain = settings.COOKIE_DOMAIN.strip()
    if not cookie_domain:
        response.set_cookie(
            key="access_token",
            value=token,
            httponly=True,
            secure=secure_cookie,
            samesite=samesite_value,
            max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            path="/"
        )
    else:
        response.set_cookie(
            key="access_token",
            value=token,
            httponly=True,
            secure=secure_cookie,
            samesite=samesite_value,
            max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            path="/",
            domain=cookie_domain
        )

    return {
        "message": "Login successful",
        "access_token": token,
        "token_type": "bearer"
    }


# ------------------------------
# JWT Verification & Dependencies
# ------------------------------


@router.post("/refresh")
async def refresh_token(
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user_and_token)
):
    """
    Provides a new token with rotation, effectively "refreshing" the session if the user is still valid.
    Also sets a new cookie for seamless session continuity.
    Enhanced with token rotation and additional security metadata.
    """

    # Obtain old token from cookie/header to revoke it if present
    old_token = request.cookies.get("access_token") or request.headers.get("Authorization", "").replace("Bearer ", "")
    if old_token:
        # If old token is valid, revoke its jti
        try:
            old_payload = verify_token(old_token)
            old_jti = old_payload.get("jti")
            if old_jti:
                revoke_token_id(old_jti)
        except:
            # If old token can't be verified, just proceed
            pass

    # Generate a unique token ID for new access token
    token_id = str(uuid.uuid4())
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": current_user.username, 
        "exp": expire,
        "iat": datetime.utcnow(),
        "jti": token_id,  # Add JWT ID
        "type": "access"
    }
    new_token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    production_mode = settings.ENV == "production"
    secure_cookie = True if production_mode else False
    samesite_value = "none" if production_mode else "lax"

    cookie_domain = settings.COOKIE_DOMAIN.strip()
    cookie_params = {
        "key": "access_token",
        "value": new_token,
        "httponly": True,
        "secure": secure_cookie,
        "samesite": samesite_value,
        "max_age": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "path": "/",
    }
    if cookie_domain:
        cookie_params["domain"] = cookie_domain

    response.set_cookie(**cookie_params)
    logger.info(f"Refreshed token for user '{current_user.username}', previous token revoked if valid.")

    return {
        "message": "Token refreshed",
        "access_token": new_token,
        "token_type": "bearer",
        "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60
    }


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
    production_mode = settings.ENV == "production"
    cookie_domain = settings.COOKIE_DOMAIN.strip()
    if production_mode:
        secure_cookie = True
        samesite_value = "none"
    else:
        secure_cookie = False
        # Default to same-site='lax' for local dev
        samesite_value = "lax"

    delete_params = {
        "key": "access_token",
        "path": "/",
        "httponly": True,
        "secure": secure_cookie,
        "samesite": samesite_value
    }

    # Only set domain if configured
    if cookie_domain:
        delete_params["domain"] = cookie_domain

    response.delete_cookie(**delete_params)
    return {"status": "logged out"}
