"""
project.py
----------
Defines the Project model used to group files, notes, and references
that can be attached to one or more conversations for context.
"""
from typing import List
from sqlalchemy import String, Integer, Text, TIMESTAMP, text, ForeignKey, Boolean, CheckConstraint, Index
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column
from db import Base
from typing import Optional, TYPE_CHECKING
from datetime import datetime
from sqlalchemy import event

class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        CheckConstraint('max_tokens >= token_usage', name='check_token_limit', comment="Token usage cannot exceed allocated maximum"),
        CheckConstraint('NOT (archived AND pinned)', name='check_archive_pin', comment="Archived projects cannot be pinned"),
        CheckConstraint('NOT (archived AND is_default)', name='check_archive_default'),
        Index('ix_projects_created_at', 'created_at'),
        Index('ix_projects_updated_at', 'updated_at')
    )
    
    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), 
        primary_key=True,
        server_default=text("gen_random_uuid()")
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    goals: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    token_usage: Mapped[int] = mapped_column(
        Integer, 
        default=0, 
        nullable=False,
        server_default="0"  # Ensure DB-level default
    )
    max_tokens: Mapped[int] = mapped_column(
        Integer, 
        default=200000, 
        nullable=False,
        server_default="200000"  # Ensure DB-level default
    )
    custom_instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    knowledge_base_id: Mapped[Optional[UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("knowledge_bases.id", ondelete="SET NULL"), 
        nullable=True, 
        index=True,
        unique=True,  # Ensures one KB per project
        comment="References knowledge base assets"
    )
    default_model: Mapped[str] = mapped_column(String(50), default="claude-3-sonnet-20240229", nullable=False, server_default="claude-3-sonnet-20240229")
    
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"), onupdate=text("CURRENT_TIMESTAMP"))
    
    extra_data: Mapped[Optional[dict]] = mapped_column(JSONB(none_as_null=True), nullable=True)
    
    # Relationship to conversations
    conversations = relationship("Conversation", back_populates="project", cascade="all, delete-orphan", passive_deletes=True)
    artifacts = relationship("Artifact", back_populates="project", cascade="all, delete-orphan")
    
    # Relationship to files
    files = relationship("ProjectFile", back_populates="project", cascade="all, delete-orphan", passive_deletes=True)
    
    # Many-to-many relationship to users through association table
    members: Mapped[List["ProjectUserAssociation"]] = relationship(
        back_populates="project", 
        cascade="all, delete-orphan"
    )
    
    # Simple one-way relationship to knowledge base
    knowledge_base = relationship(
        "KnowledgeBase",
        uselist=False,
        foreign_keys=[knowledge_base_id]
    )

    def __repr__(self):
        return f"<Project {self.name} (#{self.id}) user_id={self.user_id}>"

    @hybrid_property
    def token_status(self) -> bool:
        usage = self.token_usage if self.token_usage is not None else 0
        limit = self.max_tokens if self.max_tokens is not None else 200000
        return usage <= limit

    @token_status.expression
    def token_status(cls):
        return case(
            [
                (and_(
                    cls.token_usage.is_not(None),
                    cls.max_tokens.is_not(None)
                ), cls.token_usage <= cls.max_tokens)
            ],
            else_=False
        )

@event.listens_for(Project.knowledge_base_id, 'set', retval=True)
def validate_knowledge_base_assignment(target, value, oldvalue, initiator):
    if value and oldvalue and value != oldvalue:
        raise ValueError("Cannot change knowledge base association - create a new knowledge base instead")
    return value


class ProjectUserAssociation(Base):
    __tablename__ = "project_users"
    
    project_id: Mapped[UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), 
        primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), 
        primary_key=True
    )
    role: Mapped[str] = mapped_column(String(50), default="member")
    joined_at: Mapped[datetime] = mapped_column(
        TIMESTAMP, 
        server_default=text("CURRENT_TIMESTAMP")
    )

    # Relationships
    project: Mapped["Project"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship(back_populates="project_associations")

if TYPE_CHECKING:
    from models.user import User
