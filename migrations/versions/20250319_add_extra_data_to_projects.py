"""
Add extra_data column to projects table

Revision ID: 20250319_add_extra_data_to_projects
Revises: 20250319_merge_heads
Create Date: 2025-03-19
"""

from alembic import op
import sqlalchemy as sa

revision = "20250319_add_extra_data_to_projects"
down_revision = "20250319_merge_heads"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column(
        "projects",
        sa.Column(
            "extra_data",
            sa.JSON(),  # or sa.dialects.postgresql.JSONB if preferred
            nullable=True
        )
    )

def downgrade():
    op.drop_column("projects", "extra_data")