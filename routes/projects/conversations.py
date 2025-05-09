# This module handles conversation routes for projects.
# All references to project.knowledge_base_id have been replaced with project.knowledge_base (1-1 relationship).
# When the UUID of the KB is needed, use: kb_id = project.knowledge_base.id if project.knowledge_base else None

from fastapi import APIRouter, HTTPException, Depends, Request, status
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession

from models.project import Project
from models.conversation import Conversation
from db import get_async_session
from services.conversation_service import ConversationService, get_conversation_service

router = APIRouter()


def get_kb_id(project):
    return project.knowledge_base.id if project.knowledge_base else None


@router.post("/api/projects/{project_id}/conversations", response_model=dict)
async def create_conversation(
    project_id: UUID,
    request: Request,
    conversation_service: ConversationService = Depends(get_conversation_service),
    db: AsyncSession = Depends(get_async_session),
):
    # Fetch project
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Validate existence of KB
    if not project.knowledge_base:
        raise HTTPException(status_code=400, detail="Project has no knowledge base")

    kb_id = project.knowledge_base.id if project.knowledge_base else None

    # Example: extract user_id and other data from request (adapt as needed)
    data = await request.json()
    request_user_id = data.get("user_id")
    title = data.get("title", "Untitled")
    model_id = data.get("model_id")
    ai_settings = data.get("ai_settings", {})

    convo = Conversation(
        user_id=request_user_id,
        project_id=project.id,
        knowledge_base_id=kb_id,
        title=title,
        model_id=model_id,
        use_knowledge_base=True,
        extra_data={"ai_settings": ai_settings} if ai_settings else None,
    )

    db.add(convo)
    await db.commit()
    await db.refresh(convo)
    return {"id": str(convo.id), "title": convo.title}

# (Other GET/POST/DELETE routes for conversations would also use project.knowledge_base and kb_id as above)
