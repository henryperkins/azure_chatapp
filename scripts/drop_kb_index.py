"""
Script to safely drop knowledge_bases indexes
"""
import asyncio
from db import async_engine
from sqlalchemy import text

async def drop_indexes():
    async with async_engine.connect() as conn:
        # List of indexes to check/drop
        indexes = [
            'ix_knowledge_bases_project_id',
            'ix_knowledge_bases_is_active'
        ]
        
        for index in indexes:
            # Check if index exists
            result = await conn.execute(text(f"""
                SELECT 1 FROM pg_indexes
                WHERE indexname = '{index}'
            """))
            exists = result.scalar()
            
            if exists:
                print(f"Dropping index {index}...")
                await conn.execute(text(f"DROP INDEX {index}"))
                await conn.commit()
                print(f"Index {index} dropped successfully")
            else:
                print(f"Index {index} does not exist, nothing to drop")

if __name__ == "__main__":
    asyncio.run(drop_indexes())