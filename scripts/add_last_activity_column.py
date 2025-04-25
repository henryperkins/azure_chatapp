import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

from config import settings

DATABASE_URL = settings.DATABASE_URL

async def add_last_activity_column():
    engine = create_async_engine(DATABASE_URL)
    async with engine.begin() as conn:
        await conn.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity TIMESTAMP NULL")
        )
    await engine.dispose()
    print("last_activity column added (if missing)")

if __name__ == "__main__":
    asyncio.run(add_last_activity_column())
