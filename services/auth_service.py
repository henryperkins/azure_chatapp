"""services/auth_service.py
===========================
Thin *service layer* wrapping all authentication-related business logic.

Moving business logic out of `routes/auth.py` into this module helps us
achieve the *Service-first* architecture mandated by the backend guard-rails
and improves unit-testability.

NOTE:  At the moment this is just a *template* – only method signatures and
docstrings are provided.  Existing functionality in *auth.py* will be
gradually migrated into these helpers in follow-up commits.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Tuple

from sqlalchemy.ext.asyncio import AsyncSession

from models.user import User
from schemas.auth_schemas import (
    UserCredentials,
    LoginResponse,
    TokenRequest,
    TokenExpirySettings,
)

logger = logging.getLogger(__name__)


class AuthService:
    """Pure business-logic façade for user authentication workflows."""

    def __init__(
        self,
        db: AsyncSession,
        access_expiry: timedelta,
        refresh_expiry: timedelta,
    ) -> None:
        self._db = db
        self._access_expiry = access_expiry
        self._refresh_expiry = refresh_expiry

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def register(self, creds: UserCredentials) -> LoginResponse:
        """Register a new account and immediately return login tokens."""

        raise NotImplementedError

    async def login(self, creds: UserCredentials) -> LoginResponse:
        """Validate credentials and issue new tokens."""

        raise NotImplementedError

    async def refresh_tokens(self, req: TokenRequest) -> LoginResponse:
        """Return fresh access / refresh tokens given a valid refresh token."""

        raise NotImplementedError

    async def verify_status(self, user: User) -> TokenExpirySettings:
        """Return token expiry info and basic account flags (active, locked...)."""

        raise NotImplementedError


# Factory helper ----------------------------------------------------------------


def create_auth_service(
    db: AsyncSession,
    access_expiry: timedelta,
    refresh_expiry: timedelta,
) -> AuthService:
    """Convenience factory for DI (e.g., Depends(create_auth_service))."""

    return AuthService(db=db, access_expiry=access_expiry, refresh_expiry=refresh_expiry)
