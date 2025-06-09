# services/client_log_service.py - Updated version

"""
services/client_log_service.py - Business logic for client log processing
"""

import logging
import json
from typing import List, Dict, Any, cast, Literal, TypedDict

# Typing helpers – fall back to local definitions if running with an older
# version of `sentry-sdk` that doesn't expose the (private) `_types` module at
# runtime. These aliases exist purely to satisfy static type checkers like
# Pylance/mypy; they have no runtime impact.
try:
    # Pylance ships stubs that expose these, but the runtime module might not.
    from sentry_sdk._types import LogLevelStr, Event  # type: ignore
except Exception:  # pragma: no cover – runtime-only fallback

from typing import TypeAlias

LogLevelStrType: TypeAlias = Literal[
    "fatal",
    "critical",
    "error",
    "warning",
    "info",
    "debug"
]

    class _EventDict(TypedDict, total=False):
        message: str
        level: LogLevelStr
        extra: Dict[str, Any]

EventType: TypeAlias = _EventDict
from datetime import datetime, timedelta, timezone
import aiofiles
import sentry_sdk

from config import settings

logger = logging.getLogger(__name__)


class ClientLogService:
    """Service for processing client-side logs"""

    def __init__(self):
        self.error_cache = {}  # Simple in-memory dedup
        self.cache_ttl = timedelta(seconds=settings.CLIENT_ERROR_DEDUP_TTL)
        self.log_file = settings.CLIENT_LOG_FILE if settings.CLIENT_LOG_FILE else None

    async def process_client_logs(
        self, entries: List[Any], request_context: Dict[str, Any]
    ) -> None:
        """Process a batch of client log entries"""
        for entry in entries:
            await self._process_single_log(entry, request_context)

    async def _process_single_log(
        self, entry: Any, request_context: Dict[str, Any]
    ) -> None:
        """Process a single log entry"""
        # Map client levels to Python levels
        level_map = {
            "debug": logging.DEBUG,
            "info": logging.INFO,
            "warn": logging.WARNING,
            "warning": logging.WARNING,
            "error": logging.ERROR,
            "critical": logging.CRITICAL,
        }

        level = level_map.get(entry.level.lower(), logging.INFO)

        # Check deduplication for errors
        if level >= logging.ERROR:
            cache_key = f"{entry.context}:{entry.message}"
            now = datetime.now(timezone.utc)

            if cache_key in self.error_cache:
                last_seen = self.error_cache[cache_key]
                if now - last_seen < self.cache_ttl:
                    return  # Skip duplicate

            self.error_cache[cache_key] = now

            # Clean old entries
            self._clean_cache()

        # Log to Python logger with context
        extra = {
            "client_log": True,
            "client_context": entry.context,
            "client_session_id": entry.sessionId,
            "client_trace_id": entry.traceId,
            **request_context,
        }

        if entry.data:
            extra["client_data"] = entry.data

        if entry.metadata:
            extra["client_metadata"] = entry.metadata

        logger.log(level, f"[CLIENT] {entry.message}", extra=extra)

        # Forward to Sentry if error/critical and enabled
        if level >= logging.ERROR and getattr(settings, "SENTRY_ENABLED", False):
            await self._forward_to_sentry(entry, request_context)

        # Persist to file if configured
        if self.log_file:
            await self._write_to_file(entry, request_context)

    async def _forward_to_sentry(
        self, entry: Any, request_context: Dict[str, Any]
    ) -> None:
        """Forward error logs from client to Sentry with enhanced context."""
        try:
            with sentry_sdk.push_scope() as scope:
                scope.set_tag("source", "client_log_service")  # Differentiate from direct client Sentry
                scope.set_tag("client_context", getattr(entry, "context", None))

                # Add more granular tags/ids if present
                if hasattr(entry, "sessionId") and entry.sessionId:
                    scope.set_tag("client_session_id", entry.sessionId)
                if hasattr(entry, "traceId") and entry.traceId:
                    scope.set_tag("client_trace_id", entry.traceId)

                # User context from the request, not the client (privacy)
                if request_context.get("user_id"):
                    scope.set_user({
                        "id": request_context["user_id"],
                        "ip_address": request_context.get("client_ip")
                    })
                elif request_context.get("client_ip"):
                    scope.set_user({"ip_address": request_context.get("client_ip")})

                # Add client metadata as extra fields/tags (prefix to avoid collisions)
                if hasattr(entry, "metadata") and entry.metadata:
                    scope.set_extra("client_metadata", entry.metadata)
                # Add entire request context as extra for traceability
                scope.set_extra("log_upload_context", request_context)

                # Create more structured Sentry events for error logs with data payloads
                raw_level: str = (
                    getattr(entry, "level", "error").lower()
                    if hasattr(entry, "level")
                    else "error"
                )

                sentry_event_level = self._normalize_sentry_level(raw_level)

                # If entry.data looks like an Error object (from the browser), capture as such
                client_data = getattr(entry, "data", None)
                if isinstance(client_data, dict) and (
                    "name" in client_data or "stack" in client_data
                ):
                    # Optionally: synthesize a "synthetic exception" if stack/message present
                    event_data: EventType = {
                        "message": f"[CLIENT] {entry.message}",
                        "level": sentry_event_level,
                        "extra": {
                            "client_error_details": client_data,
                            "original_client_log": entry.dict(exclude_none=True),
                        },
                    }

                    sentry_sdk.capture_event(event)
                else:
                    sentry_sdk.capture_message(
                        f"[CLIENT] {entry.message}",
                        level=sentry_event_level
                    )

                # Always add a breadcrumb for the client log
                sentry_sdk.add_breadcrumb(
                    category="client_log",
                    message=entry.message,
                    level=sentry_event_level,
                    data=getattr(entry, "metadata", {}) or {},
                )
        except Exception as e:
            logger.error(f"Failed to forward client log to Sentry: {e}", exc_info=True)

    async def _write_to_file(self, entry: Any, request_context: Dict[str, Any]) -> None:
        """Write log entry to file"""
        try:
            if not self.log_file:
                return

            log_data = {
                **entry.dict(),
                **request_context,
                "server_timestamp": datetime.now(timezone.utc).isoformat(),
            }

            async with aiofiles.open(self.log_file, "a") as f:
                await f.write(json.dumps(log_data) + "\n")
        except Exception as e:
            # Log but don't fail
            logger.debug(f"Failed to write client log to file: {e}")

    def _clean_cache(self) -> None:
        """Remove expired entries from error cache"""
        now = datetime.now(timezone.utc)
        expired = [
            key
            for key, timestamp in self.error_cache.items()
            if now - timestamp > self.cache_ttl
        ]
        for key in expired:
            del self.error_cache[key]

    # ---------------------------------------------------------------------
    # Internal helpers
    # ---------------------------------------------------------------------

    @staticmethod
    def _normalize_sentry_level(level: str) -> LogLevelStrType:
        """Coerce arbitrary string into a valid Sentry ``LogLevelStr``.

        The official Sentry type stubs restrict the *level* field to the set
        of log level string literals.  Runtime code is lenient – anything is
        accepted – but static analyzers (e.g., Pylance, mypy) rightfully flag
        dynamic ``str`` values as incompatible.

        This helper maps unknown/unsupported values to ``"error"`` which is a
        sensible and safe default for client-side error forwarding.
        """
        allowed: tuple[LogLevelStrType, ...] = (
            "fatal",
            "critical",
            "error",
            "warning",
            "info",
            "debug",
        )

        normalized = level.lower()
        if normalized not in allowed:
            return cast(LogLevelStr, "error")

        return cast(LogLevelStrType, normalized)
