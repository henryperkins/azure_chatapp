"""
Simple script to test PostgreSQL database connection.
Uses the same database URL from the .env file.
"""
import asyncio
import os
import sys
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def test_connection():
    """Test connection to the PostgreSQL database."""
    # Get database URL from environment or use the one from .env
    database_url = os.getenv("DATABASE_URL", "postgresql+asyncpg://postgres:newpassword@localhost:5432/azure_chat_db")

    print(f"Testing connection to database (URL partially redacted for security):")
    print(f"  {database_url.split('@')[0].split(':')[0]}:***@{database_url.split('@')[1]}")

    try:
        # Create async engine
        engine = create_async_engine(database_url)

        # Test connection with a simple query
        async with engine.begin() as conn:
            result = await conn.execute(text("SELECT 1"))
            value = result.scalar()
            if value == 1:
                print("\n✅ Successfully connected to the PostgreSQL database!")

                # Get database information
                result = await conn.execute(text("SELECT version()"))
                version = result.scalar()
                print(f"\nPostgreSQL version: {version}")

                # Show database size
                result = await conn.execute(text("""
                    SELECT pg_size_pretty(pg_database_size(current_database()))
                """))
                size = result.scalar()
                print(f"Database size: {size}")

                # Get table information
                result = await conn.execute(text("""
                    SELECT
                        table_name,
                        pg_size_pretty(pg_total_relation_size(table_name::text)) as size
                    FROM information_schema.tables
                    WHERE table_schema='public'
                    ORDER BY pg_total_relation_size(table_name::text) DESC
                    LIMIT 10
                """))
                print("\nTop 10 tables by size:")
                for row in result:
                    print(f"  {row.table_name}: {row.size}")

                return True
    except Exception as e:
        print(f"\n❌ Failed to connect to the database: {str(e)}")
        return False

if __name__ == "__main__":
    result = asyncio.run(test_connection())
    sys.exit(0 if result else 1)
