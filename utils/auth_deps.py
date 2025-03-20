import logging
import os
from datetime import datetime, timedelta
import jwt
from starlette import status
from fastapi import WebSocket, Cookie
from fastapi import HTTPException
from fastapi.security import OAuth2PasswordBearer
from fastapi import Depends, HTTPException, Request, Header
from sqlalchemy import select
from models.user import User
from db import get_async_session
from typing import Optional, Any, List, Type, TypeVar, Dict, Union
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import ClauseElement
from uuid import UUID
# Import settings from config.py to ensure consistent configuration
from config import settings

logger = logging.getLogger(__name__)

# Basic in-memory revocation list. In production, consider a DB or Redis.
REVOCATION_LIST = set()

def revoke_token_id(token_id: str):
    """
    Add token_id (jti) to revocation list.
    """
    REVOCATION_LIST.add(token_id)
    logger.info(f"Token ID '{token_id}' has been revoked and cannot be used.")

# Use JWT_SECRET from centralized config
JWT_SECRET: str = settings.JWT_SECRET
if not JWT_SECRET or JWT_SECRET.strip() == "":
    raise SystemExit("Error: JWT_SECRET is not set in config.py. Please configure a proper secret before running.")

# Standard JWT algorithm
JWT_ALGORITHM = "HS256"

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return encoded_jwt

T = TypeVar('T')

def verify_token(token: str, expected_type: Optional[str] = None):
    """
    Verifies and decodes a JWT token, also validating against the revocation list if present.

    Args:
        token: The JWT token to verify
        expected_type: Optional token type to validate (e.g., "access")

    Returns:
        The decoded token payload

    Raises:
        HTTPException: If token validation fails
    """
    try:
        decoded = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])

        # Optionally validate token type
        if expected_type and decoded.get("type") != expected_type:
            logger.warning(f"Token type mismatch. Expected {expected_type}, got {decoded.get('type')}")
            raise HTTPException(status_code=401, detail="Invalid token type")

        # Check if token ID is flagged as revoked
        token_id = decoded.get("jti")
        if token_id in REVOCATION_LIST:
            logger.warning(f"Token ID '{token_id}' is revoked")
            raise HTTPException(status_code=401, detail="Token is revoked")

        return decoded

    except jwt.ExpiredSignatureError:
        logger.warning("Token has expired.")
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError as e:
        logger.warning(f"Invalid token: {str(e)}")
        raise HTTPException(status_code=401, detail="Invalid token")

async def get_current_user_and_token(
    request: Request,
    session: AsyncSession = Depends(get_async_session),
    token_type: Optional[str] = "access"
):
    """
    Enhanced authentication dependency that extracts token from request and validates it.
    Supports WebSocket and HTTP request types with consistent token extraction.
    
    Args:
        request: The FastAPI Request or WebSocket object
        session: Database session
        token_type: Expected token type (default: "access")
        
    Returns:
        The authenticated User object
    """
    # Extract token from appropriate source based on request type
    token = None
    
    # Extract token from cookies first
    token = request.cookies.get("access_token")
    
    # Fallback to Authorization header if no cookie
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split("Bearer ")[1]
            logger.debug("Using token from Authorization header")
    
    if not token:
        logger.debug("No token found in cookies or headers")
        raise HTTPException(
            status_code=401,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"}
        )
    
    # Use the enhanced token validation logic
    return await _get_user_from_token(token, session, token_type)

async def _get_user_from_token(token: str, session: AsyncSession, expected_type: Optional[str] = "access"):
    """
    Gets user from token using injected session with enhanced token validation
    
    Args:
        token: The JWT token
        session: Database session
        expected_type: Expected token type (default: "access")
        
    Returns:
        The User object
        
    Raises:
        HTTPException: For various authentication failures
    """
    try:
        # Verify with expected token type
        decoded = verify_token(token, expected_type)
        
        username = decoded.get("sub")
        if not username:
            logger.warning("Token missing 'sub' claim in payload")
            raise HTTPException(status_code=401, detail="Invalid token payload: missing subject")

        # Verify token ID if present
        token_id = decoded.get("jti")
        if token_id:
            # In the future, this could check against a token blocklist
            # to support token revocation
            pass
            
        # Get user from database
        result = await session.execute(select(User).where(User.username == username))
        user = result.scalars().first()
        
        if not user:
            logger.warning(f"User with username '{username}' from token not found in database")
            raise HTTPException(status_code=401, detail="User not found")
            
        if not user.is_active:
            logger.warning(f"Attempt to use token for disabled account: {username}")
            raise HTTPException(status_code=403, detail="Account disabled")
            
        return user
    except HTTPException:
        # Re-raise HTTP exceptions directly
        raise
    except Exception as e:
        # Log and wrap other exceptions
        logger.error(f"Error authenticating user: {str(e)}")
        raise HTTPException(status_code=401, detail="Authentication failed")

async def websocket_auth(websocket: WebSocket):
    """WebSocket authentication using cookies"""
    await websocket.accept()
    
    # Extract token from cookies
    token = None
    if "cookie" in websocket.headers:
        cookies = dict(cookie.split("=") for cookie in websocket.headers["cookie"].split("; "))
        token = cookies.get("access_token")
    
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return None

    try:
        user = await _get_user_from_token(token, websocket.app.state.db, "access")
        return user
    except Exception as e:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return None

# Fixed and enhanced utility functions

async def validate_resource_ownership(
    resource_id: Any,
    model_class: Type[T],
    user: User,
    db: AsyncSession,
    resource_name: str = "Resource",
    additional_conditions: Optional[List[ClauseElement]] = None
) -> T:
    """
    Generic function to validate that a user has access to a given resource.
    Reduces duplicate ownership checks across routes.
    
    Args:
        resource_id: ID of the resource (usually UUID)
        model_class: SQLAlchemy model class
        user: User model from get_current_user_and_token
        db: AsyncSession dependency
        resource_name: Name for error messages
        additional_conditions: List of additional SQL conditions
        
    Returns:
        The validated resource
        
    Raises:
        HTTPException: If resource not found or user doesn't have access
    """
    # Start with basic ID condition - using getattr to avoid type checking issues
    conditions = [getattr(model_class, "id") == resource_id]
    
    # Add user ownership check if model has user_id
    if hasattr(model_class, "user_id"):
        conditions.append(getattr(model_class, "user_id") == user.id)
    
    # Add additional custom conditions
    if additional_conditions:
        conditions.extend(additional_conditions)
    
    # Execute query with all conditions
    result = await db.execute(select(model_class).where(*conditions))
    resource = result.scalars().first()
    
    if not resource:
        raise HTTPException(
            status_code=404,
            detail=f"{resource_name} not found or you don't have access"
        )
    
    return resource

async def verify_project_access(
    project_id: UUID,
    user: User,
    db: AsyncSession
):
    """
    Verifies a user has access to a project.
    Used as a building block for more complex permission checks.
    
    Returns the project if access is granted, raises HTTPException otherwise.
    """
    from models.project import Project
    
    result = await db.execute(
        select(Project).where(
            Project.id == project_id,
            Project.user_id == user.id
        )
    )
    project = result.scalars().first()
    
    if not project:
        raise HTTPException(
            status_code=404,
            detail="Project not found or you don't have access"
        )
    
    if getattr(project, "archived", False):
        raise HTTPException(
            status_code=400,
            detail="This project is archived"
        )
    
    return project

async def process_standard_response(data: Any, message: Optional[str] = None) -> Dict[str, Any]:
    """
    Creates a standardized API response format.
    
    Args:
        data: The main response data
        message: Optional success message
        
    Returns:
        Formatted response dictionary
    """
    response = {
        "data": data,
        "success": True
    }
    
    if message:
        response["message"] = message
        
    return response
