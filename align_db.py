import asyncio
from db import init_db

async def main():
    print("Aligning database with ORM models...")
    await init_db()
    print("Database alignment complete")

if __name__ == "__main__":
    asyncio.run(main())
