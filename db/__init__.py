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


# Create SchemaManager instance
_schema_manager = SchemaManager()


# Re-export functions with the same interface as before
async def init_db() -> None:
    """
    Initialize database (backward compatibility wrapper).
    Creates missing tables, aligns schema, and validates.
    """
    await _schema_manager.initialize_database()


async def validate_db_schema() -> list[str]:
    """
    Validate schema and return a list of mismatch details (backward compatibility wrapper).
    """
    return await _schema_manager.validate_schema()


async def fix_db_schema() -> None:
    """
    Fix database schema (backward compatibility wrapper).
    Comprehensive schema alignment using synchronous session for DDL.
    """
    await _schema_manager.fix_schema()


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
    "SchemaManager"
]
