"""services/admin_service.py
===========================
Admin/maintenance related helpers separated from route controllers.
Currently supports *knowledge-base repair* but can be extended for future
admin tools (e.g., data migrations, bulk user actions).
"""

import logging
from typing import List

from sqlalchemy.ext.asyncio import AsyncSession

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class KBRepairResult(BaseModel):
    success: bool
    fixed_count: int
    total_processed: int
    errors: List[str]


class AdminService:
    """Encapsulates privileged maintenance operations."""

    def __init__(self, db: AsyncSession):
        self._db = db

    # ------------------------------------------------------------------
    # Knowledge-base helpers
    # ------------------------------------------------------------------

    async def ensure_kbs_exist(self) -> KBRepairResult:
        """Create a KB for every project missing one.

        The heavy lifting (vector DB init, file processing) should live in the
        dedicated `knowledgebase_service`.  This method only orchestrates the
        iteration and returns a structured result.
        """

        raise NotImplementedError


# ---------------------------------------------------------------------------
# Factory for DI
# ---------------------------------------------------------------------------


def create_admin_service(db: AsyncSession) -> AdminService:
    return AdminService(db=db)
