"""
Merge heads

Revision ID: 20250319_merge_heads
Revises: e08f8e90a060, 20250319_add_updated_at_to_users
Create Date: 2025-03-19
"""

from alembic import op
import sqlalchemy as sa

# Revision identifiers, used by Alembic.
revision = '20250319_merge_heads'
down_revision = ('e08f8e90a060', '20250319_add_updated_at_to_users')
branch_labels = None
depends_on = None

def upgrade():
    # No changes needed; this is just merging heads.
    pass

def downgrade():
    # Not typically used; you'd have to decide how to revert if you needed to.
    pass