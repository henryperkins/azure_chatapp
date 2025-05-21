# pylint: disable=import-outside-toplevel
"""
utils/middlewares.py (insecure/debug version)
--------------------------------------------
Middleware components with relaxed or removed security headers for **local
development only**.  Do **NOT** use in production.

Changes:
- Uses updated helpers from utils.sentry_utils (set_sentry_user, tag_transaction,
  capture_breadcrumb, etc.).
"""

import logging
import os
import time
import uuid
from urllib.parse import urlparse
from typing import Any, Optional, Set

import sentry_sdk
from fastapi import FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response, JSONResponse
from starlette.types import ASGIApp

# Project settings
from config import settings

if not getattr(settings, "DEBUG", False):
    raise RuntimeError(
        "INSECURE middlewares loaded in non-debug/prod environment! "
        "Use only in local dev/testing."
    )

# Updated Sentry helpers
from utils.sentry_utils import (
    inject_sentry_trace_headers,
    extract_sentry_trace,
    set_sentry_user,
    tag_transaction,
    capture_breadcrumb,
    request_id_var, trace_id_var          # NEW
)

logger = logging.getLogger(__name__)

# ------------------------------------------------------------------ #
#                Insecure / Debug-only header handling               #
# ------------------------------------------------------------------ #
DEFAULT_CSP = ""  # CSP disabled in debug mode

INCLUDE_HEADERS: Set[str] = {
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
SENSITIVE_HEADERS: Set[str] = {
    "cookie",
    "authorization",
    "x-api-key",
    "x-auth-token",
}
NORMALIZE_PATHS = ["/api/users/", "/api/projects/", "/api/items/"]


# ------------------------------------------------------------------ #
#                           Middlewares                              #
# ------------------------------------------------------------------ #
class CSRFMiddleware(BaseHTTPMiddleware):
    """
    CSRF protection middleware. Requires X-CSRF-Token header on mutating requests.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            header_token = request.headers.get("X-CSRF-Token")
            session_token = request.session.get("csrf_token")
            if not header_token or not session_token or header_token != session_token:
                logger.warning(f"CSRF failure method={request.method} url={request.url.path} header={header_token} session={session_token}")
                return JSONResponse(status_code=403, content={"detail": "Bad CSRF token"})
        return await call_next(request)

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Adds a single debug marker header; skips all strict security headers.
    """

    def __init__(self, app: ASGIApp, csp: str = DEFAULT_CSP) -> None:  # noqa: D401
        super().__init__(app)
        self.csp = csp

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:  # noqa: D401
        response = await call_next(request)
        response.headers["X-Debug-Insecure"] = "true"
        return response


class SentryTracingMiddleware(BaseHTTPMiddleware):
    """
    Sentry performance + breadcrumbs + insecure headers for debug mode.
    """

    def __init__(
        self,
        app: ASGIApp,
        include_request_body: bool = False,
        record_breadcrumbs: bool = True,
        spans_sample_rate: float = 1.0,
    ) -> None:
        super().__init__(app)
        self.environment = os.getenv("ENVIRONMENT", "development")
        self.include_request_body = include_request_body
        self.record_breadcrumbs = record_breadcrumbs
        self.spans_sample_rate = spans_sample_rate

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        start_time = time.time()
        trace_headers = extract_sentry_trace(request)
        transaction_name = self._transaction_name(request)

        try:
            if "sentry-trace" in trace_headers:
                transaction = sentry_sdk.continue_trace(
                    trace_headers, op="http.server", name=transaction_name
                )
                with sentry_sdk.start_transaction(transaction):
                    return await self._process_request(request, call_next, transaction, start_time)
            with sentry_sdk.start_transaction(
                op="http.server", name=transaction_name
            ) as transaction:
                return await self._process_request(request, call_next, transaction, start_time)
        except Exception as exc:  # noqa: BLE001
            logger.error("Request processing error", exc_info=True)
            if sentry_sdk.Hub.current.client:
                sentry_sdk.capture_exception(exc)
            return JSONResponse(
                status_code=500,
                content={"detail": "Internal server error (debug mode)"},
            )

    # ---------------------------------------------------------------- #
    #                           Helpers                                #
    # ---------------------------------------------------------------- #
    async def _process_request(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
        transaction: Any,
        start_time: float,
    ) -> Response:
        # Generate context IDs for structured logging
        request_id = str(uuid.uuid4())
        trace_id   = transaction.trace_id if hasattr(transaction, "trace_id") else ""

        tag_transaction("request.id", request_id)
        tag_transaction("trace.id",  trace_id)

        # --- propagate into logging ContextVars ---
        req_token = request_id_var.set(request_id)
        trc_token = trace_id_var.set(str(trace_id))

        try:
            self._attach_request_info(request, transaction)
            self._attach_user_info(request)

            if self.record_breadcrumbs:
                self._add_request_breadcrumb(request)

            route_start = time.time()
            response = await call_next(request)
            route_ms = (time.time() - route_start) * 1000
        finally:
            # Restore previous ContextVar state
            request_id_var.reset(req_token)
            trace_id_var.reset(trc_token)

        # Final transaction enrichment
        transaction.set_data("route_processing_ms", route_ms)
        transaction.set_tag("http.status_code", response.status_code)
        transaction.set_data(
            "http.response_content_type", response.headers.get("content-type", "")
        )

        trans_status = (
            "ok"
            if response.status_code < 400
            else "invalid_argument"
            if response.status_code < 500
            else "internal_error"
        )
        transaction.set_status(trans_status)
        transaction.set_data("response_time_ms", (time.time() - start_time) * 1000)

        inject_sentry_trace_headers(response)
        return response

    # ------------- private -------------------------------------------------- #
    def _transaction_name(self, request: Request) -> str:
        method = request.method
        path = request.url.path
        for prefix in NORMALIZE_PATHS:
            if path.startswith(prefix) and len(path) > len(prefix):
                return f"{method} {prefix}:id"
        return f"{method} {path}"

    def _attach_request_info(self, request: Request, transaction: Any) -> None:
        transaction.set_tag("http.method", request.method)
        transaction.set_tag("http.url", str(request.url))
        transaction.set_tag("environment", self.environment)

        parsed = urlparse(str(request.url))
        if parsed.hostname:
            transaction.set_data("server.address", parsed.hostname)
        if parsed.port:
            transaction.set_data("server.port", parsed.port)
        if parsed.path:
            transaction.set_data("http.target", parsed.path)
        if parsed.query:
            transaction.set_data("http.query", parsed.query)

        # Filter headers
        filtered: dict[str, str] = {}
        for k, v in request.headers.items():
            kl = k.lower()
            if kl in INCLUDE_HEADERS:
                filtered[k] = v
            elif kl in SENSITIVE_HEADERS:
                filtered[k] = "[FILTERED]"
        transaction.set_data("http.request_headers", filtered)

        ua = request.headers.get("user-agent")
        if ua:
            transaction.set_tag("http.user_agent", ua)

    def _attach_user_info(self, request: Request) -> None:
        if hasattr(request.state, "user") and request.state.user:
            user = request.state.user  # framework-specific user model
            user_data = {"id": str(getattr(user, "id", ""))}
            for field in ("email", "username", "name"):
                val = getattr(user, field, None)
                if val:
                    user_data[field] = str(val)
            set_sentry_user(user_data)

        ip = self._client_ip(request)
        if ip:
            tag_transaction("client.ip", ip)

    def _client_ip(self, request: Request) -> Optional[str]:
        if fwd := request.headers.get("x-forwarded-for"):
            return fwd.split(",")[0].strip()
        if rip := request.headers.get("x-real-ip"):
            return rip
        client = request.scope.get("client")
        return client[0] if client and len(client) >= 2 else None

    def _add_request_breadcrumb(self, request: Request) -> None:
        capture_breadcrumb(
            category="request",
            message=f"{request.method} {request.url.path}",
            level="info",
            data={
                "url": str(request.url),
                "method": request.method,
                "client_ip": self._client_ip(request),
            },
        )


class SentryContextMiddleware(BaseHTTPMiddleware):
    """
    Adds minimal context tags for local debugging.
    """

    def __init__(  # noqa: D401
        self,
        app: ASGIApp,
        app_version: str = "debug",
        environment: str = "development",
        server_name: str | None = None,
    ) -> None:
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
            scope.set_tag("request.path", request.url.path)
        return await call_next(request)


# ------------------------------------------------------------------ #
#                       Application helper                           #
# ------------------------------------------------------------------ #
def setup_middlewares(app: FastAPI) -> FastAPI:
    """
    Mounts insecure middlewares in the recommended order. CORS (if any) should
    be added in your main entrypoint, not here.
    """
    app.add_middleware(CSRFMiddleware)
    app.add_middleware(SecurityHeadersMiddleware, csp=DEFAULT_CSP)
    app.add_middleware(
        SentryContextMiddleware,
        app_version=os.getenv("APP_VERSION", "debug"),
        environment=os.getenv("ENVIRONMENT", "development"),
    )
    app.add_middleware(
        SentryTracingMiddleware,
        include_request_body=False,
        record_breadcrumbs=True,
        spans_sample_rate=1.0,
    )
    return app
