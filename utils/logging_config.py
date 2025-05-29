import logging
import sys
import os
import json
import signal
import time
import re
from contextvars import ContextVar
from typing import Optional, Any, Dict

# ContextVars for request_id and trace_id
request_id_var: ContextVar[Optional[str]] = ContextVar("request_id", default=None)
trace_id_var: ContextVar[Optional[str]] = ContextVar("trace_id", default=None)


class ContextFilter(logging.Filter):
    """
    A logging filter to add request_id and trace_id from contextvars to log records.
    """
    def filter(self, record: logging.LogRecord) -> bool:
        setattr(record, "request_id", request_id_var.get())
        setattr(record, "trace_id", trace_id_var.get())
        return True


class RateLimitingFilter(logging.Filter):
    """
    Rate limiting filter to prevent log storms by limiting identical messages.
    Allows up to LOG_DUP_MAX identical messages per minute (default: 50).
    """
    _cache: Dict[tuple[str, str], tuple[int, float]] = {}

    def filter(self, record: logging.LogRecord) -> bool:
        key = (record.name, record.getMessage())
        cnt, first_ts = self._cache.get(key, (0, record.created))
        # reset window
        if record.created - first_ts > 60:
            cnt, first_ts = 0, record.created
        cnt += 1
        self._cache[key] = (cnt, first_ts)
        return cnt <= int(os.getenv("LOG_DUP_MAX", "50"))


class SensitiveDataFilter(logging.Filter):
    """
    Enhanced PII protection filter that redacts sensitive information from log messages.
    """
    SENSITIVE_PATTERNS = [
        (re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"), "[EMAIL_REDACTED]"),
        (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[SSN_REDACTED]"),
        (re.compile(r"\bBearer\s+[A-Za-z0-9\-._~+/]+=*", re.IGNORECASE), "Bearer [TOKEN_REDACTED]"),
        (re.compile(r"\b[A-Za-z0-9]{32,}\b"), "[TOKEN_REDACTED]"),
        (re.compile(r'password["\s]*[:=]["\s]*[^"\s,}]+', re.IGNORECASE), 'password="[REDACTED]"'),
        (re.compile(r'api[_-]?key["\s]*[:=]["\s]*[^"\s,}]+', re.IGNORECASE), 'api_key="[REDACTED]"'),
    ]

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            for pattern, repl in self.SENSITIVE_PATTERNS:
                record.msg = pattern.sub(repl, record.msg)

        if record.args:
            cleaned = []
            for arg in record.args:
                if isinstance(arg, str):
                    for pattern, repl in self.SENSITIVE_PATTERNS:
                        arg = pattern.sub(repl, arg)
                cleaned.append(arg)
            record.args = tuple(cleaned)

        return True


# ---------------------------------------------------------------------------
# Noise-suppression filter for verbose auth-token checks
#   • Filters out INFO/WARNING spam such as
#       "Attempting to extract access token from request"
#       "Access token not found in request"
# ---------------------------------------------------------------------------
class AuthNoiseFilter(logging.Filter):
    SUPPRESS_PATTERNS = (
        "Attempting to extract access token from request",
        "Access token not found in request",
    )

    def filter(self, record: logging.LogRecord) -> bool:
        # Only suppress low-signal INFO/WARNING messages
        if record.levelno > logging.INFO:
            return True

        msg = str(record.getMessage())
        return not any(pat in msg for pat in self.SUPPRESS_PATTERNS)


class CustomJsonFormatter(logging.Formatter):
    """
    A custom JSON formatter to structure log records.
    """
    def format(self, record: logging.LogRecord) -> str:
        log_record: Dict[str, Any] = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "message": record.getMessage(),
            "name": record.name,
            "module": record.module,
            "funcName": record.funcName,
            "lineno": record.lineno,
        }

        # Include context IDs if present
        req_id = getattr(record, "request_id", None)
        if req_id:
            log_record["request_id"] = req_id
        tr_id = getattr(record, "trace_id", None) or record.__dict__.get("trace_id")
        if tr_id:
            log_record["trace_id"] = tr_id

        # Preserve any extra fields
        for key, val in record.__dict__.items():
            if key not in {
                "name", "msg", "args", "levelname", "levelno", "pathname",
                "filename", "module", "exc_info", "exc_text", "stack_info",
                "lineno", "funcName", "created", "msecs", "relativeCreated",
                "thread", "threadName", "processName", "process",
                "timestamp", "level", "message", "request_id", "trace_id"
            }:
                log_record[key] = val

        if record.exc_info:
            log_record["exc_info"] = self.formatException(record.exc_info)

        return json.dumps(log_record)


# ─── human-readable, colourised console formatter ────────────────
try:
    from colorama import init as _c_init, Fore, Style
    _c_init()
except ImportError:
    class Fore:
        RED = YELLOW = CYAN = GREEN = MAGENTA = RESET = ""

    class Style:
        BRIGHT = NORMAL = DIM = RESET_ALL = ""


class ColoredTextFormatter(logging.Formatter):
    _LEVEL_COLOURS = {
        logging.DEBUG: Fore.CYAN,
        logging.INFO: Fore.GREEN,
        logging.WARNING: Fore.YELLOW + Style.BRIGHT,
        logging.ERROR: Fore.RED + Style.BRIGHT,
        logging.CRITICAL: Fore.MAGENTA + Style.BRIGHT,
    }
    RESET = Style.RESET_ALL if hasattr(Style, "RESET_ALL") else ""

    def format(self, record: logging.LogRecord) -> str:
        ts = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(record.created))
        lvl = record.levelname
        colour = self._LEVEL_COLOURS.get(record.levelno, "")
        msg = record.getMessage()
        rid = getattr(record, "request_id", "") or ""
        tid = getattr(record, "trace_id", "") or ""
        parts = [ts, f"{colour}{lvl}{self.RESET}", f"{record.name}:", msg]
        if rid:
            parts.append(f"req={rid}")
        if tid:
            parts.append(f"trace={tid}")
        return " ".join(parts)


def _cycle_level(root: logging.Logger) -> None:
    """
    Cycle through log levels: INFO → DEBUG → WARNING → INFO
    """
    seq = [logging.INFO, logging.DEBUG, logging.WARNING]
    idx = seq.index(root.level) if root.level in seq else 0
    next_lvl = seq[(idx + 1) % len(seq)]
    root.setLevel(next_lvl)
    logging.getLogger(__name__).warning(
        "🔄 log level changed → %s", logging.getLevelName(next_lvl)
    )


def setup_audit_logger() -> logging.Logger:
    """
    Set up a dedicated audit logger that writes to disk (or stdout on failure).
    """
    audit_logger = logging.getLogger("audit")
    audit_logger.setLevel(logging.INFO)
    audit_logger.propagate = False

    audit_file = os.getenv("AUDIT_LOG_FILE", "audit.log")
    try:
        handler = logging.FileHandler(audit_file)
        handler.setLevel(logging.INFO)
        handler.setFormatter(CustomJsonFormatter())
        audit_logger.addHandler(handler)
    except (OSError, PermissionError) as e:
        logging.warning(f"Could not create audit log file {audit_file}: {e}")
        fallback = logging.StreamHandler(sys.stdout)
        fallback.setLevel(logging.INFO)
        fallback.setFormatter(CustomJsonFormatter())
        audit_logger.addHandler(fallback)

    return audit_logger


def init_structured_logging() -> None:
    """
    Initialize structured JSON + colored logging with context, rate limits, PII filters,
    and SIGUSR2-driven level cycling.
    """
    level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    root = logging.getLogger()
    root.setLevel(getattr(logging, level_name, logging.INFO))

    # Remove existing handlers
    if root.hasHandlers():
        root.handlers.clear()

    # Common filters
    ctx_filter = ContextFilter()
    rate_filter = RateLimitingFilter()
    pii_filter = SensitiveDataFilter()
    auth_noise_filter = AuthNoiseFilter()

    # Console handler
    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(ColoredTextFormatter())
    ch.addFilter(ctx_filter)
    ch.addFilter(rate_filter)
    ch.addFilter(pii_filter)
    ch.addFilter(auth_noise_filter)
    root.addHandler(ch)

    # Optional file handler
    log_file = os.getenv("LOG_FILE")
    if log_file:
        from logging.handlers import RotatingFileHandler
        fh = RotatingFileHandler(log_file, maxBytes=10 * 1024 * 1024, backupCount=3)
        fh.setFormatter(CustomJsonFormatter(
            "%(timestamp)s %(level)s %(name)s %(module)s %(funcName)s %(lineno)d %(message)s %(request_id)s %(trace_id)s"
        ))
        fh.addFilter(ctx_filter)
        fh.addFilter(rate_filter)
        fh.addFilter(pii_filter)
        fh.addFilter(auth_noise_filter)
        root.addHandler(fh)

    # SIGUSR2 for live level cycling
    try:
        signal.signal(signal.SIGUSR2, lambda *_: _cycle_level(root))
        logging.info("SIGUSR2 handler registered for log level cycling")
    except (AttributeError, OSError):
        logging.info("SIGUSR2 not available on this platform")

    # Always-on audit logger
    setup_audit_logger()

    # Attach noise filter specifically to utils.auth_utils
    logging.getLogger("utils.auth_utils").addFilter(auth_noise_filter)

    # Attach AuthNoiseFilter to common Uvicorn loggers to suppress auth token spam
    for lg_name in ("uvicorn.access", "uvicorn.error", ""):       # root as ""  
        lg = logging.getLogger(lg_name)
        if not any(isinstance(f, AuthNoiseFilter) for f in lg.filters):
            lg.addFilter(auth_noise_filter)

    logging.info("Structured logging initialized.")


if __name__ == "__main__":
    init_structured_logging()

    # Example context
    req_tok = request_id_var.set("test-req-123")
    tr_tok = trace_id_var.set("test-trace-abc")

    logger = logging.getLogger("my_app_test")
    logger.info("This is an info message.")
    logger.warning("This is a warning message.", extra={"user_id": "user_xyz", "action": "login"})
    try:
        1 / 0
    except ZeroDivisionError:
        logger.error("A division by zero occurred.", exc_info=True)

    # Reset context
    request_id_var.reset(req_tok)
    trace_id_var.reset(tr_tok)
