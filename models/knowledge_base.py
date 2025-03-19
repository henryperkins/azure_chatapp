"""
knowledge_base.py
----------------
Defines the KnowledgeBase model for managing vector embeddings and semantic search
capabilities that can be attached to projects.
"""
from sqlalchemy import String, Text, TIMESTAMP, text, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column
from db import Base
from typing import Optional
from datetime import datetime

class KnowledgeBase(Base):
    __tablename__ = "knowledge_bases"
    
    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), 
        primary_key=True,
        server_default=text("gen_random_uuid()")
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    embedding_model: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP, 
        server_default=text("CURRENT_TIMESTAMP")
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP, 
        server_default=text("CURRENT_TIMESTAMP"), 
        onupdate=text("CURRENT_TIMESTAMP")
    )
    
    # Relationship to projects using this knowledge base
    projects = relationship("Project", back_populates="knowledge_base")
    
    def __repr__(self):
        return f"<KnowledgeBase {self.name} (#{self.id})>"