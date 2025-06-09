"""schemas/auth_schemas.py
=========================
Request/response models for the authentication subsystem.

These are extracted from the historical `auth.py` so they can be re-used by
`services/auth_service.py` and any future controllers without importing the
heavier auth router implementation (which also brings crypto libs, rate-limit
maps, etc.).
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, validator


# ---------------------------------------------------------------------------
# Input payloads
# ---------------------------------------------------------------------------


class UserCredentials(BaseModel):
    """Plain username / password credentials used for *register* & *login*."""

    username: str = Field(..., min_length=1, max_length=150)
    password: str = Field(..., min_length=12, max_length=256)


class TokenRequest(BaseModel):
    """Payload for token refresh operations when sent in the body."""

    access_token: str
    refresh_token: Optional[str] = ""


# ---------------------------------------------------------------------------
# Output payloads
# ---------------------------------------------------------------------------


class LoginResponse(BaseModel):
    """Standard envelope returned by login / register endpoints."""

    access_token: str
    token_type: str = "bearer"
    refresh_token: Optional[str] = None
    username: Optional[str] = None
    user_id: Optional[int] = None
    message: Optional[str] = None
    token_version: Optional[int] = None


# ---------------------------------------------------------------------------
# Settings helpers (optional responses)
# ---------------------------------------------------------------------------


class TokenExpirySettings(BaseModel):
    access_token_expires_at: datetime
    refresh_token_expires_at: datetime
