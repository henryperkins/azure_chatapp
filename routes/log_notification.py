"""
routes/log_notification.py - DEPRECATED: Client no longer sends logs here.
"""

import logging

logger = logging.getLogger("notification_system")
logger.warning("log_notification routes are deprecated; client no longer sends logs")

# The log_notification API routes are now disabled.
# @router.post("/api/log_notification", status_code=status.HTTP_201_CREATED)
# async def log_notification(...):
#     pass

# @router.post("/api/log_notification_batch", status_code=status.HTTP_201_CREATED)
# async def log_notification_batch(...):
#     pass

# def write_log_entries(...):
#     pass
