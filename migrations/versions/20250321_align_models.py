"""
Align database schema with current models

Revision ID: 20250321_align_models
Revises: 20250320_reset_database_structure
Create Date: 2025-03-21 00:00:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers
revision = "20250321_align_models"
down_revision = "20250320_reset_database_structure"
branch_labels = None
depends_on = None

def upgrade():
    # Make conversation.project_id nullable
    op.alter_column('conversations', 'project_id',
                    existing_type=postgresql.UUID(),
                    nullable=True)
    
    # Create missing index on messages.created_at
    op.create_index('ix_messages_created_at', 'messages', ['created_at'])

def downgrade():
    op.drop_index('ix_messages_created_at', table_name='messages')
    op.alter_column('conversations', 'project_id',
                    existing_type=postgresql.UUID(),
                    nullable=False)
