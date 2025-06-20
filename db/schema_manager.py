"""
Database Schema Management Module (`db.schema_manager`)
-------------------------------------------------------

Central point for database schema validation, automatic alignment, and initialization logic.
This module orchestrates comprehensive schema checks, repair, and migration routines to ensure
the runtime PostgreSQL database matches SQLAlchemy ORM definitions, with strong automation and safety controls.

Features:
- Declarative async `SchemaManager` that can:
    * Initialize database state (creating any missing tables in correct dependency order)
    * Validate the DB schema against ORM models and generate human-readable differences
    * Automatically align schema: add missing columns, indexes, FKs,
      (optionally) drop obsolete columns/indexes and alter types if enabled via env flag
    * Handle tricky circular dependency (projects ↔ knowledge_bases) and order of creation safely
- Pluggable Alembic auto-migration helper: can generate, skip, and prune no-op migrations,
  with clear logging and protection against reload loops (see `automated_alembic_migrate`)
- Full logging and auditability of all changes (additions, drops, type mismatches, attempts/failures)
- All destructive/irreversible changes (dropping or altering columns) are by default off
  and gated via `AUTO_SCHEMA_DESTRUCTIVE=true` in the environment. Always back up before enabling destructive mode!
- Built for both production runtime (async) and development/CLI invocation
- Exports an async interface for service initialization and CI/CD automation
- Designed to robustly interoperate with the engines/session provided by `db.db`
- Integration point with Alembic migration system, but can operate "migrationless" if needed

Environment/config flags recognized:
- `ENABLE_AUTO_MIGRATION` (autogenerate/apply Alembic migrations during init if true)
- `AUTO_SCHEMA_DESTRUCTIVE` (enable column/index dropping and type alteration if true)

Main entry points:
- `SchemaManager.initialize_database()` (async) — full migration/validation/fix pass
- `SchemaManager.validate_schema()` (async) — analyze current DB and report mismatches
- `SchemaManager.fix_schema()` (async) — forcibly repair mismatched schema to match ORM base
- `automated_alembic_migrate()` — autogen/apply Alembic migration with no-op skip

"""

import os
# (keep glob if you run migrations from glob elsewhere, otherwise safe for removal)
import logging
import time
# Alembic removed – all migration logic is now native
from typing import Optional, List, Set
import hashlib
from pathlib import Path

from sqlalchemy import inspect, text, UniqueConstraint, CheckConstraint
from sqlalchemy.schema import AddConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.ext.asyncio import AsyncConnection

from db.db import Base, sync_engine, async_engine
from config import settings

logger = logging.getLogger(__name__)

MIGRATIONS_PATH = Path(__file__).parent.parent / "db" / "migrations"


# -----------------------------------------------------------------
# Alembic helper function removed.  All versioning now flows through:
#   1. versioned SQL files in MIGRATIONS_PATH  (V###__desc.sql)
#   2. runtime auto-alignment via SchemaManager.fix_schema()
# -----------------------------------------------------------------


class SchemaManager:
    """
    SchemaManager now supports automatic schema alignment:
    - Adds missing tables, columns, indexes, and foreign keys.
    - (Optional) Drops obsolete columns and alters column types if AUTO_SCHEMA_DESTRUCTIVE=true.
    - Logs all changes for auditability.

    Caution:
    - Destructive changes (dropping columns, altering types) are only performed if
      the environment variable AUTO_SCHEMA_DESTRUCTIVE=true is set.
    - Always back up your database before enabling destructive schema changes.
    """

    def __init__(self):
        # Type equivalents for schema validation
        self.type_equivalents = {
            "VARCHAR": ["character varying"],
            "TEXT": ["text"],
            # For TIMESTAMP(timezone=False) which stringifies to 'TIMESTAMP WITHOUT TIME ZONE'
            "TIMESTAMP WITHOUT TIME ZONE": ["timestamp without time zone", "timestamp"],
            # For TIMESTAMP(timezone=True) which stringifies to 'TIMESTAMP WITH TIME ZONE'
            "TIMESTAMP WITH TIME ZONE": ["timestamp with time zone"],
            "UUID": ["uuid"],
            "JSONB": ["jsonb"],
            "INTEGER": ["integer", "int4"],
            "BIGINT": ["bigint", "int8"],
            "BOOLEAN": ["boolean", "bool"],
        }

    # ---------------------------------------------------------
    # Public Interface
    # ---------------------------------------------------------

    async def migrate(self, migrations_path: Path = MIGRATIONS_PATH) -> None:
        """
        Applies SQL migrations from the specified path.
        Tracks executed migrations in the schema_history table.
        Uses a PostgreSQL advisory lock to ensure multi-pod safety.
        """
        logger.info(f"Starting database migration process from {migrations_path}...")

        async with async_engine.begin() as conn:
            # Acquire advisory lock
            lock_acquired = await conn.execute(text("SELECT pg_try_advisory_lock(hashtext('schema_migrate'))"))
            if not lock_acquired.scalar_one():
                logger.warning("Could not acquire schema migration lock. Another migration process may be running.")
                # Depending on desired behavior, could raise an error or just return
                return

            try:
                await conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS schema_history (
                        version         BIGINT       PRIMARY KEY,
                        description     TEXT         NOT NULL,
                        installed_on    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        installed_by    TEXT         NOT NULL,
                        execution_time  INTEGER      NOT NULL,
                        success         BOOLEAN      NOT NULL,
                        checksum        TEXT         NOT NULL
                    );
                """))
                # Unique partial index for retrying failed migrations
                await conn.execute(text("""
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_schema_history_version_success
                    ON schema_history (version)
                    WHERE success;
                """))
                logger.info("Ensured schema_history table exists.")

                result = await conn.execute(text("SELECT version FROM schema_history WHERE success = TRUE"))
                applied_versions = {row[0] for row in result}
                logger.info(f"Found {len(applied_versions)} successfully applied migration versions: {applied_versions}")

                if not migrations_path.exists():
                    logger.info("Migrations directory %s does not exist. Skipping migration step.", migrations_path)
                    return

                migration_files = sorted(migrations_path.glob("V*.sql"))
                logger.info(f"Found {len(migration_files)} migration files in {migrations_path}.")

                for sql_file in migration_files:
                    try:
                        version_str = sql_file.name.split("__")[0][1:]
                        version = int(version_str)
                        description = sql_file.name.split("__")[1].split(".sql")[0].replace("_", " ")
                    except (IndexError, ValueError) as e:
                        logger.error(f"Could not parse version/description from filename {sql_file.name}: {e}")
                        continue

                    if version in applied_versions:
                        # Optional: Add checksum validation for already applied migrations
                        # result_checksum = await conn.execute(text("SELECT checksum FROM schema_history WHERE version = :v AND success = TRUE"), {"v": version})
                        # db_checksum = result_checksum.scalar_one_or_none()
                        # current_checksum = hashlib.sha256(sql_file.read_text().encode()).hexdigest()
                        # if db_checksum != current_checksum:
                        #     logger.error(f"Checksum mismatch for applied migration {sql_file.name}! DB: {db_checksum}, File: {current_checksum}")
                        #     raise RuntimeError(f"Checksum mismatch for applied migration {sql_file.name}")
                        continue

                    logger.info(f"Attempting to apply migration: {sql_file.name} (Version: {version})")
                    sql_content = sql_file.read_text()
                    checksum = hashlib.sha256(sql_content.encode()).hexdigest()
                    installed_by = settings.APP_NAME

                    start_time = time.perf_counter()
                    try:
                        await conn.execute(text(sql_content))
                        duration_ms = int((time.perf_counter() - start_time) * 1000)
                        await conn.execute(
                            text("""
                                INSERT INTO schema_history (version, description, installed_by, execution_time, success, checksum)
                                VALUES (:version, :description, :installed_by, :execution_time, TRUE, :checksum)
                                ON CONFLICT (version) WHERE success DO UPDATE SET
                                    description = EXCLUDED.description,
                                    installed_on = CURRENT_TIMESTAMP,
                                    installed_by = EXCLUDED.installed_by,
                                    execution_time = EXCLUDED.execution_time,
                                    success = TRUE,
                                    checksum = EXCLUDED.checksum;
                            """),
                            {
                                "version": version,
                                "description": description,
                                "installed_by": installed_by,
                                "execution_time": duration_ms,
                                "checksum": checksum,
                            },
                        )
                        logger.info(f"Successfully applied migration {sql_file.name} in {duration_ms}ms.")
                    except Exception as e:
                        duration_ms = int((time.perf_counter() - start_time) * 1000)
                        logger.error(f"Failed to apply migration {sql_file.name}: {e}", exc_info=True)
                        await conn.execute(
                            text("""
                                INSERT INTO schema_history (version, description, installed_by, execution_time, success, checksum)
                                VALUES (:version, :description, :installed_by, :execution_time, FALSE, :checksum)
                                ON CONFLICT (version) DO UPDATE SET
                                    description = EXCLUDED.description,
                                    installed_on = CURRENT_TIMESTAMP,
                                    installed_by = EXCLUDED.installed_by,
                                    execution_time = EXCLUDED.execution_time,
                                    success = FALSE,
                                    checksum = EXCLUDED.checksum;
                            """),
                            {
                                "version": version,
                                "description": description,
                                "installed_by": installed_by,
                                "execution_time": duration_ms,
                                "checksum": checksum,
                            },
                        )
                        raise  # Re-raise the exception to ensure the transaction rolls back and failure is visible
            finally:
                # Release advisory lock
                await conn.execute(text("SELECT pg_advisory_unlock(hashtext('schema_migrate'))"))
                logger.info("Released schema migration lock.")
        logger.info("Database migration process finished.")

    async def initialize_database(self) -> None:
        """
        Full database initialization process:
        1️⃣ Versioned SQL files (Flyway-style)
        2️⃣ Auto-alignment – additive changes & optional destructive fixes
        3️⃣ Validate
        """
        try:
            logger.info("Starting database initialization...")

            # 1️⃣  Versioned SQL files (Flyway-style)
            await self.migrate()

            # 2️⃣  Auto-alignment – additive changes & optional destructive fixes
            logger.info("Running schema alignment (fix_schema)...")
            await self.fix_schema()

            # 3️⃣  Validate
            logger.info("Validating schema...")
            issues = await self.validate_schema()
            if issues:
                msg = f"Schema validation completed with {len(issues)} issues."
                logger.warning(msg)
                for issue in issues[:5]:  # Log first 5 issues
                    logger.warning(f"  - {issue}")
                if len(issues) > 5:
                    logger.warning(f"...and {len(issues) - 5} more issues.")
            else:
                logger.info("Schema validation successful - no issues found")

        except Exception as e:
            logger.error(f"Database initialization failed: {str(e)}")
            raise

    async def validate_schema(self) -> List[str]:
        """
        Validate the database schema against SQLAlchemy ORM definitions.
        Returns a list of mismatch descriptions.
        """
        logger.info("Validating database schema...")
        mismatch_details = []

        # Get database schema information
        db_schema = await self._get_db_schema()

        # Compare against ORM definitions
        for table_name, table in Base.metadata.tables.items():
            if table_name not in db_schema["tables"]:
                mismatch_details.append(f"Missing table: {table_name}")
                continue

            # Check columns
            for column in table.columns:
                if column.name not in db_schema["columns"].get(table_name, {}):
                    mismatch_details.append(
                        f"Missing column: {table_name}.{column.name}"
                    )
                    continue

                # Check column types
                db_col = db_schema["columns"][table_name][column.name]
                if not self._types_match(
                    column.type, db_col["type"], db_col.get("length")
                ):
                    db_type_str = db_col['type']
                    db_length = db_col.get('length')
                    db_type_display = f"{db_type_str}({db_length})" if db_length else db_type_str
                    mismatch_details.append(
                        f"Type mismatch: {table_name}.{column.name} (DB: {db_type_display} vs ORM: {column.type})"
                    )

            # Check indexes
            for index in table.indexes:
                if index.name not in db_schema["indexes"].get(table_name, []):
                    mismatch_details.append(f"Missing index: {table_name}.{index.name}")

            # Check constraints
            for constraint in table.constraints:
                if not constraint.name:  # type: ignore
                    continue  # skip unnamed constraints
                if constraint.name not in db_schema["constraints"].get(table_name, []):  # type: ignore
                    mismatch_details.append(
                        f"Missing constraint: {table_name}.{constraint.name}"  # type: ignore
                    )

        return mismatch_details

    async def fix_schema(self) -> None:
        """Schema alignment using async connection"""
        logger.info("Starting schema alignment...")

        destructive = os.getenv("AUTO_SCHEMA_DESTRUCTIVE", "false").lower() == "true"

        async with async_engine.begin() as conn:
            # Create missing tables and align schema with ORM
            await conn.run_sync(Base.metadata.create_all)

            # Add missing columns, indexes, and foreign key constraints as needed
            for table in Base.metadata.tables.values():
                table_exists = await conn.run_sync(
                    lambda sync_conn, table=table: inspect(sync_conn).has_table(table.name)
                )
                if not table_exists:
                    continue

                db_columns_set = await conn.run_sync(
                    lambda sync_conn, table=table: {c["name"] for c in inspect(sync_conn).get_columns(table.name)}
                )
                for column in table.columns:
                    if column.name not in db_columns_set:
                        logger.info(f"Adding column: {table.name}.{column.name}")
                        await self._add_column(conn, table.name, column)

            # --- Enhanced: Drop obsolete columns and alter column types ---
            for table in Base.metadata.tables.values():
                table_exists = await conn.run_sync(
                    lambda sync_conn, table=table: inspect(sync_conn).has_table(table.name)
                )
                if not table_exists:
                    continue

                db_columns = await conn.run_sync(
                    lambda sync_conn, table=table: {c["name"]: c for c in inspect(sync_conn).get_columns(table.name)}
                )
                orm_columns = {col.name: col for col in table.columns}

                # Drop columns not in ORM (if enabled)
                if destructive:
                    for db_col_name in db_columns:
                        if db_col_name not in orm_columns:
                            logger.warning(f"Dropping obsolete column: {table.name}.{db_col_name}")
                            try:
                                await conn.execute(
                                    text(f'ALTER TABLE "{table.name}" DROP COLUMN "{db_col_name}"')
                                )
                                logger.info(f"Dropped column: {table.name}.{db_col_name}")
                            except Exception as e:
                                logger.error(f"Failed to drop column {table.name}.{db_col_name}: {e}")

                # Alter column types if mismatched (if enabled)
                for col_name, db_col in db_columns.items():
                    if col_name in orm_columns:
                        orm_col = orm_columns[col_name]
                        db_type = db_col["type"]
                        # Compile ORM type to string for comparison
                        try:
                            orm_type = orm_col.type.compile(sync_engine.dialect)
                        except Exception:
                            orm_type = str(orm_col.type)
                        # Compare types (case-insensitive, ignore length for now)
                        if str(db_type).lower() != str(orm_type).lower():
                            logger.warning(
                                f"Type mismatch for {table.name}.{col_name}: DB={db_type}, ORM={orm_type}. "
                                "Manual intervention may be required."
                            )
                            if destructive:
                                try:
                                    await conn.execute(
                                        text(f'ALTER TABLE "{table.name}" ALTER COLUMN "{col_name}" TYPE {orm_type}')
                                    )
                                    logger.info(f"Altered column type: {table.name}.{col_name} to {orm_type}")
                                except Exception as e:
                                    logger.error(f"Failed to alter column type for {table.name}.{col_name}: {e}")

            # 3. Create missing indexes
            for table in Base.metadata.tables.values():
                table_exists = await conn.run_sync(
                    lambda sync_conn: inspect(sync_conn).has_table(table.name)
                )
                if not table_exists:
                    continue

                db_indexes = await conn.run_sync(
                    lambda sync_conn: {idx["name"] for idx in inspect(sync_conn).get_indexes(table.name)}
                )
                for index in table.indexes:
                    if index.name not in db_indexes:
                        logger.info(f"Creating index: {table.name}.{index.name}")
                        try:
                            await conn.run_sync(lambda sync_conn: index.create(sync_conn))
                        except Exception as e:
                            logger.error(f"Failed to create index {index.name}: {e}")

                # Drop obsolete indexes (if enabled)
                if destructive:
                    orm_index_names = {index.name for index in table.indexes if index.name}
                    # Add names of indexes created by UniqueConstraints
                    for constraint in table.constraints:
                        if isinstance(constraint, UniqueConstraint) and constraint.name:
                            orm_index_names.add(constraint.name)
                    # Add names of indexes created by unique=True on columns (convention-based, might need refinement)
                    for column in table.columns:
                        if column.unique and column.name:  # unique=True implies an index
                            # Default naming convention for index from unique=True is often ix_tablename_colname or tablename_colname_key
                            # This is a heuristic. A more robust way would be to inspect the compiled DDL for the column.
                            # For now, we'll assume if a UniqueConstraint with a name exists for the column, it's covered.
                            # If not, and only unique=True is set, the index name is implicit.
                            # We will be cautious here to avoid dropping legitimate implicit unique indexes.
                            # A common convention for unique column index is `ix_{table.name}_{column.name}` or `{table.name}_{column.name}_key`
                            # Let's add the constraint name if the column is part of a unique constraint.
                            for constraint in table.constraints:
                                if isinstance(constraint, UniqueConstraint) and column in constraint.columns and constraint.name:
                                    orm_index_names.add(constraint.name)
                                    break

                    for db_index_name in db_indexes:
                        # Avoid dropping primary key indexes, typically named like tablename_pkey
                        if db_index_name and db_index_name.endswith("_pkey"):
                            continue
                        if db_index_name not in orm_index_names:
                            logger.warning(f"Attempting to drop potentially obsolete index: {table.name}.{db_index_name}")
                            try:
                                await conn.execute(
                                    text(f'DROP INDEX IF EXISTS "{db_index_name}"')
                                )
                                logger.info(f"Dropped index: {table.name}.{db_index_name}")
                            except Exception as e:
                                logger.error(f"Failed to drop index {table.name}.{db_index_name}: {e}")
                                # If dropping fails (e.g. due to dependency), log and continue if possible,
                                # as this might be what's causing the transaction to abort.
                                # However, InFailedSQLTransactionError means the transaction is already bad.
                                if "InFailedSQLTransactionError" in str(e):
                                    raise  # Propagate if transaction is already broken
                                logger.warning(f"Could not drop index {db_index_name} due to: {str(e)}. It might be in use by a constraint not explicitly named in ORM's table.indexes.")

                # 5. Create missing Constraints (Check, Unique, etc.)
                # Get existing check constraint names
                db_check_constraints_info = await conn.run_sync(
                    lambda sync_conn: inspect(sync_conn).get_check_constraints(table.name)
                )
                db_constraint_names = {c['name'] for c in db_check_constraints_info}

                # Get existing unique constraint names and add them
                db_unique_constraints_info = await conn.run_sync(
                    lambda sync_conn: inspect(sync_conn).get_unique_constraints(table.name)
                )
                db_constraint_names.update({c['name'] for c in db_unique_constraints_info})
                # Note: This currently doesn't fetch other types like FKs or PKs for this specific check,
                # as they are handled differently or assumed to be covered by create_all or other logic.
                # The primary goal here is to fix Check and Unique constraint creation.

                for constraint in table.constraints:
                    if constraint.name and constraint.name not in db_constraint_names:
                        if isinstance(constraint, (CheckConstraint, UniqueConstraint)):
                            logger.info(
                                f"Missing declarative constraint {table.name}.{constraint.name} of type {type(constraint).__name__}. "
                                f"Attempting to create with ALTER TABLE."
                            )
                            try:
                                # Compile DDL for adding the constraint
                                # Ensure the constraint is associated with the correct metadata if not already
                                if constraint.table is None and hasattr(constraint, '_set_parent'):
                                    constraint._set_parent(table)  # Associate with table if not already, for DDL compilation

                                add_constraint_ddl = await conn.run_sync(
                                    lambda sync_conn: str(AddConstraint(constraint).compile(dialect=sync_conn.dialect))
                                )
                                await conn.execute(text(add_constraint_ddl))
                                logger.info(f"Successfully created constraint: {table.name}.{constraint.name}")
                            except Exception as e:
                                # Check if error is due to constraint already existing (e.g., race condition or subtle naming issue)
                                if "already exists" in str(e).lower() or (
                                    "duplicate" in str(e).lower() and "constraint" in str(e).lower()
                                ):
                                    logger.warning(
                                        f"Constraint {table.name}.{constraint.name} may already exist or there was an issue with its name/definition: {e}"
                                    )
                                else:
                                    logger.error(
                                        f"Failed to create constraint {table.name}.{constraint.name} with ALTER TABLE: {e}",
                                        exc_info=True,
                                    )
                        elif hasattr(constraint, 'create'):
                            # Fallback for other constraint types that might have a .create() method
                            logger.info(f"Attempting to explicitly create other constraint type: {table.name}.{constraint.name} of type {type(constraint).__name__}")
                            try:
                                await conn.run_sync(lambda sync_conn: constraint.create(sync_conn, checkfirst=True))
                                logger.info(f"Successfully created other constraint: {table.name}.{constraint.name}")
                            except Exception as e:
                                if "already exists" in str(e).lower():
                                    logger.warning(f"Other constraint {table.name}.{constraint.name} may already exist or creation was attempted: {e}")
                                else:
                                    logger.error(f"Failed to create other constraint {table.name}.{constraint.name}: {e}", exc_info=True)
                        else:
                            logger.warning(
                                f"Constraint {table.name}.{constraint.name} of type {type(constraint).__name__} "
                                f"was not found in DB, does not have a .create() method, and is not a Check/Unique constraint for ALTER TABLE handling."
                            )

            # 4. Fix foreign key constraints (This was misnumbered as step 4 before, constraint creation is step 5)
            for table in Base.metadata.tables.values():
                table_exists = await conn.run_sync(
                    lambda sync_conn: inspect(sync_conn).has_table(table.name)
                )
                if not table_exists:
                    continue

                db_fks = await conn.run_sync(
                    lambda sync_conn: inspect(sync_conn).get_foreign_keys(table.name)
                )
                for column in table.columns:
                    for fk in column.foreign_keys:
                        if not self._fk_exists(db_fks, column.name, fk):
                            logger.info(
                                f"Adding FK: {table.name}.{column.name} -> {fk.column.table.name}.{fk.column.name}"
                            )
                            await self._add_foreign_key(conn, table.name, column.name, fk)

                # Drop obsolete foreign keys (if enabled)
                # (Not implemented here for safety; can be added similarly if needed)

        logger.info("Schema alignment completed")

    # ---------------------------------------------------------
    # Internal Helper Methods
    # ---------------------------------------------------------

    async def get_existing_tables(self) -> Set[str]:
        """Get set of existing table names in the database."""
        async with async_engine.connect() as conn:
            result = await conn.execute(
                text(
                    "SELECT table_name FROM information_schema.tables WHERE table_schema='public'"
                )
            )
            return {row[0] for row in result}

    async def _get_db_schema(self) -> dict:
        """Retrieve current database schema information."""
        schema_info: dict = {
            "tables": set(),  # Set[str]
            "columns": {},    # Dict[str, Dict[str, dict]]
            "indexes": {},    # Dict[str, Set[str]]
            "constraints": {},
        }

        async with async_engine.connect() as conn:
            # Get tables
            result = await conn.execute(
                text(
                    "SELECT table_name FROM information_schema.tables WHERE table_schema='public'"
                )
            )
            schema_info["tables"] = {row[0] for row in result}

            # Get columns
            for table in schema_info["tables"]:
                result = await conn.execute(
                    text(
                        f"""
                        SELECT column_name, data_type, character_maximum_length
                        FROM information_schema.columns
                        WHERE table_name='{table}' AND table_schema='public'
                    """
                    )
                )
                schema_info["columns"][table] = {
                    row[0]: {"type": row[1], "length": row[2]} for row in result
                }

            # Get indexes
            for table in schema_info["tables"]:
                result = await conn.execute(
                    text(
                        f"""
                        SELECT indexname FROM pg_indexes
                        WHERE tablename='{table}' AND schemaname='public'
                    """
                    )
                )
                schema_info["indexes"][table] = {row[0] for row in result}

            # Get constraints
            for table in schema_info["tables"]:
                result = await conn.execute(
                    text(
                        f"""
                        SELECT conname FROM pg_constraint
                        WHERE conrelid = '{table}'::regclass
                    """
                    )
                )
                schema_info["constraints"][table] = {row[0] for row in result}

        return schema_info

    def _types_match(self, orm_type, db_type: str, db_length: Optional[int]) -> bool:
        """Return True if SQLAlchemy type == live PostgreSQL type."""
        try:
            orm_compiled = orm_type.compile(sync_engine.dialect).lower()
        except Exception:
            orm_compiled = ""

        if orm_compiled == db_type.lower():
            return True

        # keep the VARCHAR/TEXT/UUID special-cases here if you still need length checks
        # For example, if you want to ensure VARCHAR(50) in ORM matches VARCHAR(50) in DB:
        orm_type_str_for_special_cases = str(orm_type).split("(")[0].upper()
        if orm_type_str_for_special_cases == "VARCHAR" and db_type == "character varying":
            orm_length = getattr(orm_type, "length", None)
            # If ORM length is None, it implies "any length" for VARCHAR, so it matches.
            # If ORM length is specified, it must match db_length.
            if orm_length is None or orm_length == db_length:
                return True
            # If orm_length is not None and doesn't match, it's a mismatch for VARCHAR length.
            # However, the primary goal here is type name matching, so we might let this pass
            # to the equivalence table if strict length matching isn't desired at this stage.
            # For now, let's assume if lengths are different, it's not a match here.
            # To allow VARCHAR(X) to match TEXT, or different length VARCHARs, this check would need adjustment
            # or rely on the equivalence table below.
            # The original code had: return orm_length is None or orm_length == db_length
            # We'll keep that logic for the special VARCHAR case if orm_compiled didn't match.

        elif orm_type_str_for_special_cases == "TEXT" and db_type == "text":
            return True
        elif isinstance(orm_type, PG_UUID) and db_type == "uuid":  # PG_UUID is specific, direct check
            return True
        # Add other special cases if necessary, e.g., for NUMERIC precision/scale if not handled by compile()

        # finally fall back to the static equivalence table
        orm_type_str = str(orm_type).split("(")[0].upper()
        for orm_t, db_types_list in self.type_equivalents.items():
            if orm_t == orm_type_str and db_type.lower() in db_types_list:  # ensure db_type is also lowercased for comparison
                return True
        return False

    def _fk_exists(self, db_fks, column_name: str, fk) -> bool:
        """Check if a foreign key constraint already exists."""
        for db_fk in db_fks:
            if (
                db_fk["constrained_columns"]
                and db_fk["constrained_columns"][0] == column_name
                and db_fk["referred_table"] == fk.column.table.name
                and db_fk["referred_columns"][0] == fk.column.name
            ):
                return True
        return False

    async def _add_column(self, conn: AsyncConnection, table_name: str, column) -> None:
        """Add a column to a table."""
        # Safer identifier quoting and explicit error on bad defaults
        column_spec = column.type.compile(sync_engine.dialect)

        if not column.nullable and column.server_default is None:
            # Protect runtime rows: make column nullable first, back-fill in a separate UPDATE, then set NOT NULL.
            logger.info(
                f"Adding non-nullable column '{column.name}' to '{table_name}' with no default—adding as NULL-able for now"
            )
            await conn.execute(
                text(
                    'ALTER TABLE "{tbl}" ADD COLUMN "{col}" {typ} NULL'.format(
                        tbl=table_name, col=column.name, typ=column_spec
                    )
                )
            )
            return  # caller’s validation loop will re-detect nullability

        if not column.nullable and column.server_default is None:
            # These cases above are now handled.
            pass
        elif not column.nullable:
            column_spec += " NOT NULL"
        if column.server_default is not None:
            column_spec += f" DEFAULT {column.server_default.arg}"

        await conn.execute(
            text(f'ALTER TABLE "{table_name}" ADD COLUMN "{column.name}" {column_spec}')
        )

    async def _add_foreign_key(
        self, conn: AsyncConnection, table_name: str, column_name: str, fk
    ) -> None:
        """Add a foreign key constraint."""
        fk_name = f"fk_{table_name}_{column_name}_{fk.column.table.name}"
        fk_name = fk_name[:63]  # PG identifier limit
        ondelete = f" ON DELETE {fk.ondelete}" if fk.ondelete else ""

        for attempt in range(3):  # Retry up to 3 times
            try:
                await conn.execute(
                    text(
                        'ALTER TABLE "{tbl}" ADD CONSTRAINT "{fk}" '
                        'FOREIGN KEY ("{col}") REFERENCES "{reft}"("{refc}"){od}'.format(
                            tbl=table_name,
                            fk=fk_name,
                            col=column_name,
                            reft=fk.column.table.name,
                            refc=fk.column.name,
                            od=ondelete,
                        )
                    )
                )
                return
            except Exception as e:
                if "deadlock" in str(e).lower() and attempt < 2:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                raise

    async def _create_missing_tables(self, tables: List[str]) -> None:
        """Create missing tables with proper dependency ordering."""
        # Ensure 'users' table is created first if it's in the list
        if "users" in tables:
            async with async_engine.begin() as conn:
                await conn.run_sync(
                    lambda sync_conn: Base.metadata.tables["users"].create(sync_conn, checkfirst=True)
                )
                logger.info("Created table: users (if not exists)")
            tables = [t for t in tables if t != "users"]

        # Handle circular dependencies for projects and knowledge_bases
        if "projects" in tables and "knowledge_bases" in tables:
            # Create projects table without the FK to knowledge_bases initially
            # The _create_projects_table method already handles creating projects without the FK
            await self._create_projects_table()  # Uses "IF NOT EXISTS"
            # Create knowledge_bases table
            await self._create_knowledge_bases_table()  # Uses checkfirst=True
            # Add the FK from projects to knowledge_bases
            await self._add_projects_knowledge_base_fk()
            # Remove them from the list of tables to be created in the general loop
            tables = [t for t in tables if t not in ["projects", "knowledge_bases"]]
        elif "projects" in tables:  # If only projects needs to be created (users already exists or created)
            await self._create_projects_table()  # This will create projects with its FK to users (uses "IF NOT EXISTS")
            if "knowledge_bases" in await self.get_existing_tables():  # Check if KB exists to add FK
                await self._add_projects_knowledge_base_fk()
            tables = [t for t in tables if t != "projects"]
        elif "knowledge_bases" in tables:  # If only knowledge_bases needs to be created
            await self._create_knowledge_bases_table()  # Uses checkfirst=True
            tables = [t for t in tables if t != "knowledge_bases"]

        # Create remaining tables
        for table_name in tables:
            async with async_engine.begin() as conn:
                await conn.run_sync(
                    lambda sync_conn: Base.metadata.tables[table_name].create(sync_conn, checkfirst=True)
                )
                logger.info(f"Created table: {table_name} (if not exists)")

    async def _create_projects_table(self) -> None:
        """Special handling for projects table creation."""
        async with async_engine.begin() as conn:
            await conn.run_sync(
                lambda sync_conn: sync_conn.execute(
                    text(
                        """
                CREATE TABLE IF NOT EXISTS projects (
                    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                    name VARCHAR(200) NOT NULL,
                    goals TEXT,
                    description TEXT,
                    token_usage INTEGER NOT NULL DEFAULT 0,
                    max_tokens INTEGER NOT NULL DEFAULT 200000,
                    custom_instructions TEXT,
                    archived BOOLEAN NOT NULL DEFAULT FALSE,
                    pinned BOOLEAN NOT NULL DEFAULT FALSE,
                    is_default BOOLEAN NOT NULL DEFAULT FALSE,
                    version INTEGER NOT NULL DEFAULT 1,
                    default_model VARCHAR(50) NOT NULL DEFAULT 'claude-3-sonnet-20240229',
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    extra_data JSONB,
                    knowledge_base_id UUID
                )
            """
                    )
                )
            )
            # The constraint might also already exist if the table was partially created.
            # It's safer to check or use ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS,
            # but standard SQL for ADD CONSTRAINT IF NOT EXISTS is not universally supported directly in older PostgreSQL.
            # For now, we'll assume if CREATE TABLE IF NOT EXISTS runs, this might need to be conditional too.
            # However, the immediate error is about table/index creation, not constraint addition.
            try:
                await conn.run_sync(
                    lambda sync_conn: sync_conn.execute(
                        text(
                            """
                    ALTER TABLE projects
                    ADD CONSTRAINT check_token_limit CHECK (max_tokens >= token_usage)
                """
                        )
                    )
                )
            except Exception as e:
                if "already exists" in str(e).lower():
                    logger.info("Constraint 'check_token_limit' on 'projects' table already exists.")
                else:
                    raise
            logger.info("Created/Ensured projects table (without knowledge_base_id FK initially if part of circular dependency handling)")

    async def _create_knowledge_bases_table(self) -> None:
        """Create knowledge_bases table."""
        async with async_engine.begin() as conn:
            await conn.run_sync(
                lambda sync_conn: Base.metadata.tables["knowledge_bases"].create(
                    sync_conn, checkfirst=True
                )
            )
            logger.info("Created knowledge_bases table (if not exists)")

    async def _add_projects_knowledge_base_fk(self) -> None:
        """Add the knowledge_base_id foreign key to projects, robustly and idempotently."""
        fk_sql = (
            'ALTER TABLE "projects" ADD CONSTRAINT IF NOT EXISTS '
            '"fk_projects_knowledge_base" FOREIGN KEY ("knowledge_base_id") '
            'REFERENCES "knowledge_bases"("id") ON DELETE SET NULL'
        )
        async with async_engine.begin() as conn:
            await conn.execute(text(fk_sql))
            logger.info("Added knowledge_base_id foreign key to projects")
