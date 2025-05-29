"""
routes/logs.py - Client log ingestion endpoint
Focused on receiving and routing logs, not processing
"""

import json
import logging
from typing import Optional, List
from fastapi import APIRouter, Request, Response, status, Depends
from pydantic import BaseModel, Field
import sentry_sdk

from utils.auth_utils import get_current_user
from utils.logging_config import request_id_var, trace_id_var
from models.user import User
from services.client_log_service import ClientLogService

logger = logging.getLogger(__name__)
router = APIRouter()

class ClientLogEntry(BaseModel):
    """Single log entry from client"""
    timestamp: str
    level: str = "info"
    message: str
    context: str = "client"
    sessionId: Optional[str] = Field(None, alias="sessionId")
    traceId: Optional[str] = Field(None, alias="traceId")
    data: Optional[dict] = None
    metadata: Optional[dict] = None

class ClientLogBatch(BaseModel):
    """Batch of client logs"""
    logs: List[ClientLogEntry]

async def get_current_user_optional(request: Request) -> Optional[User]:
    """Optional auth - returns None if not authenticated"""
    try:
        return await get_current_user(request)
    except Exception:
        return None

@router.post("/api/logs", status_code=status.HTTP_204_NO_CONTENT)
async def receive_logs(
    request: Request,
    log_service: ClientLogService = Depends(),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    """
    Receive client logs and delegate to service for processing.
    Always returns 204 to avoid client retries.
    """
    try:
        payload = await request.json()

        # Parse batch or single log
        if isinstance(payload, dict) and "logs" in payload:
            batch = ClientLogBatch(**payload)
            entries = batch.logs
        else:
            entry = ClientLogEntry(**payload)
            entries = [entry]

        # Add request context
        request_context = {
            "request_id": request_id_var.get(),
            "trace_id": trace_id_var.get(),
            "user_id": current_user.id if current_user else None,
            "client_ip": request.client.host if request.client else None,
        }

        # Delegate to service
        await log_service.process_client_logs(entries, request_context)

    except Exception as e:
        # Log but don't fail the request
        logger.error(
            "Failed to process client logs",
            exc_info=True,
            extra={"request_id": request_id_var.get()}
        )

    # Always return 204 to prevent client retries
    return Response(status_code=status.HTTP_204_NO_CONTENT)
