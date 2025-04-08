"""
db.py
-----
Sets up the PostgreSQL database connection using SQLAlchemy.
Defines the async init_db process for migrations or table creation.
"""

import logging
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
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
    """
    Validate the current database schema against the ORM models.
    Logs differences as warnings rather than failing.
    """
    import logging
    from sqlalchemy import MetaData, inspect

    logger = logging.getLogger(__name__)
    has_mismatches = False

    # Reflect database schema with error handling
    try:
        inspector = inspect(sync_engine)
        meta = MetaData()
        meta.reflect(bind=sync_engine)
    except Exception as e:
        logger.error(f"Failed to reflect database schema: {e}")
        raise RuntimeError("Database schema reflection failed") from e

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
        logger.warning(
            "⚠️ Database schema has mismatches with ORM models (see warnings above)"
        )

    return has_mismatches  # Return whether mismatches were found


async def init_db() -> None:
    """
    Initialize database and handle schema alignment using SQLAlchemy metadata.
    This function ensures the database schema is fully aligned with ORM models,
    creating tables, adding missing columns, adjusting types, and setting up constraints
    without requiring Alembic migrations.
    """
    logger.info("Starting database initialization and schema alignment")

    # First check which tables exist
    existing_tables = set()
    async with async_engine.connect() as conn:
        result = await conn.execute(
            text(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
            )
        )
        existing_tables = {row[0] for row in result.fetchall()}
        await conn.commit()

    # Only create tables that don't exist
    tables_to_create = [
        t for t in Base.metadata.tables.keys() if t not in existing_tables
    ]
    if tables_to_create:
        logger.info(f"Creating missing tables: {', '.join(tables_to_create)}")
        async with async_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    # Execute comprehensive schema alignment to handle any discrepancies
    await fix_db_schema()

    # Final verification of schema alignment
    mismatches = await validate_db_schema()
    if mismatches:
        logger.warning(
            "Some schema mismatches couldn't be automatically fixed but application can continue"
        )
    else:
        logger.info("Database schema fully aligned with ORM models")

    # Log list of verified tables for debugging
    async with async_engine.connect() as conn:
        result = await conn.execute(
            text(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
            )
        )
        tables = [row[0] for row in result.fetchall()]
        await conn.commit()  # Explicitly commit the transaction
        logger.info(f"Verified tables in database: {', '.join(tables)}")


async def fix_db_schema():
    """Comprehensive schema alignment using synchronous session for DDL"""
    from sqlalchemy import inspect, text
    from sqlalchemy.dialects.postgresql import UUID as PG_UUID

    logger.info("Starting comprehensive schema alignment...")

    # Use sync engine for all schema operations
    with sync_engine.begin() as sync_conn:
        inspector = inspect(sync_conn)

        # 1. Add missing tables
        existing_tables = set(inspector.get_table_names())
        for table_name in Base.metadata.tables.keys():
            if table_name not in existing_tables:
                logger.info(f"Creating missing table: {table_name}")
                Base.metadata.tables[table_name].create(sync_conn)
                continue

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
                
                ddl = f"ALTER TABLE {table_name} ADD COLUMN {col_spec}"
                sync_conn.execute(text(ddl))
                logger.info(f"Added missing column: {table_name}.{col_name}")

        # 2. Create missing indexes
        for table_name, table in Base.metadata.tables.items():
            # Get existing indexes
            db_indexes = {idx["name"] for idx in inspector.get_indexes(table_name)}

            # Check ORM indexes
            for idx in table.indexes:
                if idx.name not in db_indexes:
                    create_stmt = idx.create(sync_engine)
                    if create_stmt is not None:
                        sql_text = str(create_stmt)
                        if sql_text and sql_text.strip():
                            sync_conn.execute(text(sql_text))
                            logger.info(f"Created missing index: {idx.name}")
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
