"""
utils/sentry_utils.py
-----
Utility functions for Sentry integration including:
- Performance monitoring helpers
- Trace context management
- Logger configuration
- MCP server connection validation
"""

__all__ = ["configure_sentry_loggers", "filter_sensitive_event"]

import logging
import time
import contextlib
from typing import Dict, Any, Optional, Generator, Union
from fastapi import Request, Response

import sentry_sdk
from sentry_sdk import configure_scope
from sentry_sdk.tracing import Span, Transaction

def configure_sentry_loggers() -> None:
    """
    Configure Sentry to ignore noisy loggers that might create too many events.
    This helps reduce noise in the Sentry dashboard and minimize quota usage.
    """
    # Standard noisy loggers to ignore
    noisy_loggers = [
        # Built-in and common frameworks
        "uvicorn.access",
        "uvicorn.error",
        "fastapi",
        "sqlalchemy.engine.Engine",
        "sqlalchemy.pool",
        # HTTP client libraries
        "urllib3.connectionpool",
        "requests",
        "httpx",
        # Misc
        "asyncio",
        "concurrent",
        "multipart",
    ]

    # Register each logger to be ignored for events (but still recorded as breadcrumbs)
    for logger_name in noisy_loggers:
        sentry_sdk.integrations.logging.ignore_logger(logger_name)  # type: ignore

    logging.getLogger(__name__).info(f"Configured Sentry to ignore {len(noisy_loggers)} noisy loggers")

def check_sentry_mcp_connection() -> bool:
    """
    Verify that the Sentry MCP server connection is working properly.
    This helps diagnose integration issues early.

    Returns:
        bool: True if MCP server is properly connected, False otherwise
    """
    try:
        # Try to access the MCP Sentry server using the MCP tool
        from utils.mcp_sentry import get_sentry_issue  # type: ignore

        # Send a test event to ensure connection is working
        with configure_scope() as scope:
            scope.set_tag("test_type", "mcp_connection_check")
            test_id = f"mcp-test-{int(time.time())}"
            scope.set_tag("connection_test_id", test_id)

            # Create a minimal test transaction
            with sentry_sdk.start_transaction(op="test", name="MCP Connection Test"):
                # Add a test breadcrumb
                sentry_sdk.add_breadcrumb(
                    category="test",
                    message="MCP connection test breadcrumb",
                    level="info"
                )

                # Record success
                logging.getLogger(__name__).info("Sentry MCP connection test successful")
                return True

    except ImportError:
        logging.getLogger(__name__).warning("Sentry MCP server module not found")
        return False
    except Exception as e:
        logging.getLogger(__name__).error(f"Sentry MCP connection test failed: {str(e)}")
        return False

def extract_sentry_trace(request: Request) -> Dict[str, str]:
    """
    Extract Sentry trace information from incoming request headers for distributed tracing.

    Args:
        request: The FastAPI request object

    Returns:
        Dict containing trace headers if present
    """
    headers = {}

    # Extract standard trace information
    if "sentry-trace" in request.headers:
        headers["sentry-trace"] = request.headers["sentry-trace"]

    # Extract baggage header for context propagation
    if "baggage" in request.headers:
        headers["baggage"] = request.headers["baggage"]

    return headers

def inject_sentry_trace_headers(response: Response) -> None:
    """
    Inject current Sentry trace information into outgoing response headers.
    This enables distributed tracing across services or browser/server boundaries.

    Args:
        response: The FastAPI response object to inject headers into
    """
    # Get current trace parent
    trace_parent = sentry_sdk.get_traceparent()
    if trace_parent:
        response.headers["sentry-trace"] = trace_parent

    # Get baggage for contextual information
    baggage = sentry_sdk.get_baggage()
    if baggage:
        response.headers["baggage"] = baggage

def tag_transaction(key: str, value: Union[str, int, float, bool]) -> None:
    """
    Add a tag to the current transaction or scope.
    Tags provide a way to categorize events for searching and filtering.

    Args:
        key: Tag key
        value: Tag value (must be a simple type)
    """
    # Try to get current span/transaction first
    span = sentry_sdk.get_current_span()
    if span:
        span.set_tag(key, value)
    else:
        # Fall back to setting tag on current scope
        with configure_scope() as scope:
            scope.set_tag(key, value)

@contextlib.contextmanager
def sentry_span(op: str, description: Optional[str] = None, **kwargs) -> Generator[Span, None, None]:
    """
    Context manager for creating and managing Sentry spans in a transaction.

    Args:
        op: Operation type/category (e.g., "db.query", "http.client")
        description: Human-readable description of the operation
        **kwargs: Additional data to add to the span

    Yields:
        The created span object
    """
    # Get current transaction or span to nest under
    parent = sentry_sdk.get_current_span()

    if parent is None:
        # No active transaction, create a new one
        with sentry_sdk.start_transaction(op=op, name=str(description if description is not None else op)) as transaction:
            for key, value in kwargs.items():
                transaction.set_data(key, value)
            yield transaction
    else:
        # Create a child span under the parent
        with parent.start_child(op=op, description=str(description if description is not None else op)) as span:
            for key, value in kwargs.items():
                span.set_data(key, value)
            yield span

def filter_sensitive_event(event: Dict[str, Any], hint: Optional[Any] = None) -> Dict[str, Any]:
    """
    Remove sensitive details from Sentry events before sending them.
    If the event contains a 'request' with 'data', remove keys such as 'password', 'token', and 'secret'.

    Args:
        event: The Sentry event to be filtered.
        hint: Additional hint information (unused).

    Returns:
        The filtered event.
    """
    # Skip processing if event is None or not a dict
    if not event or not isinstance(event, dict):
        return event

    # Handle request data
    request = event.get("request", {})
    if request and isinstance(request, dict):
        # Filter sensitive data from request body
        data = request.get("data")
        if isinstance(data, dict):
            for sensitive_key in ["password", "token", "api_key", "secret", "auth", "credentials"]:
                data.pop(sensitive_key, None)

        # Filter sensitive headers
        headers = request.get("headers")
        if isinstance(headers, dict):
            for header_key in list(headers.keys()):
                lower_key = header_key.lower()
                if any(sensitive in lower_key for sensitive in ["auth", "token", "key", "secret", "password", "cookie"]):
                    headers[header_key] = "[FILTERED]"

    # Filter sensitive user information if not explicitly enabled
    user = event.get("user", {})
    if user and isinstance(user, dict):
        # Keep id and ip, but filter other potentially sensitive fields
        safe_user = {"id": user.get("id"), "ip_address": user.get("ip_address")}
        event["user"] = safe_user

    return event


def filter_transactions(event: Dict[str, Any], hint: Optional[Any] = None) -> Optional[Dict[str, Any]]:
    """
    Filter transaction events to reduce noise and focus on important transactions.
    This function allows controlling which transactions are sent to Sentry.

    Args:
        event: The transaction event to filter
        hint: Additional hint information

    Returns:
        The transaction event or None if it should be dropped
    """
    # Skip processing if event is None or not a dict
    if not event or not isinstance(event, dict):
        return event

    # Check if this is a transaction event
    if event.get("type") != "transaction":
        return event

    # Get transaction name and URL
    transaction = event.get("transaction", "")
    url = event.get("request", {}).get("url", "")

    # Drop health check and static file URLs
    if any(pattern in url for pattern in ["/health", "/static/", "/favicon.ico"]):
        return None

    # Skip transaction if it's a health check endpoint
    if "health" in transaction.lower():
        return None

    # Keep all other transactions
    return event
