"""
project.py
----------
Defines the Project model used to group files, notes, and references
that can be attached to one or more chats for context.
"""
from sqlalchemy import Column, String, Integer, Text, TIMESTAMP, text, ForeignKey, Boolean
from sqlalchemy.dialects.postgresql import UUID, JSONB
# Removed import as chat_project is no longer used
from sqlalchemy.orm import relationship, Mapped, mapped_column

from db import Base
from typing import Optional
from datetime import datetime
import uuid

class Project(Base):
    __tablename__ = "projects"
    
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
    knowledge_base_id: Mapped[Optional[UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("knowledge_bases.id", ondelete="SET NULL"), nullable=True)
    
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"), onupdate=text("CURRENT_TIMESTAMP"))
    
    extra_metadata: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    
    # Relationship to conversations
    conversations = relationship("Conversation", back_populates="project", cascade="all, delete-orphan", passive_deletes=True)
    artifacts = relationship("Artifact", back_populates="project", cascade="all, delete-orphan")
    
    # Relationship to files
    files = relationship("ProjectFile", back_populates="project", cascade="all, delete-orphan")
    user = relationship("User", back_populates="projects")

    def __repr__(self):
        return f"<Project {self.name} (#{self.id}) user_id={self.user_id}>"
