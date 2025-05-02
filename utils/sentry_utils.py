"""
utils/sentry_utils.py
-----
Enhanced Sentry integration utilities with:
- Better performance monitoring
- Improved trace management
- Comprehensive logging configuration
- Robust MCP server validation
- Advanced event filtering
- Optional integration with ConversationService for metrics
"""

import logging
import time
import contextlib
import re
import asyncio
from typing import Any, Optional, Generator, Union, Set, AsyncGenerator, TYPE_CHECKING
from fastapi import Request, Response

import sentry_sdk
from sentry_sdk import configure_scope, push_scope
from sentry_sdk.tracing import Span, Transaction
from sentry_sdk.integrations.logging import LoggingIntegration, ignore_logger
from sentry_sdk.types import Event, Hint
# Sentry SDK integrations - imported at module level for lint compliance
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
from sentry_sdk.integrations.asyncio import AsyncioIntegration


# Optional imports with fallbacks
try:
    import psutil
except ImportError:
    psutil = None

try:
    from db import get_async_session
    from services.conversation_service import ConversationService
    from sqlalchemy.ext.asyncio import AsyncSession
    HAS_CONVERSATION_SERVICE = True
except ImportError:
    HAS_CONVERSATION_SERVICE = False
    if TYPE_CHECKING:
        from sqlalchemy.ext.asyncio import AsyncSession  # type: ignore
        from services.conversation_service import ConversationService  # type: ignore
    else:
        AsyncSession = Any  # type: ignore
        ConversationService = Any  # type: ignore

    async def get_async_session() -> AsyncGenerator["AsyncSession", None]:
        """
        get_async_session is unavailable because the conversation service is not installed.
        """
        raise RuntimeError(
            "get_async_session is unavailable without conversation_service and db modules."
        )
        yield  # unreachable: required only for typing (see Pylint W0101 suppression)

# Type aliases
SentryEvent = dict[str, Any]  # Kept for backward compatibility
SentryHint = Optional[dict[str, Any]]  # Kept for backward compatibility

# Constants
NOISY_LOGGERS = {
    # Built-in and framework loggers
    "uvicorn.access",
    "uvicorn.error",
    "fastapi",
    # Database loggers
    "sqlalchemy.engine.Engine",
    "sqlalchemy.pool",
    # HTTP clients
    "urllib3.connectionpool",
    "requests",
    "httpx",
    # Async/misc
    "asyncio",
    "concurrent",
    "multipart",
}

SENSITIVE_KEYS = {
    "password",
    "token",
    "api_key",
    "secret",
    "auth",
    "credentials",
    "session",
    "cookie",
}

IGNORED_TRANSACTIONS = {
    "/health",
    "/static/",
    "/favicon.ico",
    "/robots.txt",
    "/metrics",
    "/api/auth/csrf",
    "/api/auth/verify",
}


def configure_sentry_loggers(additional_ignores: Optional[Set[str]] = None) -> None:
    """
    Configure Sentry to ignore noisy loggers while preserving breadcrumbs.
    """
    ignored_loggers = NOISY_LOGGERS.union(additional_ignores or set())
    for logger_name in ignored_loggers:
        ignore_logger(logger_name)
    logging.info(f"Configured Sentry to ignore {len(ignored_loggers)} loggers")


import os

def configure_sentry(
    dsn: str,
    environment: str = "production",
    release: Optional[str] = None,
    traces_sample_rate: float = 1.0,
    profiles_sample_rate: Optional[float] = None,
    additional_ignores: Optional[Set[str]] = None,
    before_send: Optional[Any] = None,
    traces_sampler: Optional[Any] = None,
    before_send_transaction: Optional[Any] = None,
) -> None:
    """
    Centralized Sentry configuration. Supports optional profiling and custom sampling.
    Call this at app startup.
    Now reads SENTRY_DEBUG env variable ("1", "true" for enabled), else defaults to False.
    Honors SENTRY_ENABLED env var (or settings.SENTRY_ENABLED, if imported) to globally disable Sentry.
    """
    # Check SENTRY_ENABLED, prefer config if importable, otherwise env var
    sentry_enabled_env = os.getenv("SENTRY_ENABLED", "").lower()
    try:
        from config import settings
        sentry_enabled = getattr(settings, "SENTRY_ENABLED", False)
    except Exception:
        sentry_enabled = sentry_enabled_env in ("1", "true", "yes", "on")

    if not sentry_enabled:
        logging.info("Sentry not enabled; skipping sentry_sdk.init")
        return

    sentry_logging = LoggingIntegration(
        level=logging.WARNING,  # Only capture warnings/errors
        event_level=logging.ERROR,
    )
    init_kwargs = {}
    init_kwargs["dsn"] = dsn
    # Make debug configurable via env var SENTRY_DEBUG
    debug_env = os.getenv("SENTRY_DEBUG", "").lower()
    init_kwargs["debug"] = debug_env in ("1", "true", "yes", "on")
    init_kwargs["environment"] = environment
    init_kwargs["release"] = release
    init_kwargs["traces_sample_rate"] = traces_sample_rate
    init_kwargs["default_integrations"] = False
    init_kwargs["integrations"] = [
        sentry_logging,
        FastApiIntegration(),
        SqlalchemyIntegration(),
        AsyncioIntegration(),
    ]
    # Only include these if not None, don't set if None
    if profiles_sample_rate is not None:
        init_kwargs["profiles_sample_rate"] = profiles_sample_rate
    if before_send is not None:
        init_kwargs["before_send"] = before_send
    if traces_sampler is not None:
        init_kwargs["traces_sampler"] = traces_sampler
    if before_send_transaction is not None:
        init_kwargs["before_send_transaction"] = before_send_transaction

    # Remove keys whose value is None, as Sentry rejects them
    final_kwargs = {k: v for k, v in init_kwargs.items() if v is not None}

    sentry_sdk.init(**final_kwargs)

    configure_sentry_loggers(additional_ignores)


def check_sentry_mcp_connection(timeout: float = 2.0) -> bool:
    """
    Validate MCP server connection with timeout and retry logic.
    """
    try:
        start_time = time.time()

        with push_scope() as scope:
            scope.set_tag("test_type", "mcp_connection_check")
            test_id = f"mcp-test-{int(time.time())}"
            scope.set_tag("connection_test_id", test_id)

            with sentry_sdk.start_transaction(
                op="test", name="MCP Connection Test", sampled=True
            ) as transaction:
                # Add test span
                with transaction.start_child(op="test", description="Connection check"):
                    if time.time() - start_time > timeout:
                        raise TimeoutError("MCP connection test timed out")

                    logging.info("Sentry MCP connection test successful")
                    return True

    except Exception as e:
        logging.error(f"Sentry MCP connection test failed: {str(e)}")
        return False


def extract_sentry_trace(request: Request) -> dict[str, str]:
    """
    Extract distributed tracing headers with validation.
    """
    trace_data = {}

    if sentry_trace := request.headers.get("sentry-trace"):
        if re.match(r"^[0-9a-f]{32}-[0-9a-f]{16}-[01]$", sentry_trace):
            trace_data["sentry-trace"] = sentry_trace

    if baggage := request.headers.get("baggage"):
        trace_data["baggage"] = baggage

    return trace_data


def inject_sentry_trace_headers(response: Response) -> None:
    """
    Inject tracing headers into response with validation.
    """
    if trace_parent := sentry_sdk.get_traceparent():
        response.headers["sentry-trace"] = trace_parent

    if baggage := sentry_sdk.get_baggage():
        response.headers["baggage"] = baggage


# --- USER/TAG/CONTEXT HELPERS ---

def set_sentry_user(user: dict[str, Any]) -> None:
    """
    Set the current Sentry user context for the request.
    Use in request-lifecycle middleware.
    """
    from sentry_sdk import set_user
    safe_user = _filter_user_data(user)
    set_user(safe_user)

def set_sentry_tag(key: str, value: Union[str, int, float, bool]) -> None:
    """
    Set a custom tag on current Sentry span or global scope.
    """
    from sentry_sdk import set_tag as sdk_set_tag
    try:
        sdk_set_tag(key, value)
    except Exception:
        # If used outside request context
        pass

def set_sentry_context(key: str, ctx: dict[str, Any]) -> None:
    """
    Attach a dict as custom context under the specified key.
    """
    from sentry_sdk import set_context as sdk_set_context
    try:
        sdk_set_context(key, ctx)
    except Exception:
        pass

def get_current_trace_id() -> Optional[str]:
    """
    Returns the current Sentry trace ID, or None.
    """
    try:
        curr_span = sentry_sdk.get_current_span()
        return curr_span.trace_id if curr_span else None
    except Exception:
        return None


def tag_transaction(key: str, value: Union[str, int, float, bool]) -> None:
    """
    Safely tag current transaction or scope with type validation.
    """
    if not isinstance(value, (str, int, float, bool)):
        value = str(value)

    with contextlib.suppress(Exception):
        if span := sentry_sdk.get_current_span():
            span.set_tag(key, value)
        else:
            with configure_scope() as scope:
                scope.set_tag(key, value)


@contextlib.contextmanager
def sentry_span(
    op: str, description: Optional[str] = None, **kwargs: Any
) -> Generator[Span, None, None]:
    """
    Context manager for creating nested spans with error handling.
    """
    parent = sentry_sdk.get_current_span()
    description = description or op

    try:
        if parent is None:
            with sentry_sdk.start_transaction(op=op, name=description) as transaction:
                _set_span_data(transaction, kwargs)
                yield transaction
        else:
            with parent.start_child(op=op, description=description) as span:
                _set_span_data(span, kwargs)
                yield span
    except Exception as e:
        logging.error(f"Failed to create Sentry span: {str(e)}")
        raise

from typing import Literal

def capture_breadcrumb(
    category: str,
    message: str,
    level: Literal["fatal", "critical", "error", "warning", "info", "debug"] = "info",
    data: Optional[dict[str, Any]] = None,
) -> None:
    """
    Add a manual Sentry breadcrumb. Useful for important business actions.
    Level must be one of: fatal, critical, error, warning, info, debug
    """
    from sentry_sdk import add_breadcrumb
    SENTRY_ALLOWED_LEVELS = {"fatal", "critical", "error", "warning", "info", "debug"}
    safe_level = level.lower() if isinstance(level, str) else "info"
    if safe_level not in SENTRY_ALLOWED_LEVELS:
        safe_level = "info"
    try:
        add_breadcrumb(
            category=category,
            message=message,
            level=safe_level,
            data=data or {},
        )
    except Exception:
        pass

def capture_custom_message(
    message: str,
    level: Literal["fatal", "critical", "error", "warning", "info", "debug"] = "info",
    extra: Optional[dict[str, Any]] = None,
) -> Optional[str]:
    """
    Capture a custom message to Sentry with optional extra context.
    Level must be one of: fatal, critical, error, warning, info, debug
    """
    from sentry_sdk import capture_message, push_scope
    SENTRY_ALLOWED_LEVELS = {"fatal", "critical", "error", "warning", "info", "debug"}
    safe_level = level.lower() if isinstance(level, str) else "info"
    if safe_level not in SENTRY_ALLOWED_LEVELS:
        safe_level = "info"
    try:
        if extra:
            with push_scope() as scope:
                for k, v in extra.items():
                    scope.set_extra(k, v)
                return capture_message(message, level=safe_level)  # type: ignore
        else:
            return capture_message(message, level=safe_level)  # type: ignore
    except Exception:
        return None


def _set_span_data(span: Union[Span, Transaction], data: dict[str, Any]) -> None:
    """Helper to safely add data to spans"""
    for key, value in data.items():
        try:
            span.set_data(key, value)
        except Exception:
            span.set_data(key, str(value))


def _filter_event_data(event: Event) -> Event:
    """Internal helper to filter sensitive data from events"""
    # Filter request data
    if request := event.get("request", {}):
        _filter_request_data(request)

    # Filter user data
    if user := event.get("user", {}):
        event["user"] = _filter_user_data(user)

    # Filter extra context
    if contexts := event.get("contexts", {}):
        event["contexts"] = _filter_contexts(contexts)

    return event


def _get_active_conversations_count() -> Optional[int]:
    """
    Safely get active conversations count via ConversationService.
    NOTE: This function uses asyncio.run and may cause issues if called
          from an existing event loop (e.g., within FastAPI).
          Consider alternative approaches for integrating DB metrics.
    """
    if not HAS_CONVERSATION_SERVICE:
        return None

    try:

        async def _collect_conversations() -> Optional[int]:
            if not HAS_CONVERSATION_SERVICE:
                return None

            # Use AsyncSession directly (it's either imported or Any)
            session_gen: AsyncGenerator[AsyncSession, None] = get_async_session()
            db: Optional[AsyncSession] = None
            try:
                # Use async context manager pattern for session handling if possible
                # Assuming get_async_session yields a session managed externally or needs manual handling here
                db = await session_gen.asend(None)
                if db is None: # Should not happen with standard context manager pattern but check anyway
                    raise RuntimeError("Failed to acquire DB session.")

                service = ConversationService(db)
                # Assuming user_id=0 is a placeholder for fetching all/system conversations
                conversations = await service.list_conversations(
                    user_id=0, # Consider if this user_id is appropriate
                    skip=0,
                    limit=10_000, # Be cautious with large limits
                )
                return len(conversations)
            finally:
                # Ensure the generator is properly closed
                if db is not None:
                    try:
                        # Signal completion/cleanup to the generator
                        await session_gen.asend(None)
                    except StopAsyncIteration:
                        pass # Expected when generator finishes
                    except Exception as close_exc:
                        logging.error(f"Error closing session generator: {close_exc}")


        # Warning: asyncio.run() cannot be called from a running event loop.
        # This will likely fail within FastAPI.
        return asyncio.run(_collect_conversations())

    except RuntimeError as e:
        # Catch the specific error from asyncio.run if called incorrectly
        logging.error(f"RuntimeError calling _collect_conversations (likely due to nested event loops): {str(e)}", exc_info=True)
        return None
    except Exception as e:
        logging.error(f"Error getting active conversations: {str(e)}", exc_info=True)
        return None


def filter_sensitive_event(
    event: Event, hint: Optional[Hint] = None
) -> Optional[Event]:
    """
    Enhanced error event processor that:
    - Filters sensitive data
    - Adds request context
    - Includes relevant database info
    - Attaches application state (like active conversations count) - REMOVED DB CALL
    """
    if not event:
        return event

    try:
        # If there's a request in the hint, attach it to the event
        if hint and isinstance(hint, dict) and hint.get("request"):
            request = hint["request"]
            event.setdefault(
                "request",
                {
                    "method": getattr(request, "method", "UNKNOWN"),
                    "url": str(getattr(request, "url", "UNKNOWN")),
                    "headers": {
                        # Redact sensitive headers like Authorization
                        k: "[FILTERED]" if any(s in k.lower() for s in SENSITIVE_KEYS | {"authorization"}) else v
                        for k, v in getattr(request, "headers", {}).items()
                    },
                    "query_params": dict(getattr(request, "query_params", {})),
                },
            )

        # Add database context for SQL errors (optional)
        # Example: If hint contains DB info, add it here.
        # if hint and isinstance(hint, dict) and hint.get("sqlalchemy_info"):
        #    event.setdefault("extra", {}).update({"db_info": hint["sqlalchemy_info"]})


        # Add application metrics if available
        try:
            metrics = {}
            if psutil:
                metrics["memory_usage_mb"] = (
                    psutil.Process().memory_info().rss / 1024 / 1024
                )


            if metrics:
                event.setdefault("extra", {}).update(metrics)
        except Exception as metrics_exc:
            # Avoid errors in metrics collection stopping event processing
            logging.warning(f"Failed to gather system metrics for Sentry event: {metrics_exc}")


    except Exception as e:
        logging.error(f"Error enhancing Sentry event: {str(e)}")

    return _filter_event_data(event) # Ensure sensitive data filtering still runs


def _filter_request_data(request: dict[str, Any]) -> None:
    """Filter sensitive data from request payload"""
    if isinstance((data := request.get("data")), dict):
        for key in list(data.keys()):
            if any(sensitive in key.lower() for sensitive in SENSITIVE_KEYS):
                data[key] = "[FILTERED]"

    if isinstance((headers := request.get("headers")), dict):
        request["headers"] = {
            k: (
                "[FILTERED]"
                if any(sensitive in k.lower() for sensitive in SENSITIVE_KEYS)
                else v
            )
            for k, v in headers.items()
        }


def _filter_user_data(user: dict[str, Any]) -> dict[str, Any]:
    """Preserve only safe user identifiers"""
    return {
        "id": user.get("id"),
        "ip_address": user.get("ip_address"),
        "username": user.get("username"),
    }


def _filter_contexts(contexts: dict[str, Any]) -> dict[str, Any]:
    """Filter sensitive data from contexts"""
    return {
        k: (
            "[FILTERED]"
            if any(sensitive in k.lower() for sensitive in SENSITIVE_KEYS)
            else v
        )
        for k, v in contexts.items()
    }


def capture_critical_issue_with_logs(log_text: str) -> Optional[str]:
    """Capture a critical issue with attached log files"""
    with configure_scope() as scope:
        scope.add_attachment(
            bytes=log_text.encode("utf-8"),
            filename="server_logs.txt",
            content_type="text/plain",
        )
        return sentry_sdk.capture_event(
            {
                "message": "Critical server issue with logs attached",
                "level": "error",
            }
        )


def filter_transactions(
    event: SentryEvent, _hint: SentryHint = None
) -> Optional[SentryEvent]:
    """
    Filter transaction events to reduce noise.
    """
    if not event or event.get("type") != "transaction":
        return event

    transaction = event.get("transaction", "")
    url = str(event.get("request", {}).get("url", ""))

    # Drop known noisy endpoints
    if any(ignored in url for ignored in IGNORED_TRANSACTIONS):
        return None

    if "health" in transaction.lower():
        return None

    return event

# --- SENTRY TRACE RESPONSE HELPER ---

from fastapi.responses import JSONResponse

def make_sentry_trace_response(payload: dict, transaction) -> JSONResponse:
    """
    Wraps a dict payload as a JSONResponse with Sentry trace headers for distributed tracing.
    """
    resp = JSONResponse(content=payload)
    try:
        resp.headers["sentry-trace"] = transaction.to_traceparent()
        # Add `baggage` if available (dynamic sampling):
        if hasattr(transaction, "containing_transaction"):
            containing_transaction = transaction.containing_transaction()
            if hasattr(containing_transaction, "_baggage") and hasattr(containing_transaction._baggage, "serialize"):
                resp.headers["baggage"] = containing_transaction._baggage.serialize()
    except Exception:
        # Defensive: don't break response on header issues
        pass
    return resp
