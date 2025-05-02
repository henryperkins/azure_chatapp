from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from utils.auth_utils import get_current_user_and_token
from db import get_async_session
from models.user import User

router = APIRouter()

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession
from utils.auth_utils import get_current_user_and_token

@router.get("/api/user/me")
async def get_current_user_profile(
    request: Request,
    db: AsyncSession = Depends(get_async_session),
    current_user_tuple: tuple = Depends(get_current_user_and_token),
):
    """
    Returns the current user's profile and preferences, for frontend bootstrapping.
    """
    current_user, _ = current_user_tuple
    if not current_user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    prefs = current_user.preferences or {}
    profile = {
        "id": current_user.id,
        "username": current_user.username,
        "role": current_user.role,
        "is_active": current_user.is_active,
        "preferences": prefs,
        "created_at": current_user.created_at,
        "updated_at": current_user.updated_at,
    }
    return {"user": profile}

@router.get("/api/user/projects")
async def get_user_projects(
    db: AsyncSession = Depends(get_async_session),
    current_user_tuple: tuple = Depends(get_current_user_and_token),
):
    """
    Retrieve the current user's project list (id, title, created_at, updated_at, chronologically ordered by preferences) and last_project_id.
    """
    from sqlalchemy import select
    from models.project import Project

    current_user, _ = current_user_tuple
    if not current_user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    prefs = current_user.preferences or {}
    project_refs = prefs.get("projects", [])
    last_project_id = prefs.get("last_project_id")

    # Query real Projects
    result = []
    seen_ids = set()
    if project_refs:
        for ref in project_refs:
            pid = ref.get("id")
            if not pid:
                continue
            # Only once
            if pid in seen_ids:
                continue
            seen_ids.add(pid)
            proj_q = await db.execute(select(Project).where(Project.id == pid, Project.user_id == current_user.id))
            project = proj_q.scalar_one_or_none()
            if project:
                result.append({
                    "id": str(project.id),
                    "title": project.name,
                    "created_at": project.created_at.isoformat() if project.created_at else None,
                    "updated_at": project.updated_at.isoformat() if project.updated_at else None
                })
    else:
        # Fallback: all user projects newest last
        all_q = await db.execute(select(Project).where(Project.user_id == current_user.id).order_by(Project.created_at.asc()))
        for project in all_q.scalars():
            result.append({
                "id": str(project.id),
                "title": project.name,
                "created_at": project.created_at.isoformat() if project.created_at else None,
                "updated_at": project.updated_at.isoformat() if project.updated_at else None
            })

    return {
        "projects": result,
        "last_project_id": last_project_id
    }


@router.get("/api/preferences/starred")
async def get_starred_conversations(
    db: AsyncSession = Depends(get_async_session),
    current_user_tuple: tuple = Depends(get_current_user_and_token),
):
    """
    Get starred conversations for the current user
    """
    # Unpack the (User, token) tuple
    current_user, _ = current_user_tuple

    if not current_user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Retrieve the user's preferences
    preferences = current_user.preferences or {}

    # Return the starred conversations list or an empty list
    return {"data": preferences.get("starred_conversations", [])}


@router.patch("/api/user/preferences")
async def update_user_preferences(
    preferences: dict,
    db: AsyncSession = Depends(get_async_session),
    current_user_tuple: tuple = Depends(get_current_user_and_token),
):
    """
    Update user preferences
    """
    # Unpack the (User, token) tuple
    current_user, _ = current_user_tuple

    if not current_user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Get current preferences or initialize empty dict
    current_preferences = current_user.preferences or {}

    # Update with new incoming preferences
    current_preferences.update(preferences)

    # Save to database
    current_user.preferences = current_preferences
    await db.commit()

    return {"status": "success", "data": current_user.preferences}
