"""
routes/log_notification.py - Enhanced with proper file locking, retries,
context-rich logging and Sentry mirroring
"""

import os
import time
import fcntl  # For file locking
import logging
from datetime import datetime
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Request, status, BackgroundTasks
from pydantic import BaseModel, Field, validator, Extra


# -------------------------------------------------------------------
# No-op stubs for Sentry utilities (always defined, suppress Pylint)
# -------------------------------------------------------------------
def capture_breadcrumb(*_args, **_kwargs) -> None:
    """No-op if Sentry not installed."""
    pass


def capture_custom_message(*_args, **_kwargs) -> None:
    """No-op if Sentry not installed."""
    pass


def extract_sentry_trace(_request) -> Dict[str, Any]:
    """No-op if Sentry not installed."""
    return {}


# -------------------------------------------------------------------
# Try to import real Sentry utilities, override stubs on success
# -------------------------------------------------------------------
HAS_SENTRY = False
try:
    from utils.sentry_utils import (
        capture_breadcrumb as _real_capture_breadcrumb,
        capture_custom_message as _real_capture_custom_message,
        extract_sentry_trace as _real_extract_sentry_trace,
    )

    capture_breadcrumb = _real_capture_breadcrumb
    capture_custom_message = _real_capture_custom_message
    extract_sentry_trace = _real_extract_sentry_trace
    HAS_SENTRY = True
except ImportError:
    # leave stubs in place
    pass

router = APIRouter()

# Configure logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("notification_system")

# Constants
NOTIFICATION_LOG = "notifications.txt"
MAX_LOG_SIZE = 10 * 1024 * 1024  # 10MB
MAX_LOGS = 5  # Number of rotated logs to keep


class NotificationLogItem(BaseModel, extra=Extra.allow):
    message: str = Field(..., max_length=4096)
    type: str = Field(default="info", max_length=50)
    timestamp: Optional[float] = None
    user: str = Field(default="unknown", max_length=256)
    group: Optional[bool] = None
    context: Optional[str] = None
    module: Optional[str] = None
    source: Optional[str] = None
    id: Optional[str] = None
    groupKey: Optional[str] = None
    traceId: Optional[str] = None
    transactionId: Optional[str] = None
    extra: Optional[Dict[str, Any]] = None

    @validator("type")
    @classmethod
    def validate_type(cls, v):
        valid_types = ["info", "warning", "error", "success"]
        if isinstance(v, str) and v.lower() in valid_types:
            return v.lower()
        return "info"


class NotificationLogBatch(BaseModel):
    notifications: List[NotificationLogItem]


def check_rotate_logs():
    """Rotate the log if it exceeds MAX_LOG_SIZE, keeping up to MAX_LOGS copies."""
    try:
        if not os.path.exists(NOTIFICATION_LOG):
            return

        if os.path.getsize(NOTIFICATION_LOG) > MAX_LOG_SIZE:
            # Shift old logs up by one index
            for i in range(MAX_LOGS - 1, -1, -1):
                src = f"{NOTIFICATION_LOG}" if i == 0 else f"{NOTIFICATION_LOG}.{i}"
                dst = f"{NOTIFICATION_LOG}.{i+1}"
                if os.path.exists(src):
                    if os.path.exists(dst):
                        os.remove(dst)
                    os.rename(src, dst)
            # Start fresh
            with open(NOTIFICATION_LOG, "w", encoding="utf-8") as f:
                f.write(f"# Log rotated at {datetime.now().isoformat()}\n")
    except Exception as e:
        logger.error(f"Error rotating logs: {e}")


def write_log_entries(entries: List[NotificationLogItem], retries: int = 2) -> bool:
    """
    Append structured notification lines to disk with file locking,
    retry on failure, and mirror to Sentry if available.
    """
    for attempt in range(retries + 1):
        try:
            check_rotate_logs()
            log_lines = []

            for entry in entries:
                dt = entry.timestamp or time.time()
                dt_str = datetime.utcfromtimestamp(dt).isoformat() + "Z"
                user = entry.user or "unknown"
                clean_type = (entry.type or "info").lower()
                ctx_parts = []

                for attr in (
                    "id",
                    "groupKey",
                    "traceId",
                    "transactionId",
                    "group",
                    "context",
                    "module",
                    "source",
                ):
                    val = getattr(entry, attr, None)
                    if val is not None:
                        ctx_parts.append(f"{attr}={val}")

                ctx_str = f" ({', '.join(ctx_parts)})" if ctx_parts else ""
                log_lines.append(
                    f"{dt_str} [{clean_type.upper()}] user={user}{ctx_str} {entry.message.strip()}"
                )

                if HAS_SENTRY:
                    try:
                        capture_breadcrumb(
                            category="notification",
                            message=entry.message,
                            level=clean_type,
                            data=entry.dict(exclude_none=True),
                        )
                        if clean_type in ("error", "warning"):
                            capture_custom_message(
                                entry.message,
                                clean_type,
                                extra=entry.dict(exclude_none=True),
                            )
                    except Exception as sentry_exc:
                        logger.error(f"Failed to send to Sentry: {sentry_exc}")

            with open(NOTIFICATION_LOG, "a", encoding="utf-8") as f:
                fcntl.flock(f, fcntl.LOCK_EX)
                try:
                    f.write("\n".join(log_lines) + "\n")
                    f.flush()
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)

            return True

        except Exception as e:
            if attempt < retries:
                time.sleep(0.5 * (2**attempt))
                continue
            logger.error(
                f"Failed to write notification logs (attempt {attempt+1}): {e}"
            )
            return False


@router.post("/api/log_notification", status_code=status.HTTP_201_CREATED)
async def log_notification(
    entry: NotificationLogItem,
    background_tasks: BackgroundTasks,
    request: Request,
):
    """Log a single notification entry; context-rich, Sentry-mirrored."""
    if HAS_SENTRY:
        try:
            trace_headers = extract_sentry_trace(request)
            if trace_headers.get("sentry-trace"):
                entry.traceId = trace_headers["sentry-trace"]
        except Exception:
            pass

    background_tasks.add_task(write_log_entries, [entry])
    return {"status": "ok"}


@router.post("/api/log_notification_batch", status_code=status.HTTP_201_CREATED)
async def log_notification_batch(
    batch: NotificationLogBatch,
    background_tasks: BackgroundTasks,
):
    """Log multiple notifications in a single batch."""
    if not batch.notifications:
        return {"status": "ok", "message": "No notifications to log"}

    background_tasks.add_task(write_log_entries, batch.notifications)
    return {"status": "ok", "count": len(batch.notifications)}
