```python
"""
user_service.py
---------------
Provides user-related services that were previously in the User model.
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models.user import User


async def get_user_by_username(db: AsyncSession, username: str):
    """
    Retrieves a user by their username.

    Args:
        db: AsyncSession instance
        username: Username to search for

    Returns:
        User instance or None if not found
    """
    result = await db.execute(select(User).filter(User.username == username))
    return result.scalars().first()

```