"""
conversation.py
--------------
Defines the Conversation model, representing a conversation's metadata: 
- ID (UUID)
- user ownership
- optional model_id referencing an AI model
- title for display
"""
from sqlalchemy import String, Integer, Boolean, TIMESTAMP, text, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column
from db import Base
from typing import Optional
from datetime import datetime
import uuid

class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    project_id: Mapped[Optional[UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String, default="New Chat")
    model_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP,
        server_default=text("CURRENT_TIMESTAMP"),
        index=True
    )
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"), onupdate=text("CURRENT_TIMESTAMP"))
    extra_data: Mapped[Optional[dict]] = mapped_column(JSONB(none_as_null=True), default=dict)
    knowledge_base_id: Mapped[Optional[UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("knowledge_bases.id"),
        nullable=True
    )
    use_knowledge_base: Mapped[bool] = mapped_column(Boolean, default=False)
    search_results: Mapped[Optional[dict]] = mapped_column(JSONB(none_as_null=True))
    
    user = relationship("User", back_populates="conversations")
    knowledge_base = relationship("KnowledgeBase")
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")
    project = relationship("Project", back_populates="conversations")
    artifacts = relationship("Artifact", back_populates="conversation")

    def __repr__(self) -> str:
        return f"<Conversation {self.id} (User #{self.user_id}) title={self.title}>"
