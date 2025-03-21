"""
db_utils.py
----------
Database utility functions including token cleanup scheduled task,
background cleanup operations, and other database maintenance functions.
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Callable, Awaitable, Any

from sqlalchemy.ext.asyncio import AsyncSession

from db import get_async_session_context
from utils.auth_utils import clean_expired_tokens

logger = logging.getLogger(__name__)

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