from db.db import sync_engine, async_engine
from sqlalchemy import text
import asyncio

import bcrypt

def list_users():
    try:
        with sync_engine.connect() as conn:
            result = conn.execute(text(
                "SELECT id, username, password_hash, role, created_at, is_active, is_verified FROM users"
            ))
            users = result.fetchall()
            if not users:
                print("No users found.")
            else:
                print("Registered Users:")
                for u in users:
                    print(f"ID: {u.id}, Username: {u.username}, Role: {u.role}, Created: {u.created_at}, Active: {u.is_active}, Verified: {u.is_verified}")
                    print(f"    Password Hash: {u.password_hash}")

                    # Try authenticating with default pass for admin
                    if u.username in ("admin", "hperkins"):
                        for test_pass in ["Twiohmld1234!", "admin", "password", "testuser"]:
                            try:
                                match = bcrypt.checkpw(test_pass.encode("utf-8"), u.password_hash.encode("utf-8"))
                                print(f"    Test password '{test_pass}': {'OK' if match else 'FAIL'}")
                            except Exception as be:
                                print(f"    Test password '{test_pass}': error: {be}")
                    else:
                        pass
    except Exception as e:
        print(f"User listing failed: {e}")

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
    # List users after connection check
    list_users()

if __name__ == "__main__":
    asyncio.run(main())
