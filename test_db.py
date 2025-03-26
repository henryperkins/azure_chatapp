import asyncio
from sqlalchemy import text
from db import async_engine

async def test_connection():
    try:
        async with async_engine.connect() as conn:
            result = await conn.execute(text("SELECT 1"))
            print("✅ Connection successful:", result.scalar())
    except Exception as e:
        print("❌ Connection failed:", str(e))
        print("\nTroubleshooting steps:")
        print("1. Verify PostgreSQL is running: systemctl status postgresql")
        print("2. Check the database exists: psql -l")
        print("3. Verify DATABASE_URL in config.py matches your PostgreSQL credentials")

asyncio.run(test_connection())
