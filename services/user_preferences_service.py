"""services/user_preferences_service.py
======================================
Encapsulates CRUD operations for the *user preferences* feature so that route
handlers remain thin and focused on HTTP concerns only.
"""

import logging
from typing import Any, Dict

from sqlalchemy.ext.asyncio import AsyncSession

from models.user import User

logger = logging.getLogger(__name__)


class UserPreferencesService:
    """Service façade for reading / writing user preference key-values."""

    def __init__(self, db: AsyncSession):
        self._db = db

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def get_preferences(self, user: User) -> Dict[str, Any]:
        """Return *all* preferences for *user*.

        Implementation TBD – likely reads a `user_preferences` table and
        returns a dict keyed by preference name.
        """

        raise NotImplementedError

    async def set_preference(self, user: User, key: str, value: Any) -> None:
        """Insert or update a single preference value."""

        raise NotImplementedError


# Factory helper --------------------------------------------------------------


def create_user_preferences_service(db: AsyncSession) -> UserPreferencesService:
    return UserPreferencesService(db=db)
