"""
chat_project.py
---------------
Defines the many-to-many relationship between Chats and Projects.
"""

from sqlalchemy import Column, String, Integer, ForeignKey
from db import Base

class ChatProject(Base):
    __tablename__ = "chat_projects"
    
    chat_id = Column(String, ForeignKey('chats.id'), primary_key=True)
    project_id = Column(Integer, ForeignKey('projects.id'), primary_key=True)

    def __repr__(self):
        return f"<ChatProject chat={self.chat_id} project={self.project_id}>"
