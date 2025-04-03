"""
Script to check existing indexes on knowledge_bases table
"""
import asyncio
from db import async_engine
from sqlalchemy import text

async def check_indexes():
    async with async_engine.connect() as conn:
        result = await conn.execute(text("""
            SELECT indexname FROM pg_indexes 
            WHERE tablename = 'knowledge_bases'
        """))
        indexes = result.fetchall()
        print("Existing indexes on knowledge_bases:")
        for idx in indexes:
            print(f"- {idx[0]}")

if __name__ == "__main__":
    asyncio.run(check_indexes())