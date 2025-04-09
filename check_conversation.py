from db import AsyncSessionLocal
from models.conversation import Conversation
import asyncio
import uuid
import sys

async def check_conversation(conv_id_str):
    try:
        conv_id = uuid.UUID(conv_id_str)
        async with AsyncSessionLocal() as db:
            conv = await db.get(Conversation, conv_id)
            print(f"Conversation exists: {conv is not None}")
            if conv:
                print(f"Details: id={conv.id}, project_id={conv.project_id}, user_id={conv.user_id}, is_deleted={conv.is_deleted}")
            else:
                print(f"No conversation found with ID {conv_id}")
    except ValueError:
        print(f"Invalid UUID format: {conv_id_str}")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python check_conversation.py <conversation_id>")
        sys.exit(1)
    
    asyncio.run(check_conversation(sys.argv[1]))
