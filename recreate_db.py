#!/usr/bin/env python3
"""
Script to drop (wipe) all tables in the database and then recreate them
according to the ORM models in models/.
"""

import asyncio
from db import Base, async_engine
# Import models so SQLAlchemy knows about them when creating tables
from models import (
    Artifact,
    Conversation,
    KnowledgeBase,
    Message,
    Project,
    ProjectFile,
    User
)

async def recreate_database():
    print("Dropping all tables using the async engine...")
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        print("Creating all tables...")
        await conn.run_sync(Base.metadata.create_all)
    print("Database schema recreated successfully.")

if __name__ == "__main__":
    # Run the async function
    asyncio.run(recreate_database())
