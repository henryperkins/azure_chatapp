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
from models.chat_project import ChatProject
from sqlalchemy.orm import relationship

from db import Base

from typing import Optional
from datetime import datetime
from sqlalchemy.orm import Mapped, mapped_column

class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String, default="New Chat")
    model_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))

    user = relationship("User", back_populates="chats")
    # messages = relationship("Message", back_populates="chat", cascade="all, delete-orphan")
    projects = relationship("Project", secondary="chat_projects", back_populates="chats")

    def __repr__(self) -> str:
        return f"<Chat {self.id} (User #{self.user_id}) title={self.title}>"
