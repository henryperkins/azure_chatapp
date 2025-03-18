# Project Upgrade Implementation Plan

Based on the project upgrade plan, I'll outline the key code changes needed to align the current implementation with the target specification in projects-plan.md. I'll focus on the core models and schema changes first.

## 1. Update Project Model

The Project model needs additional fields to match the plan's specification:

```python
from sqlalchemy import Column, String, Integer, Boolean, TIMESTAMP, text, ForeignKey
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from typing import Optional
from datetime import datetime

from db import Base

class Project(Base):
    __tablename__ = "projects"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()")
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    goals: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP, 
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=text("CURRENT_TIMESTAMP")
    )
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    custom_instructions: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    token_usage: Mapped[int] = mapped_column(Integer, default=0)
    max_tokens: Mapped[int] = mapped_column(Integer, default=200000)
    metadata: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    
    # Relationships
    files = relationship("ProjectFile", back_populates="project", cascade="all, delete-orphan")
    conversations = relationship("Conversation", back_populates="project", cascade="all, delete-orphan")
    artifacts = relationship("Artifact", back_populates="project", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<Project {self.id} name={self.name}>"
```

## 2. Conversation Model (Previously Chat)

The Conversation model needs to reference a single project directly:

```python
"""
chat.py (to be renamed to conversation.py)
-------
Defines the Conversation model, representing a conversation's metadata: 
- ID (usually a UUID)
- user ownership
- project reference
- optional model_id referencing an AI model
- title for display
"""

from sqlalchemy import Column, String, Integer, Boolean, TIMESTAMP, text, ForeignKey
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from typing import Optional
from datetime import datetime

from db import Base

class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    project_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    title: Mapped[str] = mapped_column(String, default="New Chat")
    model_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP, 
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=text("CURRENT_TIMESTAMP")
    )
    metadata: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    user = relationship("User", back_populates="conversations")
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")
    project = relationship("Project", back_populates="conversations")
    artifacts = relationship("Artifact", back_populates="conversation")

    def __repr__(self) -> str:
        return f"<Conversation {self.id} (User #{self.user_id}) title={self.title}>"
```

## 3. Create Artifact Model

Add a new model for artifacts (code, documents, etc.):

```python
"""
artifact.py
-------
Defines the Artifact model, representing content generated within a project:
- Code snippets
- Documents
- Visual outputs
"""

from sqlalchemy import Column, String, Text, TIMESTAMP, text, ForeignKey
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from typing import Optional
from datetime import datetime

from db import Base

class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()")
    )
    project_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    conversation_id: Mapped[Optional[UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("conversations.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    content_type: Mapped[str] = mapped_column(String(50), nullable=False)  # code, document, image, etc.
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    metadata: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    project = relationship("Project", back_populates="artifacts")
    conversation = relationship("Conversation", back_populates="artifacts")

    def __repr__(self) -> str:
        return f"<Artifact {self.id} name={self.name} type={self.content_type}>"
```

## 4. Update ProjectFile Model

Enhance the ProjectFile model with additional fields:

```python
from sqlalchemy import Column, String, Integer, TIMESTAMP, text, ForeignKey
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from typing import Optional
from datetime import datetime

from db import Base

class ProjectFile(Base):
    __tablename__ = "project_files"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()")
    )
    project_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    file_type: Mapped[str] = mapped_column(String(100), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    metadata: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    project = relationship("Project", back_populates="files")

    def __repr__(self) -> str:
        return f"<ProjectFile {self.id} filename={self.filename}>"
```

## 5. Migration Script for Schema Changes

Create an Alembic migration script to apply these changes:

```python
"""Upgrade project schema

Revision ID: 20250318_upgrade
Revises: 20250317_add_is_active_column
Create Date: 2025-03-18 10:00:00

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '20250318_upgrade'
down_revision = '20250317_add_is_active_column'
branch_labels = None
depends_on = None


def upgrade():
    # Add new columns to projects table
    op.add_column('projects', sa.Column('description', sa.String(), nullable=True))
    op.add_column('projects', sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True))
    op.add_column('projects', sa.Column('is_default', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('projects', sa.Column('custom_instructions', sa.String(), nullable=True))
    op.add_column('projects', sa.Column('max_tokens', sa.Integer(), server_default='200000', nullable=False))
    op.add_column('projects', sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    
    # Modify the conversations table (previously chats)
    # Rename table first
    op.rename_table('chats', 'conversations')
    
    # Add new columns to conversations
    op.add_column('conversations', sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True))
    op.add_column('conversations', sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('conversations', sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    
    # Add foreign key constraint
    op.create_foreign_key('fk_conversations_project', 'conversations', 'projects', ['project_id'], ['id'])
    
    # Update existing references in messages table
    op.rename_table('chat_messages', 'messages')
    op.alter_column('messages', 'chat_id', new_column_name='conversation_id')
    op.drop_constraint('fk_chat_messages_chat_id', 'messages', type_='foreignkey')
    op.create_foreign_key('fk_messages_conversation', 'messages', 'conversations', ['conversation_id'], ['id'])
    
    # Drop chat_projects many-to-many table
    op.drop_table('chat_projects')
    
    # Add columns to project_files
    op.add_column('project_files', sa.Column('file_type', sa.String(length=100), nullable=True))
    op.add_column('project_files', sa.Column('file_size', sa.Integer(), nullable=True))
    op.add_column('project_files', sa.Column('order_index', sa.Integer(), server_default='0', nullable=False))
    op.add_column('project_files', sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    
    # Create artifacts table
    op.create_table(
        'artifacts',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('conversation_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('content_type', sa.String(length=50), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name='fk_artifacts_project'),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], name='fk_artifacts_conversation'),
        sa.PrimaryKeyConstraint('id')
    )


def downgrade():
    # Drop artifacts table
    op.drop_table('artifacts')
    
    # Remove columns from project_files
    op.drop_column('project_files', 'metadata')
    op.drop_column('project_files', 'order_index')
    op.drop_column('project_files', 'file_size')
    op.drop_column('project_files', 'file_type')
    
    # Recreate chat_projects table
    op.create_table(
        'chat_projects',
        sa.Column('chat_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(['chat_id'], ['conversations.id'], name='fk_chat_projects_chat'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name='fk_chat_projects_project'),
        sa.PrimaryKeyConstraint('chat_id', 'project_id')
    )
    
    # Revert messages back to chat_messages
    op.drop_constraint('fk_messages_conversation', 'messages', type_='foreignkey')
    op.alter_column('messages', 'conversation_id', new_column_name='chat_id')
    op.create_foreign_key('fk_chat_messages_chat_id', 'messages', 'conversations', ['chat_id'], ['id'])
    op.rename_table('messages', 'chat_messages')
    
    # Revert conversations back to chats
    op.drop_constraint('fk_conversations_project', 'conversations', type_='foreignkey')
    op.drop_column('conversations', 'metadata')
    op.drop_column('conversations', 'project_id')
    op.drop_column('conversations', 'updated_at')
    op.rename_table('conversations', 'chats')
    
    # Remove columns from projects
    op.drop_column('projects', 'metadata')
    op.drop_column('projects', 'max_tokens')
    op.drop_column('projects', 'custom_instructions')
    op.drop_column('projects', 'is_default')
    op.drop_column('projects', 'updated_at')
    op.drop_column('projects', 'description')
```

## 6. Update Schema Classes

Update the project schemas to match the enhanced models:

```python
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Union
from uuid import UUID
from datetime import datetime

class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None
    goals: Optional[str] = None
    custom_instructions: Optional[str] = None
    is_default: Optional[bool] = False
    pinned: Optional[bool] = False
    archived: Optional[bool] = False
    metadata: Optional[Dict[str, Any]] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    goals: Optional[str] = None
    custom_instructions: Optional[str] = None
    is_default: Optional[bool] = None
    pinned: Optional[bool] = None
    archived: Optional[bool] = None
    metadata: Optional[Dict[str, Any]] = None


class ProjectResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    goals: Optional[str] = None
    custom_instructions: Optional[str] = None
    is_default: bool
    pinned: bool
    archived: bool
    created_at: datetime
    updated_at: datetime
    token_usage: int
    max_tokens: int
    metadata: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True
```

## 7. Create Artifacts Schema

```python
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from uuid import UUID
from datetime import datetime

class ArtifactCreate(BaseModel):
    project_id: UUID
    conversation_id: Optional[UUID] = None
    name: str
    content_type: str
    content: str
    metadata: Optional[Dict[str, Any]] = None


class ArtifactResponse(BaseModel):
    id: UUID
    project_id: UUID
    conversation_id: Optional[UUID] = None
    name: str
    content_type: str
    content: str
    created_at: datetime
    metadata: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True
```

## 8. Update Routes for Nested Structure

Here's an example update for the project routes to include artifacts:

```python
# ... existing imports ...
from schemas.artifact_schemas import ArtifactCreate, ArtifactResponse
from models.artifact import Artifact

# ... existing code ...

@router.post("/{project_id}/artifacts", response_model=ArtifactResponse, status_code=201)
async def create_artifact(
    project_id: UUID,
    artifact_data: ArtifactCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new artifact for a project"""
    # Verify project exists and belongs to user
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    # Create artifact
    new_artifact = Artifact(
        project_id=project_id,
        conversation_id=artifact_data.conversation_id,
        name=artifact_data.name,
        content_type=artifact_data.content_type,
        content=artifact_data.content,
        metadata=artifact_data.metadata
    )
    
    db.add(new_artifact)
    await db.commit()
    await db.refresh(new_artifact)
    
    return new_artifact


@router.get("/{project_id}/artifacts", response_model=List[ArtifactResponse])
async def list_artifacts(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all artifacts for a project"""
    # Verify project exists and belongs to user
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    query = select(Artifact).where(Artifact.project_id == project_id)
    result = await db.execute(query)
    artifacts = result.scalars().all()
    
    return artifacts


@router.get("/{project_id}/artifacts/{artifact_id}", response_model=ArtifactResponse)
async def get_artifact(
    project_id: UUID,
    artifact_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get a specific artifact"""
    query = select(Artifact).where(
        Artifact.project_id == project_id,
        Artifact.id == artifact_id
    )
    result = await db.execute(query)
    artifact = result.scalars().first()
    
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")
        
    return artifact


@router.delete("/{project_id}/artifacts/{artifact_id}", status_code=204)
async def delete_artifact(
    project_id: UUID,
    artifact_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete an artifact"""
    query = select(Artifact).where(
        Artifact.project_id == project_id,
        Artifact.id == artifact_id
    )
    result = await db.execute(query)
    artifact = result.scalars().first()
    
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")
        
    await db.delete(artifact)
    await db.commit()
    
    return None
```

## Next Steps

1. Update the remaining routes in chat.py to use the nested structure 
2. Adapt the knowledgebase_service.py to handle larger file sizes and more file types
3. Update the User model to include relationships with conversations
4. Implement token tracking functionality
5. Create unit tests for new functionality

This implementation follows the upgrade plan while maintaining compatibility with existing code where possible. The migration script provides a path to upgrade the database schema without data loss.