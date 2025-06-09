"""schemas/common.py
====================
Shared response and helper models used across multiple API endpoints.

Only lightweight, dependency-free `pydantic.BaseModel` subclasses should live
here so import cycles are avoided.  Feature-specific response/request models
belong in their dedicated `schemas/<feature>_schemas.py` module.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field


class StandardResponse(BaseModel):
    """A minimal envelope for endpoints that simply return *status* + *message*."""

    status: Literal["success", "error"] = Field(..., description="Result status")
    message: Optional[str] = Field(None, description="Human-readable summary")


class HealthStatus(BaseModel):
    """Health/ready-check response shared by `/health` and service-level probes."""

    status: Literal["healthy", "degraded", "down"]
    db_available: bool
    environment: str
    app_name: str
    version: str
