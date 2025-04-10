from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from utils.auth_utils import get_current_user_and_token
from db import get_async_session
from models.user import User

router = APIRouter()

@router.get("/api/preferences/starred")
async def get_starred_conversations(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_and_token)
):
    """Get starred conversations for the current user"""
    if not current_user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    # Retrieve the user's preferences
    preferences = current_user.preferences or {}
    
    # Return the starred conversations list or an empty list
    return {
        "data": preferences.get("starred_conversations", [])
    }

@router.patch("/api/user/preferences")
async def update_user_preferences(
    preferences: dict,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_and_token)
):
    """Update user preferences"""
    if not current_user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    # Get current preferences or initialize empty dict
    current_preferences = current_user.preferences or {}
    
    # Update with new preferences
    current_preferences.update(preferences)
    
    # Save to database
    current_user.preferences = current_preferences
    await db.commit()
    
    return {"status": "success", "data": current_user.preferences}
