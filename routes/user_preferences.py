"""
user_preferences.py
------------------
Handles user preferences including starred conversations.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Dict, Any

from db import get_async_session
from models.user import User
from utils.auth_utils import get_current_user_and_token

router = APIRouter()

@router.get("/preferences", response_model=Dict[str, Any])
async def get_user_preferences(
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """
    Get all user preferences including starred conversations.
    Returns empty dict if no preferences set.
    """
    return current_user.preferences or {}

@router.put("/preferences", response_model=Dict[str, Any])
async def update_user_preferences(
    preferences: Dict[str, Any],
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """
    Update user preferences. Merges with existing preferences.
    Returns updated preferences.
    """
    current_user.preferences = {**(current_user.preferences or {}), **preferences}
    await db.commit()
    await db.refresh(current_user)
    return current_user.preferences

@router.get("/preferences/starred", response_model=list)
async def get_starred_conversations(
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
) -> list:
    """
    Get user's starred conversation IDs.
    Returns empty list if none starred.
    """
    return current_user.preferences.get("starred_conversations", [])

@router.put("/preferences/starred", response_model=list)
async def update_starred_conversations(
    starred_ids: list,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
) -> list:
    """
    Update user's starred conversation IDs.
    Returns updated starred list.
    """
    current_user.preferences = {
        **(current_user.preferences or {}),
        "starred_conversations": starred_ids
    }
    await db.commit()
    await db.refresh(current_user)
    return current_user.preferences.get("starred_conversations", [])