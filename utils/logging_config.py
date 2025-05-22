import logging
import sys
import os
import json
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

        trace_id = getattr(record, "trace_id", None)
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


def init_structured_logging():
    """
    Initializes structured JSON logging for the application.
    - Sets the root logger's level (default: INFO, configurable via LOG_LEVEL env var).
    - Clears existing handlers to avoid duplicate logs.
    - Adds a StreamHandler to output logs to sys.stdout.
    - Attaches ContextFilter and CustomJsonFormatter to the handler.
    """
    log_level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    log_level = getattr(logging, log_level_name, logging.INFO)

    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    # Clear any existing handlers
    if root_logger.hasHandlers():
        root_logger.handlers.clear()

    # Create a stream handler for stdout
    stream_handler = logging.StreamHandler(sys.stdout)

    # Add the context filter
    context_filter = ContextFilter()
    stream_handler.addFilter(context_filter)

    # Create and set the custom JSON formatter
    formatter = CustomJsonFormatter(
        "%(timestamp)s %(level)s %(name)s %(module)s %(funcName)s %(lineno)d %(message)s %(request_id)s %(trace_id)s"
    )
    stream_handler.setFormatter(formatter)

    # Add the handler to the root logger
    root_logger.addHandler(stream_handler)

    logging.info("Structured JSON logging initialized.")


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
