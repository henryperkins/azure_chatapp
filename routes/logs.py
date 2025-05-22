from fastapi import APIRouter, Request, Response, status, Depends
import sys
import json
import os
import re
import time
from utils.sentry_utils import capture_custom_message
from utils.auth_utils import get_current_user_and_token

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

@router.post('/api/logs', status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("100/minute")
async def receive_logs(request: Request, user_and_token=Depends(get_current_user_and_token)):
    try:
        log_entry = await request.json()
        level = str(log_entry.get("level", "info")).lower()
        ctx = log_entry.get("context", "client")
        args = log_entry.get("args", [])
        summary = args[0] if args else ""
        color = get_color_for_level(level)
        reset = Style.RESET_ALL if hasattr(Style, "RESET_ALL") else ""

        # --- Sanitize sensitive fields ---
        def sanitize(entry):
            sensitive_patterns = [
                r"password.*",
                r".*token.*",
                r".*key.*",
                r".*secret.*"
            ]
            sanitized = dict(entry)
            for key in list(sanitized.keys()):
                if any(re.match(pattern, key, re.IGNORECASE) for pattern in sensitive_patterns):
                    sanitized[key] = "[REDACTED]"
            # Also sanitize nested dicts in 'args' if present
            if isinstance(sanitized.get("args"), list):
                sanitized["args"] = [
                    {k: "[REDACTED]" if any(re.match(p, k, re.IGNORECASE) for p in sensitive_patterns) else v
                     for k, v in (a.items() if isinstance(a, dict) else [])}
                    if isinstance(a, dict) else a
                    for a in sanitized["args"]
                ]
            return sanitized

        sanitized_entry = sanitize(log_entry)

        # --- Log rotation: if file >10MB, rotate ---
        log_path = "client_logs.jsonl"
        max_bytes = 10 * 1024 * 1024
        if os.path.exists(log_path) and os.path.getsize(log_path) > max_bytes:
            ts = time.strftime("%Y%m%d-%H%M%S")
            rotated = f"client_logs_{ts}.jsonl"
            os.rename(log_path, rotated)

        # Output: colored header, Route-style log (single line, all context and summary)
        main_args = ' '.join(str(a) for a in args)
        print(
            f"{color}[CLIENT LOG] [{ctx}] [{level.upper()}] {main_args}{reset}",
            file=sys.stdout, flush=True
        )

        # --- Async write to log file ---
        try:
            async with aiofiles.open(log_path, "a", encoding="utf-8") as logfile:
                await logfile.write(json.dumps(sanitized_entry, ensure_ascii=False))
                await logfile.write("\n")
        except Exception as log_exc:
            print(f"{Fore.YELLOW}[CLIENT LOG WARNING] Failed to write log file: {str(log_exc)}{reset}", file=sys.stderr, flush=True)

        # Skip Sentry for noise-level logs
        if level in ("debug", "info"):
            return Response(status_code=status.HTTP_204_NO_CONTENT)

        # Integration: Forward client log to Sentry as a message (retaining details)
        try:
            msg = f"[{ctx}] {level.upper()}: {summary}"
            if level in ("warning", "warn", "error", "critical", "fatal"):
                capture_custom_message(
                    message=msg,
                    level=level,
                    extra={
                        "browser": True,
                        "source": ctx,
                        "args": args,
                        "raw": sanitized_entry
                    }
                )
        except Exception as sentry_exc:
            print(f"{Fore.MAGENTA}[CLIENT LOG - SENTRY] Failed to forward log: {str(sentry_exc)}{reset}", file=sys.stderr, flush=True)

        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as e:
        print(f"{Fore.RED}[CLIENT LOG ERROR] Could not process incoming client log: {str(e)}{Style.RESET_ALL}", file=sys.stderr, flush=True)
        return Response(status_code=400)
