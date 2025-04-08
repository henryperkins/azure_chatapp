"""
db.py
-----
Sets up the PostgreSQL database connection using SQLAlchemy.
Defines the async init_db process for migrations or table creation.
"""

import logging
import time
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.exc import OperationalError
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base
from contextlib import asynccontextmanager

from config import settings

logger = logging.getLogger(__name__)

# Use the DATABASE_URL from config settings
DATABASE_URL = settings.DATABASE_URL

async_engine = create_async_engine(
    DATABASE_URL, echo=False, pool_pre_ping=True  # Disable engine-level logging
)

AsyncSessionLocal = async_sessionmaker(
    bind=async_engine, autocommit=False, autoflush=False, expire_on_commit=False
)

# Create sync engine for migrations and schema validation
sync_engine = create_engine(
    DATABASE_URL.replace("+asyncpg", "") if "+asyncpg" in DATABASE_URL
    else DATABASE_URL
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=sync_engine)


Base = declarative_base()


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


async def validate_db_schema():
    """Validate schema async-friendly"""
    from sqlalchemy import MetaData, inspect
    
    logger.info("Validating database schema...")
    has_mismatches = False

    async with async_engine.connect() as conn:
        # Use database-specific functions for checks
        result = await conn.execute(text("""
            SELECT table_name, column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'public'
        """))
        db_schema = {(row.table_name, row.column_name): row.data_type for row in result}
        
        # Get ORM metadata
        orm_schema = {
            (table.name, column.name): str(column.type)
            for table in Base.metadata.tables.values() 
            for column in table.columns.values()
        }

        # Compare schemas
        mismatches = []
        for (table, column), orm_type in orm_schema.items():
            db_type = db_schema.get((table, column))
            if not db_type:
                logger.warning(f"Missing column: {table}.{column}")
                has_mismatches = True
            elif db_type != orm_type.split('(')[0].lower():
                logger.warning(f"Type mismatch: {table}.{column} - DB: {db_type}, ORM: {orm_type}")
                has_mismatches = True

        return has_mismatches


async def init_db() -> None:
    """Initialize database with improved progress tracking"""
    try:
        logger.info("Initialization started")
        
        # Step 1: Create missing tables
        logger.info("Checking for missing tables...")
        existing_tables = await _get_existing_tables()
        tables_to_create = [
            t for t in Base.metadata.tables.keys() if t not in existing_tables
        ]
        if tables_to_create:
            await _create_missing_tables(tables_to_create)
        
        # Step 2: Schema alignment (with progress callbacks)
        logger.info("Running schema alignment...")
        await fix_db_schema()
        
        # Step 3: Final validation
        logger.info("Validating final schema...")
        if await validate_db_schema():
            logger.warning("Schema validation completed with warnings")
        else:
            logger.info("Schema validation successful")

    except Exception as e:
        logger.error(f"❌ DB initialization failed: {str(e)}")
        raise


async def fix_db_schema():
    """Comprehensive schema alignment using synchronous session for DDL"""
    from sqlalchemy import inspect, text
    from sqlalchemy.dialects.postgresql import UUID as PG_UUID

    logger.info("Starting comprehensive schema alignment...")

    # Use sync engine for all schema operations
    with sync_engine.begin() as sync_conn:
        inspector = inspect(sync_conn)
        
        # Add statement timeout to prevent hanging (30 seconds)
        sync_conn.execute(text("SET statement_timeout = 30000"))

        # 1. Add missing tables with progress indication
        existing_tables = set(inspector.get_table_names())
        total_tables = len(Base.metadata.tables)
        for idx, (table_name, table) in enumerate(Base.metadata.tables.items(), 1):
            if table_name not in existing_tables:
                logger.info(f"({idx}/{total_tables}) Creating table: {table_name}")
                table.create(sync_conn)
            else:
                logger.debug(f"({idx}/{total_tables}) Table exists: {table_name}")

        # 2. Add missing columns
        for table_name in Base.metadata.tables.keys():
            # Skip tables that don't exist in the database yet
            if not inspector.has_table(table_name):
                logger.info(f"Skipping non-existent table: {table_name}")
                continue

            # Get database columns
            db_cols = {c["name"] for c in inspector.get_columns(table_name)}

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
                    if str(col.type) == "JSONB":
                        col_spec += " DEFAULT '{}'::jsonb"
                    elif str(col.type) == "BOOLEAN":
                        col_spec += " DEFAULT false"
                    elif str(col.type).startswith("INTEGER"):
                        col_spec += " DEFAULT 0"
                    elif str(col.type).startswith("UUID"):
                        col_spec += " DEFAULT gen_random_uuid()"
                    else:
                        col_spec += (
                            " DEFAULT ''"  # Default empty string for other types
                        )

                col_spec += " NOT NULL" if not col.nullable else " NULL"

                if col.server_default:
                    col_spec += f" DEFAULT {col.server_default.arg}"

                # Handle special case for token_type column to avoid PostgreSQL DEFAULT expression limitation
                if col_name == "token_type" and "DEFAULT access" in col_spec:
                    col_spec = col_spec.replace("DEFAULT access", "DEFAULT 'access'")
                
                    # Modify the DDL to add EXISTS check
                    ddl = f"""
                    DO $$
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1 
                            FROM information_schema.columns 
                            WHERE table_name = '{table_name}' 
                            AND column_name = '{col_name}'
                        ) THEN
                            ALTER TABLE {table_name} ADD COLUMN {col_spec};
                        END IF;
                    END $$;
                    """
                    sync_conn.execute(text(ddl))
                    logger.info(f"Added column: {table_name}.{col_name}")

        # 2. Create missing indexes
        for table_name, table in Base.metadata.tables.items():
            # Get existing indexes
            db_indexes = {idx["name"] for idx in inspector.get_indexes(table_name)}

            # Check ORM indexes
            # Only create non-existent indexes
            for idx in [i for i in table.indexes if i.name not in db_indexes]:
                try:
                    logger.info(f"Creating index {idx.name} on {table_name}")
                    # Use CONCURRENTLY if possible (PostgreSQL only)
                    if idx.dialect_kwargs.get('postgresql_concurrently'):
                        sync_conn.execute(text(f"CREATE INDEX CONCURRENTLY {idx.name} ON {table_name} {idx.column_expressions}"))
                    else:
                        idx.create(sync_conn)
                except Exception as index_error:
                    logger.error(f"Failed to create index {idx.name}: {index_error}")
                    # Continue instead of failing whole process
                        else:
                            logger.warning(
                                f"Empty create statement for index: {idx.name}"
                            )
                    else:
                        logger.warning(
                            f"Could not generate create statement for index: {idx.name}"
                        )

        # 3. Handle column type changes
        for table_name, table in Base.metadata.tables.items():
            db_cols = inspector.get_columns(table_name)
            db_col_dict = {c["name"]: c for c in db_cols}

            for col_name, orm_col in table.columns.items():
                if col_name not in db_col_dict:
                    continue  # Skip columns that don't exist yet

                db_col = db_col_dict[col_name]
                db_type = str(db_col["type"]).split("(")[0]
                orm_type = str(orm_col.type).split("(")[0]

                # Handle type conversion
                if db_type != orm_type:
                    logger.warning(
                        f"Type mismatch: {table_name}.{orm_col.name} (DB: {db_type} vs ORM: {orm_type})"
                    )
                    # Handle common type conversions safely
                    if "VARCHAR" in db_type and "TEXT" in orm_type:
                        sync_conn.execute(
                            text(
                                f"ALTER TABLE {table_name} ALTER COLUMN {orm_col.name} TYPE TEXT"
                            )
                        )
                        logger.info(
                            f"Converted {table_name}.{orm_col.name} from VARCHAR to TEXT"
                        )
                    elif "INTEGER" in db_type and "BIGINT" in orm_type:
                        sync_conn.execute(
                            text(
                                f"ALTER TABLE {table_name} ALTER COLUMN {orm_col.name} TYPE BIGINT"
                            )
                        )
                        logger.info(
                            f"Converted {table_name}.{orm_col.name} from INTEGER to BIGINT"
                        )
                    elif "CHAR" in db_type and "UUID" in orm_type:
                        try:
                            sync_conn.execute(
                                text(
                                    f"ALTER TABLE {table_name} ALTER COLUMN {orm_col.name} TYPE UUID USING {orm_col.name}::uuid"
                                )
                            )
                            logger.info(
                                f"Converted {table_name}.{orm_col.name} from CHAR to UUID"
                            )
                        except Exception as e:
                            logger.error(f"Failed to convert to UUID: {e}")
                            # Create a new UUID column and migrate data
                            sync_conn.execute(
                                text(
                                    f"ALTER TABLE {table_name} ADD COLUMN {orm_col.name}_new UUID DEFAULT gen_random_uuid()"
                                )
                            )
                            sync_conn.execute(
                                text(
                                    f"UPDATE {table_name} SET {orm_col.name}_new = {orm_col.name}::uuid"
                                )
                            )
                            sync_conn.execute(
                                text(
                                    f"ALTER TABLE {table_name} DROP COLUMN {orm_col.name}"
                                )
                            )
                            sync_conn.execute(
                                text(
                                    f"ALTER TABLE {table_name} RENAME COLUMN {orm_col.name}_new TO {orm_col.name}"
                                )
                            )
                            logger.info(
                                f"Successfully migrated {table_name}.{orm_col.name} to UUID via new column"
                            )
                    elif isinstance(orm_col.type, PG_UUID) and db_type != "uuid":
                        # Handle UUID columns that aren't properly typed
                        sync_conn.execute(
                            text(
                                f"ALTER TABLE {table_name} ALTER COLUMN {orm_col.name} TYPE UUID USING {orm_col.name}::uuid"
                            )
                        )
                        logger.info(
                            f"Converted {table_name}.{orm_col.name} to UUID type"
                        )
                        
        # 5. Handle foreign key constraints with proper cascade rules
        for table_name, table in Base.metadata.tables.items():
            db_fks = inspector.get_foreign_keys(table_name)
            db_fk_cols = {
                (fk["constrained_columns"][0], fk["referred_table"], fk.get("ondelete"))
                for fk in db_fks
                if fk["constrained_columns"]
            }

            for fk in table.foreign_keys:
                col_name = fk.parent.name
                referred_table = fk.column.table.name
                ondelete = None
                
                # Get ondelete rule from the column if specified
                for col in table.columns:
                    if col.name == col_name and col.foreign_keys:
                        for fk_constraint in col.foreign_keys:
                            if fk_constraint.ondelete:
                                ondelete = fk_constraint.ondelete.upper()

                if (col_name, referred_table, ondelete) not in db_fk_cols:
                    # FK doesn't exist or has different cascade rules, try to add it
                    try:
                        constraint_name = f"fk_{table_name}_{col_name}_{referred_table}"
                        ondelete_clause = f" ON DELETE {ondelete}" if ondelete else ""
                
                        # Drop existing constraint if it exists but has different rules
                        for existing_fk in db_fks:
                            if (existing_fk["constrained_columns"] and
                                existing_fk["constrained_columns"][0] == col_name and
                                existing_fk["referred_table"] == referred_table):
                                try:
                                    sync_conn.execute(
                                        text(
                                            f"ALTER TABLE {table_name} DROP CONSTRAINT {existing_fk['name']}"
                                        )
                                    )
                                    logger.info(
                                        f"Dropped existing foreign key constraint {existing_fk['name']} to update cascade rules"
                                    )
                                except Exception as drop_error:
                                    logger.warning(
                                        f"Failed to drop existing constraint {existing_fk['name']}: {drop_error}"
                                    )
                                    continue  # Skip adding new constraint if we can't drop old one

                        try:
                            sync_conn.execute(
                                text(
                                    f"ALTER TABLE {table_name} ADD CONSTRAINT {constraint_name} "
                                    f"FOREIGN KEY ({col_name}) REFERENCES {referred_table}({fk.column.name})"
                                    f"{ondelete_clause}"
                                )
                            )
                            logger.info(
                                f"Successfully added foreign key constraint: {table_name}.{col_name} -> {referred_table} "
                                f"with ON DELETE {ondelete if ondelete else 'NO ACTION'}"
                            )
                        except Exception as add_error:
                            logger.error(
                                f"Failed to add foreign key constraint for {table_name}.{col_name}: {add_error}\n"
                                f"SQL: ALTER TABLE {table_name} ADD CONSTRAINT {constraint_name} "
                                f"FOREIGN KEY ({col_name}) REFERENCES {referred_table}({fk.column.name})"
                                f"{ondelete_clause}"
                            )
                            # Attempt to create constraint without ondelete clause if that was the issue
                            if ondelete_clause:
                                try:
                                    sync_conn.execute(
                                        text(
                                            f"ALTER TABLE {table_name} ADD CONSTRAINT {constraint_name} "
                                            f"FOREIGN KEY ({col_name}) REFERENCES {referred_table}({fk.column.name})"
                                        )
                                    )
                                    logger.warning(
                                        f"Added constraint without ON DELETE clause due to previous error"
                                    )
                                except Exception as simple_add_error:
                                    logger.error(
                                        f"Completely failed to add foreign key constraint: {simple_add_error}"
                                    )
                    except Exception as outer_error:
                        if "deadlock" in str(outer_error).lower() and attempt < max_retries - 1:
                            logger.warning(f"Deadlock detected on FK {constraint_name}, retrying... (Attempt {attempt + 1})")
                            time.sleep(0.1 * (attempt + 1))
                            continue
                        else:
                            logger.error(
                                f"Failed to handle foreign key constraint for {table_name}.{col_name}: {outer_error}"
                            )
                            raise
