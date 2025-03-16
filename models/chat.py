"""
chat.py
-------
Defines the Chat model, representing a conversation's metadata: 
- ID (usually a UUID)
- user ownership
- optional model_id referencing an AI model
- title for display
"""

from sqlalchemy import Column, String, Integer, Boolean, TIMESTAMP, text, ForeignKey
from sqlalchemy.orm import relationship

from db import Base

class Chat(Base):
    __tablename__ = "chats"

    id = Column(String, primary_key=True)  # e.g. a UUID string
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String, default="New Chat")
    model_id = Column(String, nullable=True)
    is_deleted = Column(Boolean, default=False)
    created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))

    # If you define a relationship to the user:
    user = relationship("User", back_populates="chats")

    # If you define a relationship to messages:
    # messages = relationship("Message", back_populates="chat", cascade="all, delete-orphan")

    # Relationship for projects could be many-to-many via a bridging table chat_projects
    projects = relationship("Project", secondary="chat_projects", back_populates="chats")

    def __repr__(self):
        return f"<Chat {self.id} (User #{self.user_id}) title={self.title}>"
