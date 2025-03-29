"""rename metadata to config in project_files

Revision ID: XXXX
Revises: YYYY 
Create Date: 2024-01-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'XXXX'
down_revision = 'YYYY'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column('project_files', 'metadata', new_column_name='config',
                   type_=postgresql.JSONB(astext_type=sa.Text()),
                   existing_type=postgresql.JSONB(astext_type=sa.Text()),
                   existing_nullable=True)


def downgrade():
    op.alter_column('project_files', 'config', new_column_name='metadata',
                   type_=postgresql.JSONB(astext_type=sa.Text()),
                   existing_type=postgresql.JSONB(astext_type=sa.Text()),
                   existing_nullable=True)
