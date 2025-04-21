"""
utils/middlewares.py
--------------------
Enhanced FastAPI middleware components with comprehensive security headers,
Sentry integration, and Content Security Policy (CSP) configuration.

Key Features:
- Sentry request tracing with distributed tracing support
- Performance monitoring and detailed request capture
- Strict security headers including CSP with worker support
- Request context enrichment
- Error handling and logging
"""

import logging
import time
import os
from urllib.parse import urlparse
from typing import Dict, Any, Optional, Tuple

import sentry_sdk
from fastapi import FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response, JSONResponse
from starlette.types import ASGIApp

from utils.sentry_utils import (
    inject_sentry_trace_headers,
    extract_sentry_trace,
    filter_sensitive_event,
)

logger = logging.getLogger(__name__)

# Security configuration
DEFAULT_CSP = (
    "default-src 'self' blob:; "
    "style-src 'self' 'unsafe-inline'; "
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://o4508070823395328.ingest.us.sentry.io https://js.sentry-cdn.com https://browser.sentry-cdn.com; "
    "script-src-elem 'self' 'unsafe-inline' blob: https://o4508070823395328.ingest.us.sentry.io https://js.sentry-cdn.com https://browser.sentry-cdn.com; "
    "worker-src 'self' blob:; "
    "child-src 'self' blob:; "
    "connect-src 'self' http://localhost:8000 https://o4508070823395328.ingest.us.sentry.io https://js.sentry-cdn.com https://browser.sentry-cdn.com; "
    "img-src 'self' data: blob: https://*.sentry.io https://*.sentry-cdn.com; "
    "frame-src 'self'; "
    "font-src 'self' data:; "
    "media-src 'self' blob:; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'none';"
)

# Headers configuration
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
    """Middleware for setting security headers including CSP with worker support"""

    def __init__(self, app: ASGIApp, csp: str = DEFAULT_CSP):
        super().__init__(app)
        self.csp = csp

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        response = await call_next(request)

        security_headers = {
            "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "X-XSS-Protection": "1; mode=block",
            "Content-Security-Policy": self.csp,
            "Referrer-Policy": "strict-origin-when-cross-origin",
            "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Resource-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
        }

        response.headers.update(security_headers)
        return response


class SentryTracingMiddleware(BaseHTTPMiddleware):
    """
    Enhanced Sentry middleware with:
    - Distributed tracing support
    - Performance monitoring
    - Detailed request context
    - Error handling
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
                content={"detail": "Internal server error"},
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

        self._process_queue_time(request, transaction, request_received_time)

        try:
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
        except Exception as e:
            transaction.set_status("internal_error")
            transaction.set_data("exception_type", type(e).__name__)
            transaction.set_data("exception_value", str(e))

            with sentry_sdk.push_scope() as scope:
                scope.set_tag("handled", "false")
                scope.set_context("request", self._get_request_context(request))
                sentry_sdk.capture_exception(e)
            raise

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

        headers = {}
        for name, value in request.headers.items():
            name_lower = name.lower()
            if name_lower in INCLUDE_HEADERS:
                headers[name] = value
            elif name_lower in SENSITIVE_HEADERS:
                headers[name] = "[FILTERED]"

        transaction.set_data("http.request_headers", headers)
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

    def _process_queue_time(
        self, request: Request, transaction: Any, request_received_time: float
    ) -> None:
        request_start = request.headers.get("x-request-start")
        if request_start and request_start.isdigit():
            try:
                start_time_ms = float(request_start) / 1000.0
                queue_time_ms = (request_received_time - start_time_ms) * 1000
                if 0 <= queue_time_ms <= 60000:
                    transaction.set_data("queue_time_ms", queue_time_ms)
                    with sentry_sdk.start_span(
                        op="queue", description="Request queue time"
                    ) as span:
                        span.set_data("queue_time_ms", queue_time_ms)
            except (ValueError, TypeError):
                pass

    def _get_request_context(self, request: Request) -> Dict[str, Any]:
        headers_dict = {}
        if request.headers:
            try:
                headers_dict = dict(request.headers.items())
                for header in SENSITIVE_HEADERS:
                    if header in headers_dict:
                        headers_dict[header] = "[FILTERED]"
            except Exception:
                headers_dict = {"error": "Could not process headers"}

        return {
            "method": request.method,
            "url": str(request.url),
            "headers": headers_dict,
            "client_ip": self._get_client_ip(request),
            "path_params": getattr(request, "path_params", {}) or {},
            "query_params": (
                dict(request.query_params.items()) if request.query_params else {}
            ),
        }


class SentryContextMiddleware(BaseHTTPMiddleware):
    """Middleware for adding global context to Sentry events"""

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
    """Configure all middlewares with proper ordering"""
    # CORS + no security headers in development
    if os.getenv("ENVIRONMENT") == "development":
        from fastapi.middleware.cors import CORSMiddleware
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
        # Skip all other security headers (CSP, HSTS, etc.) in dev
    else:
        # Production: apply strict security headers
        app.add_middleware(SecurityHeadersMiddleware, csp=DEFAULT_CSP)

    # Sentry context before tracing
    app.add_middleware(
        SentryContextMiddleware,
        app_version=os.getenv("APP_VERSION", "1.0.0"),
        environment=os.getenv("ENVIRONMENT", "development"),
    )

    # Tracing middleware last
    app.add_middleware(
        SentryTracingMiddleware,
        include_request_body=False,
        record_breadcrumbs=True,
        spans_sample_rate=1.0,
    )

    return app
