"""
project_file.py
---------------
Stores files attached to a Project. 
Each record can hold the filename, path, inline content, etc.
"""

from sqlalchemy import Column, Integer, String, Text, TIMESTAMP, text, ForeignKey
from sqlalchemy.orm import relationship
from ..db import Base

class ProjectFile(Base):
    __tablename__ = "project_files"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    filename = Column(String, nullable=False)
    filepath = Column(String, nullable=False)  # local or S3 path
    content = Column(Text, nullable=True)
    mime_type = Column(String, nullable=True)
    uploaded_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))

    # Relationship to project
    # project = relationship("Project", back_populates="files")

    def __repr__(self):
        return f"<ProjectFile {self.filename} (#{self.id}) project_id={self.project_id}>"
