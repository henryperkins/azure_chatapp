from fastapi import APIRouter, Request, Response, status, Depends
import sys
import json
import os
import re
import time
import logging
from pydantic import BaseModel, ValidationError
from utils.sentry_utils import capture_custom_message
from utils.auth_utils import get_current_user
from models.user import User

import aiofiles

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

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
level_map = {
    "debug": logging.DEBUG, "info": logging.INFO, "log": logging.INFO,
    "warn": logging.WARNING, "warning": logging.WARNING,
    "error": logging.ERROR, "critical": logging.CRITICAL, "fatal": logging.CRITICAL,
}
class ClientLog(BaseModel):
    level: str = "info"
    context: str = "client"
    args: list = []
    ts: int | None = None
    request_id: str | None = None
    session_id: str | None = None
    trace_id: str | None = None  # ← NEW

router = APIRouter()


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


@router.post("/api/logs", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("100/minute")
async def receive_logs(
    request: Request, current_user: User = Depends(get_current_user)
):
    try:
        try:
            log_entry = ClientLog(**(await request.json())).dict()
        except ValidationError as ve:
            logger.warning("Bad client-log payload", extra={"errors": ve.errors()})
            return Response(status_code=400)

        level = str(log_entry.get("level", "info")).lower()
        if level not in level_map:
            level = "info"
        ctx = log_entry.get("context", "client")
        args = log_entry.get("args", [])
        summary = args[0] if args else ""
        color = get_color_for_level(level)
        reset = Style.RESET_ALL if hasattr(Style, "RESET_ALL") else ""

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
        sanitized_entry = sanitize(log_entry)
        sanitized_entry["request_id"] = request.headers.get(
            "X-Request-ID"
        ) or log_entry.get("request_id")
        sanitized_entry["session_id"] = log_entry.get("session_id")
        sanitized_entry["trace_id"] = (
            request.headers.get("X-Trace-ID")
            or log_entry.get("trace_id")
        )

        # --- Log rotation: if file >10MB, rotate ---
        log_path = os.getenv("CLIENT_LOG_FILE", "client_logs.jsonl")
        max_bytes = 10 * 1024 * 1024
        if os.path.exists(log_path) and os.path.getsize(log_path) > max_bytes:
            ts = time.strftime("%Y%m%d-%H%M%S")
            rotated = f"client_logs_{ts}.jsonl"
            import aiofiles.os; await aiofiles.os.rename(log_path, rotated)

        # Terminal echo **only** for WARN/ERROR+
        if level in ("warn", "warning", "error", "critical", "fatal"):
            lvl_num   = level_map.get(level, logging.INFO)
            summary_c = f"{color}{summary}{reset}"
            logger.log(lvl_num, summary_c, extra=sanitized_entry)

        # --- Async write to log file ---
        try:
            async with aiofiles.open(log_path, "a", encoding="utf-8") as logfile:
                await logfile.write(json.dumps(sanitized_entry, ensure_ascii=False))
                await logfile.write("\n")
        except Exception as log_exc:
            logger.warning("Failed to write log file", extra={"error": str(log_exc)})

        # Skip Sentry for noise-level logs
        if level in ("debug", "info"):
            return Response(status_code=status.HTTP_204_NO_CONTENT)

        # Integration: Forward client log to Sentry as a message (retaining details)
        try:
            msg = f"[{ctx}] {level.upper()}: {summary}"
            if level in ("warning", "warn", "error", "critical", "fatal"):
                # Set Sentry tags for correlation
                import sentry_sdk

                with sentry_sdk.configure_scope() as scope:
                    scope.set_tag("session_id", sanitized_entry.get("session_id"))
                    scope.set_tag("request_id", sanitized_entry.get("request_id"))
                    scope.set_tag("trace_id"  , sanitized_entry.get("trace_id"))  # NEW

                capture_custom_message(
                    message=msg,
                    level=level,
                    extra={
                        "browser": True,
                        "source": ctx,
                        "args": args,
                        "raw": sanitized_entry,
                    },
                )
        except Exception as sentry_exc:
            logger.error("Failed to forward log to Sentry", extra={"error": str(sentry_exc)})

        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as e:
        logger.error("Could not process incoming client log", extra={"error": str(e)})
        return Response(status_code=400)
