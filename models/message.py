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

    from sqlalchemy.dialects.postgresql import UUID
    import uuid
    
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
        index=True
    )
    conversation_id = Column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False
    )
    role = Column(String, nullable=False)  # "user", "assistant", "system"
    content = Column(Text, nullable=False)
    message_metadata = Column(JSON(none_as_null=True), default=dict)
    timestamp = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    
    conversation = relationship("Conversation", back_populates="messages")
    
    def __repr__(self):
        return f"<Message #{self.id} role={self.role}, conversation_id={self.conversation_id}>"
    
    def get_metadata_dict(self):
        return self.message_metadata or {}
