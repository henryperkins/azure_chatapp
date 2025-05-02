"""
log_notification.py
-------------------
Route for recording frontend notifications to a server-side text file.
"""

from fastapi import APIRouter, Request, status
from pydantic import BaseModel, Field
from datetime import datetime
import os

router = APIRouter()

NOTIFICATION_LOG = "notifications.txt"  # Uses project root for the log file

class NotificationLogSchema(BaseModel):
    message: str = Field(..., max_length=4096)
    type: str = Field(default="info", max_length=50)
    timestamp: float | None = None  # Unix timestamp (optional)
    user: str = Field(default="unknown", max_length=256)  # (optional) if passed from app

@router.post("/api/log_notification", status_code=status.HTTP_201_CREATED)
async def log_notification(entry: NotificationLogSchema, request: Request):
    # Format timestamp
    dt_str = (
        datetime.utcfromtimestamp(entry.timestamp).isoformat() + "Z"
        if entry.timestamp
        else datetime.utcnow().isoformat() + "Z"
    )
    user = entry.user if entry.user else "unknown"
    clean_type = entry.type or "info"
    logline = f"{dt_str} [{clean_type.upper()}] user={user} {entry.message.strip()}\n"
    try:
        # Open in append mode, create if missing
        with open(NOTIFICATION_LOG, "a", encoding="utf-8") as f:
            f.write(logline)
    except Exception as e:
        return {"status": "error", "detail": f"Failed to write notification log: {str(e)}"}
    return {"status": "ok"}
