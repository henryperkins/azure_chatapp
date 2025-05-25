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
        # Add attributes dynamically to the LogRecord object
        setattr(record, "request_id", request_id_var.get())
        setattr(record, "trace_id", trace_id_var.get())
        return True


class RateLimitingFilter(logging.Filter):
    """
    Rate limiting filter to prevent log storms by limiting identical messages.
    Allows up to LOG_DUP_MAX identical messages per minute (default: 50).
    """

    _cache: Dict[tuple[str, str], tuple[int, float]] = (
        {}
    )  # (name,msg) ➜ (count, first_ts)

    def filter(self, record: logging.LogRecord) -> bool:
        key = (record.name, record.getMessage())
        cnt, first_ts = self._cache.get(key, (0, record.created))
        if record.created - first_ts > 60:  # new window
            cnt, first_ts = 0, record.created
        cnt += 1
        self._cache[key] = (cnt, first_ts)
        return cnt <= int(os.getenv("LOG_DUP_MAX", "50"))


class SensitiveDataFilter(logging.Filter):
    """
    Enhanced PII protection filter that redacts sensitive information from log messages.
    """

    # Patterns for sensitive data detection
    SENSITIVE_PATTERNS = [
        (
            re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"),
            "[EMAIL_REDACTED]",
        ),  # Email
        (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[SSN_REDACTED]"),  # SSN
        (
            re.compile(r"\bBearer\s+[A-Za-z0-9\-._~+/]+=*", re.IGNORECASE),
            "Bearer [TOKEN_REDACTED]",
        ),  # Bearer tokens
        (
            re.compile(r"\b[A-Za-z0-9]{32,}\b"),
            "[TOKEN_REDACTED]",
        ),  # Generic long tokens
        (
            re.compile(r'password["\s]*[:=]["\s]*[^"\s,}]+', re.IGNORECASE),
            'password="[REDACTED]"',
        ),  # Passwords
        (
            re.compile(r'api[_-]?key["\s]*[:=]["\s]*[^"\s,}]+', re.IGNORECASE),
            'api_key="[REDACTED]"',
        ),  # API keys
    ]

    def filter(self, record: logging.LogRecord) -> bool:
        # Redact sensitive data from the message
        if hasattr(record, "msg") and isinstance(record.msg, str):
            for pattern, replacement in self.SENSITIVE_PATTERNS:
                record.msg = pattern.sub(replacement, record.msg)

        # Also check args if they exist
        if hasattr(record, "args") and record.args:
            cleaned_args = []
            for arg in record.args:
                if isinstance(arg, str):
                    for pattern, replacement in self.SENSITIVE_PATTERNS:
                        arg = pattern.sub(replacement, arg)
                cleaned_args.append(arg)
            record.args = tuple(cleaned_args)

        return True


class CustomJsonFormatter(logging.Formatter):
    """
    A custom JSON formatter to structure log records.
    Ensures standard fields like timestamp, level, message, request_id, trace_id,
    and any fields passed in `extra` are present.
    """

    def format(self, record: logging.LogRecord) -> str:
        log_record: Dict[str, Any] = {}

        # Add basic fields
        log_record["timestamp"] = self.formatTime(record, self.datefmt)
        log_record["level"] = record.levelname
        log_record["message"] = record.getMessage()

        # Add logger name, module, and line info
        log_record["name"] = record.name
        log_record["module"] = record.module
        log_record["funcName"] = record.funcName
        log_record["lineno"] = record.lineno

        # Ensure contextvars are included if available - use getattr with default to avoid type checking issues
        request_id = getattr(record, "request_id", None)
        if request_id:
            log_record["request_id"] = request_id

        trace_id = getattr(record, "trace_id", None) or record.__dict__.get("trace_id")
        if trace_id:
            log_record["trace_id"] = trace_id

        # Preserve attributes supplied via logging extra={...}
        for key, value in record.__dict__.items():
            if key not in (
                "name",
                "msg",
                "args",
                "levelname",
                "levelno",
                "pathname",
                "filename",
                "module",
                "exc_info",
                "exc_text",
                "stack_info",
                "lineno",
                "funcName",
                "created",
                "msecs",
                "relativeCreated",
                "thread",
                "threadName",
                "processName",
                "process",
                "timestamp",
                "level",
                "message",
                "request_id",
                "trace_id",
            ):
                log_record[key] = value

        # Add exception info if present
        if record.exc_info:
            log_record["exc_info"] = self.formatException(record.exc_info)

        return json.dumps(log_record)

# ─── NEW: human-readable, colourised console formatter ────────────────
try:
    from colorama import init as _c_init, Fore, Style     # optional
    _c_init()                                             # safe if re-called
except ImportError:                                       # graceful fallback
    class _Dummy: RESET_ALL = ""
    class Fore:  RED=YELLOW=CYAN=GREEN=MAGENTA=RESET=""   # type: ignore
    class Style: BRIGHT=NORMAL=DIM=""                     # type: ignore

class ColoredTextFormatter(logging.Formatter):
    _LEVEL_COLOURS = {
        logging.DEBUG   : Fore.CYAN,
        logging.INFO    : Fore.GREEN,
        logging.WARNING : Fore.YELLOW + Style.BRIGHT,
        logging.ERROR   : Fore.RED + Style.BRIGHT,
        logging.CRITICAL: Fore.MAGENTA + Style.BRIGHT,
    }
    RESET = Style.RESET_ALL if hasattr(Style, "RESET_ALL") else ""

    def format(self, record: logging.LogRecord) -> str:
        ts   = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(record.created))
        lvl  = record.levelname
        colour = self._LEVEL_COLOURS.get(record.levelno, "")
        msg  = record.getMessage()
        rid  = getattr(record, "request_id", "") or ""
        tid  = getattr(record, "trace_id",   "") or ""
        parts = [ts, f"{colour}{lvl}{self.RESET}", record.name + ":", msg]
        if rid: parts.append(f"req={rid}")
        if tid: parts.append(f"trace={tid}")
        return " ".join(parts)


def _cycle_level(root: logging.Logger) -> None:
    """
    Cycle through log levels: INFO → DEBUG → WARNING → INFO
    Triggered by SIGUSR2 signal for runtime log level adjustment.
    """
    seq = [logging.INFO, logging.DEBUG, logging.WARNING]
    current_idx = seq.index(root.level) if root.level in seq else 0
    next_level = seq[(current_idx + 1) % len(seq)]
    root.setLevel(next_level)
    logging.getLogger(__name__).warning(
        "🔄 log level changed → %s", logging.getLevelName(next_level)
    )


def setup_audit_logger() -> logging.Logger:
    """
    Set up a dedicated audit logger that always writes to disk AND Sentry,
    independent of root logger level.
    """
    audit_logger = logging.getLogger("audit")
    audit_logger.setLevel(logging.INFO)

    # Prevent propagation to root logger to avoid duplicates
    audit_logger.propagate = False

    # File handler for audit logs
    audit_file = os.getenv("AUDIT_LOG_FILE", "audit.log")
    try:
        file_handler = logging.FileHandler(audit_file)
        file_handler.setLevel(logging.INFO)
        file_handler.setFormatter(CustomJsonFormatter())
        audit_logger.addHandler(file_handler)
    except (OSError, PermissionError) as e:
        # Fallback to stdout if file creation fails
        logging.warning(f"Could not create audit log file {audit_file}: {e}")
        stdout_handler = logging.StreamHandler(sys.stdout)
        stdout_handler.setLevel(logging.INFO)
        stdout_handler.setFormatter(CustomJsonFormatter())
        audit_logger.addHandler(stdout_handler)

    return audit_logger


def init_structured_logging():
    """
    Initializes structured JSON logging for the application.
    - Sets the root logger's level (default: INFO, configurable via LOG_LEVEL env var).
    - Clears existing handlers to avoid duplicate logs.
    - Adds a StreamHandler to output logs to sys.stdout.
    - Attaches ContextFilter, RateLimitingFilter, SensitiveDataFilter and CustomJsonFormatter.
    - Sets up SIGUSR2 signal handler for runtime log level cycling.
    """
    log_level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    log_level = getattr(logging, log_level_name, logging.INFO)

    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    # Clear any existing handlers
    if root_logger.hasHandlers():
        root_logger.handlers.clear()

    # Add all filters in order
    context_filter = ContextFilter()
    rate_limiting_filter = RateLimitingFilter()
    sensitive_data_filter = SensitiveDataFilter()

    # 2️⃣ CONSOLE handler → coloured text
    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.addFilter(context_filter)
    stream_handler.addFilter(rate_limiting_filter)
    stream_handler.addFilter(sensitive_data_filter)
    stream_handler.setFormatter(ColoredTextFormatter())
    root_logger.addHandler(stream_handler)

    # 3️⃣ FILE handler (optional) → JSON
    log_file = os.getenv("LOG_FILE")
    if log_file:
        from logging.handlers import RotatingFileHandler
        fh = RotatingFileHandler(log_file, maxBytes=10*1024*1024, backupCount=3)
        fh.setFormatter(CustomJsonFormatter(
            "%(timestamp)s %(level)s %(name)s %(module)s %(funcName)s %(lineno)d %(message)s %(request_id)s %(trace_id)s"
        ))
        fh.addFilter(context_filter)
        fh.addFilter(rate_limiting_filter)
        fh.addFilter(sensitive_data_filter)
        root_logger.addHandler(fh)

    # Set up signal handler for runtime log level cycling (SIGUSR2)
    try:
        signal.signal(signal.SIGUSR2, lambda *_: _cycle_level(root_logger))
        logging.info("SIGUSR2 signal handler registered for log level cycling")
    except (AttributeError, OSError):
        # SIGUSR2 might not be available on all platforms (e.g., Windows)
        logging.info("SIGUSR2 signal not available, log level cycling disabled")

    # Set up audit logger
    setup_audit_logger()

    logging.info(
        "Structured JSON logging initialized with enhanced filters and signal handling."
    )


if __name__ == "__main__":
    # Example usage (for testing this module directly)
    init_structured_logging()

    # Simulate setting context vars (in a real app, middleware would do this)
    req_id_token = request_id_var.set("test-req-123")
    tr_id_token = trace_id_var.set("test-trace-abc")

    logger = logging.getLogger("my_app_test")
    logger.info("This is an info message.")
    logger.warning(
        "This is a warning message.", extra={"user_id": "user_xyz", "action": "login"}
    )
    try:
        1 / 0
    except ZeroDivisionError:
        logger.error("A division by zero occurred.", exc_info=True)

    # Reset context vars
    request_id_var.reset(req_id_token)
    trace_id_var.reset(tr_id_token)
