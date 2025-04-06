"""
db_utils.py
----------
Database utility functions including token cleanup scheduled task,
background cleanup operations, and other database maintenance functions.
"""

import asyncio
import logging
from datetime import datetime
from typing import (
    Callable,
    Awaitable,
    Any,
    List,
    Type,
    Optional,
    TypeVar,
    Union,
    Protocol,
    Sequence,
)
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.expression import BinaryExpression
from sqlalchemy.sql import ColumnElement  # Add this import

from db import get_async_session_context
from models.user import User
from utils.auth_utils import clean_expired_tokens

logger = logging.getLogger(__name__)


# Base protocol for models with common attributes
class BaseModelProtocol(Protocol):
    id: Any
    user_id: Any
    archived: bool = False


# Type variable for generic database models
T = TypeVar("T", bound=BaseModelProtocol)

# Global flag to manage concurrent runs of scheduled tasks
_task_running = False


async def run_periodic_task(
    interval_seconds: int,
    task_func: Callable[[AsyncSession], Awaitable[Any]],
    task_name: str,
) -> None:
    """
    Runs a periodic task at specified intervals.

    Args:
        interval_seconds: Time in seconds between task runs
        task_func: Async function to run that takes a database session
        task_name: Name of the task for logging
    """
    global _task_running

    if _task_running:
        logger.warning(
            f"Periodic task '{task_name}' already running, skipping this execution"
        )
        return

    try:
        _task_running = True
        logger.info(f"Starting periodic task: {task_name}")

        while True:
            try:
                async with get_async_session_context() as session:
                    start_time = datetime.utcnow()
                    result = await task_func(session)
                    end_time = datetime.utcnow()
                    duration = (end_time - start_time).total_seconds()

                    logger.info(
                        f"Periodic task '{task_name}' completed in {duration:.2f}s: {result}"
                    )
            except Exception as e:
                logger.error(f"Error in periodic task '{task_name}': {str(e)}")

            # Wait until next interval
            await asyncio.sleep(interval_seconds)
    finally:
        _task_running = False


async def schedule_token_cleanup(interval_minutes: int = 60) -> None:
    """
    Schedules the token cleanup task to run periodically.

    Args:
        interval_minutes: Time in minutes between cleanup runs
    """
    # Start the task in the background
    asyncio.create_task(
        run_periodic_task(
            interval_minutes * 60,  # Convert to seconds
            clean_expired_tokens,
            "token_cleanup",
        )
    )
    logger.info(f"Scheduled token cleanup to run every {interval_minutes} minutes")


async def save_model(db: AsyncSession, model_instance: Any) -> Optional[Any]:
    """
    Generic function to save a model instance to the database.

    Args:
        db: Database session
        model_instance: SQLAlchemy model instance to save

    Returns:
        The saved model instance if successful, None otherwise
    """
    try:
        logger.debug(f"Saving model instance: {model_instance}")
        db.add(model_instance)
        await db.commit()
        await db.refresh(model_instance)
        logger.debug(f"Successfully saved model: {model_instance}")
        return model_instance
    except Exception as e:
        logger.error(f"Error saving model {type(model_instance).__name__}: {str(e)}")
        await db.rollback()
        return None


async def get_all_by_condition(
    db: AsyncSession,
    model_class: Type[T],
    *where_clauses: Union[BinaryExpression, ColumnElement],  # Change this type
    order_by: Optional[Any] = None,
    limit: Optional[int] = None,
    offset: Optional[int] = None,
) -> List[T]:
    """
    Generic function to retrieve all model instances matching given conditions.

    Args:
        db: Database session
        model_class: SQLAlchemy model class to query
        where_clauses: SQLAlchemy where conditions
        order_by: Optional order by clause
        limit: Optional limit for query results
        offset: Optional offset for query results

    Returns:
        List of model instances matching the conditions
    """
    query = select(model_class)

    # Apply all where conditions
    for condition in where_clauses:
        query = query.where(condition)

    # Apply ordering if specified
    if order_by is not None:
        query = query.order_by(order_by)

    # Apply pagination if specified
    if offset is not None:
        query = query.offset(offset)
    if limit is not None:
        query = query.limit(limit)

    try:
        result = await db.execute(query)
        return list(result.scalars().all())
    finally:
        await db.close()


async def validate_resource_access(
    resource_id: UUID,
    model_class: Type[T],
    user: User,
    db: AsyncSession,
    resource_name: str = "Resource",
    additional_filters: Optional[Sequence[BinaryExpression[Any]]] = None,
    require_ownership: bool = True,
) -> T:
    """
    Generic method for validating access to any resource with enhanced debugging.

    Args:
        resource_id: UUID of the resource
        model_class: The SQLAlchemy model class of the resource
        user: User object
        db: Database session
        resource_name: Human-readable name for error messages
        additional_filters: Optional additional filter conditions
        require_ownership: Whether to validate user ownership (default True)

    Returns:
        The resource object if found and accessible

    Raises:
        HTTPException: With specific error details if validation fails
    """
    logger.debug(
        f"Validating access to {resource_name} {resource_id} for user {user.id}\n"
        f"Model: {model_class.__name__}\n"
        f"Additional filters: {additional_filters}"
    )

    # Build base query
    query = select(model_class).where(model_class.id == resource_id)

    # Add ownership check if required
    if require_ownership and hasattr(model_class, "user_id"):
        query = query.where(model_class.user_id == user.id)

    # Apply additional filters if specified
    if additional_filters:
        for condition in additional_filters:
            query = query.where(condition)

    # Log and execute query
    logger.debug(f"Executing query: {query}")
    result = await db.execute(query)
    resource = result.scalars().first()

    if not resource:
        # Check if resource exists at all
        exists = await db.execute(
            select(model_class.id).where(model_class.id == resource_id)
        )
        if not exists.scalar():
            logger.warning(f"{resource_name} {resource_id} does not exist")
            raise HTTPException(status_code=404, detail=f"{resource_name} not found")

        # Resource exists but filters/ownership failed
        logger.warning(
            f"Access denied to {resource_name} {resource_id}\n"
            f"User {user.id} failed validation checks"
        )
        raise HTTPException(
            status_code=404, detail=f"{resource_name} exists but you don't have access"
        )

    # Check archived status if applicable
    if hasattr(resource, "archived") and resource.archived:
        logger.warning(f"Attempt to access archived {resource_name} {resource_id}")
        raise HTTPException(
            status_code=400,
            detail=f"{resource_name} is archived and cannot be modified",
        )

    logger.debug(f"Access granted to {resource_name} {resource_id}")
    return resource


async def get_by_id(
    db: AsyncSession, model_class: Type[T], model_id: Union[UUID, int]
) -> Optional[T]:
    """
    Generic function to retrieve a model instance by its ID.
    Supports both UUID and integer ID types.

    Args:
        db: Database session
        model_class: SQLAlchemy model class to query
        model_id: ID of the model instance to retrieve (UUID or integer)

    Returns:
        The model instance if found, otherwise None
    """
    query = select(model_class).where(model_class.id == model_id)
    result = await db.execute(query)
    return result.scalars().first()
