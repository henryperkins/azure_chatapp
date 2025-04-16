"""
Comprehensive database verification script.
Tests connection, schema validation, and basic CRUD operations.
"""
import asyncio
import sys
import uuid
from datetime import datetime
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from db import validate_db_schema, get_async_session_context
from models.user import User

async def test_connection():
    """Test basic database connection."""
    print("1. Testing database connection...")

    async with get_async_session_context() as session:
        result = await session.execute(text("SELECT 1"))
        value = result.scalar()

        if value == 1:
            print("✅ Successfully connected to the database")

            # Get database information
            result = await session.execute(text("SELECT version()"))
            version = result.scalar()
            print(f"   PostgreSQL version: {version}")
            return True
        else:
            print("❌ Connection test failed")
            return False

async def test_schema_validation():
    """Validate database schema against models."""
    print("\n2. Validating database schema...")

    # Import all models to ensure they're registered
    from models.project import Project
    from models.project_file import ProjectFile
    from models.conversation import Conversation
    from models.message import Message
    from models.knowledge_base import KnowledgeBase
    from models.artifact import Artifact

    mismatch_details = await validate_db_schema()

    if mismatch_details:
        print(f"❌ Found {len(mismatch_details)} schema mismatches:")
        for detail in mismatch_details[:5]:  # Show first 5 mismatches
            print(f"   - {detail}")
        return False
    else:
        print("✅ Database schema matches application models")
        return True

async def test_crud_operations():
    """Test basic CRUD operations."""
    print("\n3. Testing basic CRUD operations...")

    # Generate a unique test user
    test_email = f"test_{uuid.uuid4()}@example.com"
    test_username = f"test_user_{uuid.uuid4().hex[:8]}"

    created_user_id = None
    success = True

    async with get_async_session_context() as session:
        try:
            # CREATE operation
            print(f"   Creating test user: {test_username}")
            new_user = User(
                username=test_username,
                password_hash="$2b$12$test_hash_not_real",
                is_active=True,
                role="user"
                # created_at is auto-generated with server_default
            )
            session.add(new_user)
            await session.commit()
            await session.refresh(new_user)
            created_user_id = new_user.id
            print(f"   ✅ CREATE: User created with ID: {created_user_id}")

            # READ operation
            print(f"   Reading user with ID: {created_user_id}")
            result = await session.execute(
                text(f"SELECT id, username, role FROM users WHERE id = '{created_user_id}'")
            )
            user_row = result.fetchone()
            if user_row and user_row.username == test_username:
                print(f"   ✅ READ: Successfully retrieved user: {user_row.username}")
            else:
                print("   ❌ READ: Failed to retrieve user")
                success = False

            # UPDATE operation
            updated_username = f"{test_username}_updated"
            print(f"   Updating username to: {updated_username}")
            await session.execute(
                text(f"UPDATE users SET username = '{updated_username}' WHERE id = '{created_user_id}'")
            )
            await session.commit()

            # Verify update
            result = await session.execute(
                text(f"SELECT username FROM users WHERE id = '{created_user_id}'")
            )
            updated_name = result.scalar()
            if updated_name == updated_username:
                print(f"   ✅ UPDATE: Successfully updated username to: {updated_name}")
            else:
                print(f"   ❌ UPDATE: Failed to update username. Got: {updated_name}")
                success = False

        except Exception as e:
            print(f"   ❌ Error during CRUD operations: {str(e)}")
            success = False

    # DELETE operation in a separate session
    if created_user_id:
        try:
            async with get_async_session_context() as session:
                print(f"   Deleting test user with ID: {created_user_id}")
                await session.execute(
                    text(f"DELETE FROM users WHERE id = '{created_user_id}'")
                )
                await session.commit()

                # Verify deletion
                result = await session.execute(
                    text(f"SELECT COUNT(*) FROM users WHERE id = '{created_user_id}'")
                )
                count = result.scalar()
                if count == 0:
                    print("   ✅ DELETE: Successfully deleted test user")
                else:
                    print("   ❌ DELETE: Failed to delete test user")
                    success = False
        except Exception as e:
            print(f"   ❌ Error during DELETE operation: {str(e)}")
            success = False

    return success

async def test_table_counts():
    """Get row counts for main tables."""
    print("\n4. Checking table row counts...")

    async with get_async_session_context() as session:
        tables = [
            "users", "projects", "project_files", "conversations",
            "messages", "knowledge_bases", "artifacts"
        ]

        for table in tables:
            try:
                result = await session.execute(text(f"SELECT COUNT(*) FROM {table}"))
                count = result.scalar()
                print(f"   {table}: {count} rows")
            except Exception as e:
                print(f"   ❌ Error counting {table}: {str(e)}")

    return True

async def main():
    """Run all database verification tests."""
    print("=== COMPREHENSIVE DATABASE VERIFICATION ===\n")

    # Run all tests
    connection_ok = await test_connection()
    if not connection_ok:
        print("\n❌ Database connection failed. Aborting further tests.")
        return False

    schema_ok = await test_schema_validation()
    if not schema_ok:
        print("\n⚠️ Schema validation failed. Continuing with other tests...")

    crud_ok = await test_crud_operations()
    if not crud_ok:
        print("\n⚠️ CRUD operations test failed.")

    counts_ok = await test_table_counts()

    # Overall result
    print("\n=== VERIFICATION SUMMARY ===")
    print(f"Connection Test: {'✅ PASSED' if connection_ok else '❌ FAILED'}")
    print(f"Schema Validation: {'✅ PASSED' if schema_ok else '❌ FAILED'}")
    print(f"CRUD Operations: {'✅ PASSED' if crud_ok else '❌ FAILED'}")
    print(f"Table Counts: {'✅ PASSED' if counts_ok else '❌ FAILED'}")

    overall = connection_ok and schema_ok and crud_ok and counts_ok
    print(f"\nOverall Result: {'✅ ALL TESTS PASSED' if overall else '❌ SOME TESTS FAILED'}")

    return overall

if __name__ == "__main__":
    result = asyncio.run(main())
    sys.exit(0 if result else 1)
