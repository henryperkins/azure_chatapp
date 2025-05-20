"""
message.py
----------
Defines the Message model for storing messages associated with a Conversation.
Tracks role ("user", "assistant", "system"), content, metadata for tokens.
"""

from sqlalchemy import String, Text, TIMESTAMP, text, ForeignKey, event, CheckConstraint, Integer
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.dialects.postgresql import JSONB, UUID
from typing import Optional
import uuid
from datetime import datetime

from jsonschema import ValidationError, validate
from db import Base


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint(
            "role IN ('user', 'assistant', 'system')", name="valid_message_roles"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
        index=True,
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(
        String,
        nullable=False,
        comment="Message role: user, assistant, or system",
        server_default="user",
    )
    # Raw markdown/user content
    raw_text: Mapped[str] = mapped_column(Text, nullable=False, comment="Original message raw Markdown/text")
    # Server-rendered and sanitized HTML
    formatted_text: Mapped[str] = mapped_column(Text, nullable=False, comment="Sanitized HTML produced from raw_text")
    # Token count for this message
    token_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False, comment="Number of tokens in message")
    # Optionally keep legacy 'content' for migration/read-compat only
    content: Mapped[str] = mapped_column(Text, nullable=False)
    extra_data: Mapped[Optional[dict]] = mapped_column(
        JSONB(none_as_null=True), default=dict
    )
    context_used: Mapped[Optional[dict]] = mapped_column(
        JSONB(none_as_null=True), comment="KB context actually used in this message"
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=False), server_default=text("CURRENT_TIMESTAMP"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=False),
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=text("CURRENT_TIMESTAMP"),
        nullable=False,
    )

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
            "has_thinking": {"type": "boolean"},
        },
    }


# Attach the 'set' event to the Message.extra_data attribute
@event.listens_for(Message.extra_data, "set", retval=True)
def validate_message_metadata(target, value, oldvalue, initiator):
    if value:
        try:
            validate(instance=value, schema=Message.message_schema)
        except ValidationError as e:
            raise ValueError(f"Invalid message metadata: {e.message}") from e
    return value
