"""fix_project_tokens

Revision ID: XXXX
Revises: YYYY
Create Date: 2024-01-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'XXXX'
down_revision = 'YYYY'
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        UPDATE projects SET 
            token_usage = COALESCE(token_usage, 0),
            max_tokens = COALESCE(max_tokens, 200000)
        WHERE max_tokens IS NULL OR token_usage IS NULL;
        """
    )
    op.alter_column('projects', 'token_usage',
        existing_type=sa.INTEGER(),
        nullable=False,
        server_default=sa.text("0"))
    op.alter_column('projects', 'max_tokens',
        existing_type=sa.INTEGER(),
        nullable=False,
        server_default=sa.text("200000"))

def downgrade():
    pass
