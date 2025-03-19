"""
Reset database structure to match current models

Revision ID: 20250320_reset_database_structure
Revises: 20250319_add_extra_data_to_projects
Create Date: 2025-03-20 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers
revision = "20250320_reset_database_structure"
down_revision = "20250319_add_extra_data_to_projects"
branch_labels = None
depends_on = None

def upgrade():
    """
    Drop all existing tables and recreate them according to current models.
    This will lose all data - use only when data preservation is not needed.
    """
    # Drop all tables in the correct order (handle foreign key constraints)
    op.execute("DROP TABLE IF EXISTS project_files CASCADE")
    op.execute("DROP TABLE IF EXISTS artifacts CASCADE")
    op.execute("DROP TABLE IF EXISTS messages CASCADE")
    op.execute("DROP TABLE IF EXISTS conversations CASCADE")
    op.execute("DROP TABLE IF EXISTS projects CASCADE")
    op.execute("DROP TABLE IF EXISTS knowledge_bases CASCADE")
    op.execute("DROP TABLE IF EXISTS users CASCADE")
    
    # Drop alembic version table to ensure clean slate
    op.execute("DROP TABLE IF EXISTS alembic_version")
    
    # Create the PostgreSQL extension for UUID generation if it doesn't exist
    op.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
    
    # Create tables
    
    # Users table
    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('username', sa.String(150), nullable=False, unique=True),
        sa.Column('password_hash', sa.String(200), nullable=False),
        sa.Column('role', sa.String(50), server_default='user'),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.text('CURRENT_TIMESTAMP'),
                  onupdate=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.CheckConstraint("role IN ('user', 'admin')", name="valid_role_types"),
    )
    
    # Knowledge bases table
    op.create_table(
        'knowledge_bases',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), primary_key=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('embedding_model', sa.String(100), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.text('CURRENT_TIMESTAMP'),
                  onupdate=sa.text('CURRENT_TIMESTAMP')),
    )
    op.create_index('ix_knowledge_bases_name', 'knowledge_bases', ['name'])
    
    # Projects table
    op.create_table(
        'projects',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), primary_key=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('goals', sa.Text(), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('token_usage', sa.Integer(), server_default='0', nullable=False),
        sa.Column('max_tokens', sa.Integer(), server_default='200000', nullable=False),
        sa.Column('custom_instructions', sa.Text(), nullable=True),
        sa.Column('archived', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('pinned', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('is_default', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('knowledge_base_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.text('CURRENT_TIMESTAMP'),
                  onupdate=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('extra_data', postgresql.JSONB(none_as_null=True), nullable=True),
        sa.ForeignKeyConstraint(['knowledge_base_id'], ['knowledge_bases.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.CheckConstraint('max_tokens >= token_usage', name='check_token_limit'),
        sa.CheckConstraint('NOT (archived AND pinned)', name='check_archive_pin'),
        sa.CheckConstraint('NOT (archived AND is_default)', name='check_archive_default'),
    )
    op.create_index('ix_projects_user_id', 'projects', ['user_id'])
    op.create_index('ix_projects_knowledge_base_id', 'projects', ['knowledge_base_id'])
    
    # Conversations table
    op.create_table(
        'conversations',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), primary_key=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('title', sa.String(), server_default='New Chat', nullable=False),
        sa.Column('model_id', sa.String(), nullable=True),
        sa.Column('is_deleted', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.text('CURRENT_TIMESTAMP'),
                  onupdate=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('extra_data', postgresql.JSONB(none_as_null=True), server_default='{}', nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_conversations_user_id', 'conversations', ['user_id'])
    op.create_index('ix_conversations_project_id', 'conversations', ['project_id'])
    op.create_index('ix_conversations_created_at', 'conversations', ['created_at'])
    op.create_index('ix_conversations_is_deleted', 'conversations', ['is_deleted'])
    
    # Messages table
    op.create_table(
        'messages',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), primary_key=True),
        sa.Column('conversation_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('role', sa.String(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('extra_data', postgresql.JSONB(none_as_null=True), server_default='{}', nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.text('CURRENT_TIMESTAMP'),
                  onupdate=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_messages_id', 'messages', ['id'])
    op.create_index('ix_messages_conversation_id', 'messages', ['conversation_id'])
    
    # Project Files table
    op.create_table(
        'project_files',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), primary_key=True),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('filename', sa.String(), nullable=False),
        sa.Column('file_path', sa.String(500), nullable=False),
        sa.Column('file_size', sa.Integer(), nullable=False),
        sa.Column('file_type', sa.String(100), nullable=False),
        sa.Column('order_index', sa.Integer(), server_default='0', nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.text('CURRENT_TIMESTAMP'),
                  onupdate=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('content', sa.Text(), nullable=True),
        sa.Column('extra_data', postgresql.JSONB(none_as_null=True), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_project_files_project_id', 'project_files', ['project_id'])
    
    # Artifacts table
    op.create_table(
        'artifacts',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), primary_key=True),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('conversation_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('content_type', sa.String(50), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.text('CURRENT_TIMESTAMP'),
                  onupdate=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('extra_data', postgresql.JSONB(none_as_null=True), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='SET NULL'),
        sa.CheckConstraint("content_type IN ('code', 'document', 'image', 'audio', 'video')", name="valid_content_type"),
    )
    op.create_index('ix_artifacts_project_id', 'artifacts', ['project_id'])

def downgrade():
    """
    Since this is a database reset, downgrade would need to go back to previous state,
    but that would require knowing the exact previous schema. This is not provided.
    """
    op.execute("DROP TABLE IF EXISTS artifacts CASCADE")
    op.execute("DROP TABLE IF EXISTS project_files CASCADE")
    op.execute("DROP TABLE IF EXISTS messages CASCADE")
    op.execute("DROP TABLE IF EXISTS conversations CASCADE")
    op.execute("DROP TABLE IF EXISTS projects CASCADE")
    op.execute("DROP TABLE IF EXISTS knowledge_bases CASCADE")
    op.execute("DROP TABLE IF EXISTS users CASCADE")