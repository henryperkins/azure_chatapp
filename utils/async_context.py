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
from typing import Any, Awaitable, Callable, TypeVar, Optional, Coroutine

# Import context variables from logging_config
from utils.logging_config import request_id_var, trace_id_var

logger = logging.getLogger(__name__)

T = TypeVar("T")


def get_request_id() -> Optional[str]:
    """
    Get the current request ID from the context variable.

    Returns:
        The current request ID if set, None otherwise.
    """
    return request_id_var.get()


def get_trace_id() -> Optional[str]:
    """
    Get the current trace ID from the context variable.

    Returns:
        The current trace ID if set, None otherwise.
    """
    return trace_id_var.get()


# Using ``Coroutine`` in the signature ensures static type checkers accept the
# value when it's eventually passed to ``asyncio.create_task`` (which expects
# a real coroutine object, not a generic Awaitable).

def create_context_safe_task(
    coro_func: Callable[..., Coroutine[Any, Any, T]],
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
            coro_obj: Coroutine[Any, Any, T] = coro_func(*args, **kwargs)
            task: asyncio.Task[T] = ctx.run(lambda: asyncio.create_task(coro_obj))
            return await task
        except Exception as e:
            logger.exception(
                "Error in context-safe background task",
                extra={
                    "task_function": coro_func.__name__,
                    "error": str(e),
                    "args_count": len(args),
                    "kwargs_keys": list(kwargs.keys()) if kwargs else [],
                },
            )
            raise

    return loop.create_task(_wrapped_coro())


def context_preserving_wrapper(
    func: Callable[..., Awaitable[T]],
) -> Callable[..., Awaitable[T]]:
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
        task_inner: asyncio.Task[T] = ctx.run(lambda: asyncio.create_task(_run_in_context()))
        return await task_inner

    return wrapper


class AsyncContextManager:
    """
    A utility class for managing context propagation in async operations.
    Provides methods for creating context-aware tasks and managing context state.
    """

    @staticmethod
    def create_task_with_context(
        coro: Coroutine[Any, Any, T], name: str | None = None
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
            task_inner: asyncio.Task[T] = ctx.run(lambda: asyncio.create_task(coro))
            return await task_inner

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
