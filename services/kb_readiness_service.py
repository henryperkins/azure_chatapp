"""kb_readiness_service.py
--------------------------
Light-weight, cached readiness checks for the knowledge-base (KB)
sub-system.  The goal is to answer the question *"is the KB ready
for use right now?"* without triggering the heavyweight model
initialisation that normally happens on first use of the vector DB
layer.

The implementation purposefully avoids *importing* optional heavy
dependencies such as `sentence_transformers` or `faiss` because even
the import can take >1 s and allocate hundreds of MB of RAM.  Instead
we rely on `importlib.util.find_spec()` which performs a fast metadata
lookup.

Results are cached for a short, configurable TTL so that downstream
code can call the check on every request without incurring noticeable
overhead while still allowing a single worker process to pick up
changes (e.g. a newly indexed KB or hot-installed package) within a
reasonable time.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Dict, Optional, List
from uuid import UUID

from importlib.util import find_spec

# get_async_session returns an *async generator* tuned for FastAPI dependency
# injection and therefore cannot be used with "async with" directly.  Use the
# context-manager helper instead.
from db import get_async_session_context

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class KBReadinessStatus:
    """Represents the readiness state of knowledge-base functionality."""

    available: bool
    reason: Optional[str] = None
    fallback_available: bool = False
    missing_dependencies: List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Service implementation (singleton per process)
# ---------------------------------------------------------------------------


class KBReadinessService:
    """Fast readiness checks without triggering expensive initialisation."""

    _instance: "KBReadinessService | None" = None

    # cache_key -> (KBReadinessStatus, timestamp)
    _status_cache: Dict[str, tuple[KBReadinessStatus, float]] = {}

    # Cache entries live for this many seconds
    _CACHE_TTL_SECONDS = 30.0

    # Single lock to avoid duplicate expensive computations under load
    _lock = asyncio.Lock()

    # ---------------------------------------------------------------------
    # Singleton helpers
    # ---------------------------------------------------------------------

    @classmethod
    def get_instance(cls) -> "KBReadinessService":  # noqa: D401 – imperative mood
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    # ---------------------------------------------------------------------
    # Public API
    # ---------------------------------------------------------------------

    async def check_global_readiness(self) -> KBReadinessStatus:  # noqa: D401
        """Return readiness status that is *independent* of any project."""

        cache_key = "global"
        cached = self._get_cached(cache_key)
        if cached:
            return cached

        async with self._lock:
            # Double-check once inside the lock
            cached = self._get_cached(cache_key)
            if cached:
                return cached

            status = self._compute_global_readiness()
            self._store_cache(cache_key, status)
            return status

    async def check_project_readiness(self, project_id: UUID) -> KBReadinessStatus:  # noqa: D401,E501
        """Return readiness for a *specific* project.

        Combines the global readiness with quick checks specific to the
        project such as whether a knowledge-base is configured and
        whether an index directory exists.
        """

        # First check global readiness (fast & cached)
        global_status = await self.check_global_readiness()
        if not global_status.available:
            return global_status

        cache_key = f"project_{project_id}"
        cached = self._get_cached(cache_key)
        if cached:
            return cached

        async with self._lock:
            cached = self._get_cached(cache_key)
            if cached:
                return cached

            status = await self._compute_project_readiness(project_id)
            self._store_cache(cache_key, status)
            return status

    def invalidate_cache(self, project_id: Optional[UUID] = None) -> None:
        """Invalidate cached readiness data.

        If *project_id* is given, only that entry is removed; otherwise the
        entire cache is cleared.
        """

        if project_id:
            self._status_cache.pop(f"project_{project_id}", None)
        else:
            self._status_cache.clear()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _module_available(module_name: str) -> bool:
        """Return True if *module_name* can be imported without actually importing it."""

        return find_spec(module_name) is not None

    def _compute_global_readiness(self) -> KBReadinessStatus:
        """Compute readiness that doesn’t depend on a project."""

        missing_deps: List[str] = []

        sentence_transformers_available = self._module_available("sentence_transformers")
        faiss_available = self._module_available("faiss")
        sklearn_available = self._module_available("sklearn")

        if not sentence_transformers_available:
            missing_deps.append("sentence-transformers")
        if not faiss_available:
            missing_deps.append("faiss-cpu")
        if not sklearn_available:
            missing_deps.append("scikit-learn")

        # Determine availability rules:
        # – We need *either* FAISS or scikit-learn for similarity search.
        fallback_available = sklearn_available and not faiss_available

        if not (faiss_available or sklearn_available):
            return KBReadinessStatus(
                available=False,
                reason="No vector search backend available",
                missing_dependencies=missing_deps,
            )

        return KBReadinessStatus(
            available=True,
            fallback_available=fallback_available,
            missing_dependencies=missing_deps,
        )

    async def _compute_project_readiness(self, project_id: UUID) -> KBReadinessStatus:
        """Compute readiness status for *project_id* (slow path)."""

        # Late imports to avoid circular dependencies
        from models.project import Project

        try:
            async with get_async_session_context() as db:
                project = await db.get(Project, project_id)

                if not project or not project.knowledge_base:
                    return KBReadinessStatus(
                        available=False,
                        reason="Knowledge base not configured for project",
                    )

                kb = project.knowledge_base
                if not kb.is_active:
                    return KBReadinessStatus(
                        available=False,
                        reason="Knowledge base is inactive",
                    )

            # Check that vector DB directory exists (fast file-system stat)
            storage_path = os.path.join("./storage/vector_db", str(project_id))
            if not os.path.exists(storage_path):
                return KBReadinessStatus(
                    available=False,
                    reason="No indexed files found",
                )

            return KBReadinessStatus(available=True)

        except Exception as exc:  # pragma: no cover – unexpected path
            logger.error("Error checking project KB readiness", exc_info=True)
            return KBReadinessStatus(available=False, reason=str(exc))

    # ------------------------------------------------------------------
    # Cache helpers
    # ------------------------------------------------------------------

    def _get_cached(self, key: str) -> Optional[KBReadinessStatus]:
        entry = self._status_cache.get(key)
        if not entry:
            return None
        status, ts = entry
        if (time.time() - ts) > self._CACHE_TTL_SECONDS:
            # Expired
            self._status_cache.pop(key, None)
            return None
        return status

    def _store_cache(self, key: str, status: KBReadinessStatus) -> None:
        self._status_cache[key] = (status, time.time())
