"""
Script to verify that the timestamp type alignment solution is working correctly.
This script:
1. Checks for any existing timestamp type mismatches
2. Runs the database schema validation
3. Reports on the success of the alignment solution
"""

import asyncio
import logging
import sys
from sqlalchemy import text

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Import database and model definitions
sys.path.insert(0, ".")  # Add current directory to path to make imports work
from db import Base, validate_db_schema, sync_engine, async_engine
from scripts.fix_timestamp_mismatches import check_timestamp_columns, print_timestamp_mismatch_summary


async def verify_timestamp_alignment():
    """
    Verify that the timestamp type alignment solution is working correctly by:
    1. Looking for any existing timestamp type mismatches
    2. Checking if the schema validation detects any issues
    3. Reporting a summary of the findings
    """
    logger.info("Starting timestamp alignment verification...")

    # Check for timestamp type mismatches
    logger.info("Checking for timestamp type mismatches...")
    mismatches = await check_timestamp_columns()

    if mismatches:
        logger.warning(f"Found {len(mismatches)} timestamp type mismatches!")
        await print_timestamp_mismatch_summary(mismatches)
        logger.info(
            "To fix these mismatches, run: python scripts/fix_timestamp_mismatches.py"
        )
        mismatch_tables = set(m["table"] for m in mismatches)
        logger.info(f"Affected tables: {', '.join(sorted(mismatch_tables))}")
    else:
        logger.info("✅ No timestamp type mismatches found!")

    # Run schema validation
    logger.info("Running complete schema validation...")
    mismatch_details = await validate_db_schema()

    timestamp_related_issues = [
        issue for issue in mismatch_details
        if "timestamp" in issue.lower() and "type mismatch" in issue.lower()
    ]

    # Report results
    if timestamp_related_issues:
        logger.warning(f"Found {len(timestamp_related_issues)} timestamp-related schema issues:")
        for issue in timestamp_related_issues:
            logger.warning(f"  - {issue}")
        logger.info(
            "These timestamp issues should be fixed with the db.py schema alignment "
            "improvements or by running the fix script."
        )
    else:
        if mismatch_details:
            logger.info(
                f"Schema validation found {len(mismatch_details)} non-timestamp issues."
            )
            logger.info("✅ No timestamp-related schema issues detected!")
        else:
            logger.info("✅ Schema validation successful! No issues detected.")

    return len(mismatches) == 0 and len(timestamp_related_issues) == 0


async def check_db_timestamp_definitions():
    """
    Check the actual timestamp column definitions in the database
    for information purposes
    """
    logger.info("Retrieving timestamp column definitions from database...")

    timestamp_columns = []

    async with async_engine.connect() as conn:
        result = await conn.execute(
            text("""
                SELECT
                    t.table_name,
                    c.column_name,
                    c.data_type,
                    c.datetime_precision
                FROM
                    information_schema.tables t
                JOIN
                    information_schema.columns c ON t.table_name = c.table_name
                WHERE
                    t.table_schema = 'public'
                    AND c.table_schema = 'public'
                    AND c.data_type LIKE 'timestamp%'
                ORDER BY
                    t.table_name, c.column_name
            """)
        )

        # Use mappings() to get results as dictionaries
        timestamp_columns = [row._mapping for row in result.fetchall()]

    if timestamp_columns:
        logger.info(f"Found {len(timestamp_columns)} timestamp columns in the database:")
        for col in timestamp_columns:
            logger.info(
                f"  - {col['table_name']}.{col['column_name']}: "
                f"{col['data_type']} (precision: {col['datetime_precision']})"
            )
    else:
        logger.info("No timestamp columns found in the database.")

    return timestamp_columns


async def main():
    """Main verification function"""
    logger.info("Starting timestamp alignment verification...")

    # Check the actual DB timestamp definitions
    await check_db_timestamp_definitions()

    # Verify alignment
    alignment_success = await verify_timestamp_alignment()

    if alignment_success:
        logger.info("""
✅ TIMESTAMP TYPE ALIGNMENT VERIFICATION SUCCESSFUL!
   -----------------------------------------------
   The schema validation and alignment logic in db.py is correctly
   handling timestamp type definitions. Any timestamp columns in the
   database should now match their ORM definitions.
""")
        return 0
    else:
        logger.warning("""
⚠️ TIMESTAMP TYPE ALIGNMENT VERIFICATION FAILED
   ------------------------------------------
   Some timestamp type mismatches or schema issues were detected.
   Run 'python scripts/fix_timestamp_mismatches.py' to fix them.
""")
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
