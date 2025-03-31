"""
conversation.py
--------------
Defines the Conversation model, representing a conversation's metadata: 
- ID (UUID)
- user ownership
- optional model_id referencing an AI model
- title for display
"""
from sqlalchemy import String, Integer, Boolean, TIMESTAMP, text, ForeignKey
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import JSONB, UUID
from models.project import Project
from models.knowledge_base import KnowledgeBase
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column, validates
from db import Base
from typing import Optional
from datetime import datetime
import uuid

class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    project_id: Mapped[Optional[UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String, default="New Chat")
    model_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP,
        server_default=text("CURRENT_TIMESTAMP"),
        index=True
    )
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"), onupdate=text("CURRENT_TIMESTAMP"))
    extra_data: Mapped[Optional[dict]] = mapped_column(JSONB(none_as_null=True), default=dict)
    knowledge_base_id: Mapped[Optional[UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("knowledge_bases.id"),
        nullable=True
    )
    use_knowledge_base: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    search_results: Mapped[Optional[dict]] = mapped_column(JSONB(none_as_null=True))
    
    user = relationship("User", back_populates="conversations")
    knowledge_base = relationship("KnowledgeBase")
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")
    project = relationship("Project", back_populates="conversations")
    artifacts = relationship("Artifact", back_populates="conversation")

    def __repr__(self) -> str:
        return f"<Conversation {self.id} (User #{self.user_id}) title={self.title}>"

    async def validate_knowledge_base(self, db: AsyncSession) -> None:
        """Validate KB usage is properly configured"""
        if self.use_knowledge_base and not self.project_id:
            raise ValueError("Knowledge base can only be used with project-associated conversations")
            
        if self.use_knowledge_base:
            if not self.project_id:
                raise ValueError("Conversation must belong to project to use KB")
            
            project = await db.get(Project, self.project_id)
            if not project or not project.knowledge_base_id:
                raise ValueError("Project has no knowledge base configured")
            
            kb = await db.get(KnowledgeBase, project.knowledge_base_id)
            if not kb or not kb.is_active:
                raise ValueError("Project's knowledge base is not active")
            
            # Check index stats through JSONB config field
            config_data = kb.config or {}
            index_stats = config_data.get("index_stats", {})
            
            if not index_stats.get("chunk_count", 0) > 0:
                raise ValueError("Knowledge base has no indexed content")

    @validates('use_knowledge_base')
    def validate_kb_flag(self, key, value):
        """Validate knowledge base flag is consistent with project association"""
        if value and not self.project_id:
            raise ValueError("Knowledge base requires project association")
        return value

    @validates('project_id')
    def validate_knowledge_base_requirements(self, key, project_id):
        """Auto-enable KB if project has one"""
        from sqlalchemy import select
        from models.project import Project
        
        # Check if we're actually changing the project_id
        if project_id == getattr(self, key, None):
            return project_id

        # Only attempt validation if we have a session
        if hasattr(self, '_sa_instance_state') and self._sa_instance_state.session:
            # Get fresh project info from DB
            session = self._sa_instance_state.session
            project = session.get(Project, project_id)
            
            # Enable KB only if project has one and model supports it
            if project and project.knowledge_base_id:
                self.use_knowledge_base = True
                self.knowledge_base_id = project.knowledge_base_id
            else:
                self.use_knowledge_base = False
                
        return project_id
