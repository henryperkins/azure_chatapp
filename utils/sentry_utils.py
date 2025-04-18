"""
utils/sentry_utils.py
-----
Enhanced Sentry integration utilities with:
- Better performance monitoring
- Improved trace management
- Comprehensive logging configuration
- Robust MCP server validation
- Advanced event filtering
"""

import logging
import time
import contextlib
import re
from typing import Dict, Any, Optional, Generator, Union, List, Set
from fastapi import Request, Response
from sentry_sdk import configure_scope, push_scope
from sentry_sdk.tracing import Span, Transaction
import sentry_sdk

# Type aliases
SentryEvent = Dict[str, Any]
SentryHint = Optional[Dict[str, Any]]

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
}


def configure_sentry_loggers(additional_ignores: Optional[Set[str]] = None) -> None:
    """
    Configure Sentry to ignore noisy loggers while preserving breadcrumbs.

    Args:
        additional_ignores: Additional logger names to ignore
    """
    ignored_loggers = NOISY_LOGGERS.union(additional_ignores or set())

    for logger_name in ignored_loggers:
        sentry_sdk.integrations.logging.ignore_logger(logger_name)

    logging.info(f"Configured Sentry to ignore {len(ignored_loggers)} loggers")


def check_sentry_mcp_connection(timeout: float = 2.0) -> bool:
    """
    Validate MCP server connection with timeout and retry logic.

    Args:
        timeout: Maximum time to wait for connection test

    Returns:
        bool: True if connection is successful
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


def extract_sentry_trace(request: Request) -> Dict[str, str]:
    """
    Extract distributed tracing headers with validation.

    Args:
        request: Incoming FastAPI request

    Returns:
        Dict containing validated trace headers
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

    Args:
        response: Outgoing FastAPI response
    """
    if trace_parent := sentry_sdk.get_traceparent():
        response.headers["sentry-trace"] = trace_parent

    if baggage := sentry_sdk.get_baggage():
        response.headers["baggage"] = baggage


def tag_transaction(key: str, value: Union[str, int, float, bool]) -> None:
    """
    Safely tag current transaction or scope with type validation.

    Args:
        key: Tag name
        value: Tag value (must be serializable)
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

    Args:
        op: Operation type
        description: Span description
        **kwargs: Additional span data

    Yields:
        Active span object
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


def _set_span_data(span: Union[Span, Transaction], data: Dict[str, Any]) -> None:
    """Helper to safely add data to spans"""
    for key, value in data.items():
        try:
            span.set_data(key, value)
        except Exception:
            span.set_data(key, str(value))


def filter_sensitive_event(event: SentryEvent, hint: SentryHint = None) -> SentryEvent:
    """
    Comprehensive sensitive data filtering for Sentry events.

    Args:
        event: Raw Sentry event
        hint: Additional event metadata

    Returns:
        Filtered Sentry event
    """
    if not event:
        return event

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


def _filter_request_data(request: Dict[str, Any]) -> None:
    """Filter sensitive data from request payload"""
    if isinstance(data := request.get("data"), dict):
        for key in list(data.keys()):
            if any(sensitive in key.lower() for sensitive in SENSITIVE_KEYS):
                data[key] = "[FILTERED]"

    if isinstance(headers := request.get("headers"), dict):
        request["headers"] = {
            k: (
                "[FILTERED]"
                if any(sensitive in k.lower() for sensitive in SENSITIVE_KEYS)
                else v
            )
            for k, v in headers.items()
        }


def _filter_user_data(user: Dict[str, Any]) -> Dict[str, Any]:
    """Preserve only safe user identifiers"""
    return {
        "id": user.get("id"),
        "ip_address": user.get("ip_address"),
        "username": user.get("username"),  # Username is often safe
    }


def _filter_contexts(contexts: Dict[str, Any]) -> Dict[str, Any]:
    """Filter sensitive data from contexts"""
    return {
        k: (
            "[FILTERED]"
            if any(sensitive in k.lower() for sensitive in SENSITIVE_KEYS)
            else v
        )
        for k, v in contexts.items()
    }


def capture_critical_issue_with_logs(log_text: str):
    """Capture a critical issue with attached log files"""
    with configure_scope() as scope:
        scope.add_attachment(
            bytes=log_text.encode("utf-8"),
            filename="server_logs.txt",
            content_type="text/plain"
        )
        return sentry_sdk.capture_event({
            "message": "Critical server issue with logs attached",
            "level": "error",
        })

def filter_transactions(
    event: SentryEvent, hint: SentryHint = None
) -> Optional[SentryEvent]:
    """
    Filter transaction events to reduce noise.

    Args:
        event: Transaction event
        hint: Additional metadata

    Returns:
        Filtered event or None to drop
    """
    if not event or event.get("type") != "transaction":
        return event

    transaction = event.get("transaction", "")
    url = str(event.get("request", {}).get("url", ""))

    if any(ignored in url for ignored in IGNORED_TRANSACTIONS):
        return None

    if "health" in transaction.lower():
        return None

    return event
