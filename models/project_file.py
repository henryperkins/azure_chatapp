"""
project_file.py
---------------
Stores files attached to a Project. 
Each record can hold the filename, path, inline content, etc.
"""
from sqlalchemy import Column, String, Text, TIMESTAMP, text, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship, Mapped, mapped_column
from db import Base
from typing import Optional
from datetime import datetime

class ProjectFile(Base):
    __tablename__ = "project_files"
    
    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()")
    )
    project_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False
    )
    filename: Mapped[str] = mapped_column(String, nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)  # local or S3 path
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    file_type: Mapped[str] = mapped_column(String(100), nullable=False)  # e.g., "pdf", "docx", "txt"
    order_index: Mapped[int] = mapped_column(Integer, server_default=text('0'), nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    
    # Optional content field for inline content
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Metadata field for token count and other info
    extra_metadata: Mapped[Optional[dict]] = mapped_column(JSONB(none_as_null=True), nullable=True)
    
    # Relationship to project
    project = relationship("Project", back_populates="files")
    
    def __repr__(self):
        return f"<ProjectFile {self.filename} (#{self.id}) project_id={self.project_id}>"
