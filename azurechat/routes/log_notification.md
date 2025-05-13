```python
"""
routes/log_notification.py

Log notification events from the frontend and other clients.
Accepts notification payloads and ensures structured server-side logging and observability.

API endpoints:
  - POST /api/log_notification
  - POST /api/log_notification_batch
"""

import logging
from fastapi import APIRouter, Request, status, HTTPException
from fastapi.responses import JSONResponse

router = APIRouter()
logger = logging.getLogger("notification_system")

@router.post("/api/log_notification", status_code=status.HTTP_201_CREATED)
async def log_notification(request: Request):
    try:
        payload = await request.json()

        # Extract fields
        msg = payload.get("msg") or payload.get("message") or ""
        log_type = payload.get("type", "info")
        context = payload.get("context", "")
        module = payload.get("module", "")
        source = payload.get("source", "")
        trace_id = payload.get("traceId") or payload.get("sessionId")
        extra = payload.get("extra", {})

        # Create log entry
        log_entry = {
            "msg": msg,
            "type": log_type,
            "context": context,
            "module": module,
            "source": source,
            "traceId": trace_id,
            **({"extra": extra} if extra else {})
        }

        # Log with appropriate level
        log_level = {
            "debug": logging.DEBUG,
            "info": logging.INFO,
            "success": logging.INFO,
            "warning": logging.WARNING,
            "warn": logging.WARNING,
            "error": logging.ERROR
        }.get(log_type, logging.INFO)

        logger.log(log_level, f"[notif] {log_entry}")
        return JSONResponse(status_code=201, content={"status": "logged"})

    except Exception:
        logger.error("Failed to process log notification", exc_info=True)
        raise HTTPException(status_code=400, detail="Invalid request")

@router.post("/api/log_notification_batch", status_code=status.HTTP_201_CREATED)
async def log_notification_batch(request: Request):
    try:
        payload = await request.json()
        entries = payload.get("batch") or payload.get("entries") or []

        if not isinstance(entries, list):
            raise ValueError("batch must be a list")

        count = 0
        for entry in entries:
            # Extract fields
            msg = entry.get("msg") or entry.get("message") or ""
            log_type = entry.get("type", "info")
            context = entry.get("context", "")
            module = entry.get("module", "")
            source = entry.get("source", "")
            trace_id = entry.get("traceId") or entry.get("sessionId")
            extra = entry.get("extra", {})

            # Create log entry
            log_entry = {
                "msg": msg,
                "type": log_type,
                "context": context,
                "module": module,
                "source": source,
                "traceId": trace_id,
                **({"extra": extra} if extra else {})
            }

            # Log with appropriate level
            log_level = {
                "debug": logging.DEBUG,
                "info": logging.INFO,
                "success": logging.INFO,
                "warning": logging.WARNING,
                "warn": logging.WARNING,
                "error": logging.ERROR
            }.get(log_type, logging.INFO)

            logger.log(log_level, f"[notif-batch] {log_entry}")
            count += 1

        return JSONResponse(status_code=201, content={"status": "batch_logged", "count": count})

    except Exception:
        logger.error("Failed to process batch log notification", exc_info=True)
        raise HTTPException(status_code=400, detail="Invalid request")

def write_log_entries(entries):
    """Helper to log a list of entries, compatible with batch endpoint format."""
    count = 0
    for entry in entries:
        try:
            logger.info(f"[notify-batch-helper] {entry}")
            count += 1
        except Exception:
            logger.error("Failed to write log batch helper entry", exc_info=True)
    return count

```