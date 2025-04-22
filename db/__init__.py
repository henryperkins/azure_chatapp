"""
db/__init__.py
------------
Database package initialization.
Exposes core database functionality from the refactored modules
to maintain backward compatibility with existing code.
"""

from db.db import (
    Base,
    async_engine,
    sync_engine,
    AsyncSessionLocal,
    SessionLocal,
    get_async_session,
    get_async_session_context
)

from db.schema_manager import SchemaManager

import logging
logger = logging.getLogger(__name__)


# Create SchemaManager instance
# _schema_manager = SchemaManager()


# Re-export functions with the same interface as before
async def init_db() -> None:
    """Simple database initialization without schema management"""
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created (schema management disabled)")


async def validate_db_schema() -> list[str]:
    """Stub for schema validation"""
    logger.warning("Schema validation disabled")
    return []


async def fix_db_schema() -> None:
    """Stub for schema fixing"""
    logger.warning("Schema fixing disabled")


# Expose all relevant components
__all__ = [
    "Base",
    "async_engine",
    "sync_engine",
    "AsyncSessionLocal", 
    "SessionLocal",
    "get_async_session",
    "get_async_session_context",
    "init_db",
    "validate_db_schema",
    "fix_db_schema",
    # "SchemaManager"  # Removed
]
