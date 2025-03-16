"""
user.py
-------
Defines the User model responsible for authentication identity, roles, 
and ownership of chats/projects in the Azure Chat Application.
"""

from sqlalchemy import Column, Integer, String, TIMESTAMP, text, Boolean
from sqlalchemy.orm import relationship

from sqlalchemy.ext.asyncio import AsyncSession
from db import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False)
    # Increase the column length for password_hash to ensure the full bcrypt hash is stored
    password_hash = Column(String(200), nullable=False)
    role = Column(String, default="user")  # e.g. "admin", "user"
    created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    is_active = Column(Boolean, default=True, nullable=False)

    # Example relationships:
    chats = relationship("Chat", back_populates="user", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User {self.username} (#{self.id})>"

    @classmethod
    async def get_by_username(cls, db: AsyncSession, username: str):
        from sqlalchemy import select
        result = await db.execute(select(cls).filter(cls.username == username))
        return result.scalars().first()
