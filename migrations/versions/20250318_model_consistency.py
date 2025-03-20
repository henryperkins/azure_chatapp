"""
Model consistency improvements

Revision ID: 20250318_model_consistency
Revises: 0cc7d9e46f7b
Create Date: 2025-03-18
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20250318_model_consistency"
down_revision = "0cc7d9e46f7b"
branch_labels = None
depends_on = None

def upgrade():
    # Avoid duplicating indexes already created in "20250318_add_performance_indexes"
    # Keep only those that are unique to this migration:
    op.create_index('ix_projects_updated_at', 'projects', ['updated_at'])
    op.create_index('ix_users_username', 'users', ['username'], unique=True)

def downgrade():
    op.drop_index('ix_projects_updated_at', table_name='projects')
    op.drop_index('ix_users_username', table_name='users')
