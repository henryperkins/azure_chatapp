import logging
import sys
import os
from contextvars import ContextVar
from python_json_logger import jsonlogger

# ContextVars for request_id and trace_id
request_id_var: ContextVar[str] = ContextVar("request_id", default=None)
trace_id_var: ContextVar[str] = ContextVar("trace_id", default=None)

class ContextFilter(logging.Filter):
    """
    A logging filter to add request_id and trace_id from contextvars to log records.
    """
    def filter(self, record):
        record.request_id = request_id_var.get()
        record.trace_id = trace_id_var.get()
        return True

class CustomJsonFormatter(jsonlogger.JsonFormatter):
    """
    A custom JSON formatter to structure log records.
    Ensures standard fields like timestamp, level, message, request_id, trace_id,
    and any fields passed in `extra` are present.
    """
    def add_fields(self, log_record, record, message_dict):
        super(CustomJsonFormatter, self).add_fields(log_record, record, message_dict)
        if not log_record.get('timestamp'):
            log_record['timestamp'] = record.created
        if not log_record.get('level'):
            log_record['level'] = record.levelname
        if not log_record.get('message'):
            log_record['message'] = record.getMessage()

        # Ensure contextvars are included if available
        if hasattr(record, 'request_id') and record.request_id:
            log_record['request_id'] = record.request_id
        if hasattr(record, 'trace_id') and record.trace_id:
            log_record['trace_id'] = record.trace_id

        # Add any extra fields
        for key, value in record.__dict__.get('extra', {}).items():
            log_record[key] = value

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
        '%(timestamp)s %(level)s %(name)s %(module)s %(funcName)s %(lineno)d %(message)s %(request_id)s %(trace_id)s'
    )
    stream_handler.setFormatter(formatter)

    # Add the handler to the root logger
    root_logger.addHandler(stream_handler)

    logging.info("Structured JSON logging initialized.")


if __name__ == '__main__':
    # Example usage (for testing this module directly)
    init_structured_logging()

    # Simulate setting context vars (in a real app, middleware would do this)
    req_id_token = request_id_var.set("test-req-123")
    tr_id_token = trace_id_var.set("test-trace-abc")

    logger = logging.getLogger("my_app_test")
    logger.info("This is an info message.")
    logger.warning("This is a warning message.", extra={"user_id": "user_xyz", "action": "login"})
    try:
        1 / 0
    except ZeroDivisionError:
        logger.error("A division by zero occurred.", exc_info=True)

    # Reset context vars
    request_id_var.reset(req_id_token)
    trace_id_var.reset(tr_id_token)
