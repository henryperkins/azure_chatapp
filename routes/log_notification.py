"""
log_notification.py - Enhanced with proper file locking and retries
"""

from fastapi import APIRouter, Request, status, BackgroundTasks
from pydantic import BaseModel, Field, validator
from datetime import datetime
import os
import logging
from typing import List, Optional
import time
import fcntl  # For file locking

router = APIRouter()

# Configure logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("notification_system")

# Constants
NOTIFICATION_LOG = "notifications.txt"
MAX_LOG_SIZE = 10 * 1024 * 1024  # 10MB
MAX_LOGS = 5  # Number of rotated logs to keep

class NotificationLogItem(BaseModel):
    message: str = Field(..., max_length=4096)
    type: str = Field(default="info", max_length=50)
    timestamp: Optional[float] = None
    user: str = Field(default="unknown", max_length=256)

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

        # Check file size
        if os.path.getsize(NOTIFICATION_LOG) > MAX_LOG_SIZE:
            # Rotate logs
            for i in range(MAX_LOGS - 1, 0, -1):
                src = f"{NOTIFICATION_LOG}.{i}" if i > 0 else NOTIFICATION_LOG
                dst = f"{NOTIFICATION_LOG}.{i+1}"

                if os.path.exists(src):
                    if os.path.exists(dst):
                        os.remove(dst)
                    os.rename(src, dst)

            # Create new empty log
            with open(NOTIFICATION_LOG, "w") as f:
                f.write(f"# Log rotated at {datetime.now().isoformat()}\n")
    except Exception as e:
        logger.error(f"Error rotating logs: {str(e)}")

def write_log_entries(entries, retries=2):
    """Write multiple log entries to the file with file locking and retries."""
    for attempt in range(retries + 1):
        try:
            check_rotate_logs()

            # Format log entries
            log_lines = []
            for entry in entries:
                dt_str = (
                    datetime.utcfromtimestamp(entry.timestamp).isoformat() + "Z"
                    if entry.timestamp
                    else datetime.utcnow().isoformat() + "Z"
                )
                user = entry.user if entry.user else "unknown"
                clean_type = entry.type or "info"
                log_lines.append(f"{dt_str} [{clean_type.upper()}] user={user} {entry.message.strip()}")

            # Use file locking to handle concurrent writes
            with open(NOTIFICATION_LOG, "a", encoding="utf-8") as f:
                fcntl.flock(f, fcntl.LOCK_EX)
                try:
                    f.write("\n".join(log_lines) + "\n")
                    f.flush()  # Ensure it's written to disk
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)

            return True
        except Exception as e:
            if attempt < retries:
                # Exponential backoff
                time.sleep(0.5 * (2 ** attempt))
                continue
            logger.error(f"Failed to write notification logs (attempt {attempt+1}): {str(e)}")
            return False

@router.post("/api/log_notification", status_code=status.HTTP_201_CREATED)
async def log_notification(entry: NotificationLogItem, background_tasks: BackgroundTasks):
    """Log a single notification entry."""
    background_tasks.add_task(write_log_entries, [entry])
    return {"status": "ok"}

@router.post("/api/log_notification_batch", status_code=status.HTTP_201_CREATED)
async def log_notification_batch(batch: NotificationLogBatch, background_tasks: BackgroundTasks):
    """Log multiple notifications in a single batch."""
    if not batch.notifications:
        return {"status": "ok", "message": "No notifications to log"}

    background_tasks.add_task(write_log_entries, batch.notifications)
    return {"status": "ok", "count": len(batch.notifications)}
