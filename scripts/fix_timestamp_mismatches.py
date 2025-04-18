"""
Script to specifically check and fix timestamp type mismatches between the database
and SQLAlchemy ORM models.

This script focuses on resolving the issue with 'timestamp without time zone' vs
'timestamp with time zone' columns by:
1. Detecting any timestamp type mismatches in the database
2. Converting mismatched timestamp columns to match ORM definitions
3. Verifying that the fixes were successful
"""

import asyncio
import logging
import sys
from sqlalchemy import text, inspect
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Import database and model definitions
sys.path.insert(0, ".")  # Add current directory to path to make imports work
from db import Base, validate_db_schema, fix_db_schema, sync_engine, async_engine
from db import AsyncSessionLocal, get_async_session_context


async def check_timestamp_columns():
    """
    Specifically check for timestamp type mismatches between database columns
    and ORM model definitions.

    Returns:
        list: List of dictionaries containing details of mismatched columns
    """
    mismatches = []

    # Get all tables from SQLAlchemy metadata
    tables = Base.metadata.tables

    # Use SQLAlchemy inspector to get column info from the database
    inspector = inspect(sync_engine)

    # Check each table
    for table_name, table in tables.items():
        if not inspector.has_table(table_name):
            logger.warning(f"Table {table_name} doesn't exist in the database")
            continue

        # Get column info from the database
        db_columns = inspector.get_columns(table_name)
        db_column_dict = {col["name"]: col for col in db_columns}

        # Check each ORM column
        for column_name, column in table.columns.items():
            if column_name not in db_column_dict:
                continue

            db_col = db_column_dict[column_name]
            col_type = str(column.type)
            db_type = str(db_col["type"])

            # Check for timestamp mismatches
            if ("timestamp" in col_type.lower() and "timestamp" in db_type.lower()):
                orm_has_timezone = "with time zone" in col_type.lower()
                db_has_timezone = "with time zone" in db_type.lower()

                if orm_has_timezone != db_has_timezone:
                    mismatches.append({
                        "table": table_name,
                        "column": column_name,
                        "orm_type": col_type,
                        "db_type": db_type,
                        "orm_has_timezone": orm_has_timezone,
                        "db_has_timezone": db_has_timezone
                    })

    return mismatches


async def fix_timestamp_columns(mismatches):
    """
    Fix the timestamp columns that have type mismatches

    Args:
        mismatches: List of dictionaries with mismatch information

    Returns:
        int: Number of columns fixed
    """
    count = 0

    with sync_engine.begin() as conn:
        for mismatch in mismatches:
            table = mismatch["table"]
            column = mismatch["column"]
            target_type = "TIMESTAMP WITH TIME ZONE" if mismatch["orm_has_timezone"] else "TIMESTAMP WITHOUT TIME ZONE"

            logger.info(f"Converting {table}.{column} to {target_type}")

            try:
                conn.execute(
                    text(f"ALTER TABLE {table} ALTER COLUMN {column} TYPE {target_type}")
                )
                count += 1
                logger.info(f"✅ Successfully converted {table}.{column}")
            except Exception as e:
                logger.error(f"❌ Failed to convert {table}.{column}: {str(e)}")

    return count


async def print_timestamp_mismatch_summary(mismatches):
    """Print a summary of timestamp type mismatches"""
    if not mismatches:
        logger.info("✅ No timestamp type mismatches found!")
        return

    logger.warning(f"❌ Found {len(mismatches)} timestamp type mismatches:")

    for i, mismatch in enumerate(mismatches, 1):
        db_type = "WITH TIME ZONE" if mismatch["db_has_timezone"] else "WITHOUT TIME ZONE"
        orm_type = "WITH TIME ZONE" if mismatch["orm_has_timezone"] else "WITHOUT TIME ZONE"

        logger.warning(
            f"{i}. Table: {mismatch['table']}, Column: {mismatch['column']}\n"
            f"   Database: TIMESTAMP {db_type}\n"
            f"   ORM Model: TIMESTAMP {orm_type}"
        )


async def main():
    """Main function to check and fix timestamp column type mismatches"""
    logger.info("Checking for timestamp type mismatches...")

    # First, check for timestamp mismatches
    initial_mismatches = await check_timestamp_columns()

    # Print summary of mismatches
    await print_timestamp_mismatch_summary(initial_mismatches)

    if not initial_mismatches:
        logger.info("No timestamp type mismatches to fix")
        return True

    # Ask user if they want to fix the mismatches
    fix_it = input("\nDo you want to fix these mismatches? (y/n): ").strip().lower()

    if fix_it != 'y':
        logger.info("No changes were made")
        return False

    # Fix the mismatches
    logger.info("Fixing timestamp type mismatches...")
    fixed_count = await fix_timestamp_columns(initial_mismatches)

    # Check for remaining mismatches
    remaining_mismatches = await check_timestamp_columns()

    if remaining_mismatches:
        logger.warning(f"After fixes, {len(remaining_mismatches)} timestamp type mismatches remain")
        await print_timestamp_mismatch_summary(remaining_mismatches)
        return False
    else:
        logger.info(f"✅ Successfully fixed {fixed_count} timestamp type mismatches!")

        # Run full schema validation to confirm overall schema health
        logger.info("Running full schema validation...")
        mismatch_details = await validate_db_schema()

        if mismatch_details:
            logger.warning(
                f"Schema validation completed with {len(mismatch_details)} remaining issue(s)."
            )
            for issue in mismatch_details[:7]:  # Show first 7 issues only
                logger.warning(f"  - {issue}")

            logger.info("Note: These issues are not related to timestamp type mismatches and may require separate fixes.")
        else:
            logger.info("✅ Schema validation successful! All ORM definitions match the database.")

        return True


if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
