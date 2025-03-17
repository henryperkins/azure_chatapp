"""
db.py
-----
Sets up the PostgreSQL database connection using SQLAlchemy.
Defines the async init_db process for migrations or table creation.
"""

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base

# Example: 'postgresql+asyncpg://user:pass@localhost:5432/azure_chat'
DATABASE_URL = "postgresql+asyncpg://user:pass@localhost:5432/azure_chat"

async_engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(async_engine, expire_on_commit=False)

sync_engine = create_engine(DATABASE_URL.replace("+asyncpg", ""))
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=sync_engine
)

Base = declarative_base()

from contextlib import asynccontextmanager

async def get_async_session():
    """
    Provides an asynchronous SQLAlchemy session for database operations.
    This function is intended to be used as a dependency in FastAPI.

    Yields:
        AsyncSession: The SQLAlchemy AsyncSession object.
    """
    async with AsyncSessionLocal() as session:
        yield session

async def init_db():
    """
    Initializes the database and creates all defined tables.
    If they do not exist.
    """
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
