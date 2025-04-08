"""
user.py
-------
Defines the User model responsible for authentication identity, roles, 
and ownership of conversations/projects in the Azure Chat Application.
"""

from typing import List, Optional
from sqlalchemy import (
    Integer,
    String,
    TIMESTAMP,
    text,
    Boolean,
    CheckConstraint,
    Index,
    ForeignKey,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.ext.hybrid import hybrid_property
from typing import List, TYPE_CHECKING

if TYPE_CHECKING:
    from models.project import ProjectUserAssociation
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
        CheckConstraint("role IN ('user', 'admin')", name="valid_role_types"),
        Index("ix_users_last_login", "last_login"),
        Index("ix_users_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[str] = mapped_column(
        String(50), nullable=False, default="user"
    )  # e.g. "admin", "user"
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP, server_default=text("CURRENT_TIMESTAMP")
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=text("CURRENT_TIMESTAMP"),
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Add field for tracking last login time
    last_login: Mapped[datetime] = mapped_column(
        TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"), nullable=True
    )
    token_version: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False, server_default="0"
    )
    preferences: Mapped[dict] = mapped_column(
        JSONB, default={}, nullable=False, server_default="'{}'::jsonb"
    )

    # Relationships
    conversations = relationship(
        "Conversation", back_populates="user", cascade="all, delete-orphan"
    )
    project_associations: Mapped[List["ProjectUserAssociation"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<User {self.username} (#{self.id})>"


class TokenBlacklist(Base):
    __tablename__ = "token_blacklist"
    __table_args__ = (
        Index("ix_token_blacklist_token_type", "token_type"),
        Index("ix_token_blacklist_expires", "expires"),
        Index("ix_token_blacklist_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    jti: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    expires: Mapped[datetime] = mapped_column(TIMESTAMP)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    token_type: Mapped[str] = mapped_column(String(20), default="access", nullable=False, server_default="access")
    creation_reason: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=text("CURRENT_TIMESTAMP")
    )
