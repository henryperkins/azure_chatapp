"""
repair_projects_with_missing_chat_kb.py

Script to ensure all existing projects have:
- a Knowledge Base (kb)
- at least one default Conversation

Idempotent and safe—can be rerun as needed.

Usage:
    python scripts/repair_projects_with_missing_chat_kb.py
"""

import asyncio
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import models  # Ensure all models are registered with SQLAlchemy
from sqlalchemy import select
from db import get_async_session
from models.project import Project
from models.knowledge_base import KnowledgeBase
from models.conversation import Conversation
from models.user import User
from utils.db_utils import save_model

async def create_kb_if_missing(project: Project, db):
    if not getattr(project, "knowledge_base_id", None):
        from services.knowledgebase_service import create_knowledge_base
        kb = await create_knowledge_base(
            name=f"{project.name} Knowledge Base",
            project_id=project.id,
            description="Auto-created KB for project (repair script)",
            db=db,
        )
        # Direct assignment is correct for ORM model attribute
        setattr(project, "knowledge_base_id", kb.id)
        await save_model(db, project)
        print(f"Created KB {kb.id} for project {project.id}")
        return True
    return False

async def create_default_conversation_if_missing(project: Project, db):
    q = await db.execute(
        select(Conversation).where(
            Conversation.project_id == project.id,
            Conversation.is_deleted.is_(False)
        )
    )
    conversations = q.scalars().all()
    if not conversations:
        from services.conversation_service import ConversationService
        user_q = await db.execute(select(User).where(User.id == project.user_id))
        user = user_q.scalar_one_or_none()
        if not user:
            print(f"WARNING: No user found for project {project.id}, skipping default conversation.")
            return False
        conv_service = ConversationService(db)
        default_conversation = await conv_service.create_conversation(
            user_id=user.id,
            title="Default Conversation",
            model_id="claude-3-sonnet-20240229",
            project_id=project.id,
        )
        print(f"Created default conversation {default_conversation.id} for project {project.id}")
        return True
    return False

async def main():
    count_kb = 0
    count_chat = 0
    async for db in get_async_session():
        q = await db.execute(select(Project))
        projects = q.scalars().all()
        for project in projects:
            repaired_kb = await create_kb_if_missing(project, db)
            if repaired_kb:
                count_kb += 1
            repaired_chat = await create_default_conversation_if_missing(project, db)
            if repaired_chat:
                count_chat += 1
        await db.commit()
        print(f"Repaired {count_kb} knowledge bases and {count_chat} chat conversations.")

if __name__ == "__main__":
    asyncio.run(main())
