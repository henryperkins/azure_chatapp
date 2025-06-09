"""
services/client_log_service.py
------------------------------
Centralized business logic for ingesting the browser's log messages into
the server environment:

1. Logs to std logging so messages appear in server logs.
2. Optionally forwards error/critical messages to Sentry if configured.
3. Optionally persists raw entries into an append-only text file (one
   JSON blob per line).
4. Deduplicates identical error entries for a configurable time window
   to reduce noise.

This class can be instantiated or injected via FastAPI Depends() in
routes.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, TypedDict

import aiofiles

try:  # best-effort import (sentry_sdk is optional)
    import sentry_sdk
except ImportError:
    sentry_sdk = None

from config import settings


class _EventDict(TypedDict, total=False):
    message: str
    level: str  # We'll store the string-based level.
    extra: Dict[str, Any]


EventType = _EventDict


_ALLOWED_SENTRY_LEVELS = {"fatal", "critical", "error", "warning", "info", "debug"}


def _normalize_sentry_level(level: str) -> str:
    """
    Convert the given level string to a valid Sentry log-level string,
    or fallback to "error" if unknown.
    """
    lowered = level.lower()
    if lowered in _ALLOWED_SENTRY_LEVELS:
        return lowered
    return "error"


class ClientLogService:
    """
    Processes logs received from the browser client. Deduplicates repeated
    errors, logs them to the server logs, can forward to Sentry, and optionally
    persist to a local text file.
    """

    def __init__(self) -> None:
        self.error_cache: Dict[str, datetime] = {}
        self.cache_ttl = timedelta(seconds=settings.CLIENT_ERROR_DEDUP_TTL)
        self.log_file = getattr(settings, "CLIENT_LOG_FILE", None)
        self.logger = logging.getLogger(__name__)

    async def process_client_logs(
        self,
        entries: List[Any],
        request_context: Dict[str, Any],
    ) -> None:
        """Process a batch of client log entries."""
        for entry in entries:
            await self._process_single_log(entry, request_context)

    async def _process_single_log(
        self,
        entry: Any,
        request_context: Dict[str, Any],
    ) -> None:
        """Process an individual client log entry."""
        raw_level = getattr(entry, "level", "info")
        python_level = self._map_client_level(raw_level)

        # Deduplicate error logs if needed
        if python_level >= logging.ERROR:
            cache_key = f"{getattr(entry, 'context', '')}:{getattr(entry, 'message', '')}"
            now = datetime.now(timezone.utc)
            last_seen = self.error_cache.get(cache_key)
            if last_seen and (now - last_seen < self.cache_ttl):
                # Skip duplicate
                return
            self.error_cache[cache_key] = now
            self._clean_cache()

        # Log to Python logger
        extra_fields: Dict[str, Any] = {
            "client_log": True,
            "client_context": getattr(entry, "context", None),
            "client_session_id": getattr(entry, "sessionId", None),
            "client_trace_id": getattr(entry, "traceId", None),
            **request_context,
        }
        if getattr(entry, "data", None):
            extra_fields["client_data"] = entry.data
        if getattr(entry, "metadata", None):
            extra_fields["client_metadata"] = entry.metadata

        msg = f"[CLIENT] {getattr(entry, 'message', '')}"
        self.logger.log(python_level, msg, extra=extra_fields)

        # Forward to Sentry if configured and is error/critical
        if python_level >= logging.ERROR and getattr(settings, "SENTRY_ENABLED", False):
            if sentry_sdk is not None:
                await self._forward_to_sentry(entry, request_context)

        # Optionally persist to a text file
        if self.log_file:
            await self._write_to_file(entry, request_context)

    async def _forward_to_sentry(
        self,
        entry: Any,
        request_context: Dict[str, Any],
    ) -> None:
        """Forward error logs to Sentry with contextual metadata."""
        if not sentry_sdk:
            return

        try:
            with sentry_sdk.push_scope() as scope:
                scope.set_tag("source", "client_log_service")
                scope.set_tag("client_context", getattr(entry, "context", None))

                sid = getattr(entry, "sessionId", None)
                if sid:
                    scope.set_tag("client_session_id", sid)

                tid = getattr(entry, "traceId", None)
                if tid:
                    scope.set_tag("client_trace_id", tid)

                uid = request_context.get("user_id")
                if uid:
                    scope.set_user({"id": uid, "ip_address": request_context.get("client_ip")})
                elif request_context.get("client_ip"):
                    scope.set_user({"ip_address": request_context["client_ip"]})

                meta = getattr(entry, "metadata", None)
                if meta:
                    scope.set_extra("client_metadata", meta)

                scope.set_extra("log_upload_context", request_context)

                raw_level = getattr(entry, "level", "error")
                event_level = _normalize_sentry_level(raw_level)

                # If entry.data looks like an error object, capture event for possible stack
                client_data = getattr(entry, "data", None)
                if isinstance(client_data, dict) and ("name" in client_data or "stack" in client_data):
                    event_data: EventType = {
                        "message": f"[CLIENT] {getattr(entry, 'message', '')}",
                        "level": event_level,
                        "extra": {
                            "client_error_details": client_data,
                            "original_client_log": (entry.dict(exclude_none=True) if hasattr(entry, "dict") else {}),
                        },
                    }
                    sentry_sdk.capture_event(event_data)  # type: ignore[arg-type]
                else:
                    # Use ignore because typed stubs require LogLevelStr, we have str
                    sentry_sdk.capture_message(f"[CLIENT] {getattr(entry, 'message', '')}", level=event_level)  # type: ignore[arg-type]

                # Add a breadcrumb
                sentry_sdk.add_breadcrumb(
                    category="client_log",
                    message=getattr(entry, "message", ""),
                    level=event_level,  # type: ignore[arg-type]
                    data=meta or {},
                )
        except Exception as exc:
            self.logger.error("Failed to forward client log to Sentry: %s", exc, exc_info=True)

    async def _write_to_file(self, entry: Any, request_context: Dict[str, Any]) -> None:
        """Append a JSON log line to the configured file."""
        if not self.log_file:
            return

        log_data: Dict[str, Any] = {
            **(entry.dict() if hasattr(entry, "dict") else {}),
            **request_context,
            "server_timestamp": datetime.now(timezone.utc).isoformat(),
        }

        try:
            async with aiofiles.open(self.log_file, "a") as fp:
                await fp.write(json.dumps(log_data, separators=(",", ":")) + "\n")
        except Exception as exc:
            # Do not fail main flow if file logging fails
            self.logger.debug("Failed to write client log to file: %s", exc)

    def _clean_cache(self) -> None:
        """Purge stale error duplicates from the cache."""
        now = datetime.now(timezone.utc)
        keys_to_remove = []
        for k, ts in self.error_cache.items():
            if (now - ts) > self.cache_ttl:
                keys_to_remove.append(k)
        for k in keys_to_remove:
            del self.error_cache[k]

    @staticmethod
    def _map_client_level(level: str) -> int:
        """Map the string *level* from browser to Python's logging module levels."""
        level_map: Dict[str, int] = {
            "debug": logging.DEBUG,
            "info": logging.INFO,
            "warn": logging.WARNING,
            "warning": logging.WARNING,
            "error": logging.ERROR,
            "critical": logging.CRITICAL,
        }
        return level_map.get(level.lower(), logging.INFO)
