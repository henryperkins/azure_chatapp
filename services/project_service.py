"""
project_service.py
------------------
Centralizes logic for validating and retrieving project records.
We provide two different helpers for backwards compatibility:

• get_valid_project(project_id: int, user: User, db: AsyncSession) - For cases where the code still expects an integer project_id
  - Accepts a User object, from which we extract user.id

• validate_project_access(project_id: UUID, user: User, db: AsyncSession) -> Project
  - For cases using a UUID-based project ID
  - Also accepts a User object, from which we extract user.id
"""
from uuid import UUID
from typing import Optional, Any
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from models.project import Project
from models.user import User
from sqlalchemy import asc, desc

async def validate_project_access(project_id: UUID, user: User, db: AsyncSession) -> Project:
    """
    Ensures the project with UUID-based ID belongs to the user and is not archived.
    Raises HTTPException on access issues.
    """
    result = await db.execute(
        select(Project)
        .where(Project.id == project_id, Project.user_id == user.id)
    )
    project = result.scalars().first()
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found or unauthorized access")
    
    if project.archived:
        raise HTTPException(status_code=400, detail="Project is archived")
    
    return project

async def get_default_project(user: User, db: AsyncSession) -> Project:
    """
    Retrieves the default project for a user, or creates one if none exists.
    """
    result = await db.execute(
        select(Project)
        .where(Project.user_id == user.id, Project.is_default.is_(True))
        .limit(1)
    )
    default_project = result.scalars().first()
    
    if not default_project:
        # Create a default project if none exists
        default_project = Project(
            user_id=user.id,
            name="Default Project",
            description="Your default project for conversations",
            is_default=True,
            max_tokens=200000,
            default_model="claude-3-sonnet-20240229"
        )
        db.add(default_project)
        await db.commit()
        await db.refresh(default_project)
    
    return default_project

async def create_project(
    user_id: int,
    name: str,
    db: AsyncSession,
    description: Optional[str] = None,
    goals: Optional[str] = None,
    max_tokens: int = 200000,
    knowledge_base_id: Optional[UUID] = None,
    default_model: str = "claude-3-sonnet-20240229"
) -> Project:
    """
    Creates a new project with the given parameters.
    
    Args:
        user_id: ID of the owner
        name: Project name
        description: Optional project description
        goals: Optional project goals
        max_tokens: Maximum token limit for the project
        knowledge_base_id: Optional knowledge base to link
        default_model: Default AI model to use (defaults to Claude 3.7 Sonnet)
        db: Database session
        
    Returns:
        Newly created Project object
    """
    # Validate project name
    name = name.strip()
    if not name:
        raise ValueError("Project name cannot be empty")
    
    # Create project object
    project = Project(
        user_id=user_id,
        name=name,
        description=description,
        goals=goals,
        max_tokens=max_tokens,
        knowledge_base_id=knowledge_base_id,
        default_model=default_model
    )
    
    db.add(project)
    await db.commit()
    await db.refresh(project)
    
    return project

async def get_project_token_usage(project_id: UUID, db: AsyncSession) -> dict:
    """
    Retrieves token usage statistics for a project.
    """
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    return {
        "token_usage": project.token_usage,
        "max_tokens": project.max_tokens,
        "available_tokens": project.max_tokens - project.token_usage,
        "usage_percentage": (project.token_usage / project.max_tokens) * 100 if project.max_tokens > 0 else 0
    }


async def validate_resource_access(
    resource_id: UUID,
    model_class,
    user: User,
    db: AsyncSession,
    resource_name: str = "Resource",
    additional_conditions=None
) -> Any:
    """
    Generic method for validating access to any resource.
    All services can use this for projects, artifacts, files, etc.

    Args:
        resource_id: UUID of the resource
        model_class: The SQLAlchemy model class of the resource
        user: User object
        db: Database session
        resource_name: Human-readable name for error messages
        additional_conditions: Optional additional conditions for the query

    Returns:
        The resource object if found and accessible

    Raises:
        HTTPException: If resource not found or user lacks permission
    """
    # Build the query
    query = select(model_class).where(model_class.id == resource_id)
    
    # Add user ID check if the model has a user_id field
    if hasattr(model_class, 'user_id'):
        query = query.where(model_class.user_id == user.id)
        
    # Add additional conditions if provided
    if additional_conditions:
        for condition in additional_conditions:
            query = query.where(condition)
    
    # Execute the query
    result = await db.execute(query)
    resource = result.scalars().first()
    
    if not resource:
        raise HTTPException(status_code=404, detail=f"{resource_name} not found or unauthorized access")
    
    # Check if the resource is archived (if applicable)
    if hasattr(resource, 'archived') and resource.archived:
        raise HTTPException(status_code=400, detail=f"{resource_name} is archived")
    
    return resource

async def get_project_conversations(project_id: UUID, db: AsyncSession):
    from models.conversation import Conversation
    result = await db.execute(
        select(Conversation)
        .where(Conversation.project_id == project_id)
    )
    return result.scalars().all()

async def get_paginated_resources(
    db: AsyncSession,
    model_class,
    project_id: UUID,
    sort_by: str = "created_at",
    sort_desc: bool = True,
    skip: int = 0,
    limit: int = 100,
    additional_filters=None
):
    """
    Generic function for paginated queries of project resources with sorting.

    Args:
        db: Database session
        model_class: SQLAlchemy model class to query
        project_id: Project ID to filter by
        sort_by: Field to sort by
        sort_desc: True for descending order
        skip: Pagination offset
        limit: Page size
        additional_filters: Optional additional filter conditions

    Returns:
        List of resources
    """
    query = select(model_class).where(model_class.project_id == project_id)

    # Apply additional filters if provided
    if additional_filters:
        query = query.where(additional_filters)

    # Apply sorting
    if hasattr(model_class, sort_by):
        sort_field = getattr(model_class, sort_by)
        query = query.order_by(desc(sort_field) if sort_desc else asc(sort_field))
    else:
        query = query.order_by(desc(model_class.created_at) if sort_desc else asc(model_class.created_at))

    query = query.offset(skip).limit(limit)

    result = await db.execute(query)
    return result.scalars().all()
