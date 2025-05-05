"""
log_notification.py - Enhanced with proper file locking, retries, context-rich logging and Sentry mirroring
"""

from fastapi import APIRouter, Request, status, BackgroundTasks
from pydantic import BaseModel, Field, validator, Extra
from datetime import datetime
import os
import logging
from typing import List, Optional, Dict, Any
import time
import fcntl  # For file locking

try:
    from utils.sentry_utils import capture_breadcrumb, capture_custom_message, extract_sentry_trace
    HAS_SENTRY = True
except ImportError:
    HAS_SENTRY = False

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

    @validator('type')
    def validate_type(cls, v):
        valid_types = ['info', 'warning', 'error', 'success']
        if isinstance(v, str) and v.lower() in valid_types:
            return v.lower()
        return 'info'

class NotificationLogBatch(BaseModel):
    notifications: List[NotificationLogItem]

def check_rotate_logs():
    """Check if log file needs rotation and rotate if necessary."""
    try:
        if not os.path.exists(NOTIFICATION_LOG):
            return

        if os.path.getsize(NOTIFICATION_LOG) > MAX_LOG_SIZE:
            for i in range(MAX_LOGS - 1, 0, -1):
                src = f"{NOTIFICATION_LOG}.{i}" if i > 0 else NOTIFICATION_LOG
                dst = f"{NOTIFICATION_LOG}.{i+1}"
                if os.path.exists(src):
                    if os.path.exists(dst):
                        os.remove(dst)
                    os.rename(src, dst)
            with open(NOTIFICATION_LOG, "w") as f:
                f.write(f"# Log rotated at {datetime.now().isoformat()}\n")
    except Exception as e:
        logger.error(f"Error rotating logs: {str(e)}")

def write_log_entries(entries, retries=2):
    """Write multiple log entries to the file with file locking and retries, plus Sentry mirroring."""
    for attempt in range(retries + 1):
        try:
            check_rotate_logs()
            log_lines = []
            for entry in entries:
                dt_str = (
                    datetime.utcfromtimestamp(entry.timestamp).isoformat() + "Z"
                    if entry.timestamp
                    else datetime.utcnow().isoformat() + "Z"
                )
                user = entry.user if entry.user else "unknown"
                clean_type = entry.type or "info"
                log_ctx = []
                # New fields below are optional/canonical; use if present
                if getattr(entry, "id", None):
                    log_ctx.append(f"id={entry.id}")
                if getattr(entry, "groupKey", None):
                    log_ctx.append(f"groupKey={entry.groupKey}")
                if getattr(entry, "traceId", None):
                    log_ctx.append(f"traceId={entry.traceId}")
                if getattr(entry, "transactionId", None):
                    log_ctx.append(f"transactionId={entry.transactionId}")
                if getattr(entry, "group", None) is not None:
                    log_ctx.append(f"group={entry.group}")
                if getattr(entry, "context", None):
                    log_ctx.append(f"context={entry.context}")
                if getattr(entry, "module", None):
                    log_ctx.append(f"module={entry.module}")
                if getattr(entry, "source", None):
                    log_ctx.append(f"source={entry.source}")

                ctx_str = f" ({', '.join(log_ctx)})" if log_ctx else ""

                # Yield flat log for text, but context fields for analysis/reporting
                log_lines.append(
                    f"{dt_str} [{clean_type.upper()}] user={user}{ctx_str} {entry.message.strip()}"
                )

                # Sentry mirroring: capture notification as breadcrumb (all), as event (warn/error only)
                if HAS_SENTRY:
                    try:
                        capture_breadcrumb(
                            category="notification",
                            message=entry.message,
                            level=clean_type,
                            data=entry.dict(exclude_none=True)
                        )
                        # Only capture event for warnings/errors or severe notices
                        if clean_type in ("error", "warning"):
                            capture_custom_message(entry.message, clean_type, extra=entry.dict(exclude_none=True))
                    except Exception as sentry_exc:
                        logger.error(f"Failed to log breadcrumb/event to Sentry: {sentry_exc}")

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
                time.sleep(0.5 * (2 ** attempt))
                continue
            logger.error(f"Failed to write notification logs (attempt {attempt+1}): {str(e)}")
            return False

@router.post("/api/log_notification", status_code=status.HTTP_201_CREATED)
async def log_notification(entry: NotificationLogItem, background_tasks: BackgroundTasks, request: Request):
    """Log a single notification entry; context-rich, Sentry-mirrored."""
    # Extract distributed trace headers if present
    trace_headers = {}
    if HAS_SENTRY:
        try:
            trace_headers = extract_sentry_trace(request)
        except Exception:
            trace_headers = {}
    # Optionally inject sentry trace ids if not set
    if trace_headers.get("sentry-trace"):
        entry.traceId = trace_headers["sentry-trace"]

    background_tasks.add_task(write_log_entries, [entry])
    return {"status": "ok"}

@router.post("/api/log_notification_batch", status_code=status.HTTP_201_CREATED)
async def log_notification_batch(batch: NotificationLogBatch, background_tasks: BackgroundTasks):
    """Log multiple notifications in a single batch."""
    if not batch.notifications:
        return {"status": "ok", "message": "No notifications to log"}
    background_tasks.add_task(write_log_entries, batch.notifications)
    return {"status": "ok", "count": len(batch.notifications)}
