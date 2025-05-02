"""
project_service.py
------------------
Centralizes logic for validating and retrieving project records.
We now clarify:
 - How to handle archived projects (400 vs. 403 vs. 422).
 - A 'get_valid_project' for integer-based IDs (legacy).
 - A 'validate_project_access' for UUID-based IDs (preferred).
"""

from uuid import UUID
from typing import Optional, Any, List, Type
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import asc, desc, func
from sqlalchemy.orm import joinedload

from models.project import Project
from models.user import User
from models.knowledge_base import KnowledgeBase
from models.conversation import Conversation
from models.project_file import ProjectFile
from utils.serializers import serialize_list

# =======================================================
#  Knowledge Base Validation
# =======================================================


async def validate_knowledge_base_access(
    project_id: UUID, knowledge_base_id: UUID, db: AsyncSession
) -> KnowledgeBase:
    """
    Validate KB exists, is active, and belongs to the given project.
    Raises 404 if project or KB not found, 400 if KB isn't active or mismatched.
    """
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    kb = await db.get(KnowledgeBase, knowledge_base_id)
    # kb.is_active ensures we can't use an inactive knowledge base
    if not kb or not kb.is_active or (kb.id != project.knowledge_base_id):
        raise HTTPException(
            status_code=400, detail="Knowledge base not available for this project"
        )

    return kb


# =======================================================
#  Project Access
# =======================================================


async def check_knowledge_base_status(
    project_id: UUID, db: AsyncSession
) -> dict[str, Any]:
    """Check if project's knowledge base has indexed content"""
    # Count processed files and total chunks
    stmt = select(
        func.count(1).label("file_count"),
        func.sum(
            ProjectFile.config["search_processing"]["chunk_count"].as_integer()
        ).label("total_chunks"),
    ).where(
        ProjectFile.project_id == project_id,
        ProjectFile.config["search_processing"]["success"].as_boolean(),
    )

    result = await db.execute(stmt)
    stats = result.mappings().first()

    return {
        "has_content": bool(stats and stats["total_chunks"]),
        "file_count": stats["file_count"] if stats else 0,
        "chunk_count": stats["total_chunks"] if stats else 0,
    }


async def validate_project_access(
    project_id: UUID, user: User, db: AsyncSession, skip_ownership_check: bool = False
) -> Project:
    """
    Ensures the project with UUID-based ID belongs to the user
    and is not archived. Raises 404 if not found, 400 if archived.

    Args:
        project_id: UUID of project to validate
        user: User object (only checked if skip_ownership_check=False)
        db: Database session
        skip_ownership_check: If True, skips user ownership validation
    """
    query = select(Project).where(Project.id == project_id)
    if not skip_ownership_check:
        query = query.where(Project.user_id == user.id)
    query = query.options(joinedload(Project.knowledge_base))

    result = await db.execute(query)
    project = result.scalars().first()

    if not project:
        raise HTTPException(
            status_code=404, detail="Project not found or unauthorized access"
        )

    if project.archived:
        raise HTTPException(status_code=400, detail="Project is archived")

    return project


async def get_valid_project(project_id: int, user: User, db: AsyncSession) -> Project:
    """
    Legacy approach for integer-based project IDs.
    Some older code may still rely on an int ID.
    Raises 404 if not found, 400 if archived.
    """
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == user.id)
    )
    project = result.scalars().first()

    if not project:
        raise HTTPException(
            status_code=404, detail="Project not found or unauthorized access"
        )

    if project.archived:
        raise HTTPException(status_code=400, detail="Project is archived")

    return project


# =======================================================
#  Default Project
# =======================================================


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
        default_project = Project(
            user_id=user.id,
            name="Default Project",
            description="Your default project for conversations",
            is_default=True,
            max_tokens=200000,
            default_model="claude-3-sonnet-20240229",
        )
        db.add(default_project)
        await db.commit()
        await db.refresh(default_project)

    return default_project


# =======================================================
#  Project Creation
# =======================================================


async def create_project(
    user_id: int,
    name: str,
    db: AsyncSession,
    description: Optional[str] = None,
    goals: Optional[str] = None,
    max_tokens: int = 200000,
    default_model: str = "claude-3-sonnet-20240229",
) -> Project:
    """
    Creates a new project with the given parameters.
    Raises ValueError if name is empty or invalid.
    """
    name = name.strip()
    if not name:
        raise ValueError("Project name cannot be empty")

    project = Project(
        user_id=user_id,
        name=name,
        description=description,
        goals=goals,
        max_tokens=max_tokens,
        default_model=default_model,
    )

    db.add(project)
    await db.commit()
    await db.refresh(project)

    return project


# =======================================================
#  Token Usage
# =======================================================


async def validate_project_token_usage(
    project: Project, additional_tokens: int
) -> None:
    """
    Raises ValueError if the project doesn't have enough capacity
    for additional_tokens. Return 400 or 422 in routes if desired.
    """
    if project.token_usage + additional_tokens > project.max_tokens:
        # We typically consider this a 400 "Bad Request"
        raise ValueError(
            f"Operation requires {additional_tokens} tokens, "
            f"but only {project.max_tokens - project.token_usage} available"
        )


async def get_project_token_usage(project_id: UUID, db: AsyncSession) -> dict:
    """
    Retrieves token usage statistics for a project. Raises 404 if not found.
    """
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    usage_percentage = (
        (project.token_usage / project.max_tokens) * 100
        if project.max_tokens > 0
        else 0
    )
    return {
        "token_usage": project.token_usage,
        "max_tokens": project.max_tokens,
        "available_tokens": project.max_tokens - project.token_usage,
        "usage_percentage": usage_percentage,
    }


# =======================================================
#  Generic Resource Validation
# =======================================================


async def validate_resource_access(
    resource_id: UUID,
    model_class,
    user: User,
    db: AsyncSession,
    resource_name: str = "Resource",
    additional_conditions=None,
) -> Any:
    """
    Generic method for validating access to any resource.
    We check:
      - Resource with given UUID
      - resource.user_id == user.id (if user_id is a field)
      - Not archived (if archived is a field)
    Raises 404 if not found, 400 if archived.
    """
    query = select(model_class).where(model_class.id == resource_id)

    if hasattr(model_class, "user_id"):
        query = query.where(model_class.user_id == user.id)

    if additional_conditions:
        for condition in additional_conditions:
            query = query.where(condition)

    result = await db.execute(query)
    resource = result.scalars().first()

    if not resource:
        raise HTTPException(
            status_code=404, detail=f"{resource_name} not found or unauthorized access"
        )

    if hasattr(resource, "archived") and resource.archived:
        raise HTTPException(status_code=400, detail=f"{resource_name} is archived")

    return resource


# =======================================================
#  Project Conversations
# =======================================================


async def get_project_conversations(project_id: UUID, db: AsyncSession):
    """
    Return all conversations for a project.
    Could eventually add skip/limit if needed.
    """
    result = await db.execute(
        select(Conversation).where(Conversation.project_id == project_id)
    )
    return result.scalars().all()


# =======================================================
#  Paginated Resource Query
# =======================================================


async def get_paginated_resources(
    db: AsyncSession,
    model_class: Type,
    project_id: UUID,
    sort_by: str = "created_at",
    sort_desc: bool = True,
    skip: int = 0,
    limit: int = 100,
    additional_filters: Optional[Any] = None,
    serializer_func=None,
) -> List[dict[str, Any]]:
    """
    Generic method to retrieve items for a given project,
    sorted & paginated. We assume the model has a project_id field.

    Args:
        db: SQLAlchemy async session
        model_class: SQLAlchemy model class to query
        project_id: UUID of the project
        sort_by: Field to sort by
        sort_desc: True for descending order
        skip: Number of items to skip
        limit: Maximum number of items to return
        additional_filters: Additional SQLAlchemy filters to apply
        serializer_func: Function to serialize each item. If None, returns raw ORM objects.

    Returns:
        List of serialized items (if serializer_func is provided) or raw ORM objects
    """
    query = select(model_class).where(model_class.project_id == project_id)

    if additional_filters:
        query = query.where(additional_filters)

    if hasattr(model_class, sort_by):
        sort_field = getattr(model_class, sort_by)
        query = query.order_by(desc(sort_field) if sort_desc else asc(sort_field))
    else:
        query = query.order_by(
            desc(model_class.created_at) if sort_desc else asc(model_class.created_at)
        )

    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    items = result.scalars().all()

    if serializer_func:
        return serialize_list(items, serializer_func)

    # Return raw items if no serializer provided
    return list(items)
