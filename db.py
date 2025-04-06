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
sync_engine = create_engine(DATABASE_URL.replace("+asyncpg", ""))
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


async def init_db():
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

    logger.info("Starting comprehensive schema alignment...")

    # Use sync engine for all schema operations
    with sync_engine.begin() as sync_conn:
        inspector = inspect(sync_conn)

        # 1. Add missing columns
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
                        sync_conn.execute(
                            text(
                                f"ALTER TABLE {table_name} ALTER COLUMN {orm_col.name} TYPE UUID USING {orm_col.name}::uuid"
                            )
                        )
                        logger.info(
                            f"Converted {table_name}.{orm_col.name} from CHAR to UUID"
                        )

                # Fix nullability if needed
                if db_col["nullable"] != orm_col.nullable:
                    try:
                        if orm_col.nullable and not db_col["nullable"]:
                            # Make column nullable (easy)
                            sync_conn.execute(
                                text(
                                    f"ALTER TABLE {table_name} ALTER COLUMN {orm_col.name} DROP NOT NULL"
                                )
                            )
                            logger.info(f"Made {table_name}.{orm_col.name} nullable")
                        elif not orm_col.nullable and db_col["nullable"]:
                            # Add default value first if needed
                            if not orm_col.server_default:
                                default_val = (
                                    "0"
                                    if "INT" in orm_type
                                    else (
                                        "''"
                                        if "VARCHAR" in orm_type
                                        else (
                                            "false"
                                            if "BOOL" in orm_type
                                            else (
                                                "'{}'::jsonb"
                                                if "JSONB" in orm_type
                                                else "NULL"
                                            )
                                        )
                                    )
                                )
                                sync_conn.execute(
                                    text(
                                        f"UPDATE {table_name} SET {orm_col.name} = {default_val} WHERE {orm_col.name} IS NULL"
                                    )
                                )
                            # Make not nullable
                            sync_conn.execute(
                                text(
                                    f"ALTER TABLE {table_name} ALTER COLUMN {orm_col.name} SET NOT NULL"
                                )
                            )
                            logger.info(f"Made {table_name}.{orm_col.name} NOT NULL")
                    except Exception as e:
                        logger.error(
                            f"Failed to fix nullability for {table_name}.{orm_col.name}: {e}"
                        )

        # 4. Handle check constraints
        for table_name, table in Base.metadata.tables.items():
            db_constraints = inspector.get_check_constraints(table_name)
            db_constraint_names = {c["name"] for c in db_constraints}

            # Add missing check constraints
            for constraint in table.constraints:
                if (
                    hasattr(constraint, "name")
                    and constraint.name
                    and "check" in constraint.name.lower()
                ):
                    if constraint.name not in db_constraint_names:
                        try:
                            # Create a proper DDL statement manually for check constraints
                            if hasattr(constraint, "sqltext"):
                                sql_condition = str(constraint.sqltext)
                                ddl = f"ALTER TABLE {table_name} ADD CONSTRAINT {constraint.name} CHECK ({sql_condition})"
                                sync_conn.execute(text(ddl))
                                logger.info(
                                    f"Added check constraint: {constraint.name}"
                                )
                        except Exception as e:
                            logger.error(
                                f"Failed to add check constraint {constraint.name}: {e}"
                            )

        # 5. Handle foreign key constraints
        for table_name, table in Base.metadata.tables.items():
            db_fks = inspector.get_foreign_keys(table_name)
            db_fk_cols = {
                (fk["constrained_columns"][0], fk["referred_table"])
                for fk in db_fks
                if fk["constrained_columns"]
            }

            for fk in table.foreign_keys:
                col_name = fk.parent.name
                referred_table = fk.column.table.name

                if (col_name, referred_table) not in db_fk_cols:
                    # FK doesn't exist, try to add it
                    try:
                        constraint_name = f"fk_{table_name}_{col_name}_{referred_table}"
                        sync_conn.execute(
                            text(
                                f"ALTER TABLE {table_name} ADD CONSTRAINT {constraint_name} "
                                f"FOREIGN KEY ({col_name}) REFERENCES {referred_table}({fk.column.name})"
                            )
                        )
                        logger.info(
                            f"Added foreign key constraint: {table_name}.{col_name} -> {referred_table}"
                        )
                    except Exception as e:
                        logger.error(
                            f"Failed to add foreign key constraint for {table_name}.{col_name}: {e}"
                        )

    logger.info("Schema alignment process completed")


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
        logger.warning(
            "⚠️ Database schema has mismatches with ORM models (see warnings above)"
        )

    return has_mismatches  # Return whether mismatches were found
