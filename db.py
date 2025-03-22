"""
db.py
-----
Sets up the PostgreSQL database connection using SQLAlchemy.
Defines the async init_db process for migrations or table creation.
"""

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base
from config import settings

# Use the DATABASE_URL from config settings
DATABASE_URL = settings.DATABASE_URL

async_engine = create_async_engine(DATABASE_URL, echo=False)

AsyncSessionLocal = async_sessionmaker(
    bind=async_engine, autocommit=False, autoflush=False, expire_on_commit=False
)

# Create sync engine for migrations and schema validation
sync_engine = create_engine(DATABASE_URL.replace("+asyncpg", ""))
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=sync_engine)


Base = declarative_base()

from contextlib import asynccontextmanager


async def get_async_session():
    """FastAPI dependency for getting an async session."""
    async with AsyncSessionLocal() as session:
        yield session


@asynccontextmanager
async def get_async_session_context():
    """
    Async context manager for getting a session outside of FastAPI dependencies.

    Example:
        async with get_async_session_context() as session:
            # Use session here
    """
    session = AsyncSessionLocal()
    try:
        yield session
    finally:
        await session.close()


async def init_db():
    """
    Initializes the database and creates all defined tables.
    If they do not exist.
    """
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def validate_db_schema():
    """
    Validate the current database schema against the ORM models.
    Now checks tables, columns, and indexes.
    """
    import logging
    from sqlalchemy import MetaData, inspect

    logger = logging.getLogger(__name__)

    # Reflect database schema
    inspector = inspect(sync_engine)
    meta = MetaData()
    meta.reflect(bind=sync_engine)

    # Get ORM metadata
    orm_meta = Base.metadata

    # Table validation
    tables_in_db = set(meta.tables.keys())
    tables_in_orm = set(orm_meta.tables.keys())

    missing_tables = tables_in_orm - tables_in_db
    if missing_tables:
        raise Exception(f"Missing tables: {missing_tables}")

    # Column validation for each table
    for table_name in tables_in_orm:
        db_cols = inspector.get_columns(table_name)
        orm_cols = orm_meta.tables[table_name].columns

        # Check column names and types
        db_col_map = {c["name"]: c for c in db_cols}
        for orm_col in orm_cols:
            db_col = db_col_map.get(orm_col.name)
            if not db_col:
                raise Exception(f"Missing column {table_name}.{orm_col.name}")

            # Compare type and nullable
            orm_type = str(orm_col.type).split("(")[0]  # Simplify type comparison
            db_type = str(db_col["type"]).split("(")[0]

            if db_type != orm_type:
                raise Exception(
                    f"Type mismatch in {table_name}.{orm_col.name}: "
                    f"DB has {db_type}, ORM expects {orm_type}"
                )

            if db_col["nullable"] != orm_col.nullable:
                raise Exception(
                    f"Nullability mismatch in {table_name}.{orm_col.name}: "
                    f"DB allows null={db_col['nullable']}, ORM expects {orm_col.nullable}"
                )

    # Index validation
    for table_name in tables_in_orm:
        db_indexes = inspector.get_indexes(table_name)
        orm_indexes = orm_meta.tables[table_name].indexes

        # Check index existence
        orm_index_names = {idx.name for idx in orm_indexes}
        db_index_names = {idx["name"] for idx in db_indexes}

        missing_indexes = orm_index_names - db_index_names
        if missing_indexes:
            raise Exception(f"Missing indexes in {table_name}: {missing_indexes}")

    logger.info("Database schema (tables, columns, indexes) validated successfully.")
