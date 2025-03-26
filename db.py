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


async def fix_db_schema():
    """Fix common schema mismatches between database and ORM models."""
    from sqlalchemy import text
    
    async with async_engine.begin() as conn:
        # Create missing indexes one at a time
        index_commands = [
            "CREATE INDEX IF NOT EXISTS ix_projects_created_at ON projects(created_at)",
            "CREATE INDEX IF NOT EXISTS ix_projects_updated_at ON projects(updated_at)",
            "CREATE INDEX IF NOT EXISTS ix_projects_knowledge_base_id ON projects(knowledge_base_id)",
            "CREATE INDEX IF NOT EXISTS ix_users_id ON users(id)",
            "CREATE INDEX IF NOT EXISTS ix_users_last_login ON users(last_login)",
            "CREATE INDEX IF NOT EXISTS ix_users_created_at ON users(created_at)"
        ]
        
        for cmd in index_commands:
            await conn.execute(text(cmd))
        
        # Add missing columns
        await conn.execute(text(
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS message_count INTEGER DEFAULT 0 NOT NULL"
        ))
        
        # Update default model
        await conn.execute(text(
            "ALTER TABLE projects ALTER COLUMN default_model SET DEFAULT 'claude-3-sonnet-20240229'"
        ))

async def validate_db_schema():
    """
    Validate the current database schema against the ORM models.
    Logs differences as warnings rather than failing.
    """
    import logging
    from sqlalchemy import MetaData, inspect

    logger = logging.getLogger(__name__)
    has_mismatches = False

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
        logger.warning(f"⚠️ Missing tables in database: {missing_tables}")
        has_mismatches = True

    # Column validation for each table
    for table_name in tables_in_orm:
        if table_name not in meta.tables:
            continue
            
        db_cols = inspector.get_columns(table_name)
        orm_cols = orm_meta.tables[table_name].columns

        # Check column names and types
        db_col_map = {c["name"]: c for c in db_cols}
        for orm_col in orm_cols:
            db_col = db_col_map.get(orm_col.name)
            if not db_col:
                logger.warning(f"⚠️ Missing column {table_name}.{orm_col.name}")
                has_mismatches = True
                continue

            # Compare type and nullable
            orm_type = str(orm_col.type).split("(")[0]  # Simplify type comparison
            db_type = str(db_col["type"]).split("(")[0]

            if db_type != orm_type:
                logger.warning(
                    f"⚠️ Type mismatch in {table_name}.{orm_col.name}: "
                    f"DB has {db_type}, ORM expects {orm_type}"
                )
                has_mismatches = True

            if db_col["nullable"] != orm_col.nullable:
                logger.warning(
                    f"⚠️ Nullability mismatch in {table_name}.{orm_col.name}: "
                    f"DB allows null={db_col['nullable']}, ORM expects {orm_col.nullable}"
                )
                has_mismatches = True

    # Index validation
    for table_name in tables_in_orm:
        if table_name not in meta.tables:
            continue
            
        db_indexes = inspector.get_indexes(table_name)
        orm_indexes = orm_meta.tables[table_name].indexes

        # Check index existence
        orm_index_names = {idx.name for idx in orm_indexes}
        db_index_names = {idx["name"] for idx in db_indexes}

        missing_indexes = orm_index_names - db_index_names
        if missing_indexes:
            logger.warning(f"⚠️ Missing indexes in {table_name}: {missing_indexes}")
            has_mismatches = True

    if not has_mismatches:
        logger.info("✅ Database schema matches ORM models")
    else:
        logger.warning("⚠️ Database schema has mismatches with ORM models (see warnings above)")
    
    return has_mismatches  # Return whether mismatches were found
