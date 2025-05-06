"""Cleanup orphan projects

Revision ID: cleanup_orphan_projects
Revises:
Create Date: 2025-05-06

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'cleanup_orphan_projects'
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    # Remove projects where user_id is null
    op.execute("""
        DELETE FROM projects WHERE user_id IS NULL
    """)
    # Remove projects where user_id not in users.id
    op.execute("""
        DELETE FROM projects WHERE user_id NOT IN (SELECT id FROM users)
    """)

def downgrade():
    # Irreversible operation; no-op
    pass
