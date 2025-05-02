"""
utils/middlewares.py (insecure/debug version)
--------------------------------------------
Middleware components with relaxed or removed security headers.
Maintains the same class and function names as the original for easy drop-in replacement.
Use ONLY for local development or debugging, not for production.
"""

import logging
import time
import os
from urllib.parse import urlparse
from typing import Any, Optional, Tuple

from config import settings
if not getattr(settings, 'DEBUG', False):
    raise RuntimeError("INSECURE module loaded in non-debug/prod environment! Use only in local dev/testing.")

import sentry_sdk
from fastapi import FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response, JSONResponse
from starlette.types import ASGIApp

# If you rely on these from your original Sentry utilities, import them unchanged:
# If not, remove or comment out as needed.
from utils.sentry_utils import (
    inject_sentry_trace_headers,
    extract_sentry_trace,
    filter_sensitive_event,  # Possibly used in Sentry or other components
)

logger = logging.getLogger(__name__)

# ------------------------------------------------------------------
# The original code had a DEFAULT_CSP and a set of strict headers.
# We will remove or ignore these to make it insecure.
# ------------------------------------------------------------------
DEFAULT_CSP = ""  # Ignored or set to empty to disable CSP

# Example sets of headers to filter or include. Adjust as needed.
INCLUDE_HEADERS = {
    "content-type",
    "content-length",
    "accept",
    "accept-encoding",
    "user-agent",
    "x-forwarded-for",
    "x-real-ip",
    "host",
    "referer",
    "origin",
    "x-request-id",
    "x-correlation-id",
    "x-api-version",
}
SENSITIVE_HEADERS = {"cookie", "authorization", "x-api-key", "x-auth-token"}
NORMALIZE_PATHS = ["/api/users/", "/api/projects/", "/api/items/"]


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Middleware for setting security headers, but in this INSECURE/DEBUG version,
    we skip or relax the strict headers (CSP, HSTS, etc.).

    WARNING: Do not use in production. This sets minimal or no security headers.
    """

    def __init__(self, app: ASGIApp, csp: str = DEFAULT_CSP):
        super().__init__(app)
        self.csp = csp  # For compatibility only; we won't use it in debug mode.

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        # Proceed with the request
        response = await call_next(request)

        # In the original secure version, we set many headers (HSTS, CSP, etc.).
        # Here, we either skip them altogether or set minimal placeholders.
        response.headers["X-Debug-Insecure"] = "true"

        # Example: we do NOT set these:
        #   Strict-Transport-Security, X-Frame-Options, X-XSS-Protection, etc.
        #   or Content-Security-Policy with a real CSP directive.

        return response


class SentryTracingMiddleware(BaseHTTPMiddleware):
    """
    Enhanced Sentry middleware with distributed tracing, performance monitoring,
    request context, and error handling.

    Kept mostly the same, as requested, but still "insecure" from a headers perspective.
    """

    def __init__(
        self,
        app: ASGIApp,
        include_request_body: bool = False,
        record_breadcrumbs: bool = True,
        spans_sample_rate: float = 1.0,
    ):
        super().__init__(app)
        self.environment = os.getenv("ENVIRONMENT", "development")
        self.include_request_body = include_request_body
        self.record_breadcrumbs = record_breadcrumbs
        self.spans_sample_rate = spans_sample_rate

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        start_time = time.time()
        request_received_time = time.time()
        trace_headers = extract_sentry_trace(request)
        transaction_name = self._get_transaction_name(request)

        try:
            if "sentry-trace" in trace_headers:
                transaction = sentry_sdk.continue_trace(
                    trace_headers, op="http.server", name=transaction_name
                )
                with sentry_sdk.start_transaction(transaction):
                    return await self._process_request(
                        request,
                        call_next,
                        transaction,
                        start_time,
                        request_received_time,
                    )
            else:
                with sentry_sdk.start_transaction(
                    op="http.server", name=transaction_name
                ) as transaction:
                    return await self._process_request(
                        request,
                        call_next,
                        transaction,
                        start_time,
                        request_received_time,
                    )
        except Exception as e:
            logger.error(f"Request processing error: {str(e)}", exc_info=True)
            if sentry_sdk.Hub.current.client:
                sentry_sdk.capture_exception(e)
            return JSONResponse(
                status_code=500,
                content={"detail": "Internal server error (debug mode)"},
            )

    async def _process_request(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
        transaction: Any,
        start_time: float,
        request_received_time: float,
    ) -> Response:
        self._add_request_data(request, transaction)
        self._add_user_data(request, transaction)

        if self.record_breadcrumbs:
            self._add_request_breadcrumb(request)

        # In a secure version, we might track queue time or do robust analysis.
        # For debug, we skip advanced metrics or partial calls.

        route_start_time = time.time()
        response = await call_next(request)

        route_duration_ms = (time.time() - route_start_time) * 1000
        transaction.set_data("route_processing_ms", route_duration_ms)
        transaction.set_tag("http.status_code", response.status_code)
        transaction.set_data(
            "http.response_content_type", response.headers.get("content-type", "")
        )

        if response.status_code < 400:
            transaction.set_status("ok")
        elif response.status_code < 500:
            transaction.set_status("invalid_argument")
        else:
            transaction.set_status("internal_error")

        elapsed_ms = (time.time() - start_time) * 1000
        transaction.set_data("response_time_ms", elapsed_ms)
        inject_sentry_trace_headers(response)

        return response

    def _get_transaction_name(self, request: Request) -> str:
        method = request.method
        path = request.url.path

        for pattern in NORMALIZE_PATHS:
            if path.startswith(pattern) and len(path) > len(pattern):
                id_part = path[len(pattern) :]
                if "/" in id_part:
                    id_part = id_part.split("/", 1)[1]
                    return f"{method} {pattern}:id/{id_part}"
                return f"{method} {pattern}:id"
        return f"{method} {path}"

    def _add_request_data(self, request: Request, transaction: Any) -> None:
        transaction.set_tag("http.method", request.method)
        transaction.set_tag("http.url", str(request.url))

        parsed_url = urlparse(str(request.url))
        if parsed_url.hostname:
            transaction.set_data("server.address", parsed_url.hostname)
        if parsed_url.port:
            transaction.set_data("server.port", parsed_url.port)
        if parsed_url.path:
            transaction.set_data("http.target", parsed_url.path)
        if parsed_url.query:
            transaction.set_data("http.query", parsed_url.query)

        filtered_headers = {}
        for name, value in request.headers.items():
            name_lower = name.lower()
            if name_lower in INCLUDE_HEADERS:
                filtered_headers[name] = value
            elif name_lower in SENSITIVE_HEADERS:
                filtered_headers[name] = "[FILTERED]"

        transaction.set_data("http.request_headers", filtered_headers)
        transaction.set_tag("environment", self.environment)

        user_agent = request.headers.get("user-agent", "")
        if user_agent:
            transaction.set_tag("http.user_agent", user_agent)

    def _add_user_data(self, request: Request, transaction: Any) -> None:
        user_data = {}
        if hasattr(request.state, "user") and request.state.user:
            user = request.state.user
            user_id = getattr(user, "id", None)
            if user_id:
                user_data["id"] = str(user_id)

            for field in ["email", "username", "name"]:
                value = getattr(user, field, None)
                if value:
                    user_data[field] = str(value)

        ip = self._get_client_ip(request)
        if ip:
            user_data["ip_address"] = ip

        if user_data:
            sentry_sdk.set_user(user_data)

    def _get_client_ip(self, request: Request) -> Optional[str]:
        forwarded_for = request.headers.get("x-forwarded-for")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()

        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip

        client = request.scope.get("client")
        if client and len(client) >= 2:
            return client[0]
        return None

    def _add_request_breadcrumb(self, request: Request) -> None:
        sentry_sdk.add_breadcrumb(
            category="request",
            message=f"{request.method} {request.url.path}",
            level="info",
            data={
                "url": str(request.url),
                "method": request.method,
                "client_ip": self._get_client_ip(request),
            },
        )


class SentryContextMiddleware(BaseHTTPMiddleware):
    """
    Middleware for adding global context to Sentry events.

    Retains the same name, but remains minimal.
    Used for debug or local dev: sets environment, server name, etc.
    """

    def __init__(
        self,
        app: ASGIApp,
        app_version: str = "unknown",
        environment: str = "development",
        server_name: str = "unknown",
    ):
        super().__init__(app)
        self.app_version = app_version
        self.environment = environment
        self.server_name = server_name or os.environ.get("HOSTNAME", "unknown")

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        with sentry_sdk.configure_scope() as scope:
            scope.set_tag("app.version", self.app_version)
            scope.set_tag("environment", self.environment)
            scope.set_tag("server.name", self.server_name)
            scope.set_context(
                "runtime",
                {
                    "python_version": os.environ.get("PYTHON_VERSION", "unknown"),
                    "process_id": os.getpid(),
                },
            )
            scope.set_tag("request.path", request.url.path)

        return await call_next(request)


def setup_middlewares(app: FastAPI) -> FastAPI:
    """
    Configure all middlewares with minimal or insecure defaults.
    NOTE: CORS middleware must ONLY be mounted in the entrypoint/main.
    This function does NOT add CORS; responsibility is centralized.
    """

    # Insecure security headers
    app.add_middleware(SecurityHeadersMiddleware, csp=DEFAULT_CSP)

    # Sentry context
    app.add_middleware(
        SentryContextMiddleware,
        app_version=os.getenv("APP_VERSION", "debug"),
        environment=os.getenv("ENVIRONMENT", "development"),
    )

    # Sentry tracing
    app.add_middleware(
        SentryTracingMiddleware,
        include_request_body=False,
        record_breadcrumbs=True,
        spans_sample_rate=1.0,
    )

    return app
