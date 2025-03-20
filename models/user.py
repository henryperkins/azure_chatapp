"""
user.py
-------
Defines the User model responsible for authentication identity, roles, 
and ownership of conversations/projects in the Azure Chat Application.
"""
from sqlalchemy import Integer, String, TIMESTAMP, text, Boolean, CheckConstraint, Enum, Index
from sqlalchemy.orm import relationship, Mapped, mapped_column
from typing import List, TYPE_CHECKING
from datetime import datetime
import enum

from db import Base

if TYPE_CHECKING:
    from .project import Project

class UserRole(enum.Enum):
    USER = "user"
    ADMIN = "admin"

class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "role IN ('user', 'admin')",
            name="valid_role_types"
        ),
        Index('ix_users_last_login', 'last_login'),
        Index('ix_users_created_at', 'created_at')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[str] = mapped_column(String(50), default="user")  # e.g. "admin", "user"
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"), onupdate=text("CURRENT_TIMESTAMP"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Add field for tracking last login time
    last_login: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"), nullable=True)

    # Relationships
    conversations = relationship("Conversation", back_populates="user", cascade="all, delete-orphan")
    projects: Mapped[List["Project"]] = relationship("Project", back_populates="user", cascade="all, delete-orphan", passive_deletes=True)

    def __repr__(self):
        return f"<User {self.username} (#{self.id})>"
