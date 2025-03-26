"""
project.py
----------
Defines the Project model used to group files, notes, and references
that can be attached to one or more conversations for context.
"""
from sqlalchemy import String, Integer, Text, TIMESTAMP, text, ForeignKey, Boolean, CheckConstraint, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship, Mapped, mapped_column
from db import Base
from typing import Optional
from datetime import datetime
import uuid

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
    token_usage: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_tokens: Mapped[int] = mapped_column(Integer, default=200000, nullable=False)
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
    user = relationship("User", back_populates="projects")
    
    # Relationship to knowledge base
    knowledge_base = relationship("KnowledgeBase", back_populates="project", uselist=False, cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Project {self.name} (#{self.id}) user_id={self.user_id}>"
