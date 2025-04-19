"""
utils/middlewares.py
-----
FastAPI middleware components for application-wide concerns.
Includes enhanced Sentry request tracing middleware with distributed tracing,
performance monitoring, and detailed request capture.
"""

import logging
import time
import os
from urllib.parse import urlparse
from typing import Dict, Any, Optional

import sentry_sdk
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from utils.sentry_utils import (
    inject_sentry_trace_headers,
    extract_sentry_trace
)

logger = logging.getLogger(__name__)

# Customize which headers should be captured in Sentry events
INCLUDE_HEADERS = {
    'content-type',
    'content-length',
    'accept',
    'accept-encoding',
    'user-agent',
    'x-forwarded-for',
    'x-real-ip',
    'host',
    'referer',
    'origin',
    # Additional custom headers your app might use
    'x-request-id',
    'x-correlation-id',
    'x-api-version',
}

# Headers that may contain sensitive information and should be sanitized
SENSITIVE_HEADERS = {
    'cookie',
    'authorization',
    'x-api-key',
    'x-auth-token',
}

# Paths that should be normalized to avoid cardinality issues
NORMALIZE_PATHS = [
    # Examples of path patterns that should be normalized
    '/api/users/',      # /api/users/123 -> /api/users/:id
    '/api/projects/',   # /api/projects/abc -> /api/projects/:id
    '/api/items/',      # /api/items/456 -> /api/items/:id
]

class SentryTracingMiddleware(BaseHTTPMiddleware):
    """
    Enhanced middleware that:
    1. Creates a transaction for each request with detailed context
    2. Supports distributed tracing across services
    3. Collects performance metrics and request data
    4. Adds browser and environment context when available
    5. Manages trace propagation in responses
    6. Sets transaction status based on response

    This provides comprehensive monitoring in Sentry with appropriate context.
    """

    def __init__(self, app, **options):
        super().__init__(app)
        self.environment = os.environ.get("ENVIRONMENT", "development")
        self.include_request_body = options.get("include_request_body", False)
        self.include_response_body = options.get("include_response_body", False)
        self.max_request_body_size = options.get("max_request_body_size", 1024)
        self.max_response_body_size = options.get("max_response_body_size", 1024)
        self.spans_sample_rate = options.get("spans_sample_rate", 1.0)
        self.record_breadcrumbs = options.get("record_breadcrumbs", True)

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        # Start time for performance tracking
        start_time = time.time()
        request_received_time = time.time()

        # Extract trace info from incoming request (for distributed tracing)
        trace_headers = extract_sentry_trace(request)

        # Get transaction name (normalize paths where appropriate)
        transaction_name = self._get_transaction_name(request)

        # Either continue an existing trace or start a new transaction
        transaction = None

        # Check if we have incoming trace context
        if "sentry-trace" in trace_headers:
            # Continue the trace rather than starting a new one
            transaction = sentry_sdk.continue_trace(
                trace_headers,
                op="http.server",
                name=transaction_name
            )

            # Start the transaction with the continued trace
            with sentry_sdk.start_transaction(transaction):
                response = await self._process_request(
                    request,
                    call_next,
                    transaction,
                    start_time,
                    request_received_time
                )
                return response
        else:
            # No incoming trace, start a new transaction
            with sentry_sdk.start_transaction(
                op="http.server",
                name=transaction_name
            ) as transaction:
                response = await self._process_request(
                    request,
                    call_next,
                    transaction,
                    start_time,
                    request_received_time
                )
                return response

    async def _process_request(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
        transaction: Any,
        start_time: float,
        request_received_time: float
    ) -> Response:
        """Process the request with the current transaction"""

        # Add request data to transaction
        self._add_request_data(request, transaction)

        # Add user info if available
        self._add_user_data(request, transaction)

        # Record request as breadcrumb
        if self.record_breadcrumbs:
            self._add_request_breadcrumb(request)

        # Process request queue time if X-Request-Start header is available
        self._process_queue_time(request, transaction, request_received_time)

        # Process the request
        try:
            # Track time before we hand off to route handler
            route_start_time = time.time()

            # Call the next middleware/route handler
            response = await call_next(request)

            # Calculate processing time
            route_duration_ms = (time.time() - route_start_time) * 1000
            transaction.set_data("route_processing_ms", route_duration_ms)

            # Record response data
            transaction.set_tag("http.status_code", response.status_code)
            transaction.set_data("http.response_content_type", response.headers.get("content-type", ""))

            if self.include_response_body and "application/json" in response.headers.get("content-type", "").lower():
                # This requires some extra work to get the response body
                # We may need to actually read the body and reset it for the client
                pass

            # Set transaction status based on response code
            if response.status_code < 400:
                transaction.set_status("ok")
            elif response.status_code < 500:
                transaction.set_status("invalid_argument")  # 4xx client errors
            else:
                transaction.set_status("internal_error")    # 5xx server errors

            # Add performance timing
            elapsed_ms = (time.time() - start_time) * 1000
            transaction.set_data("response_time_ms", elapsed_ms)

            # Add trace headers to the response for distributed tracing
            inject_sentry_trace_headers(response)

            return response

        except Exception as e:
            # Capture the exception with the transaction
            transaction.set_status("internal_error")

            # Add exception info to transaction
            transaction.set_data("exception_type", type(e).__name__)
            transaction.set_data("exception_value", str(e))

            # Capture the exception
            with sentry_sdk.push_scope() as scope:
                # Add additional context for this exception
                scope.set_tag("handled", "false")
                scope.set_context("request", self._get_request_context(request))
                sentry_sdk.capture_exception(e)

            # Re-raise the exception for FastAPI to handle
            raise

    def _get_transaction_name(self, request: Request) -> str:
        """Get a normalized transaction name from the request path"""
        method = request.method
        path = request.url.path

        # Normalize paths to reduce cardinality in Sentry
        for pattern in NORMALIZE_PATHS:
            if path.startswith(pattern) and len(path) > len(pattern):
                # Extract just the ID portion of the path
                id_part = path[len(pattern):]
                # If the ID has additional path segments, keep them
                if '/' in id_part:
                    id_part = id_part.split('/', 1)[1]
                    normalized_path = f"{pattern}:id/{id_part}"
                else:
                    normalized_path = f"{pattern}:id"
                return f"{method} {normalized_path}"

        return f"{method} {path}"

    def _add_request_data(self, request: Request, transaction: Any) -> None:
        """Add detailed request data to the transaction"""
        # Basic URL and method info
        transaction.set_tag("http.method", request.method)
        transaction.set_tag("http.url", str(request.url))

        # Parse URL components for additional context
        parsed_url = urlparse(str(request.url))
        if parsed_url.hostname:
            transaction.set_data("server.address", parsed_url.hostname)
        if parsed_url.port:
            transaction.set_data("server.port", parsed_url.port)
        if parsed_url.path:
            transaction.set_data("http.target", parsed_url.path)
        if parsed_url.query:
            transaction.set_data("http.query", parsed_url.query)

        # Add request headers (filtered for sensitive information)
        headers = {}
        for name, value in request.headers.items():
            name_lower = name.lower()
            if name_lower in INCLUDE_HEADERS:
                headers[name] = value
            elif name_lower in SENSITIVE_HEADERS:
                headers[name] = "[FILTERED]"

        transaction.set_data("http.request_headers", headers)

        # Set environment tag
        transaction.set_tag("environment", self.environment)

        # Set client info from user agent if available
        user_agent = request.headers.get("user-agent", "")
        if user_agent:
            transaction.set_tag("http.user_agent", user_agent)

    def _add_user_data(self, request: Request, transaction: Any) -> None:
        """Add user data to the transaction if available"""
        user_data = {}

        # Try to get user from request state (if auth middleware set it)
        if hasattr(request.state, "user") and request.state.user:
            user = request.state.user
            user_id = getattr(user, "id", None)
            if user_id:
                user_data["id"] = str(user_id)

            # Add other user fields if available
            for field in ["email", "username", "name"]:
                value = getattr(user, field, None)
                if value:
                    user_data[field] = str(value)

        # Get IP address from request
        ip = self._get_client_ip(request)
        if ip:
            user_data["ip_address"] = ip

        # Set user context if we have any data
        if user_data:
            sentry_sdk.set_user(user_data)
            transaction.set_user(user_data)

    def _get_client_ip(self, request: Request) -> Optional[str]:
        """Extract client IP from request headers or connection info"""
        # Try X-Forwarded-For first (if behind a proxy/load balancer)
        forwarded_for = request.headers.get("x-forwarded-for")
        if forwarded_for:
            # Get the first IP in the chain (client IP)
            return forwarded_for.split(",")[0].strip()

        # Try X-Real-IP next (common Nginx header)
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip

        # Fall back to the client's direct connection IP
        client = request.scope.get("client")
        if client and len(client) >= 2:
            return client[0]

        return None

    def _add_request_breadcrumb(self, request: Request) -> None:
        """Add a breadcrumb for the incoming request"""
        sentry_sdk.add_breadcrumb(
            category="request",
            message=f"{request.method} {request.url.path}",
            level="info",
            data={
                "url": str(request.url),
                "method": request.method,
                "client_ip": self._get_client_ip(request),
            }
        )

    def _process_queue_time(
        self,
        request: Request,
        transaction: Any,
        request_received_time: float
    ) -> None:
        """Calculate request queue time if X-Request-Start header is present"""
        request_start = request.headers.get("x-request-start")
        if request_start and request_start.isdigit():
            # X-Request-Start typically contains timestamp in milliseconds
            try:
                start_time_ms = float(request_start) / 1000.0  # Convert to seconds
                queue_time_ms = (request_received_time - start_time_ms) * 1000

                # Only record if the value makes sense (positive and not ridiculously large)
                if 0 <= queue_time_ms <= 60000:  # Between 0 and 60 seconds
                    transaction.set_data("queue_time_ms", queue_time_ms)

                    # Create a specific span for the queue time
                    with sentry_sdk.start_span(
                        op="queue",
                        description="Request queue time"
                    ) as span:
                        span.set_data("queue_time_ms", queue_time_ms)
            except (ValueError, TypeError):
                # If we can't parse the header, just continue
                pass

    def _get_request_context(self, request: Request) -> Dict[str, Any]:
        """Get comprehensive request context for debugging"""
        # Create a safe copy of headers
        headers_dict = {}
        if request.headers:
            try:
                headers_dict = dict(request.headers.items())
                # Filter sensitive headers
                for header in SENSITIVE_HEADERS:
                    if header in headers_dict:
                        headers_dict[header] = "[FILTERED]"
            except Exception:
                # If headers can't be processed, use an empty dict
                headers_dict = {"error": "Could not process headers"}

        context = {
            "method": request.method,
            "url": str(request.url),
            "headers": headers_dict,
            "client_ip": self._get_client_ip(request),
            "path_params": getattr(request, "path_params", {}) or {},
            "query_params": dict(request.query_params.items()) if request.query_params else {},
        }

        return context


class SentryContextMiddleware(BaseHTTPMiddleware):
    """
    Middleware that adds global context to all Sentry events.

    This includes application metadata, deployment information,
    server context, runtime metrics, etc.
    """

    def __init__(self, app, **options):
        super().__init__(app)
        self.app_version = options.get("app_version", "unknown")
        self.deployment_environment = options.get("environment", "development")
        self.server_name = options.get("server_name", os.environ.get("HOSTNAME", "unknown"))

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        # Add global context for all transactions within this request
        with sentry_sdk.configure_scope() as scope:
            # Add deployment context
            scope.set_tag("app.version", self.app_version)
            scope.set_tag("environment", self.deployment_environment)
            scope.set_tag("server.name", self.server_name)

            # Add runtime info
            scope.set_context("runtime", {
                "python_version": os.environ.get("PYTHON_VERSION", "unknown"),
                "process_id": os.getpid(),
            })

            # Add current request path to tags
            scope.set_tag("request.path", request.url.path)

        # Process the request
        return await call_next(request)
