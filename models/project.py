"""
project.py
----------
Defines the Project model used to group files, notes, and references 
that can be attached to one or more chats for context.
"""

from sqlalchemy import Column, Integer, String, Text, TIMESTAMP, text, ForeignKey
from models.chat_project import ChatProject
from sqlalchemy.orm import relationship

from db import Base

class Project(Base):
    __tablename__ = "projects"

    from sqlalchemy.dialects.postgresql import UUID
    import uuid

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200))
    goals = Column(Text)
    token_usage = Column(Integer, default=0)
    max_tokens = Column(Integer, default=200000)
    custom_instructions = Column(Text)
    archived = Column(Boolean, default=False)
    pinned = Column(Boolean, default=False)
    version = Column(Integer, default=1)
    knowledge_base_id = Column(String)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"), onupdate=text("CURRENT_TIMESTAMP"))

    # If bridging table chat_projects is used, define association:
    chats = relationship("Chat", secondary="chat_projects", back_populates="projects")

    # If you track files in the same or separate table:
    # files = relationship("ProjectFile", back_populates="project.")

    def __repr__(self):
        return f"<Project {self.name} (#{self.id}) user_id={self.user_id}>"
