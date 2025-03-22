"""
message.py
----------
Defines the Message model for storing messages associated with a Conversation.
Tracks role ("user", "assistant", "system"), content, metadata for tokens.
"""
from sqlalchemy import Integer, String, Text, TIMESTAMP, text, ForeignKey, event
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from typing import Optional
import uuid
from datetime import datetime

from jsonschema import ValidationError, validate
from db import Base

class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
        index=True
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    role: Mapped[str] = mapped_column(String, nullable=False)  # "user", "assistant", "system"
    content: Mapped[str] = mapped_column(Text, nullable=False)
    extra_data: Mapped[Optional[dict]] = mapped_column(JSONB(none_as_null=True), default=dict)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"), onupdate=text("CURRENT_TIMESTAMP"))
    
    conversation = relationship("Conversation", back_populates="messages")
    
    def __repr__(self):
        return f"<Message #{self.id} role={self.role}, conversation_id={self.conversation_id}>"
    
    def get_metadata_dict(self):
        return self.extra_data or {}

    message_schema = {
        "type": "object",
        "properties": {
            "tokens": {"type": "number"},
            "model": {"type": "string"},
            "summary": {"type": "boolean"},
            "thinking": {"type": "string"},
            "redacted_thinking": {"type": "string"},
            "has_thinking": {"type": "boolean"}
        }
    }

# Attach the 'set' event to the Message.extra_data attribute
@event.listens_for(Message.extra_data, 'set', retval=True)
def validate_message_metadata(target, value, oldvalue, initiator):
    if value:
        try:
            validate(instance=value, schema=Message.message_schema)
        except ValidationError as e:
            raise ValueError(f"Invalid message metadata: {e.message}") from e
    return value
