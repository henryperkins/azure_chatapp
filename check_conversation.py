from db import AsyncSessionLocal
import asyncio
import uuid
import sys
from sqlalchemy import text

async def check_conversation(conv_id_str):
    try:
        conv_id = uuid.UUID(conv_id_str)
        async with AsyncSessionLocal() as db:
            # Use raw SQL to avoid model loading issues
            query = text("SELECT id, project_id, user_id, is_deleted FROM conversations WHERE id = :conv_id")
            result = await db.execute(query, {"conv_id": conv_id})
            row = result.fetchone()
            
            print(f"Conversation exists: {row is not None}")
            if row:
                print(f"Details: id={row[0]}, project_id={row[1]}, user_id={row[2]}, is_deleted={row[3]}")
            else:
                print(f"No conversation found with ID {conv_id}")
    except ValueError:
        print(f"Invalid UUID format: {conv_id_str}")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python check_conversation.py <conversation_id>")
        sys.exit(1)
    
    asyncio.run(check_conversation(sys.argv[1]))
