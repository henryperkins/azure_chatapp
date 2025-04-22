from db.db import sync_engine, async_engine
from sqlalchemy import text
import asyncio

def test_sync_connection():
    try:
        with sync_engine.connect() as conn:
            result = conn.execute(text('SELECT 1')).scalar()
            print(f"Sync connection successful, result: {result}")
        return True
    except Exception as e:
        print(f"Sync connection error: {e}")
        return False

async def test_async_connection():
    try:
        async with async_engine.connect() as conn:
            result = await conn.execute(text('SELECT 1'))
            value = result.scalar()
            print(f"Async connection successful, result: {value}")
        return True
    except Exception as e:
        print(f"Async connection error: {e}")
        return False

async def main():
    sync_result = test_sync_connection()
    async_result = await test_async_connection()
    
    if sync_result and async_result:
        print("Both connections are working!")
    else:
        print("Connection problems detected.")

if __name__ == "__main__":
    asyncio.run(main())