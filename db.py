"""
db.py
-----
Sets up the PostgreSQL database connection using SQLAlchemy.
Defines the async init_db process for migrations or table creation.
Incorporates additional suggestions for improved reliability and clarity.
"""

import logging
import time
from typing import Optional
from contextlib import asynccontextmanager

from sqlalchemy import create_engine, text, inspect
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import sessionmaker

from config import settings

logger = logging.getLogger(__name__)

# Use the DATABASE_URL from config settings
DATABASE_URL = settings.DATABASE_URL

# ---------------------------------------------------------
# Async engine/session: for normal runtime usage
# ---------------------------------------------------------

async_engine = create_async_engine(DATABASE_URL, echo=False, pool_pre_ping=True)

AsyncSessionLocal = async_sessionmaker(
    bind=async_engine, autocommit=False, autoflush=False, expire_on_commit=False
)


async def get_async_session():
    """FastAPI dependency for getting an async DB session."""
    async with AsyncSessionLocal() as session:
        yield session


@asynccontextmanager
async def get_async_session_context():
    """
    Async context manager for obtaining a session outside of FastAPI dependencies.

    Example usage:
        async with get_async_session_context() as session:
            # Use session here
    """
    session = AsyncSessionLocal()
    try:
        yield session
    finally:
        await session.close()


# ---------------------------------------------------------
# Sync engine/session: for DDL, schema validation/fixing
# ---------------------------------------------------------
# If the URI uses +asyncpg, strip it for sync usage
sync_url = (
    DATABASE_URL.replace("+asyncpg", "") if "+asyncpg" in DATABASE_URL else DATABASE_URL
)
sync_engine = create_engine(sync_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=sync_engine)

Base = declarative_base()


# ---------------------------------------------------------
# Helper functions for table introspection and creation
# ---------------------------------------------------------
async def _get_existing_tables():
    """Get a list of existing table names using an async connection."""
    async with async_engine.connect() as conn:
        result = await conn.execute(
            text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema='public'"
            )
        )
        return {row[0] for row in result.fetchall()}


async def _create_missing_tables(tables: list[str]):
    """
    Create missing tables with basic progress tracking
    using synchronous metadata create.
    """
    for idx, table_name in enumerate(tables, 1):
        logger.info(f"Creating table {idx}/{len(tables)}: {table_name}")
        async with async_engine.begin() as conn:
            # Option A: run the sync create via run_sync
            # table_obj = Base.metadata.tables[table_name]
            # await conn.run_sync(table_obj.create)

            # Option B: more direct approach (as in your code):
            await conn.run_sync(
                lambda sync_conn: Base.metadata.tables[table_name].create(sync_conn)
            )


# ---------------------------------------------------------
# Database Schema Validation
# ---------------------------------------------------------
async def validate_db_schema() -> list[str]:
    """
    Validate schema and return a list of mismatch details.

    Checks (simplified list):
    1. Column existence and type (with length checks)
    2. Missing columns (that aren't nullable or have default)
    3. Index existence
    4. Foreign key constraints
    5. Unique constraints
    6. Default values
    7. Basic relationship checks

    Return:
        A list of strings describing any mismatches found.
        An empty list means everything matches the ORM definitions.
    """
    logger.info("Validating database schema...")
    mismatch_details = []

    async with async_engine.connect() as conn:
        # -------------------------------------------------
        # 1. Retrieve database schema from information_schema
        # -------------------------------------------------
        result = await conn.execute(
            text(
                """
            SELECT table_name, column_name, data_type, udt_name, character_maximum_length
            FROM information_schema.columns
            WHERE table_schema = 'public'
        """
            )
        )
        db_schema = {
            (row.table_name, row.column_name): {
                "data_type": row.data_type,
                "udt_name": row.udt_name,
                "max_length": row.character_maximum_length,
            }
            for row in result
        }

        # -------------------------------------------------
        # 2. Prepare an ORM-based schema representation
        # -------------------------------------------------
        # Basic type equivalents
        type_equivalents = {
            "VARCHAR": ["character varying"],
            "TEXT": ["text"],
            "TIMESTAMP": ["timestamp without time zone"],
            "UUID": ["uuid"],
            "JSONB": ["jsonb"],
            "INTEGER": ["integer", "int4"],
            "BIGINT": ["bigint", "int8"],
            "BOOLEAN": ["boolean", "bool"],
        }

        # Build a dict with (table, column) -> type_string
        orm_schema = {}
        for table in Base.metadata.tables.values():
            for column in table.columns:
                orm_base_type = str(column.type).split("(")[0].upper()
                # Check if it's a VARCHAR with length
                length = getattr(column.type, "length", None)
                if length and orm_base_type == "VARCHAR":
                    orm_type = f"character varying({length})"
                else:
                    # Use the first equivalent for normalization
                    orm_type = type_equivalents.get(
                        orm_base_type, [orm_base_type.lower()]
                    )[0]
                orm_schema[(table.name, column.name)] = orm_type

        # -------------------------------------------------
        # 3. Compare DB schema vs. ORM schema
        # -------------------------------------------------
        for (table, column), orm_type in orm_schema.items():
            db_info = db_schema.get((table, column))
            if not db_info:
                mismatch_details.append(f"Missing column: {table}.{column}")
                continue

            db_type = db_info["data_type"]
            udt_name = db_info["udt_name"]
            db_max_length = db_info["max_length"]

            # Original column type object:
            table_obj = Base.metadata.tables[table]
            column_obj = table_obj.columns[column]
            orm_base_type = str(column_obj.type).split("(")[0].upper()
            equivalents = type_equivalents.get(orm_base_type, [orm_base_type.lower()])

            # Decide if types match
            type_matches = False

            # (a) Specialized checks for VARCHAR
            if orm_base_type == "VARCHAR" and orm_type.startswith("character varying"):
                if db_type == "character varying":
                    actor_length = None
                    if "(" in orm_type:
                        actor_length = int(orm_type.split("(")[1].split(")")[0])
                    if actor_length and db_max_length and db_max_length != actor_length:
                        mismatch_details.append(
                            f"Length mismatch: {table}.{column} "
                            f"DB: varchar({db_max_length}) vs ORM: varchar({actor_length})"
                        )
                    else:
                        # If length omitted in ORM or matches, we consider them okay
                        type_matches = True

            # (b) TEXT check
            elif orm_type.startswith("text"):
                type_matches = db_type == "text"

            # (c) Typical enumerations: UUID, JSONB, INTEGER, BIGINT, BOOLEAN
            elif orm_base_type in type_equivalents:
                # Check DB UDT name vs recognized equivalents
                if udt_name.lower() in [e.lower() for e in equivalents]:
                    type_matches = True
                # Special boolean alias
                if orm_base_type == "BOOLEAN" and udt_name.lower() == "bool":
                    type_matches = True

            # (d) Timestamps
            elif orm_type == "timestamp without time zone":
                type_matches = db_type == "timestamp without time zone"
            elif "timestamp" in db_type.lower() and "timestamp" in orm_type.lower():
                # Might want to parse precision, but skipping for brevity
                type_matches = True

            if not type_matches:
                mismatch_details.append(
                    f"Type mismatch: {table}.{column} - "
                    f"DB: {db_type}{f'({db_max_length})' if db_max_length else ''} "
                    f"vs ORM: {orm_type}"
                )

        # -------------------------------------------------
        # 4. Check for missing columns that are not nullable or have no default
        # -------------------------------------------------
        orm_columns = set(orm_schema.keys())
        db_columns = set(db_schema.keys())
        missing_columns = orm_columns - db_columns
        for table, column in missing_columns:
            orm_col = Base.metadata.tables[table].columns[column]
            if orm_col.server_default is not None or orm_col.nullable:
                logger.debug(
                    f"Skipping missing column {table}.{column} "
                    f"because it's nullable or has a default."
                )
                continue
            mismatch_details.append(f"Missing column: {table}.{column}")

        # -------------------------------------------------
        # 5. Index checks via sync inspector
        # -------------------------------------------------
        sync_inspector = inspect(sync_engine)
        for table in Base.metadata.tables.values():
            table_name = table.name
            if not sync_inspector.has_table(table_name):
                continue
            db_indexes = {idx["name"] for idx in sync_inspector.get_indexes(table_name)}
            for idx in table.indexes:
                if idx.name not in db_indexes:
                    mismatch_details.append(f"Missing index: {table_name}.{idx.name}")

        # -------------------------------------------------
        # 6. Foreign key constraint checks
        # -------------------------------------------------
        for table in Base.metadata.tables.values():
            table_name = table.name
            if not sync_inspector.has_table(table_name):
                continue
            db_fks = sync_inspector.get_foreign_keys(table_name)
            db_fk_tuples = {
                (
                    fk["constrained_columns"][0],
                    fk["referred_table"],
                    fk.get("ondelete"),
                    fk["referred_columns"][0] if fk["referred_columns"] else None,
                )
                for fk in db_fks
                if fk["constrained_columns"]
            }
            for fk in table.foreign_keys:
                col_name = fk.parent.name
                referred_table = fk.column.table.name
                referred_col = fk.column.name
                ondelete_clause = fk.ondelete.upper() if fk.ondelete else None
                check_tuple = (col_name, referred_table, ondelete_clause, referred_col)
                if check_tuple not in db_fk_tuples:
                    mismatch_details.append(
                        f"Missing or incorrect foreign key for {table_name}.{col_name} -> "
                        f"{referred_table}.{referred_col} (ondelete={ondelete_clause})"
                    )

        # -------------------------------------------------
        # 7. Unique constraints check
        # -------------------------------------------------
        for table in Base.metadata.tables.values():
            table_name = table.name
            if not sync_inspector.has_table(table_name):
                continue
            try:
                db_uniques = sync_inspector.get_unique_constraints(table_name)
                db_unique_columns_set = {
                    tuple(sorted(u["column_names"]))
                    for u in db_uniques
                    if u["column_names"]
                }
                # Check single-column unique
                for col in table.columns:
                    if col.unique:
                        if (col.name,) not in db_unique_columns_set:
                            mismatch_details.append(
                                f"Missing or incorrect unique constraint on {table_name}.{col.name}"
                            )
                # Check multi-column unique constraints
                for constraint in table.constraints:
                    if constraint.__class__.__name__ == "UniqueConstraint":
                        orm_cols = tuple(sorted([c.name for c in constraint.columns]))
                        if orm_cols not in db_unique_columns_set:
                            mismatch_details.append(
                                f"Missing or incorrect multi-column unique constraint "
                                f"on {table_name} columns {orm_cols}"
                            )
            except Exception as e:
                logger.debug(
                    f"Skipping unique constraint check for {table_name} due to: {e}"
                )

        # -------------------------------------------------
        # 8. Default values check (basic)
        # -------------------------------------------------
        for table in Base.metadata.tables.values():
            for col in table.columns:
                if col.server_default is not None:
                    # Extract the default argument (may be string or SQL expression)
                    orm_default_arg = col.server_default.arg

                    # Convert the arg to a string to safely compare or log
                    orm_default_str = str(orm_default_arg)

                    # You can now do your normalization / comparison
                    normalized_orm_def = orm_default_str.strip("('").lower()

                    # Now compare with the DB default
                    default_sql = await conn.execute(
                        text(
                            f"""
                        SELECT column_default
                        FROM information_schema.columns
                        WHERE table_name='{table.name}'
                        AND column_name='{col.name}'
                        AND table_schema='public'
                    """
                        )
                    )
                    db_row = default_sql.fetchone()
                    db_default = db_row[0] if db_row else None
                    if db_default and isinstance(db_default, str):
                        normalized_db_def = db_default.strip("('::text)").lower()
                        if normalized_db_def != normalized_orm_def:
                            mismatch_details.append(
                                f"Default mismatch on {table.name}.{col.name}: "
                                f"DB={db_default} vs ORM={orm_default_str}"
                            )

        # Relationship checks are somewhat covered by foreign keys above

    return mismatch_details


# ---------------------------------------------------------
# Comprehensive schema alignment (DDL) function
# ---------------------------------------------------------
def _retry_foreign_key_add(
    sync_conn,
    table_name: str,
    col_name: str,
    referred_table: str,
    referred_col: str,
    ondelete_clause: Optional[str] = None,
    max_retries: int = 3,
) -> None:
    """
    Try adding a foreign key constraint up to `max_retries` times,
    handling potential deadlocks by sleeping briefly between attempts.
    Reduces nested blocks by flattening logic for reattempt.
    """
    constraint_name = f"fk_{table_name}_{col_name}_{referred_table}"
    ondelete_sql = f" ON DELETE {ondelete_clause}" if ondelete_clause else ""

    for attempt in range(max_retries):
        try:
            sync_conn.execute(
                text(
                    f"ALTER TABLE {table_name}\n"
                    f"ADD CONSTRAINT {constraint_name}\n"
                    f"FOREIGN KEY ({col_name})\n"
                    f"REFERENCES {referred_table}({referred_col})\n"
                    f"{ondelete_sql}\n"
                )
            )
            logger.info(
                f"Added/updated foreign key: {table_name}.{col_name} -> "
                f"{referred_table}.{referred_col} ON DELETE {ondelete_clause or 'NO ACTION'}"
            )
            return
        except Exception as e:
            # Flattening the deadlock retry logic to reduce nested blocks
            if "deadlock" in str(e).lower() and attempt < max_retries - 1:
                sleep_time = 0.3 * (attempt + 1)
                logger.warning(
                    f"Deadlock detected adding foreign key {constraint_name}, retrying in {sleep_time}s... "
                    f"(Attempt {attempt + 1}/{max_retries})"
                )
                time.sleep(sleep_time)
                continue
            logger.error(
                f"Failed to add foreign key {constraint_name}: {e} "
                f"after {attempt + 1} attempts"
            )
            raise


async def fix_db_schema() -> None:
    """
    Comprehensive schema alignment using synchronous session for DDL.
    Attempts to create missing columns, fix column types, add indexes,
    and correct foreign key constraints.
    """
    from sqlalchemy.dialects.postgresql import UUID as PG_UUID

    logger.info("Starting comprehensive schema alignment...")

    with sync_engine.begin() as sync_conn:
        inspector = inspect(sync_conn)
        # Add statement timeout to prevent indefinite blocking
        sync_conn.execute(text("SET statement_timeout = 30000"))

        # 1. Create missing tables using the simpler approach
        existing_tables = set(inspector.get_table_names())
        total_tables = len(Base.metadata.tables)
        for idx, (table_name, table) in enumerate(Base.metadata.tables.items(), 1):
            if table_name not in existing_tables:
                logger.info(
                    f"({idx}/{total_tables}) Creating missing table: {table_name}"
                )
                table.create(sync_conn)  # or table.create(bind=sync_conn)
            else:
                logger.debug(
                    f"({idx}/{total_tables}) Table already exists: {table_name}"
                )

        # Special handling for token_blacklist as in your code
        if inspector.has_table("token_blacklist"):
            sync_conn.execute(
                text(
                    """
                ALTER TABLE token_blacklist
                ADD COLUMN IF NOT EXISTS creation_reason VARCHAR(50) NOT NULL DEFAULT ''
            """
                )
            )
            sync_conn.execute(
                text(
                    """
                ALTER TABLE token_blacklist
                ADD COLUMN IF NOT EXISTS created_at TIMESTAMP
                NOT NULL DEFAULT CURRENT_TIMESTAMP
            """
                )
            )
            sync_conn.execute(
                text(
                    """
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'token_blacklist'
                        AND column_name = 'created_at'
                        AND data_type = 'timestamp with time zone'
                    ) THEN
                        ALTER TABLE token_blacklist
                        ALTER COLUMN created_at TYPE TIMESTAMP WITHOUT TIME ZONE;
                    END IF;
                END $$;
            """
                )
            )
            logger.info("Ensured token_blacklist schema compliance")

        # 2. Add or create missing columns
        for table_name, table in Base.metadata.tables.items():
            if not inspector.has_table(table_name):
                # If the table doesn't exist yet, we've just created it above
                continue

            db_cols = {c["name"] for c in inspector.get_columns(table_name)}
            orm_cols = set(table.columns.keys())

            missing = orm_cols - db_cols
            for col_name in missing:
                col = table.columns[col_name]
                # You can let SQLAlchemy generate the DDL:
                #
                # col.create(sync_conn)
                #
                # Or do the explicit approach with text-based DDL:
                col_type_str = col.type.compile(sync_engine.dialect)
                col_spec = f"{col_name} {col_type_str}"

                # Provide a fallback default for NOT NULL columns with no server default
                if not col.nullable and col.server_default is None:
                    if str(col.type) == "JSONB":
                        col_spec += " DEFAULT '{}'::jsonb"
                    elif str(col.type) == "BOOLEAN":
                        col_spec += " DEFAULT false"
                    elif str(col.type).startswith("INTEGER"):
                        col_spec += " DEFAULT 0"
                    elif str(col.type).startswith("BIGINT"):
                        col_spec += " DEFAULT 0"
                    elif "UUID" in str(col.type).upper():
                        # gen_random_uuid() requires 'pgcrypto' extension in some Postgres versions
                        col_spec += " DEFAULT gen_random_uuid()"
                    elif (
                        col_name == "created_at"
                        and "TIMESTAMP" in str(col.type).upper()
                    ):
                        col_spec += " DEFAULT CURRENT_TIMESTAMP"
                    else:
                        # Fallback default
                        col_spec += " DEFAULT ''"

                col_spec += " NOT NULL" if not col.nullable else " NULL"

                # If the ORM column has a default, you can attempt to incorporate it
                if col.server_default is not None:
                    col_spec += f" DEFAULT {col.server_default.arg}"

                # Avoid issues with unquoted or special defaults
                # Adjust as needed for your domain
                ddl = f"""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_name = '{table_name}'
                          AND column_name = '{col_name}'
                          AND table_schema = 'public'
                    ) THEN
                        ALTER TABLE {table_name} ADD COLUMN {col_spec};
                    END IF;
                END $$;
                """
                sync_conn.execute(text(ddl))
                logger.info(f"Added column {table_name}.{col_name}")

        # 3. Create missing indexes
        for table_name, table in Base.metadata.tables.items():
            if not inspector.has_table(table_name):
                continue

            db_indexes = {idx["name"] for idx in inspector.get_indexes(table_name)}
            for idx in table.indexes:
                if idx.name not in db_indexes:
                    # Verify the index's columns exist
                    index_col_names = {col.name for col in idx.columns}
                    existing_col_names = {
                        c["name"] for c in inspector.get_columns(table_name)
                    }
                    missing_cols = index_col_names - existing_col_names
                    if missing_cols:
                        logger.warning(
                            f"Skipping creation of index {idx.name} on {table_name} "
                            f"- missing columns: {missing_cols}"
                        )
                        continue
                    logger.info(f"Creating index {idx.name} on {table_name}")
                    try:
                        # If you prefer concurrency:
                        # if idx.dialect_kwargs.get('postgresql_concurrently'):
                        #     sync_conn.execute(text(f"CREATE INDEX CONCURRENTLY {idx.name} "
                        #                            f"ON {table_name} ({','.join(index_col_names)})"))
                        # else:
                        idx.create(sync_conn)
                    except Exception as e:
                        logger.error(f"Failed to create index {idx.name}: {e}")

        # 4. Column type alterations if needed
        db_tables = inspector.get_table_names()
        for table_name, table in Base.metadata.tables.items():
            if table_name not in db_tables:
                continue
            db_cols = inspector.get_columns(table_name)
            db_col_dict = {c["name"]: c for c in db_cols}

            for col_name, orm_col in table.columns.items():
                if col_name not in db_col_dict:
                    continue
                db_col = db_col_dict[col_name]
                db_type_name = str(db_col["type"]).split("(")[0]
                orm_type_name = str(orm_col.type).split("(")[0]

                if db_type_name != orm_type_name:
                    logger.warning(
                        f"Potential type mismatch: {table_name}.{col_name} (DB: {db_type_name} vs ORM: {orm_type_name})"
                    )
                    # Attempt some safe conversions
                    if "VARCHAR" in db_type_name and "TEXT" in orm_type_name:
                        sync_conn.execute(
                            text(
                                f"ALTER TABLE {table_name} ALTER COLUMN {col_name} TYPE TEXT"
                            )
                        )
                        logger.info(
                            f"Converted {table_name}.{col_name} from VARCHAR to TEXT"
                        )
                    elif orm_type_name.upper() in ["TEXT"] and db_type_name != "text":
                        try:
                            sync_conn.execute(
                                text(
                                    f"ALTER TABLE {table_name} ALTER COLUMN {col_name} TYPE TEXT"
                                )
                            )
                            logger.info(f"Converted {table_name}.{col_name} to TEXT")
                        except Exception as e:
                            logger.error(
                                f"Failed to convert {table_name}.{col_name} to TEXT: {e}"
                            )
                    elif (
                        isinstance(orm_col.type, PG_UUID)
                        and db_type_name.lower() != "uuid"
                    ):
                        # Convert from char/varchar to UUID
                        try:
                            sync_conn.execute(
                                text(
                                    f"ALTER TABLE {table_name} "
                                    f"ALTER COLUMN {col_name} TYPE UUID USING {col_name}::uuid"
                                )
                            )
                            logger.info(f"Converted {table_name}.{col_name} to UUID")
                        except Exception as e:
                            logger.error(f"Direct alter to UUID failed: {e}")
                            # Fallback approach: create temp column, copy, drop old, rename
                            temp_col_name = f"{col_name}_new"
                            sync_conn.execute(
                                text(
                                    f"ALTER TABLE {table_name} "
                                    f"ADD COLUMN {temp_col_name} UUID DEFAULT gen_random_uuid()"
                                )
                            )
                            sync_conn.execute(
                                text(
                                    f"UPDATE {table_name} SET {temp_col_name} = {col_name}::uuid "
                                    f"WHERE {col_name} ~ '^[0-9a-fA-F-]{{36}}$'"
                                )
                            )
                            # The above `WHERE` tries to filter valid UUID strings
                            sync_conn.execute(
                                text(f"ALTER TABLE {table_name} DROP COLUMN {col_name}")
                            )
                            sync_conn.execute(
                                text(
                                    f"ALTER TABLE {table_name} RENAME COLUMN {temp_col_name} TO {col_name}"
                                )
                            )
                            logger.info(
                                f"Migrated {table_name}.{col_name} to UUID via new column approach"
                            )

        # 5. Foreign key constraint fixes
        for table_name, table in Base.metadata.tables.items():
            if not inspector.has_table(table_name):
                continue

            db_fks = inspector.get_foreign_keys(table_name)
            db_fk_cols = {
                (fk["constrained_columns"][0], fk["referred_table"], fk.get("ondelete"))
                for fk in db_fks
                if fk["constrained_columns"]
            }

            for fk in table.foreign_keys:
                col_name = fk.parent.name
                referred_table = fk.column.table.name
                referred_col = fk.column.name
                ondelete = None
                # Gather ondelete from the foreign key if present
                for c in table.columns:
                    if c.name == col_name:
                        for fk_constraint in c.foreign_keys:
                            if fk_constraint.ondelete:
                                ondelete = fk_constraint.ondelete.upper()

                tuple_check = (col_name, referred_table, ondelete)
                if tuple_check not in db_fk_cols:
                    # Possibly we have an existing constraint with different ondelete
                    # or none at all. We'll drop any that partially match if needed:
                    for existing_fk in db_fks:
                        if (
                            existing_fk["constrained_columns"]
                            and existing_fk["constrained_columns"][0] == col_name
                            and existing_fk["referred_table"] == referred_table
                        ):
                            try:
                                sync_conn.execute(
                                    text(
                                        f"ALTER TABLE {table_name} DROP CONSTRAINT {existing_fk['name']}"
                                    )
                                )
                                logger.info(
                                    f"Dropped existing FK {existing_fk['name']} to update with correct cascade rules"
                                )
                            except Exception as drop_err:
                                logger.warning(
                                    f"Could not drop {existing_fk['name']}: {drop_err}"
                                )
                                continue

                    _retry_foreign_key_add(
                        sync_conn,
                        table_name,
                        col_name,
                        referred_table,
                        referred_col,
                        ondelete,
                    )

    logger.info("Finished comprehensive schema alignment.")


# ---------------------------------------------------------
# Main Database Initialization
# ---------------------------------------------------------
async def init_db() -> None:
    """
    Initialize database with improved progress tracking:
      1. Create missing tables (async approach).
      2. Align schema (fix columns, indexes, FKs, etc.).
      3. Validate final schema and log mismatches.
    """
    try:
        logger.info("Database initialization started...")

        # Step 1: Create missing tables
        logger.info("Checking for missing tables...")
        existing_tables = await _get_existing_tables()
        tables_to_create = [
            t for t in Base.metadata.tables.keys() if t not in existing_tables
        ]
        if tables_to_create:
            await _create_missing_tables(tables_to_create)

        # Step 2: Schema alignment
        logger.info("Running schema alignment (DDL fixes)...")
        await fix_db_schema()

        # Step 3: Final validation
        logger.info("Validating final schema...")
        mismatch_details = await validate_db_schema()
        if mismatch_details:
            logger.warning(
                f"Schema validation completed with {len(mismatch_details)} issue(s)."
            )
            # Log just the first few
            for issue in mismatch_details[:7]:
                logger.warning(f"  - {issue}")
        else:
            logger.info(
                "Schema validation successful! All ORM definitions match the database."
            )
    except Exception as e:
        logger.error(f"❌ DB initialization failed: {str(e)}")
        raise
