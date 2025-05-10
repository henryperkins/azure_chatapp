"""
conversation.py
--------------
Defines the Conversation model, representing a conversation's metadata:
- ID (UUID)
- user ownership
- optional model_id referencing an AI model
- title for display
"""

import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    String,
    Integer,
    Boolean,
    TIMESTAMP,
    text,
    ForeignKey,
    select,
    func,
    or_,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column, validates

from db import Base
from models.knowledge_base import KnowledgeBase
from models.project import Project  # noqa: F401
from models.project_file import ProjectFile

logger = logging.getLogger(__name__)


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, index=True
    )
    project_id: Mapped[Optional[UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String, default="New Chat")
    model_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=False), server_default=text("CURRENT_TIMESTAMP"), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=False),
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=text("CURRENT_TIMESTAMP"),
    )
    extra_data: Mapped[Optional[dict]] = mapped_column(
        JSONB(none_as_null=True), default=dict
    )
    knowledge_base_id: Mapped[Optional[UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_bases.id"), nullable=True
    )
    use_knowledge_base: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    search_results: Mapped[Optional[dict]] = mapped_column(JSONB(none_as_null=True))

    user = relationship("User", back_populates="conversations")
    knowledge_base = relationship("KnowledgeBase")
    messages = relationship(
        "Message", back_populates="conversation", cascade="all, delete-orphan"
    )
    project = relationship("Project", back_populates="conversations")
    artifacts = relationship("Artifact", back_populates="conversation")

    def __repr__(self) -> str:
        return f"<Conversation {self.id} (User #{self.user_id}) title={self.title}>"

    async def validate_knowledge_base(self, db: AsyncSession) -> None:
        """Validate KB with actual database content"""
        if self.use_knowledge_base and self.knowledge_base_id:
            kb = await db.get(KnowledgeBase, self.knowledge_base_id)

            # Check if KB exists and active
            if not kb:
                raise ValueError("Project's knowledge base not found")
            if not getattr(kb, "is_active", False):
                raise ValueError("Project's knowledge base is not active")

            # Check for any files that are either:
            # 1. Successfully processed (has chunks)
            # 2. In processing state (pending)
            # 3. Failed but retryable
            stmt = select(
                func.count().label("total_files"),  # pylint: disable=not-callable
                func.sum(
                    ProjectFile.config["search_processing"]["chunk_count"].as_integer()
                ).label("total_chunks"),
            ).where(
                ProjectFile.project_id == self.project_id,
                or_(
                    ProjectFile.config["search_processing"]["success"].as_boolean(),
                    ProjectFile.config["search_processing"]["attempted_at"].is_not(
                        None
                    ),
                ),
            )

            result = await db.execute(stmt)
            stats = result.mappings().first()
            stats = stats or {}
            total_chunks = stats.get("total_chunks", 0)
            total_files = stats.get("total_files", 0)

            if total_chunks <= 0 and total_files > 0:
                raise ValueError(
                    "Knowledge base has files but none are indexed yet. "
                    "Please reprocess files or wait for indexing to complete."
                )
            elif total_chunks <= 0:
                logger.warning(
                    f"Knowledge base {kb.id} has no files - "
                    f"upload files to enable knowledge base for project {self.project_id}"
                )

    @validates("use_knowledge_base")
    def validate_kb_flag(self, _, value):
        """Validate knowledge base flag is consistent with project association"""
        if value and not self.project_id:
            raise ValueError("Knowledge base requires project association")
        return value
