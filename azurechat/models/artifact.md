```python
"""
artifact.py
-------
Defines the Artifact model, representing content generated within a project:
- Code snippets
- Documents
- Visual outputs
"""

from sqlalchemy import String, Text, TIMESTAMP, text, ForeignKey, CheckConstraint
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.dialects.postgresql import JSONB, UUID
from typing import Optional, Any
from datetime import datetime

from db import Base


class Artifact(Base):
    __tablename__ = "artifacts"
    __table_args__ = (
        CheckConstraint(
            "content_type IN ('code', 'document', 'image', 'audio', 'video')",
            name="valid_content_type",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    project_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True
    )
    conversation_id: Mapped[Optional[UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="SET NULL"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    content_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # code, document, image, etc.
    content: Mapped[str] = mapped_column(
        Text, nullable=False, comment="Max 10MB of text content"
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=False), server_default=text("CURRENT_TIMESTAMP"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=False),
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=text("CURRENT_TIMESTAMP"),
        nullable=False,
    )
    extra_data: Mapped[Optional[dict]] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )

    project = relationship("Project", back_populates="artifacts")
    conversation = relationship("Conversation", back_populates="artifacts")

    def __repr__(self) -> str:
        return f"<Artifact {self.id} name={self.name} type={self.content_type}>"

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": str(self.id),
            "project_id": str(self.project_id),
            "conversation_id": (
                str(self.conversation_id) if self.conversation_id else None
            ),
            "name": self.name,
            "content_type": self.content_type,
            "content": self.content,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "extra_data": self.extra_data,
        }

```