from db import AsyncSessionLocal
from models.conversation import Conversation
import asyncio
import uuid

async def check_conversation():
    async with AsyncSessionLocal() as db:
        conv_id = uuid.UUID('83d184d9-9a2b-4842-8dfd-693f707038b0')
        conv = await db.get(Conversation, conv_id)
        print(f"Conversation exists: {conv is not None}")
        if conv:
            print(f"Details: id={conv.id}, project_id={conv.project_id}, user_id={conv.user_id}")

asyncio.run(check_conversation())