import asyncio
from sqlalchemy import text
from db import async_engine

async def add_missing_column():
    try:
        async with async_engine.begin() as conn:
            await conn.execute(text("""
                ALTER TABLE messages 
                ADD COLUMN IF NOT EXISTS context_used JSONB
                COMMENT 'KB context actually used in this message'
            """))
            print("✅ Column 'context_used' added successfully to messages table")
    except Exception as e:
        print("❌ Failed to add column:", str(e))

asyncio.run(add_missing_column())
