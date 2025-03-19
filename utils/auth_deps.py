import logging
import os
import jwt
from fastapi import WebSocket, Cookie
from fastapi import HTTPException
from fastapi.security import OAuth2PasswordBearer
from fastapi import Depends, HTTPException, Request, Header
from sqlalchemy import select
from models.user import User
from db import get_async_session
from typing import Optional, Any, List, Type, TypeVar, Dict
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

logger = logging.getLogger(__name__)
JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"

T = TypeVar('T')

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

async def get_current_user_and_token(
    request: Request,
    session: AsyncSession = Depends(get_async_session)
):
    """
    Updated to inject session properly
    """
    # Try to get from cookie first
    token = None
    
    if isinstance(request, WebSocket):
        cookies = request.cookies
        token = cookies.get("access_token")
        # For WebSocket, also check the query parameters
        if not token and "token" in request.query_params:
            token = request.query_params["token"]
    else:
        # For regular HTTP requests
        token = request.cookies.get("access_token")
        
        # Log all cookies for debugging
        logger.debug(f"All cookies: {request.cookies}")
        
        # Fallback to Authorization header if no cookie
        if not token:
            auth_header = request.headers.get("Authorization")
            if auth_header and auth_header.startswith("Bearer "):
                token = auth_header.replace("Bearer ", "")
    
    if not token:
        logger.warning("No token found in cookies or Authorization header")
        raise HTTPException(status_code=401, detail="No access token provided")
        
    return await _get_user_from_token(token, session)

async def _get_user_from_token(token: str, session: AsyncSession):
    """
    Gets user from token using injected session
    """
    try:
        decoded = verify_token(token)
        username = decoded.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid token payload")

        result = await session.execute(select(User).where(User.username == username))
        user = result.scalars().first()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        if not user.is_active:
            raise HTTPException(status_code=403, detail="Account disabled")
        return user
    except Exception as e:
        logger.error(f"Error authenticating user: {str(e)}")
        raise HTTPException(status_code=401, detail=str(e))

# Fixed and enhanced utility functions

async def validate_resource_ownership(
    resource_id: Any,
    model_class: Type[T],
    user: User,
    db: AsyncSession,
    resource_name: str = "Resource",
    additional_conditions: List = None
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
    # Start with basic ID condition
    conditions = [model_class.id == resource_id]
    
    # Add user ownership check if model has user_id
    if hasattr(model_class, "user_id"):
        conditions.append(model_class.user_id == user.id)
    
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

async def process_standard_response(data: Any, message: str = None) -> Dict[str, Any]:
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