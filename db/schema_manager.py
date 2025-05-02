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


class SchemaManager:
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
        1. Creates missing tables
        2. Aligns schema with ORM definitions
        3. Validates final schema
        """
        try:
            logger.info("Starting database initialization...")

            # Step 1: Create missing tables
            existing_tables = await self.get_existing_tables()
            tables_to_create = [
                t for t in Base.metadata.tables.keys() if t not in existing_tables
            ]

            if tables_to_create:
                logger.info(f"Creating {len(tables_to_create)} missing tables")
                await self._create_missing_tables(tables_to_create)

            # Step 2: Schema alignment
            logger.info("Running schema alignment...")
            await self.fix_schema()

            # Step 3: Final validation
            logger.info("Validating schema...")
            issues = await self.validate_schema()
            if issues:
                logger.warning(f"Schema validation completed with {len(issues)} issues")
                for issue in issues[:5]:  # Log first 5 issues
                    logger.warning(f"  - {issue}")
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
                    mismatch_details.append(
                        f"Type mismatch: {table_name}.{column.name} "
                        f"(DB: {db_col['type']}{f'({db_col['length']})' if db_col.get('length') else ''} "
                        f"vs ORM: {column.type})"
                    )

            # Check indexes
            for index in table.indexes:
                if index.name not in db_schema["indexes"].get(table_name, []):
                    mismatch_details.append(f"Missing index: {table_name}.{index.name}")

            # Check constraints
            for constraint in table.constraints:
                if constraint.name not in db_schema["constraints"].get(table_name, []):
                    mismatch_details.append(
                        f"Missing constraint: {table_name}.{constraint.name}"
                    )

        return mismatch_details

    async def fix_schema(self) -> None:
        """Schema alignment using async connection"""
        logger.info("Starting schema alignment...")

        async with async_engine.begin() as conn:
            # Create missing tables
            await conn.run_sync(Base.metadata.create_all)

            # Get existing tables using async pattern
            existing_tables = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names())

            # Add missing columns/indexes using proper async methods
            # ... (rest of schema alignment logic using async connections)


            inspector = await conn.run_sync(lambda sync_conn: inspect(sync_conn))
            for table in Base.metadata.tables.values():
                if not inspector.has_table(table.name):
                    continue
                db_columns = {c["name"] for c in inspector.get_columns(table.name)}
                for column in table.columns:
                    if column.name not in db_columns:
                        logger.info(f"Adding column: {table.name}.{column.name}")
                        self._add_column(conn, table.name, column)

            # 3. Create missing indexes
            for table in Base.metadata.tables.values():
                if not inspector.has_table(table.name):
                    continue

                db_indexes = {idx["name"] for idx in inspector.get_indexes(table.name)}
                for index in table.indexes:
                    if index.name not in db_indexes:
                        logger.info(f"Creating index: {table.name}.{index.name}")
                        try:
                            await conn.run_sync(lambda sync_conn: index.create(sync_conn))
                        except Exception as e:
                            logger.error(f"Failed to create index {index.name}: {e}")

            # 4. Fix foreign key constraints
            for table in Base.metadata.tables.values():
                if not inspector.has_table(table.name):
                    continue

                db_fks = inspector.get_foreign_keys(table.name)
                for column in table.columns:
                    for fk in column.foreign_keys:
                        if not self._fk_exists(db_fks, column.name, fk):
                            logger.info(
                                f"Adding FK: {table.name}.{column.name} -> {fk.column.table.name}.{fk.column.name}"
                            )
                            self._add_foreign_key(conn, table.name, column.name, fk)

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
        schema_info = {"tables": set(), "columns": {}, "indexes": {}, "constraints": {}}

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
