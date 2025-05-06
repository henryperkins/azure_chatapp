"""
db.py
-----
Core database connection setup using SQLAlchemy.
Handles engine creation and session management.
"""

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base

from config import settings


logger = logging.getLogger(__name__)

# Database URL from config
DATABASE_URL = settings.DATABASE_URL.split("?")[0]  # Remove any existing query parameters

# ---------------------------------------------------------
# Async engine/session: for normal runtime usage
# ---------------------------------------------------------
async_engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    connect_args={"ssl": False}  # Disable SSL properly for asyncpg
)

AsyncSessionLocal = async_sessionmaker(
    bind=async_engine,
    expire_on_commit=False
)

# ---------------------------------------------------------
# Sync engine/session: for DDL operations
# ---------------------------------------------------------
sync_url = DATABASE_URL.replace("+asyncpg", "")
sync_url = sync_url.replace("postgresql://", "postgresql+psycopg2://")  # Explicit psycopg2 driver
# For psycopg2, we can use the query parameter
sync_url += "?sslmode=disable"
sync_engine = create_engine(
    sync_url,
    pool_pre_ping=True
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=sync_engine)

# ---------------------------------------------------------
# Base for models
# ---------------------------------------------------------
Base = declarative_base()

# ---------------------------------------------------------
# Session management utilities
# ---------------------------------------------------------
async def get_async_session() -> AsyncGenerator:
    """FastAPI dependency for getting an async DB session."""
    async with AsyncSessionLocal() as session:
        yield session

@asynccontextmanager
async def get_async_session_context():
    """Async context manager for database sessions."""
    session = AsyncSessionLocal()
    try:
        yield session
    finally:
        await session.close()
