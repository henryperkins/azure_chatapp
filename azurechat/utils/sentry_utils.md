```python
"""
utils/sentry_utils.py
─────────────────────────────────────────────────────────────────────────
Unified Sentry utilities for the entire code-base.

Goals
=====
1. **Single source of truth** for Sentry configuration / helpers.
2. **Structured JSON logging** enabled before Sentry bootstraps.
3. **Context propagation** – expose `request_id_var` & `trace_id_var`
   (imported from utils.logging_config) and copy them to background tasks.
4. **Zero blocking calls** – never call `asyncio.run()` from inside an
   event loop; all helpers are either sync-only or `async` friendly.
5. **Privacy first** – aggressive redaction of credentials & PII.
6. **Low-cardinality** – avoid per-user / per-record tag explosions.

Usage
=====
• Call `configure_sentry()` once at application start-up **after**
  `init_structured_logging()` (from utils.logging_config).
• Import helper functions (`sentry_span`, `set_sentry_tag`, …) anywhere.

This file purposefully contains **no** top-level Sentry initialisation
side-effects; everything happens inside `configure_sentry()`.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from contextvars import copy_context
from typing import (
    Any,
    AsyncGenerator,
    Callable,
    Generator,
    Literal,
    Optional,
    Set,
    Union,
)

from fastapi import Response
from fastapi.responses import JSONResponse
from fastapi import Request as FastAPIRequest
import sentry_sdk
from sentry_sdk.integrations.asyncio import AsyncioIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.logging import LoggingIntegration, ignore_logger
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
from sentry_sdk.tracing import Span, Transaction
from sentry_sdk.types import Event, Hint

# ------------------------------------------------------------------------- #
# Structured logging context-vars (imported – do NOT create a second copy). #
# ------------------------------------------------------------------------- #

# ------------------------------------------------------------------------- #
# Constants                                                                 #
# ------------------------------------------------------------------------- #
NOISY_LOGGERS: Set[str] = {
    # Framework / servers
    "uvicorn.access",
    "uvicorn.error",
    "fastapi",
    "asyncio",
    # SQL
    "sqlalchemy.engine.Engine",
    "sqlalchemy.pool",
    # HTTP clients
    "urllib3.connectionpool",
    "requests",
    "httpx",
}
SENSITIVE_KEYS: Set[str] = {
    "password",
    "token",
    "secret",
    "api_key",
    "apikey",
    "authorization",
    "cookie",
    "session",
}
IGNORED_TRANSACTIONS: Set[str] = {
    "/health",
    "/metrics",
    "/favicon.ico",
    "/robots.txt",
    "/static/",
    "/api/auth/csrf",
    "/api/auth/verify",
}

# ------------------------------------------------------------------------- #
# Helper – filter sensitive data                                            #
# ------------------------------------------------------------------------- #


def _filter_request_data(request_data: dict[str, Any]) -> None:
    """In-place redaction of headers / body keys marked sensitive."""
    if isinstance((payload := request_data.get("data")), dict):
        for k in list(payload):
            if any(s in k.lower() for s in SENSITIVE_KEYS):
                payload[k] = "[FILTERED]"

    if isinstance((headers := request_data.get("headers")), dict):
        request_data["headers"] = {
            k: ("[FILTERED]" if any(s in k.lower() for s in SENSITIVE_KEYS) else v)
            for k, v in headers.items()
        }


def _filter_user_data(user: dict[str, Any]) -> dict[str, Any]:
    """Return only safe identifiers."""
    return {
        "id": user.get("id"),
        "username": user.get("username"),
        "ip_address": user.get("ip_address"),
    }


def _filter_contexts(contexts: dict[str, Any]) -> dict[str, Any]:
    """Redact sensitive keys in contexts."""
    return {
        k: ("[FILTERED]" if any(s in k.lower() for s in SENSITIVE_KEYS) else v)
        for k, v in contexts.items()
    }


def _filter_event(event: Event) -> Event:
    """Apply all redaction helpers (mutates in-place)."""
    if "request" in event:
        _filter_request_data(event["request"])  # type: ignore[arg-type]
    if "user" in event:
        event["user"] = _filter_user_data(event["user"])  # type: ignore[arg-type]
    if "contexts" in event:
        event["contexts"] = _filter_contexts(event["contexts"])  # type: ignore[arg-type]
    return event


# ------------------------------------------------------------------------- #
# Sentry before_send hooks                                                  #
# ------------------------------------------------------------------------- #
def filter_sensitive_event(event: Event, hint: Optional[Hint] = None) -> Optional[Event]:
    """
    Main `before_send` hook.
    • Scrubs sensitive fields.
    • Enriches with lightweight system metrics.
    • Rejects noisy transactions.
    """
    # Drop high-volume, low-value transactions early
    if event.get("type") == "transaction":
        url = str(event.get("request", {}).get("url", ""))
        if any(p in url for p in IGNORED_TRANSACTIONS):
            return None
    try:
        # System memory metric (cheap)
        import psutil  # optional dependency

        mem_mb = psutil.Process().memory_info().rss / 1024 / 1024  # type: ignore[attr-defined]
        event.setdefault("extra", {}).update({"memory_usage_mb": round(mem_mb, 1)})
    except Exception:  # pragma: no cover
        pass  # never fail the event

    return _filter_event(event)


# ------------------------------------------------------------------------- #
# Public bootstrap                                                          #
# ------------------------------------------------------------------------- #
def configure_sentry(
    *,
    dsn: str,
    environment: str = "production",
    release: str | None = None,
    traces_sample_rate: float = 0.2,
    profiles_sample_rate: float | None = None,
    enable_sqlalchemy: bool | None = None,
) -> None:
    """
    Initialise structured logging **and** Sentry – call ONCE at start-up.

    Env flags respected
    -------------------
    • SENTRY_ENABLED (default: False)
    • SENTRY_DEBUG   (default: False)
    """
    # 1️⃣  Structured JSON logging – idempotent.
    pass  # Removed init_structured_logging() call; logging config not needed here

    if str(os.getenv("SENTRY_ENABLED", "")).lower() not in {"1", "true", "yes"}:
        logging.info("Sentry disabled via env flag; skipping initialisation.")
        return

    sentry_logging = LoggingIntegration(
        level=logging.WARNING,  # breadcrumb level
        event_level=logging.ERROR,
    )

    integrations = [
        sentry_logging,
        FastApiIntegration(transaction_style="endpoint"),
        AsyncioIntegration(),
    ]

    # Optional SQLAlchemy instrumentation (off by default for async engines)
    sql_flag = (
        enable_sqlalchemy
        if enable_sqlalchemy is not None
        else str(os.getenv("SENTRY_SQLA_ASYNC_ENABLED", "false")).lower() in {"1", "true"}
    )
    if sql_flag:
        integrations.append(SqlalchemyIntegration())
        logging.info("Sentry SqlAlchemy integration enabled.")
    else:
        logging.info("Sentry SqlAlchemy integration disabled.")

    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=release,
        traces_sample_rate=traces_sample_rate,
        profiles_sample_rate=profiles_sample_rate,
        integrations=integrations,
        default_integrations=False,  # we only load what we want
        before_send=filter_sensitive_event,
        debug=str(os.getenv("SENTRY_DEBUG", "")).lower() in {"1", "true", "yes"},
        send_default_pii=False,
    )

    _ignore_noisy_loggers()
    logging.info("Sentry initialised (%s)", environment)


def _ignore_noisy_loggers() -> None:
    for logger_name in NOISY_LOGGERS:
        ignore_logger(logger_name)


# ------------------------------------------------------------------------- #
# Convenience helpers                                                       #
# ------------------------------------------------------------------------- #
def set_sentry_user(user: dict[str, Any]) -> None:
    """Shortcut with redaction."""
    from sentry_sdk import set_user

    set_user(_filter_user_data(user))


def set_sentry_tag(key: str, value: Union[str, int, float, bool]) -> None:
    """Low-cardinality tag helper (falls back to scope)."""
    value = str(value)[:64]  # truncate to reduce cardinality
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
    except Exception:  # pragma: no cover
        return None


# ------------------------------------------------------------------------- #
# Span helpers (sync + async)                                               #
# ------------------------------------------------------------------------- #
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
            with sentry_sdk.start_transaction(op=op, name=desc) as tx:  # root span
                _set_span_data(tx, data)
                yield tx
        else:  # child span
            with parent.start_child(op=op, description=desc) as sp:
                _set_span_data(sp, data)
                yield sp
    except Exception:  # pragma: no cover
        logging.exception("Failed to create Sentry span")
        raise


def _set_span_data(span: Span | Transaction, data: dict[str, Any]) -> None:
    """Attach data, but stringify non-serialisable values safely."""
    for k, v in data.items():
        try:
            span.set_data(k, v)
        except Exception:
            span.set_data(k, str(v))


# ------------------------------------------------------------------------- #
# Response helpers                                                          #
# ------------------------------------------------------------------------- #
def inject_sentry_trace_headers(response: Response) -> None:
    """Copy current trace headers to the outgoing Response safely."""
    with contextlib.suppress(Exception):
        if tp := sentry_sdk.get_traceparent():
            response.headers["sentry-trace"] = tp
        if baggage := sentry_sdk.get_baggage():
            response.headers["baggage"] = baggage


def make_sentry_trace_response(
    payload: dict[str, Any],
    transaction: Span | Transaction,
    status_code: int = 200,
) -> JSONResponse:
    """Convenience for REST endpoints that return raw dicts."""
    resp = JSONResponse(content=payload, status_code=status_code)
    try:
        resp.headers["sentry-trace"] = transaction.to_traceparent()
        if hasattr(transaction, "containing_transaction"):
            # py-right: ignore[reportAttributeAccessIssue]
            parent = transaction.containing_transaction()
            if getattr(parent, "_baggage", None):
                resp.headers["baggage"] = parent._baggage.serialize()
    except Exception:  # pragma: no cover
        pass
    return resp


# ------------------------------------------------------------------------- #
# Context-aware background tasks helper                                     #
# ------------------------------------------------------------------------- #
def create_background_task(
    coro_func: Callable[..., "asyncio.Future[Any]"] | Callable[..., "AsyncGenerator[Any, None]"],
    *args: Any,
    **kwargs: Any,
) -> asyncio.Task[Any]:
    """
    Spawn an asyncio Task **carrying over** current ContextVars so that
    `request_id_var` / `trace_id_var` remain visible inside the task.

    Example
    -------
    task = create_background_task(my_async_worker, user_id=123)
    """
    ctx = copy_context()
    loop = asyncio.get_running_loop()
    return loop.create_task(ctx.run(coro_func, *args, **kwargs))


# ------------------------------------------------------------------------- #
# Sentry middleware helpers (extract_sentry_trace, tag_transaction, capture_breadcrumb)
# ------------------------------------------------------------------------- #

def extract_sentry_trace(request: 'FastAPIRequest') -> dict[str, str]:
    """
    Extracts Sentry tracing headers from a FastAPI request for distributed tracing.
    Returns a dictionary of relevant headers for Sentry's continue_trace.
    """
    trace_headers = {}
    for header in ("sentry-trace", "baggage"):
        value = request.headers.get(header)
        if value:
            trace_headers[header] = value
    return trace_headers

def tag_transaction(key: str, value: Any) -> None:
    """
    Tag the current Sentry transaction/span. Used to annotate traces with contextual data.
    """
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
    """
    Record a custom Sentry breadcrumb with optional extra data.
    """
    try:
        sentry_sdk.add_breadcrumb(
            category=category,
            message=message,
            level=level,
            data=data or {},
        )
    except Exception:
        pass

# ------------------------------------------------------------------------- #
# Misc utilities                                                             #
# ------------------------------------------------------------------------- #
def capture_custom_message(
    message: str,
    level: Literal["fatal", "critical", "error", "warning", "info", "debug"] = "info",
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
    except Exception:  # pragma: no cover
        return None


def capture_critical_issue_with_logs(log_text: str) -> str | None:
    """Attach log snippet to a high-severity event."""
    with sentry_sdk.configure_scope() as scope:
        scope.add_attachment(
            bytes=log_text.encode(),
            filename="server_logs.txt",
            content_type="text/plain",
        )
    return capture_custom_message(
        "Critical server issue with logs attached", level="error"
    )

```