"""
session.py
---------
Provides utilities for database session management.
Ensures consistent session handling across different request types.
"""
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Callable, TypeVar, Optional

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from db import AsyncSessionLocal, get_async_session

logger = logging.getLogger(__name__)
T = TypeVar('T')

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
        # Add session to kwargs
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
