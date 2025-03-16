"""
project.py
----------
Defines the Project model used to group files, notes, and references 
that can be attached to one or more chats for context.
"""

from sqlalchemy import Column, Integer, String, Text, TIMESTAMP, text, ForeignKey
from sqlalchemy.orm import relationship

from ..db import Base

class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    subtitle = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))

    # If bridging table chat_projects is used, define association:
    # chats = relationship("Chat", secondary="chat_projects", back_populates="projects")

    # If you track files in the same or separate table:
    # files = relationship("ProjectFile", back_populates="project.")

    def __repr__(self):
        return f"<Project {self.name} (#{self.id}) user_id={self.user_id}>"
