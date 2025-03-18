"""
user.py
-------
Defines the User model responsible for authentication identity, roles, 
and ownership of chats/projects in the Azure Chat Application.
"""

from sqlalchemy import Column, Integer, String, TIMESTAMP, text, Boolean
from sqlalchemy.orm import relationship, Mapped, mapped_column
from typing import List, TYPE_CHECKING
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from db import Base

if TYPE_CHECKING:
    from .project import Project

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[str] = mapped_column(String(50), default="user")  # e.g. "admin", "user"
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Example relationships:
    conversations = relationship("Conversation", back_populates="user", cascade="all, delete-orphan")
    projects: Mapped[List["Project"]] = relationship("Project", back_populates="user", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User {self.username} (#{self.id})>"

    @classmethod
    async def get_by_username(cls, db: AsyncSession, username: str):
        from sqlalchemy import select
        result = await db.execute(select(cls).filter(cls.username == username))
        return result.scalars().first()
