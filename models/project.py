from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any, Optional
from datetime import datetime
from sqlalchemy import (
    String,
    Integer,
    Text,
    TIMESTAMP,
    text,
    ForeignKey,
    Boolean,
    CheckConstraint,
    Index,
    event,
    UniqueConstraint,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import relationship, Mapped, mapped_column

from db import Base

if TYPE_CHECKING:
    from models.user import User


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        CheckConstraint(
            "max_tokens >= token_usage",
            name="check_token_limit",
            comment="Token usage cannot exceed allocated maximum",
        ),
        CheckConstraint(
            "NOT (archived AND pinned)",
            name="check_archive_pin",
            comment="Archived projects cannot be pinned",
        ),
        CheckConstraint("NOT (archived AND is_default)", name="check_archive_default"),
        Index("ix_projects_created_at", "created_at"),
        Index("ix_projects_updated_at", "updated_at")
    )

    id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    goals: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # token_usage and max_tokens are not nullable, so we can remove none checks.
    token_usage: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False, server_default="0"
    )
    max_tokens: Mapped[int] = mapped_column(
        Integer, default=200000, nullable=False, server_default="200000"
    )

    custom_instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)

    default_model: Mapped[str] = mapped_column(
        String(50),
        default="claude-3-sonnet-20240229",
        nullable=False,
        server_default="claude-3-sonnet-20240229",
    )

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("CURRENT_TIMESTAMP")
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=text("CURRENT_TIMESTAMP"),
    )

    extra_data: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )

    # Relationships
    conversations = relationship(
        "Conversation",
        back_populates="project",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    artifacts = relationship(
        "Artifact",
        back_populates="project",
        cascade="all, delete-orphan",
    )
    files = relationship(
        "ProjectFile",
        back_populates="project",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    members: Mapped[list[ProjectUserAssociation]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    # Nueva relación uno-a-uno: KnowledgeBase referenciado por knowledge_bases.project_id
    knowledge_base = relationship(
        "KnowledgeBase",
        back_populates="project",
        uselist=False,
        foreign_keys="KnowledgeBase.project_id"
    )

    def __repr__(self) -> str:
        return f"<Project {self.name} (#{self.id}) user_id={self.user_id}>"

    @hybrid_property
    def token_status(self) -> bool:
        """Returns True if current token usage is within the max tokens limit."""
        return self.token_usage <= self.max_tokens


# Deleted Project.knowledge_base_id event listener; single enforced direction


class ProjectUserAssociation(Base):
    __tablename__ = "project_users"
    __table_args__ = (
        Index("ix_project_users_joined_at", "joined_at"),
        Index("ix_project_users_role", "role"),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(String(50), default="member")
    joined_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("CURRENT_TIMESTAMP")
    )

    # Relationships
    project: Mapped[Project] = relationship(back_populates="members")
    user: Mapped[User] = relationship(back_populates="project_associations")
