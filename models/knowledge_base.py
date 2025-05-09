"""
knowledge_base.py
----------------
Defines the KnowledgeBase model for managing vector embeddings and semantic search
capabilities that can be attached to projects.
"""

from sqlalchemy import (
    String,
    Text,
    TIMESTAMP,
    text,
    Boolean,
    ForeignKey,
    Integer,
    Index,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from db import Base
from typing import Optional
from datetime import datetime


class KnowledgeBase(Base):
    __tablename__ = "knowledge_bases"
    __table_args__ = (Index("ix_knowledge_bases_embedding_model", "embedding_model"),)

    config: Mapped[dict] = mapped_column(JSONB(none_as_null=True), default=dict)

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    embedding_model: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="Embedding model identifier (e.g. 'all-MiniLM-L6-v2')",
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    last_used: Mapped[Optional[datetime]] = mapped_column(
        TIMESTAMP, nullable=True, comment="Last time this knowledge base was accessed"
    )
    project_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=text("CURRENT_TIMESTAMP"),
    )

    # GitHub repository integration attributes
    repo_url: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    branch: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    file_paths: Mapped[Optional[list[str]]] = mapped_column(JSONB, nullable=True)

    # parent project (one-to-one)
    project = relationship(
        "Project",
        back_populates="knowledge_base",
        uselist=False
    )

    def __repr__(self):
        """
        Returns a string representation of the KnowledgeBase instance with its name and ID.
        """
        return f"<KnowledgeBase {self.name} (#{self.id})>"
