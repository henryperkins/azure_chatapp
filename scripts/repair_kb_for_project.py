"""
repair_kb_for_project.py

Targeted repair script to ensure a specific project has a valid, attached Knowledge Base (KB).
- If the reference FK points to a missing/nonexistent KB, or the KB is null, it creates a new KB and fixes the FK.
Idempotent and safe.

Usage:
    python scripts/repair_kb_for_project.py <project-uuid>
"""

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import asyncio
from sqlalchemy import select
from db import get_async_session
from models.project import Project
from models.knowledge_base import KnowledgeBase
from utils.db_utils import save_model

async def force_repair_kb(project_id: str, db):
    # Fetch project
    q = await db.execute(select(Project).where(Project.id == project_id))
    project = q.scalar_one_or_none()
    if not project:
        print(f"ERROR: Project {project_id} does not exist.")
        return

    kb_id = getattr(project, "knowledge_base_id", None)
    kb_missing = True

    if kb_id:
        # Check if the referenced KB exists
        kb_q = await db.execute(select(KnowledgeBase).where(KnowledgeBase.id == kb_id))
        kb = kb_q.scalar_one_or_none()
        if kb:
            kb_missing = False

    if not kb_id or kb_missing:
        from services.knowledgebase_service import create_knowledge_base

        print("Repairing: KB was missing or reference is invalid; will create a new KB and update the project FK.")
        new_kb = await create_knowledge_base(
            name=f"Manual KB for project {project.name}",
            project_id=project.id,
            description="Auto-created during manual repair",
            db=db,
        )
        project.knowledge_base_id = new_kb.id
        await save_model(db, project)
        print(f"Created KB {new_kb.id} and linked to project {project_id}.")
    else:
        print(f"Project {project_id} already has a valid KB ({kb_id}). No repair needed.")

    await db.commit()

async def main():
    if len(sys.argv) != 2:
        print("USAGE: python scripts/repair_kb_for_project.py <project-uuid>")
        sys.exit(1)
    project_id = sys.argv[1]
    async for db in get_async_session():
        await force_repair_kb(project_id, db)
        break

if __name__ == "__main__":
    asyncio.run(main())
