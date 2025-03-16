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
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db import SessionLocal  # Keep sync session for auth routes
from models.user import User

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


def get_db():
    """
    Dependency that provides a database session.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.post("/register")
def register_user(
    creds: UserCredentials,
    db: Session = Depends(get_db)
):
    """
    Registers a new user with hashed password.
    Fails if the username already exists.
    """
    existing_user = db.query(User).filter(
        User.username == creds.username
    ).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already taken")

    hashed_pw = bcrypt.hashpw(creds.password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    user = User(username=creds.username, password_hash=hashed_pw)
    db.add(user)
    db.commit()
    db.refresh(user)

    logger.info(f"User registered successfully: {user.username}")
    return {"message": f"User '{user.username}' registered successfully"}


@router.post("/login", response_model=LoginResponse)
def login_user(
    creds: UserCredentials,
    db: Session = Depends(get_db)
):
    """
    Authenticates the user and returns a JWT if valid.
    """
    user = db.query(User).filter(User.username == creds.username).first()
    if not user:
        raise HTTPException(
            status_code=401,
            detail="Invalid username or password"
        )

    if not bcrypt.checkpw(
        creds.password.encode("utf-8"),
        user.password_hash.encode("utf-8")
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials"
        )

    # Construct payload for JWT
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": user.username,
        "exp": expire
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    logger.info(f"User '{user.username}' logged in successfully.")
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
    
    
    def get_current_user(
       token: str = Depends(lambda: None),
       db: Session = Depends(get_db)
    ):
        """
        Retrieves the current user from JWT.
        Use as a FastAPI dependency where needed.
        Example usage:
           @router.get("/me")
           def me_route(current_user=Depends(get_current_user)):
               return current_user
        """
        if not token:
            raise HTTPException(
                status_code=401,
                detail="Authorization token not provided"
            )
    
        scheme, _, param = token.partition(" ")
        if scheme.lower() != "bearer":
            raise HTTPException(
                status_code=401,
                detail="Invalid authorization scheme"
            )
    
        decoded = verify_token(param)
        username = decoded.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid token payload")
    
        user = db.query(User).filter(User.username == username).first()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
    
        return user
    
    
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
        token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
        return {"access_token": token, "token_type": "bearer"}
