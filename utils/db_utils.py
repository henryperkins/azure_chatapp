"""
db_utils.py
-----------
Centralized database utility functions for common operations across the application.
Provides session management, CRUD operations, and query helpers.
"""
import logging
from contextlib import asynccontextmanager
from typing import TypeVar, Type, List, Optional, Any, AsyncGenerator, Callable, Dict, Union

from fastapi import Depends
from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import ClauseElement

from db import AsyncSessionLocal, get_async_session

logger = logging.getLogger(__name__)

# Type variable for generic database functions
T = TypeVar('T')

# Session management functions
async def with_db_session(func: Callable[..., T], *args, **kwargs) -> T:
    """
    Execute a function with a database session that is automatically closed.
    
    Args:
        func: Function to execute
        *args: Positional arguments for func
        **kwargs: Keyword arguments for func
        
    Returns:
        Result of func
    """
    async with AsyncSessionLocal() as session:
        kwargs['db'] = session
        result = await func(*args, **kwargs)
        return result


@asynccontextmanager
async def get_websocket_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Context manager for getting a database session for WebSocket handlers.
    Ensures proper cleanup on errors or disconnects.
    
    Yields:
        Database session
    """
    session = AsyncSessionLocal()
    try:
        yield session
    except Exception as e:
        await session.rollback()
        logger.error(f"WebSocket session error: {str(e)}")
        raise
    finally:
        await session.close()


# CRUD operations
async def get_by_id(
    db: AsyncSession,
    model: Type[T],
    id: Any
) -> Optional[T]:
    """
    Get a model instance by ID.
    
    Args:
        db: AsyncSession instance
        model: SQLAlchemy model class
        id: Primary key ID
        
    Returns:
        Model instance or None if not found
    """
    result = await db.execute(select(model).where(getattr(model, "id") == id))
    return result.scalars().first()


async def get_all_by_condition(
    db: AsyncSession, 
    model: Type[T], 
    *conditions, 
    limit: int = 100,
    offset: int = 0,
    order_by: Any = None
) -> List[T]:
    """
    Get all model instances matching conditions.
    
    Args:
        db: AsyncSession instance
        model: SQLAlchemy model class
        conditions: SQLAlchemy filter conditions
        limit: Maximum records to return
        offset: Number of records to skip (pagination)
        order_by: Column to order by
        
    Returns:
        List of model instances
    """
    query = select(model).where(*conditions)
    
    if order_by is not None:
        query = query.order_by(order_by)
        
    query = query.limit(limit).offset(offset)
    
    result = await db.execute(query)
    return list(result.scalars().all())


async def save_model(db: AsyncSession, model_instance: Any) -> Any:
    """
    Save or update a model instance.
    
    Args:
        db: AsyncSession instance
        model_instance: SQLAlchemy model instance to save
        
    Returns:
        Updated model instance
    """
    db.add(model_instance)
    await db.commit()
    await db.refresh(model_instance)
    return model_instance


async def update_model(
    db: AsyncSession,
    model: Type[T],
    id: Any,
    update_data: Dict[str, Any]
) -> Optional[T]:
    """
    Update a model by ID with new values.
    
    Args:
        db: AsyncSession instance
        model: SQLAlchemy model class
        id: Primary key ID
        update_data: Dictionary of fields to update
        
    Returns:
        Updated model instance or None if not found
    """
    stmt = update(model).where(getattr(model, "id") == id).values(**update_data).returning(model)
    result = await db.execute(stmt)
    await db.commit()
    return result.scalars().first()


async def delete_model(
    db: AsyncSession,
    model: Type[T],
    id: Any
) -> bool:
    """
    Delete a model by ID.
    
    Args:
        db: AsyncSession instance
        model: SQLAlchemy model class
        id: Primary key ID
        
    Returns:
        True if deleted, False if not found
    """
    stmt = delete(model).where(getattr(model, "id") == id)
    result = await db.execute(stmt)
    await db.commit()
    return result.rowcount > 0


# Specialized query helpers
async def count_by_condition(
    db: AsyncSession,
    model: Type[T],
    *conditions
) -> int:
    """
    Count model instances matching conditions.
    
    Args:
        db: AsyncSession instance
        model: SQLAlchemy model class
        conditions: SQLAlchemy filter conditions
        
    Returns:
        Count of matching records
    """
    from sqlalchemy import func
    query = select(func.count()).select_from(model).where(*conditions)
    result = await db.execute(query)
    return result.scalar() or 0