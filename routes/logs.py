from fastapi import APIRouter, Request, Response, status, Depends
import json
import os
import re
import time
import logging
from typing import Optional, Literal, cast
from pydantic import BaseModel, ValidationError
from utils.sentry_utils import capture_custom_message
from utils.auth_utils import get_current_user
from models.user import User
from config import settings  # NEW

import aiofiles
from aiofiles import os as aioos  # ← ADD
import sentry_sdk

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

# -------- client-log rate limit ------------------------------------------
_DEFAULT_RATE = "100/minute"
_DEBUG_RATE = "10000/minute"  # Very high limit for development

# Check DEBUG setting and set appropriate rate limit
is_debug = getattr(settings, "DEBUG", False)

# Allow environment variable override
env_rate_limit = os.getenv("CLIENT_LOG_RATE_LIMIT")
if env_rate_limit:
    LOGS_RATE_LIMIT = env_rate_limit
else:
    LOGS_RATE_LIMIT = _DEBUG_RATE if is_debug else _DEFAULT_RATE

# Moved log message below after logger is defined

# Add colorama and initialize (safe even if multiple imports)
try:
    from colorama import init as colorama_init, Fore, Style

    colorama_init()
except ImportError:
    # fallback stubs if colorama is not installed
    class Dummy:
        RESET_ALL = ""

    class ForeDummy(Dummy):
        RED = YELLOW = CYAN = GREEN = BLUE = MAGENTA = WHITE = RESET = ""

    class StyleDummy(Dummy):
        BRIGHT = NORMAL = DIM = ""

    Fore = ForeDummy()
    Style = StyleDummy()

logger = logging.getLogger("api.logs")
logger.info(f"Client logs rate limit set to: {LOGS_RATE_LIMIT} (DEBUG={is_debug})")

# ---------------------------------------------------------------------------
# Duplicate-error suppression (in-memory, process-wide)
# Keeps last timestamp for each ERROR/CRITICAL message and skips console output
# if the *identical* message reappears within SUPPRESS_WINDOW seconds.
# Still archived to JSONL file so nothing is lost.
# ---------------------------------------------------------------------------
_SUPPRESS_WINDOW = int(os.getenv("CLIENT_LOG_ERR_WINDOW", "30"))
_error_cache: dict[str, float] = {}
level_map = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "log": logging.INFO,
    "warn": logging.WARNING,
    "warning": logging.WARNING,
    "error": logging.ERROR,
    "critical": logging.CRITICAL,
    "fatal": logging.CRITICAL,
}


class ClientLog(BaseModel):
    level: str = "info"
    context: str = "client"
    args: list = []
    ts: int | None = None
    request_id: str | None = None
    session_id: str | None = None
    trace_id: str | None = None  # ← NEW
    timestamp: str | None = None
    message: str | None = None
    data: dict | None = None
    metadata: dict | None = None

    class Config:
        extra = "allow"  # Allow unknown fields to make endpoint robust to future client-side logger additions


class ClientLogBatch(BaseModel):
    logs: list[ClientLog]


router = APIRouter()


# Optional authentication dependency for logging endpoint
async def get_current_user_optional(request: Request) -> Optional[User]:
    """
    Optional authentication dependency that returns None if user is not authenticated
    instead of raising an exception. This allows the logs endpoint to work for both
    authenticated and unauthenticated users.
    """
    try:
        return await get_current_user(request)
    except Exception:
        # User is not authenticated, return None
        return None


def get_color_for_level(level: str):
    level = level.lower()
    if level == "error" or level == "fatal" or level == "critical":
        return Fore.RED + Style.BRIGHT
    if level == "warn" or level == "warning":
        return Fore.YELLOW + Style.BRIGHT
    if level == "debug":
        return Fore.CYAN
    if level == "info" or level == "log":
        return Fore.GREEN
    return Style.NORMAL


# Apply rate limiter conditionally based on debug mode
if is_debug:
    # No rate limiting in debug mode
    @router.post("/api/logs", status_code=status.HTTP_204_NO_CONTENT)
    async def receive_logs(
        request: Request,
        _current_user: Optional[User] = Depends(get_current_user_optional),
    ):
        return await _process_log_request(request, _current_user)

else:
    # Apply rate limiting in production
    @router.post("/api/logs", status_code=status.HTTP_204_NO_CONTENT)
    @limiter.limit(LOGS_RATE_LIMIT)
    async def receive_logs(
        request: Request,
        _current_user: Optional[User] = Depends(get_current_user_optional),
    ):
        return await _process_log_request(request, _current_user)


async def _process_log_request(request: Request, _current_user: Optional[User]):
    """Process the actual log request - extracted to avoid code duplication"""
    try:
        try:
            payload = await request.json()

            # Check if it's a batch or single log
            if isinstance(payload, dict) and "logs" in payload:
                # It's a batch
                batch = ClientLogBatch(**payload)
                log_entries = [log.model_dump() for log in batch.logs]
            else:
                # It's a single log entry
                log_entry = ClientLog(**payload)
                log_entries = [log_entry.model_dump()]

        except ValidationError as ve:
            # Log validation errors with the raw payload for debugging
            body_preview = str(await request.body())[:500]  # First 500 chars
            logger.warning(
                "Bad client-log payload - validation failed",
                extra={
                    "errors": ve.errors(),
                    "raw_body_preview": body_preview,
                    "validation_error": str(ve),
                },
            )
            return Response(status_code=400)

        # Process each log entry in the batch
        for log_entry_data in log_entries:
            await _process_single_log_entry(log_entry_data, request)

        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as e:
        logger.error("Could not process incoming client log", extra={"error": str(e)})
        return Response(status_code=400)


async def _process_single_log_entry(log_entry_data: dict, request: Request):
    """Process a single log entry from either a batch or individual request"""
    try:
        # --- Sanitize sensitive fields ---
        def sanitize_args(args):
            sensitive_patterns = [
                r"password.*",
                r".*token.*",
                r".*key.*",
                r".*secret.*",
            ]

            def is_sensitive(key):
                return any(
                    re.match(pattern, key, re.IGNORECASE)
                    for pattern in sensitive_patterns
                )

            result = []
            for arg in args:
                if isinstance(arg, dict):
                    sanitized = {
                        k: "[REDACTED]" if is_sensitive(k) else v
                        for k, v in arg.items()
                    }
                    result.append(sanitized)
                else:
                    result.append(arg)
            return result

        def sanitize(entry):
            sensitive_patterns = [
                r"password.*",
                r".*token.*",
                r".*key.*",
                r".*secret.*",
            ]

            def is_sensitive(key):
                return any(
                    re.match(pattern, key, re.IGNORECASE)
                    for pattern in sensitive_patterns
                )

            sanitized = dict(entry)
            for key in list(sanitized.keys()):
                if is_sensitive(key):
                    sanitized[key] = "[REDACTED]"
            # Also sanitize nested dicts in 'args' if present
            if isinstance(sanitized.get("args"), list):
                sanitized["args"] = sanitize_args(sanitized["args"])
            return sanitized

        # Add correlation/meta if present
        sanitized_entry = sanitize(log_entry_data)
        # ---- prevent LogRecord key collision ----
        original_args = sanitized_entry.pop("args", None)  # drop reserved key
        if original_args is not None:
            sanitized_entry["client_args"] = original_args  # keep a safe copy
        sanitized_entry["request_id"] = request.headers.get(
            "X-Request-ID"
        ) or log_entry_data.get("request_id")
        sanitized_entry["session_id"] = log_entry_data.get("session_id")
        sanitized_entry["trace_id"] = request.headers.get(
            "X-Trace-ID"
        ) or log_entry_data.get("trace_id")

        # ── derived fields (must precede any further use) ─────────
        level = sanitized_entry.get("level", "info").lower()
        ctx = sanitized_entry.get("context", "client")
        payload_args = sanitized_entry.get("client_args", [])
        summary = " ".join(map(str, payload_args)) or f"[{ctx}]"
        color = get_color_for_level(level)
        reset = getattr(Style, "RESET_ALL", "")

        # ---------------------------------------------------------------
        # Strip logging-reserved keys so logger.log(extra=…) never fails
        # ---------------------------------------------------------------
        reserved = {
            "args",
            "msg",
            "message",
            "levelname",
            "levelno",
            "level",
            "context",
        }
        for k in reserved:
            sanitized_entry.pop(k, None)

        # --- Log rotation: if file >10MB, rotate ---
        log_path = os.getenv("CLIENT_LOG_FILE", "client_logs.jsonl")
        max_bytes = 10 * 1024 * 1024
        if os.path.exists(log_path) and os.path.getsize(log_path) > max_bytes:
            ts = time.strftime("%Y%m%d-%H%M%S")
            rotated = f"client_logs_{ts}.jsonl"
            await aioos.rename(log_path, rotated)  # ← REPLACE

        # Terminal echo for all client levels ≥ INFO
        # (includes 'log', which we map to INFO)
        if level in ("info", "log", "warn", "warning", "error", "critical", "fatal"):
            lvl_num = level_map.get(level, logging.INFO)
            summary_c = f"{color}{summary}{reset}"

            # Skip repetitive low-signal diagnostic noise
            # e.g. "[DIAGNOSTIC][auth.js][getCSRFToken] …"
            if lvl_num == logging.INFO and "diagnostic" in ctx.lower():
                # Still write to JSONL file, but do not spam server console
                sanitized_entry["skipped_console"] = True
            else:
                # Remove keys that collide with built-in LogRecord attributes
                extra_for_logger = {
                    k: v for k, v in sanitized_entry.items() if k not in reserved
                }

                # Duplicate-error suppression ────────────────────────────────
                if lvl_num >= logging.ERROR:
                    now_ts = time.time()
                    last_ts = _error_cache.get(summary)
                    _error_cache[summary] = now_ts  # always update
                    if last_ts and now_ts - last_ts < _SUPPRESS_WINDOW:
                        sanitized_entry["skipped_console"] = True
                    else:
                        logger.log(lvl_num, summary_c, extra=extra_for_logger)
                else:
                    logger.log(lvl_num, summary_c, extra=extra_for_logger)

        # --- Async write to log file ---
        try:
            async with aiofiles.open(log_path, "a", encoding="utf-8") as logfile:
                await logfile.write(json.dumps(sanitized_entry, ensure_ascii=False))
                await logfile.write("\n")
        except Exception as log_exc:
            logger.warning("Failed to write log file", extra={"error": str(log_exc)})

        # Skip Sentry for noise-level logs
        if level in ("debug", "info"):
            return

        # Integration: Forward client log to Sentry as a message (retaining details)
        try:
            msg = f"[{ctx}] {level.upper()}: {summary}"
            # Determine final sentry level (Literal for static type checkers)
            send_level: Literal[
                "fatal", "critical", "error", "warning", "info", "debug"
            ] = cast(
                Literal["fatal", "critical", "error", "warning", "info", "debug"],
                (
                    level
                    if level
                    in ("fatal", "critical", "error", "warning", "info", "debug")
                    else "info"
                ),
            )
            if send_level in ("warning", "error", "critical", "fatal"):
                # Set Sentry tags for correlation
                with sentry_sdk.configure_scope() as scope:
                    scope.set_tag("session_id", sanitized_entry.get("session_id"))
                    scope.set_tag("request_id", sanitized_entry.get("request_id"))
                    scope.set_tag("trace_id", sanitized_entry.get("trace_id"))  # NEW

                # Use validated Literal type for Sentry message level
                capture_custom_message(
                    message=msg,
                    level=send_level,  # type: ignore[arg-type] – casted Literal safe for runtime but static checker complains
                    extra={
                        "browser": True,
                        "source": ctx,
                        "client_args": payload_args,
                        "raw": sanitized_entry,
                    },
                )
        except Exception as sentry_exc:
            logger.error(
                "Failed to forward log to Sentry", extra={"error": str(sentry_exc)}
            )

    except Exception as e:
        logger.error("Could not process single log entry", extra={"error": str(e)})


@router.get("/diagnostics/dom-replay-events")
async def get_dom_replay_events():
    """
    Placeholder route for frontend domReadinessService.getEventReplayStats().
    Real implementation should connect to a metric bridge or log-scraping mechanism if frontend pushes these diagnostics.
    """
    # Replace this stub with actual metric export as engineering progresses
    return {
        "enabled": True,
        "totalCachedEvents": 0,
        "maxEvents": 50,
        "ttlMs": 300000,
        "events": {},
        "oldestEvent": None,
        "newestEvent": None,
        "expiredCount": 0,
        "note": "This is a placeholder. To connect real domReadinessService stats, build a bridge from the frontend.",
    }
