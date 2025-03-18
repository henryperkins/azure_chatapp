"""
project_schemas.py
------------------
Contains Pydantic models related to projects, used by FastAPI routes and services.
"""

from typing import Optional, List
from uuid import UUID
from pydantic import BaseModel, Field
from datetime import datetime

# region Project Models

class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    goals: Optional[str] = Field(None, max_length=1000)
    description: Optional[str] = Field(None, max_length=2000)
    custom_instructions: Optional[str] = Field(None, max_length=5000)
    max_tokens: int = Field(
        default=200000,
        ge=50000,
        le=500000
    )


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    goals: Optional[str] = Field(None, max_length=1000)
    custom_instructions: Optional[str] = Field(None, max_length=5000)
    is_default: Optional[bool]
    pinned: Optional[bool]
    archived: Optional[bool]
    extra_data: Optional[dict]
    max_tokens: Optional[int] = Field(
        default=None,
        ge=50000,
        le=500000
    )


class ProjectResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    goals: Optional[str]
    custom_instructions: Optional[str] = None
    is_default: bool
    pinned: bool
    archived: bool
    token_usage: int
    max_tokens: int
    version: int
    knowledge_base_id: Optional[UUID] = None
    extra_data: Optional[dict] = None
    created_at: datetime
    updated_at: datetime
    user_id: int

    class Config:
        from_attributes = True

# endregion
