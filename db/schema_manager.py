"""
schema_manager.py
-----------------
Comprehensive database schema management and alignment system.
Handles schema validation, automatic fixes, and initialization.
"""

import logging
import time
from typing import Optional, List, Set, Tuple, AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy import inspect, text, MetaData
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncConnection

from db.db import Base, sync_engine, async_engine

logger = logging.getLogger(__name__)

# --- Alembic Automated Migration Integration ---
def automated_alembic_migrate(message: str = "Automated migration", revision_dir: str = "alembic"):
    """
    Autogenerate and apply Alembic migrations automatically
    — but if the migration is a no-op ("pass"), do not write or apply it. Prevents reload loops.
    """
    import os
    import logging
    from alembic.config import Config
    from alembic import command
    import glob

    logger = logging.getLogger(__name__)
    logger.info("Starting Alembic auto-migration workflow with no-op pruning")
    print("==> (Alembic) Starting Alembic auto-migration workflow...")

    # Path adjustments:
    alembic_ini_path = os.path.join(os.path.dirname(__file__), "..", "alembic.ini")
    alembic_ini_path = os.path.abspath(alembic_ini_path)
    migration_dir_path = os.path.join(os.path.dirname(__file__), "..", revision_dir)
    migration_dir_path = os.path.abspath(migration_dir_path)

    # Create Alembic config object programmatically
    alembic_cfg = Config(alembic_ini_path)
    alembic_cfg.set_main_option("script_location", migration_dir_path)

    from alembic.script import ScriptDirectory
    script = ScriptDirectory.from_config(alembic_cfg)
    prev_head = script.get_current_head()

    logger.info("Checking for model/db schema drift to issue new Alembic revision...")
    print("==> (Alembic) Checking for model/db schema drift to issue new Alembic revision...")
    try:
        command.revision(alembic_cfg, message=message, autogenerate=True)
        print("==> (Alembic) Alembic revision command executed.")
    except Exception as e:
        logger.error(f"Alembic revision failed: {e}")
        print(f"==> (Alembic) Alembic revision failed: {e}")
        raise

    # Check if new revision was created
    script = ScriptDirectory.from_config(alembic_cfg)
    new_head = script.get_current_head()
    if prev_head != new_head:
        # Find the new migration file
        migration_files = sorted(glob.glob(os.path.join(migration_dir_path, "versions", "*.py")), key=os.path.getmtime, reverse=True)
        latest_file = migration_files[0] if migration_files else None

        if latest_file:
            with open(latest_file, "r", encoding="utf-8") as f:
                contents = f.read()
            # Detect no-op: Both upgrade() and downgrade() are 'pass'
            is_noop = (
                "def upgrade():" in contents and "def downgrade():" in contents
                and (
                    "def upgrade():\n    pass" in contents or "def upgrade():\n\tpass" in contents
                ) and (
                    "def downgrade():\n    pass" in contents or "def downgrade():\n\tpass" in contents
                )
            )
            if is_noop:
                logger.info(f"Removing Alembic no-op (empty) migration file: {latest_file}")
                print(f"==> (Alembic) Removing no-op migration {latest_file}")
                os.remove(latest_file)
                # Reset head so db & script state matches
                script = ScriptDirectory.from_config(alembic_cfg)
                command.upgrade(alembic_cfg, prev_head or "base")
                return

        logger.info(f"New Alembic migration created: {new_head}. Upgrading database...")
        print(f"==> (Alembic) New migration created: {new_head}. Upgrading database to head...")

    else:
        logger.info("No changes detected. Database already up to date.")
        print("==> (Alembic) No changes detected. Database already up to date (no new migration).")

    try:
        command.upgrade(alembic_cfg, "head")
        logger.info("Alembic migration applied: database is at head.")
        print("==> (Alembic) Alembic upgrade applied: database is at head.")
    except Exception as e:
        logger.error(f"Alembic upgrade failed: {e}")
        print(f"==> (Alembic) Alembic upgrade failed: {e}")
        raise
# --- End Alembic Migration Integration ---


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
            "TIMESTAMP": ["timestamp without time zone"],
            "UUID": ["uuid"],
            "JSONB": ["jsonb"],
            "INTEGER": ["integer", "int4"],
            "BIGINT": ["bigint", "int8"],
            "BOOLEAN": ["boolean", "bool"],
        }

    # ---------------------------------------------------------
    # Public Interface
    # ---------------------------------------------------------

    async def initialize_database(self) -> None:
        """
        Full database initialization process:
        1. Optionally generates and runs Alembic migrations
        2. Creates missing tables
        3. Aligns schema with ORM definitions
        4. Validates final schema
        """
        import os
        try:
            # ---- Alembic auto-migration/upgrade (conditionally run) ----
            AUTO_MIGRATE = os.getenv("ENABLE_AUTO_MIGRATION", "false").lower() == "true"
            if AUTO_MIGRATE:
                automated_alembic_migrate()
            else:
                logger.info("Alembic auto-migration is disabled (ENABLE_AUTO_MIGRATION is false or unset)")
            logger.info("Starting database initialization...")
            print("==> Starting database initialization...")

            # Step 1: Create missing tables
            existing_tables = await self.get_existing_tables()
            print(f"==> Existing tables: {sorted(existing_tables)}")
            tables_to_create = [
                t for t in Base.metadata.tables.keys() if t not in existing_tables
            ]

            if tables_to_create:
                msg = f"Creating {len(tables_to_create)} missing tables: {tables_to_create}"
                logger.info(msg)
                print("==> " + msg)
                await self._create_missing_tables(tables_to_create)
            else:
                print("==> No tables need creation.")

            # Step 2: Schema alignment
            # Always align schema with ORM on startup
            logger.info("Running schema alignment...")
            print("==> Running schema alignment...")
            await self.fix_schema()

            # Step 3: Final validation
            logger.info("Validating schema...")
            print("==> Validating schema...")
            issues = await self.validate_schema()
            if issues:
                msg = f"Schema validation completed with {len(issues)} issues."
                logger.warning(msg)
                print("==> " + msg)
                for issue in issues[:5]:  # Log first 5 issues
                    logger.warning(f"  - {issue}")
                    print(f"==> (ISSUE) {issue}")
                if len(issues) > 5:
                    print(f"==> ...and {len(issues)-5} more issues.")
            else:
                logger.info("Schema validation successful - no issues found")
                print("==> Schema validation successful - no issues found.")

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
                if not constraint.name:
                    continue  # skip unnamed constraints
                if constraint.name not in db_schema["constraints"].get(table_name, []):
                    mismatch_details.append(
                        f"Missing constraint: {table_name}.{constraint.name}"
                    )

        return mismatch_details

    async def fix_schema(self) -> None:
        """Schema alignment using async connection"""
        import os

        logger.info("Starting schema alignment...")

        destructive = os.getenv("AUTO_SCHEMA_DESTRUCTIVE", "false").lower() == "true"

        async with async_engine.begin() as conn:
            # Create missing tables and align schema with ORM
            await conn.run_sync(Base.metadata.create_all)

            # Add missing columns, indexes, and foreign key constraints as needed
            for table in Base.metadata.tables.values():
                table_exists = await conn.run_sync(
                    lambda sync_conn: inspect(sync_conn).has_table(table.name)
                )
                if not table_exists:
                    continue

                db_columns_set = await conn.run_sync(
                    lambda sync_conn: {c["name"] for c in inspect(sync_conn).get_columns(table.name)}
                )
                for column in table.columns:
                    if column.name not in db_columns_set:
                        logger.info(f"Adding column: {table.name}.{column.name}")
                        await self._add_column(conn, table.name, column)

            # --- Enhanced: Drop obsolete columns and alter column types ---
            for table in Base.metadata.tables.values():
                table_exists = await conn.run_sync(
                    lambda sync_conn: inspect(sync_conn).has_table(table.name)
                )
                if not table_exists:
                    continue

                db_columns = await conn.run_sync(
                    lambda sync_conn: {c["name"]: c for c in inspect(sync_conn).get_columns(table.name)}
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
                        if db_type.lower() != orm_type.lower():
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
                    orm_index_names = {index.name for index in table.indexes}
                    for db_index_name in db_indexes:
                        if db_index_name not in orm_index_names:
                            logger.warning(f"Dropping obsolete index: {table.name}.{db_index_name}")
                            try:
                                await conn.execute(
                                    text(f'DROP INDEX IF EXISTS "{db_index_name}"')
                                )
                                logger.info(f"Dropped index: {table.name}.{db_index_name}")
                            except Exception as e:
                                logger.error(f"Failed to drop index {table.name}.{db_index_name}: {e}")

            # 4. Fix foreign key constraints
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
            "constraints": {},# Dict[str, Set[str]]
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
        """Check if database type matches ORM type definition."""
        orm_type_str = str(orm_type).split("(")[0].upper()

        # Handle special cases
        if orm_type_str == "VARCHAR" and db_type == "character varying":
            orm_length = getattr(orm_type, "length", None)
            return orm_length is None or orm_length == db_length
        elif orm_type_str == "TEXT" and db_type == "text":
            return True
        elif isinstance(orm_type, PG_UUID) and db_type == "uuid":
            return True

        # Check type equivalents
        for orm_t, db_types in self.type_equivalents.items():
            if orm_t == orm_type_str and db_type in db_types:
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
        column_spec = f"{column.name} {column.type.compile(sync_engine.dialect)}"

        if not column.nullable and column.server_default is None:
            if str(column.type) == "JSONB":
                column_spec += " DEFAULT '{}'::jsonb"
            elif str(column.type) == "BOOLEAN":
                column_spec += " DEFAULT false"
            elif "INT" in str(column.type).upper():
                column_spec += " DEFAULT 0"
            elif "UUID" in str(column.type).upper():
                column_spec += " DEFAULT gen_random_uuid()"
            elif (
                column.name == "created_at" and "TIMESTAMP" in str(column.type).upper()
            ):
                column_spec += " DEFAULT CURRENT_TIMESTAMP"
            else:
                column_spec += " DEFAULT ''"

        column_spec += " NOT NULL" if not column.nullable else ""

        if column.server_default is not None:
            column_spec += f" DEFAULT {column.server_default.arg}"

        await conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_spec}"))

    async def _add_foreign_key(
        self, conn: AsyncConnection, table_name: str, column_name: str, fk
    ) -> None:
        """Add a foreign key constraint."""
        fk_name = f"fk_{table_name}_{column_name}_{fk.column.table.name}"
        ondelete = f" ON DELETE {fk.ondelete}" if fk.ondelete else ""

        for attempt in range(3):  # Retry up to 3 times
            try:
                await conn.execute(
                    text(
                        f"ALTER TABLE {table_name} "
                        f"ADD CONSTRAINT {fk_name} "
                        f"FOREIGN KEY ({column_name}) "
                        f"REFERENCES {fk.column.table.name}({fk.column.name})"
                        f"{ondelete}"
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
        # Handle circular dependencies first
        if "projects" in tables and "knowledge_bases" in tables:
            await self._create_projects_table()
            await self._create_knowledge_bases_table()
            await self._add_projects_knowledge_base_fk()
            tables = [t for t in tables if t not in ["projects", "knowledge_bases"]]

        # Create remaining tables
        for table in tables:
            async with async_engine.begin() as conn:
                await conn.run_sync(
                    lambda sync_conn: Base.metadata.tables[table].create(sync_conn)
                )
                logger.info(f"Created table: {table}")

    async def _create_projects_table(self) -> None:
        """Special handling for projects table creation."""
        async with async_engine.begin() as conn:
            await conn.run_sync(
                lambda sync_conn: sync_conn.execute(
                    text(
                        """
                CREATE TABLE projects (
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
            logger.info("Created projects table (without knowledge_base_id FK)")

    async def _create_knowledge_bases_table(self) -> None:
        """Create knowledge_bases table."""
        async with async_engine.begin() as conn:
            await conn.run_sync(
                lambda sync_conn: Base.metadata.tables["knowledge_bases"].create(
                    sync_conn
                )
            )
            logger.info("Created knowledge_bases table")

    async def _add_projects_knowledge_base_fk(self) -> None:
        """Add the knowledge_base_id foreign key to projects."""
        async with async_engine.begin() as conn:
            await conn.run_sync(
                lambda sync_conn: sync_conn.execute(
                    text(
                        """
                ALTER TABLE projects
                ADD CONSTRAINT fk_projects_knowledge_base
                FOREIGN KEY (knowledge_base_id)
                REFERENCES knowledge_bases(id) ON DELETE SET NULL
            """
                    )
                )
            )
            logger.info("Added knowledge_base_id foreign key to projects")
