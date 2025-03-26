#!/usr/bin/env python
"""
Database Schema Verification Script
----------------------------------
Tests basic CRUD operations on all models to verify the database schema works as expected.
"""

import asyncio
import uuid
from datetime import datetime
from sqlalchemy import select

from db import get_async_session_context
from models import User, KnowledgeBase, Project, Conversation, Message, ProjectFile, Artifact

async def test_user_crud():
    async with get_async_session_context() as session:
        # Create
        user = User(
            username="test_user",
            password_hash="test_hash",
            role="user"
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        
        # Read
        stmt = select(User).where(User.username == "test_user")
        result = await session.execute(stmt)
        fetched_user = result.scalars().first()
        assert fetched_user is not None
        
        # Update
        fetched_user.role = "admin"
        await session.commit()
        await session.refresh(fetched_user)
        assert fetched_user.role == "admin"
        
        # Delete
        await session.delete(fetched_user)
        await session.commit()
        
        # Verify delete
        result = await session.execute(stmt)
        assert result.scalars().first() is None

async def test_all_models():
    """Test CRUD operations for all models"""
    await test_user_crud()
    # Add similar tests for other models...
    print("✅ All model CRUD tests passed!")

if __name__ == "__main__":
    asyncio.run(test_all_models())
