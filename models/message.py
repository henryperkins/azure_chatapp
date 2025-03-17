"""
message.py
----------
Defines the Message model for storing messages associated with a Chat.
Tracks role ("user", "assistant", "system"), content, metadata for tokens.
"""

import json
from sqlalchemy import Column, Integer, String, Text, JSON, TIMESTAMP, text, ForeignKey
from sqlalchemy.orm import relationship

from db import Base

class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    chat_id = Column(String, ForeignKey("chats.id", ondelete="CASCADE"), nullable=False)
    role = Column(String, nullable=False)        # "user", "assistant", "system"
    content = Column(Text, nullable=False)
    message_metadata = Column(JSON(none_as_null=True), default=dict)
    timestamp = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))

    # Relationship back to Chat if you want direct ORM usage
    chat = relationship("Chat", back_populates="messages")

    def __repr__(self):
        return f"<Message #{self.id} role={self.role}, chat_id={self.chat_id}>"

    def get_metadata_dict(self):
        return self.message_metadata or {}
