"""
utils/sentry_helpers.py
-----------------------
Sentry helper utilities for spans, tags, user context, and background tasks.
"""

import asyncio
import contextlib
import logging
from contextvars import copy_context
from typing import Any, Callable, Generator, Union

import sentry_sdk
from sentry_sdk.tracing import Span, Transaction

def set_sentry_user(user: dict[str, Any]) -> None:
    """Shortcut with redaction."""
    from utils.sentry_config import _filter_user_data
    from sentry_sdk import set_user
    set_user(_filter_user_data(user))

def set_sentry_tag(key: str, value: Union[str, int, float, bool]) -> None:
    """Low-cardinality tag helper (falls back to scope)."""
    value = str(value)[:64]
    with contextlib.suppress(Exception):
        if span := sentry_sdk.get_current_span():
            span.set_tag(key, value)
        else:
            with sentry_sdk.configure_scope() as scope:
                scope.set_tag(key, value)

def set_sentry_context(key: str, ctx: dict[str, Any]) -> None:
    ctx = {k: (str(v)[:128] if len(str(v)) > 128 else v) for k, v in ctx.items()}
    with contextlib.suppress(Exception):
        sentry_sdk.set_context(key, ctx)  # type: ignore[arg-type]

def get_current_trace_id() -> str | None:
    try:
        span = sentry_sdk.get_current_span()
        return span.trace_id if span else None
    except Exception:
        return None

@contextlib.contextmanager
def sentry_span(
    op: str,
    description: str | None = None,
    **data: Any,
) -> Generator[Span, None, None]:
    """
    Lightweight context-manager for a nested span or a root transaction
    when none exists (never starts a blocking `asyncio.run()`).
    """
    parent = sentry_sdk.get_current_span()
    desc = description or op
    try:
        if parent is None:
            with sentry_sdk.start_transaction(op=op, name=desc) as tx:
                _set_span_data(tx, data)
                yield tx
        else:
            with parent.start_child(op=op, description=desc) as sp:
                _set_span_data(sp, data)
                yield sp
    except Exception:
        logging.exception("Failed to create Sentry span")
        raise

def _set_span_data(span: Span | Transaction, data: dict[str, Any]) -> None:
    for k, v in data.items():
        try:
            span.set_data(k, v)
        except Exception:
            span.set_data(k, str(v))

def inject_sentry_trace_headers(response) -> None:
    with contextlib.suppress(Exception):
        if tp := sentry_sdk.get_traceparent():
            response.headers["sentry-trace"] = tp
        if baggage := sentry_sdk.get_baggage():
            response.headers["baggage"] = baggage

def make_sentry_trace_response(
    payload: dict[str, Any],
    transaction: Span | Transaction,
    status_code: int = 200,
):
    from fastapi.responses import JSONResponse
    resp = JSONResponse(content=payload, status_code=status_code)
    try:
        resp.headers["sentry-trace"] = transaction.to_traceparent()
        if hasattr(transaction, "containing_transaction"):
            parent = transaction.containing_transaction()
            if getattr(parent, "_baggage", None):
                resp.headers["baggage"] = parent._baggage.serialize()
    except Exception:
        pass
    return resp

def create_background_task(
    coro_func: Callable[..., "asyncio.Future[Any]"] | Callable[..., "asyncio.AsyncGenerator[Any, None]"],
    *args: Any,
    **kwargs: Any,
) -> asyncio.Task[Any]:
    ctx = copy_context()
    loop = asyncio.get_running_loop()
    return loop.create_task(ctx.run(coro_func, *args, **kwargs))

def extract_sentry_trace(request) -> dict[str, str]:
    trace_headers = {}
    for header in ("sentry-trace", "baggage"):
        value = request.headers.get(header)
        if value:
            trace_headers[header] = value
    return trace_headers

def tag_transaction(key: str, value: Any) -> None:
    try:
        span = sentry_sdk.get_current_span()
        if span:
            span.set_tag(key, value)
        else:
            with sentry_sdk.configure_scope() as scope:
                scope.set_tag(key, value)
    except Exception:
        pass

def capture_breadcrumb(category: str, message: str, level: str = "info", data: dict | None = None) -> None:
    try:
        sentry_sdk.add_breadcrumb(
            category=category,
            message=message,
            level=level,
            data=data or {},
        )
    except Exception:
        pass

def capture_custom_message(
    message: str,
    level: str = "info",
    extra: dict[str, Any] | None = None,
) -> str | None:
    allowed = {"fatal", "critical", "error", "warning", "info", "debug"}
    level = level if level in allowed else "info"
    try:
        if extra:
            with sentry_sdk.push_scope() as scope:
                for k, v in extra.items():
                    scope.set_extra(k, v)
                return sentry_sdk.capture_message(message, level=level)  # type: ignore[arg-type]
        return sentry_sdk.capture_message(message, level=level)  # type: ignore[arg-type]
    except Exception:
        return None

def capture_critical_issue_with_logs(log_text: str) -> str | None:
    with sentry_sdk.configure_scope() as scope:
        scope.add_attachment(
            bytes=log_text.encode(),
            filename="server_logs.txt",
            content_type="text/plain",
        )
    return capture_custom_message(
        "Critical server issue with logs attached", level="error"
    )
