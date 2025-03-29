"""
db.py
-----
Sets up the PostgreSQL database connection using SQLAlchemy.
Defines the async init_db process for migrations or table creation.
"""

import logging
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base
from config import settings

logger = logging.getLogger(__name__)

# Use the DATABASE_URL from config settings
DATABASE_URL = settings.DATABASE_URL

async_engine = create_async_engine(
    DATABASE_URL,
    echo=True,  # Show SQL statements
    pool_pre_ping=True
)

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
    Initialize database and handle schema alignment using SQLAlchemy metadata.
    """
    async with async_engine.begin() as conn:
        # Create all tables first
        await conn.run_sync(Base.metadata.create_all)
    
    # Run schema fixes in the same engine context
    await fix_db_schema()

async def fix_db_schema(conn=None):
    """Advanced schema fixing without alembic"""
    from sqlalchemy import inspect, text, DDL
    from db import sync_engine  # For SQL compilation

    async with async_engine.begin() as conn:
        # Use direct async inspection
        inspector = await conn.run_sync(lambda sync_conn: inspect(sync_conn))
        
        # 1. Add missing columns
        for table_name in Base.metadata.tables.keys():
            # Get database columns
            db_cols = {c['name'] for c in (await conn.run_sync(lambda sync_conn: inspector.get_columns(table_name)))}
            
            # Get ORM columns
            orm_cols = set(Base.metadata.tables[table_name].columns.keys())
            
            # Find missing columns
            missing = orm_cols - db_cols
            for col_name in missing:
                col = Base.metadata.tables[table_name].columns[col_name]
                
                # Construct proper column specification
                col_spec = f"{col_name} {col.type.compile(sync_engine.dialect)}"
                
                # Handle NOT NULL constraints with existing data
                if not col.nullable and col.server_default is None:
                    # Create default value based on type for existing rows
                    if str(col.type) == 'JSONB':
                        col_spec += " DEFAULT '{}'::jsonb"
                    elif str(col.type) == 'BOOLEAN':
                        col_spec += " DEFAULT false"
                    elif str(col.type).startswith('INTEGER'):
                        col_spec += " DEFAULT 0"
                    else:
                        col_spec += " DEFAULT ''"  # Default empty string for other types
                
                col_spec += " NOT NULL" if not col.nullable else " NULL"
                
                if col.server_default:
                    col_spec += f" DEFAULT {col.server_default.arg}"
                
                ddl = f"ALTER TABLE {table_name} ADD COLUMN {col_spec}"
                await conn.execute(text(ddl))
                logger.info(f"Added missing column: {table_name}.{col_name}")

        # 2. Create missing indexes
        for table_name, table in Base.metadata.tables.items():
            # Get existing indexes
            db_indexes = {idx['name'] for idx in (await conn.run_sync(lambda sync_conn: inspector.get_indexes(table_name)))}
            
            # Check ORM indexes
            for idx in table.indexes:
                if idx.name not in db_indexes:
                    await conn.execute(DDL(str(idx.create(async_engine))))
                    logger.info(f"Created missing index: {idx.name}")

        # 3. Handle column type changes
        for table_name, table in Base.metadata.tables.items():
            db_cols = await conn.run_sync(lambda sync_conn: inspector.get_columns(table_name))
            for db_col in db_cols:
                orm_col = table.columns.get(db_col['name'])
                if orm_col:
                    db_type = str(db_col['type']).split("(")[0]  
                    orm_type = str(orm_col.type).split("(")[0]
                    if db_type != orm_type:
                        logger.warning(f"Type mismatch: {table_name}.{orm_col.name} (DB: {db_type} vs ORM: {orm_type})")
                        if 'VARCHAR' in db_type and 'TEXT' in orm_type:
                            await conn.execute(text(
                                f"ALTER TABLE {table_name} ALTER COLUMN {orm_col.name} TYPE TEXT"
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
