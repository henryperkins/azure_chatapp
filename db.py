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
    Initialize database and handle schema alignment using SQLAlchemy metadata.
    """
    async with async_engine.begin() as conn:
        # Create all tables first
        await conn.run_sync(Base.metadata.create_all)
        
    # Then run schema fixes with separate connection
    await fix_db_schema()

async def fix_db_schema(conn=None):
    """Advanced schema fixing without alembic"""
    from sqlalchemy import inspect, text, DDL

    # 1. Proper decorator for connection handling
    def run_with_conn(func):
        async def wrapper(*args, **kwargs):
            nonlocal conn
            if conn:
                return await func(*args, conn=conn, **kwargs)
            else:
                async with async_engine.begin() as new_conn:
                    return await func(*args, conn=new_conn, **kwargs)
        return wrapper

    # 2. Add missing columns
    @run_with_conn
    async def add_missing_columns(conn): 
        inspector = inspect(conn.sync_engine)
        for table_name in Base.metadata.tables.keys():
            # Get database columns
            db_cols = {c['name'] for c in inspector.get_columns(table_name)}
            
            # Get ORM columns
            orm_cols = set(Base.metadata.tables[table_name].columns.keys())
            
            # Find missing columns
            missing = orm_cols - db_cols
            for col_name in missing:
                col = Base.metadata.tables[table_name].columns[col_name]
                ddl = f"ALTER TABLE {table_name} ADD COLUMN {col.compile(async_engine.dialect)}"
                if col.server_default:
                    ddl += f" DEFAULT {col.server_default.arg}"
                await conn.execute(text(ddl))
                logger.info(f"Added missing column: {table_name}.{col_name}")

    # 3. Create missing indexes
    @run_with_conn 
    async def create_missing_indexes(conn):
        inspector = inspect(conn.sync_engine)
        for table_name, table in Base.metadata.tables.items():
            # Get existing indexes
            db_indexes = {idx['name'] for idx in inspector.get_indexes(table_name)}
            
            # Check ORM indexes
            for idx in table.indexes:
                if idx.name not in db_indexes:
                    await conn.execute(DDL(str(idx.create(async_engine))))
                    logger.info(f"Created missing index: {idx.name}")

    # 4. Handle column type changes
    @run_with_conn
    async def update_column_types(conn):
        inspector = inspect(conn.sync_engine)
        for table_name, table in Base.metadata.tables.items():
            db_cols = inspector.get_columns(table_name)
            for db_col in db_cols:
                orm_col = table.columns.get(db_col['name'])
                if orm_col:
                    db_type = str(db_col['type']).split("(")[0]  # simplified
                    orm_type = str(orm_col.type).split("(")[0]
                    if db_type != orm_type:
                        logger.warning(f"Type mismatch: {table_name}.{orm_col.name} "
                                      f"(DB: {db_type} vs ORM: {orm_type})")
                        # Handle simple type upgrades
                        if 'VARCHAR' in db_type and 'TEXT' in orm_type:
                            await conn.execute(text(
                                f"ALTER TABLE {table_name} "
                                f"ALTER COLUMN {orm_col.name} TYPE TEXT"
                            ))

    # Run all fix stages
    await add_missing_columns()
    await create_missing_indexes()
    await update_column_types()

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
