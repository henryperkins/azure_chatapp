"""
user.py
-------
Defines the User model responsible for authentication identity, roles, 
and ownership of chats/projects in the Azure Chat Application.
"""

from sqlalchemy import Column, Integer, String, TIMESTAMP, text
from sqlalchemy.orm import relationship

from db import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="user")  # e.g. "admin", "user"
    created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))

    # Example relationships:
    chats = relationship("Chat", back_populates="user", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User {self.username} (#{self.id})>"
