"""
utils/async_context.py
─────────────────────────────────────────────────────────────────────────
Context-safe utilities for asyncio task management and context propagation.

This module provides enhanced context management for asyncio tasks to ensure
ContextVars (like request_id and trace_id) are properly propagated to background
tasks and coroutines.
"""

import asyncio
import functools
import logging
from contextvars import copy_context
from typing import Any, Awaitable, Callable, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar('T')


def create_context_safe_task(
    coro_func: Callable[..., Awaitable[T]],
    *args: Any,
    **kwargs: Any,
) -> asyncio.Task[T]:
    """
    Enhanced version of create_background_task that spawns an asyncio Task
    carrying over current ContextVars so that request_id_var / trace_id_var
    remain visible inside the task.

    This is an improved version that includes better error handling and logging.

    Example
    -------
    task = create_context_safe_task(my_async_worker, user_id=123)
    """
    ctx = copy_context()
    loop = asyncio.get_running_loop()

    async def _wrapped_coro() -> T:
        try:
            # Run the coroutine within the copied context
            return await ctx.run(lambda: asyncio.create_task(coro_func(*args, **kwargs)))
        except Exception as e:
            logger.exception(
                "Error in context-safe background task",
                extra={
                    "task_function": coro_func.__name__,
                    "error": str(e),
                    "args_count": len(args),
                    "kwargs_keys": list(kwargs.keys()) if kwargs else []
                }
            )
            raise

    return loop.create_task(_wrapped_coro())


def context_preserving_wrapper(func: Callable[..., Awaitable[T]]) -> Callable[..., Awaitable[T]]:
    """
    Decorator that ensures ContextVars are preserved when calling async functions.
    
    Usage:
        @context_preserving_wrapper
        async def my_background_task(data):
            # request_id_var and trace_id_var will be available here
            pass
    """
    @functools.wraps(func)
    async def wrapper(*args: Any, **kwargs: Any) -> T:
        ctx = copy_context()
        
        async def _run_in_context() -> T:
            return await func(*args, **kwargs)
        
        # Run the function in the copied context
        return await ctx.run(lambda: asyncio.create_task(_run_in_context()))
    
    return wrapper


class AsyncContextManager:
    """
    A utility class for managing context propagation in async operations.
    Provides methods for creating context-aware tasks and managing context state.
    """
    
    @staticmethod
    def create_task_with_context(
        coro: Awaitable[T],
        name: str | None = None
    ) -> asyncio.Task[T]:
        """
        Create a task that preserves the current context.
        
        Args:
            coro: The coroutine to run
            name: Optional name for the task
            
        Returns:
            asyncio.Task with preserved context
        """
        ctx = copy_context()
        loop = asyncio.get_running_loop()
        
        async def _context_wrapper() -> T:
            return await ctx.run(lambda: asyncio.create_task(coro))
        
        task = loop.create_task(_context_wrapper())
        if name:
            task.set_name(name)
        
        return task
    
    @staticmethod
    def run_in_context(func: Callable[[], T]) -> T:
        """
        Run a function in the current context.
        Useful for ensuring context variables are available in sync code.
        
        Args:
            func: Function to run
            
        Returns:
            Result of the function
        """
        ctx = copy_context()
        return ctx.run(func)


# Convenience aliases for backward compatibility
create_background_task = create_context_safe_task
