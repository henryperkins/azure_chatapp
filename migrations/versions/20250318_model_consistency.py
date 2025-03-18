"""Model consistency improvements

Revision ID: 20250318_model_consistency
Revises: 
Create Date: 2025-03-18

"""
from alembic import op
import sqlalchemy as sa

def upgrade():
    # Indexes
    op.create_index('ix_conversations_created_at', 'conversations', ['created_at'])
    op.create_index('ix_projects_updated_at', 'projects', ['updated_at'])
    op.create_index('ix_messages_timestamp', 'messages', ['timestamp'])
    op.create_index('ix_users_username', 'users', ['username'], unique=True)
    op.create_index('ix_projects_user_id', 'projects', ['user_id'])

def downgrade():
    op.drop_index('ix_conversations_created_at', table_name='conversations')
    op.drop_index('ix_projects_updated_at', table_name='projects')
    op.drop_index('ix_messages_timestamp', table_name='messages')
    op.drop_index('ix_users_username', table_name='users')
    op.drop_index('ix_projects_user_id', table_name='projects')
