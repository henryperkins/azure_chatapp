"""
Add updated_at column to users table

Revision ID: 20250319_add_updated_at_to_users
Revises: 20250318_model_consistency
Create Date: 2025-03-19
"""

from alembic import op
import sqlalchemy as sa

# Revision identifiers, used by Alembic.
revision = '20250319_add_updated_at_to_users'
down_revision = '20250318_model_consistency'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('users', sa.Column(
        'updated_at',
        sa.TIMESTAMP(timezone=False),
        server_default=sa.text('CURRENT_TIMESTAMP'),
        nullable=True
    ))
    op.execute("UPDATE users SET updated_at = CURRENT_TIMESTAMP;")
    op.alter_column('users', 'updated_at', nullable=False, server_default=sa.text('CURRENT_TIMESTAMP'))

def downgrade():
    op.drop_column('users', 'updated_at')