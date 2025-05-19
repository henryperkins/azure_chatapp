```python
from fastapi import APIRouter, Request, Response, status
import sys
import json
from utils.sentry_utils import capture_custom_message

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
async def receive_logs(request: Request):
    try:
        log_entry = await request.json()
        level = str(log_entry.get("level", "info")).lower()
        ctx = log_entry.get("context", "client")
        args = log_entry.get("args", [])
        summary = args[0] if args else ""
        color = get_color_for_level(level)
        reset = Style.RESET_ALL if hasattr(Style, "RESET_ALL") else ""

        # Output: colored header, Route-style log (single line, all context and summary)
        # Example: [CLIENT LOG] [App] [LOG] [DIAGNOSTIC][auth.js][fetchCSRFToken] Fetching /api/auth/csrf?ts=...
        main_args = ' '.join(str(a) for a in args)
        print(
            f"{color}[CLIENT LOG] [{ctx}] [{level.upper()}] {main_args}{reset}",
            file=sys.stdout, flush=True
        )

        # Pretty-print to log file in addition to console (append mode)
        try:
            with open("client_logs.jsonl", "a", encoding="utf-8") as logfile:
                logfile.write(json.dumps(log_entry, ensure_ascii=False, indent=2))
                logfile.write("\n")
        except Exception as log_exc:
            print(f"{Fore.YELLOW}[CLIENT LOG WARNING] Failed to write log file: {str(log_exc)}{reset}", file=sys.stderr, flush=True)

        # Integration: Forward client log to Sentry as a message (retaining details)
        try:
            msg = f"[{ctx}] {level.upper()}: {summary}"
            if level == "fatal":
                capture_custom_message(
                    message=msg,
                    level="fatal",
                    extra={
                        "browser": True,
                        "source": ctx,
                        "args": args,
                        "raw": log_entry
                    }
                )
            elif level == "critical":
                capture_custom_message(
                    message=msg,
                    level="critical",
                    extra={
                        "browser": True,
                        "source": ctx,
                        "args": args,
                        "raw": log_entry
                    }
                )
            elif level == "error":
                capture_custom_message(
                    message=msg,
                    level="error",
                    extra={
                        "browser": True,
                        "source": ctx,
                        "args": args,
                        "raw": log_entry
                    }
                )
            elif level == "warning" or level == "warn":
                capture_custom_message(
                    message=msg,
                    level="warning",
                    extra={
                        "browser": True,
                        "source": ctx,
                        "args": args,
                        "raw": log_entry
                    }
                )
            elif level == "info":
                capture_custom_message(
                    message=msg,
                    level="info",
                    extra={
                        "browser": True,
                        "source": ctx,
                        "args": args,
                        "raw": log_entry
                    }
                )
            elif level == "debug":
                capture_custom_message(
                    message=msg,
                    level="debug",
                    extra={
                        "browser": True,
                        "source": ctx,
                        "args": args,
                        "raw": log_entry
                    }
                )
            else:
                capture_custom_message(
                    message=msg,
                    level="info",
                    extra={
                        "browser": True,
                        "source": ctx,
                        "args": args,
                        "raw": log_entry
                    }
                )
        except Exception as sentry_exc:
            print(f"{Fore.MAGENTA}[CLIENT LOG - SENTRY] Failed to forward log: {str(sentry_exc)}{reset}", file=sys.stderr, flush=True)

        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as e:
        print(f"{Fore.RED}[CLIENT LOG ERROR] Could not process incoming client log: {str(e)}{Style.RESET_ALL}", file=sys.stderr, flush=True)
        return Response(status_code=400)

```