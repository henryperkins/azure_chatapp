"""
artifact.py
-------
Defines the Artifact model, representing content generated within a project:
- Code snippets
- Documents
- Visual outputs
"""

from sqlalchemy import Column, String, Text, TIMESTAMP, text, ForeignKey
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from typing import Optional
from datetime import datetime

from db import Base

class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()")
    )
    project_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    conversation_id: Mapped[Optional[UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    content_type: Mapped[str] = mapped_column(String(50), nullable=False)  # code, document, image, etc.
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    extra_data: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    project = relationship("Project", back_populates="artifacts")
    conversation = relationship("Conversation", back_populates="artifacts")

    def __repr__(self) -> str:
        return f"<Artifact {self.id} name={self.name} type={self.content_type}>"
