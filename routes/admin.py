from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from models.project import Project
from models.user import User, UserRole
from db import get_async_session
from services import knowledgebase_service
from utils.auth_utils import get_current_user_and_token

router = APIRouter()


async def get_admin_user(
    current_user_tuple: tuple = Depends(get_current_user_and_token),
) -> User:
    """
    Dependency to verify the user is an admin.
    Unpack the (User, token) tuple from get_current_user_and_token.
    """
    current_user, _token = current_user_tuple
    if current_user.role != UserRole.ADMIN.value:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return current_user


@router.post("/admin/fix-project-knowledge-bases", response_model=dict)
async def fix_missing_knowledge_bases(
    admin_user: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Admin endpoint to create knowledge bases for all projects missing them.
    """
    # Get all projects without knowledge bases
    from models.knowledge_base import KnowledgeBase
    query = (
        select(Project)
        .outerjoin(KnowledgeBase, KnowledgeBase.project_id == Project.id)
        .where(KnowledgeBase.id.is_(None))
    )
    result = await db.execute(query)
    projects_without_kb = result.scalars().all()

    fixed_count = 0
    errors = []

    for project in projects_without_kb:
        try:
            await knowledgebase_service.ensure_project_has_knowledge_base(
                project.id, db
            )
            fixed_count += 1
        except Exception as e:
            errors.append(f"Project {project.id}: {str(e)}")

    return {
        "success": True,
        "fixed_count": fixed_count,
        "total_processed": len(projects_without_kb),
        "errors": errors,
    }
