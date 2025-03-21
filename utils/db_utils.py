"""
db_utils.py
----------
Database utility functions including token cleanup scheduled task,
background cleanup operations, and other database maintenance functions.
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Callable, Awaitable, Any, List, Type, Optional, TypeVar, Union
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, asc, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select
from sqlalchemy.sql.expression import BinaryExpression

from db import get_async_session_context
from models.user import User
from utils.auth_utils import clean_expired_tokens

logger = logging.getLogger(__name__)

# Type variable for generic database models
T = TypeVar('T')

# Global flag to manage concurrent runs of scheduled tasks
_task_running = False

async def run_periodic_task(
    interval_seconds: int,
    task_func: Callable[[AsyncSession], Awaitable[Any]],
    task_name: str
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
        logger.warning(f"Periodic task '{task_name}' already running, skipping this execution")
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
            "token_cleanup"
        )
    )
    logger.info(f"Scheduled token cleanup to run every {interval_minutes} minutes")


async def save_model(db: AsyncSession, model_instance: Any) -> None:
    """
    Generic function to save a model instance to the database.
    
    Args:
        db: Database session
        model_instance: SQLAlchemy model instance to save
    """
    db.add(model_instance)
    await db.commit()
    await db.refresh(model_instance)


async def get_all_by_condition(
    db: AsyncSession,
    model_class: Type[T],
    *where_clauses: BinaryExpression,
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
    
    result = await db.execute(query)
    return list(result.scalars().all())


async def validate_resource_access(
    resource_id: UUID,
    model_class: Type[T],
    user: User,
    db: AsyncSession,
    resource_name: str = "Resource",
    additional_filters: Optional[List[BinaryExpression]] = None,
) -> T:
    """
    Generic method for validating access to any resource.
    
    Args:
        resource_id: UUID of the resource
        model_class: The SQLAlchemy model class of the resource
        user: User object
        db: Database session
        resource_name: Human-readable name for error messages
        additional_filters: Optional additional filter conditions
        
    Returns:
        The resource object if found and accessible
        
    Raises:
        HTTPException: If resource not found or user lacks permission
    """
    # Build query with base conditions
    query = select(model_class).where(
        model_class.id == resource_id,
        model_class.user_id == user.id,
    )
    
    # Apply additional filters if specified
    if additional_filters:
        for condition in additional_filters:
            query = query.where(condition)
    
    # Execute query
    result = await db.execute(query)
    resource = result.scalars().first()
    
    # Handle not found case
    if not resource:
        raise HTTPException(
            status_code=404, 
            detail=f"{resource_name} not found or you don't have access to it"
        )
    
    
    return resource


async def get_by_id(
    db: AsyncSession,
    model_class: Type[T],
    model_id: UUID
) -> Optional[T]:
    """
    Generic function to retrieve a model instance by its ID.

    Args:
        db: Database session
        model_class: SQLAlchemy model class to query
        model_id: ID of the model instance to retrieve

    Returns:
        The model instance if found, otherwise None
    """
    query = select(model_class).where(model_class.id == model_id)
    result = await db.execute(query)
    return result.scalars().first()


async def get_by_id(
    db: AsyncSession,
    model_class: Type[T],
    model_id: UUID
) -> Optional[T]:
    """
    Generic function to retrieve a model instance by its ID.

    Args:
        db: Database session
        model_class: SQLAlchemy model class to query
        model_id: ID of the model instance to retrieve

    Returns:
        The model instance if found, otherwise None
    """
    query = select(model_class).where(model_class.id == model_id)
    result = await db.execute(query)
    return result.scalars().first()