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
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from models.project import Project
from models.user import User

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
        .where(Project.user_id == user.id, Project.is_default == True)
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
            max_tokens=200000
        )
        db.add(default_project)
        await db.commit()
        await db.refresh(default_project)
    
    return default_project

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

from sqlalchemy import asc, desc
from typing import Any

async def validate_resource_access(
    resource_id: UUID,
    project_id: UUID,
    user: User,
    db: AsyncSession,
    model_class,
    resource_name: str = "Resource"
) -> Any:
    """
    Generic method for validating access to any project-related resource.
    All services can use this for artifacts, files, etc.

    Args:
        resource_id: UUID of the resource
        project_id: UUID of the project
        user: User object
        db: Database session
        model_class: The SQLAlchemy model class of the resource
        resource_name: Human-readable name for error messages

    Returns:
        The resource object if found and accessible

    Raises:
        HTTPException: If resource not found or user lacks permission
    """
    # First validate project access
    project = await validate_project_access(project_id, user, db)

    # Then check for the resource
    result = await db.execute(
        select(model_class).where(
            model_class.id == resource_id,
            model_class.project_id == project_id
        )
    )
    resource = result.scalars().first()

    if not resource:
        raise HTTPException(status_code=404, detail=f"{resource_name} not found")

    return resource

async def get_paginated_resources(
    db: AsyncSession,
    model_class,
    project_id: UUID,
    sort_by: str = "created_at",
    sort_desc: bool = True,
    skip: int = 0,
    limit: int = 100,
    additional_filters = None
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