"""
repair_broken_conversations.py

Script to audit all chats in the database:
- Reports the total number of conversations
- Lists unattached conversations (where project_id IS NULL)
- For attached chats, shows the project id they are attached to
- If ALL conversations are unattached: deletes all and prints investigation warning
- Otherwise, just lists unattached chats for manual inspection

Usage:
    python scripts/repair_broken_conversations.py
"""

import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from sqlalchemy import select, delete
from db import get_async_session
from models.conversation import Conversation

async def main():
    async for db in get_async_session():
        # Count all conversations
        total_q = await db.execute(select(Conversation))
        all_chats = total_q.scalars().all()
        total_count = len(all_chats)

        # Find unattached (projectless) conversations
        unattached_q = await db.execute(
            select(Conversation).where(Conversation.project_id == None)
        )
        unattached_chats = unattached_q.scalars().all()
        unattached_count = len(unattached_chats)

        # Find attached conversations (to one project)
        attached_chats = [conv for conv in all_chats if conv.project_id is not None]

        print(f"Total conversations in DB: {total_count}")
        print(f"Unattached (no project_id) conversations: {unattached_count}\n")

        if unattached_count > 0:
            print("Unattached chat IDs:")
            for conv in unattached_chats:
                print(f"- {conv.id} (title: {getattr(conv, 'title', '[No title]')})")
            print("")

        if attached_chats:
            print("Attached conversations (with project_id):")
            for conv in attached_chats:
                print(f"- {conv.id} (title: {getattr(conv, 'title', '[No title]')}) | project_id: {conv.project_id}")
            print("")

        if unattached_count == total_count and total_count > 0:
            print("\nWARNING: ALL chats are unattached! Purging all conversations for investigation.")
            await db.execute(delete(Conversation))
            await db.commit()
            print("All conversations have been deleted.")
        else:
            print("No bulk deletion performed. Please review unattached chats above.")

if __name__ == "__main__":
    asyncio.run(main())
