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

# Instantiate SchemaManager at module level
_schema_manager = SchemaManager()

# Re-export functions with the same interface as before, but delegate to SchemaManager
async def init_db() -> None:
    """Full database initialization using SchemaManager (with Alembic integration)"""
    await _schema_manager.initialize_database()

async def validate_db_schema() -> list[str]:
    """Validate DB schema using SchemaManager"""
    return await _schema_manager.validate_schema()

async def fix_db_schema() -> None:
    """Fix DB schema using SchemaManager"""
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
    "SchemaManager",  # <--- now exposed
]
