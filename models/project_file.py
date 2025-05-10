"""
project_file.py
---------------
Stores files attached to a Project.
Each record can hold the filename, path, inline content, etc.
"""

from sqlalchemy import String, Text, TIMESTAMP, text, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column
from db import Base
from typing import Optional
from datetime import datetime


class ProjectFile(Base):
    __tablename__ = "project_files"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    project_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    file_hash: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
        comment="SHA-256 hash of file content for deduplication",
    )
    filename: Mapped[str] = mapped_column(String, nullable=False)
    file_path: Mapped[str] = mapped_column(
        String(500), nullable=False
    )  # local or S3 path
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    file_type: Mapped[str] = mapped_column(
        String(100), nullable=False
    )  # e.g., "pdf", "docx", "txt"
    order_index: Mapped[int] = mapped_column(
        Integer, server_default=text("0"), nullable=False
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

    # Optional content field for inline content
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Configuration and processed metadata
    config: Mapped[Optional[dict]] = mapped_column(
        JSONB(none_as_null=True),
        name="config",
        nullable=True,
        comment="Configuration and processed metadata",
    )

    # Relationship to project
    project = relationship("Project", back_populates="files")

    def __repr__(self):
        return (
            f"<ProjectFile {self.filename} (#{self.id}) project_id={self.project_id}>"
        )

    def to_dict(self):
        """Convert the ProjectFile object to a dictionary representation."""
        return {
            "id": str(self.id),
            "project_id": str(self.project_id),
            "filename": self.filename,
            "file_path": self.file_path,
            "file_size": self.file_size,
            "file_type": self.file_type,
            "file_hash": self.file_hash,
            "order_index": self.order_index,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "config": self.config
        }
