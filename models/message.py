"""
message.py
----------
Defines the Message model for storing messages associated with a Chat.
Tracks role ("user", "assistant", "system"), content, metadata for tokens.
"""

from sqlalchemy import Integer, String, Text, TIMESTAMP, text, ForeignKey
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from typing import Optional
import uuid
from datetime import datetime

from db import Base

class Message(Base):
    __tablename__ = "messages"

    from sqlalchemy.dialects.postgresql import UUID
    import uuid
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
        index=True
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False
    )
    role: Mapped[str] = mapped_column(String, nullable=False)  # "user", "assistant", "system"
    content: Mapped[str] = mapped_column(Text, nullable=False)
    message_metadata: Mapped[Optional[dict]] = mapped_column(JSONB(none_as_null=True), default=dict)
    timestamp: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    
    conversation = relationship("Conversation", back_populates="messages")
    
    def __repr__(self):
        return f"<Message #{self.id} role={self.role}, conversation_id={self.conversation_id}>"
    
    def get_metadata_dict(self):
        return self.message_metadata or {}

    from sqlalchemy import event
    from jsonschema import ValidationError, validate

    message_schema = {
        "type": "object",
        "properties": {
            "tokens": {"type": "number"},
            "model": {"type": "string"},
            "summary": {"type": "boolean"}
        }
    }

    @event.listens_for(Message.message_metadata, 'set', retval=True)
    def validate_message_metadata(target, value, oldvalue, initiator):
        if value:
            try:
                validate(instance=value, schema=Message.message_schema)
            except ValidationError as e:
                raise ValueError(f"Invalid message metadata: {e.message}") from e
        return value
