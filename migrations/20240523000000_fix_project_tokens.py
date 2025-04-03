"""Fix project token defaults"""
from alembic import op
import sqlalchemy as sa

revision = '20240523000000'
down_revision = None

def upgrade():
    op.alter_column('projects', 'token_usage',
                    server_default=sa.text('0'),
                    existing_type=sa.Integer(),
                    existing_nullable=False)
    op.alter_column('projects', 'max_tokens',
                    server_default=sa.text('200000'),
                    existing_type=sa.Integer(),
                    existing_nullable=False)

def downgrade():
    op.alter_column('projects', 'token_usage',
                    server_default=None,
                    existing_type=sa.Integer(),
                    existing_nullable=False)
    op.alter_column('projects', 'max_tokens',
                    server_default=None,
                    existing_type=sa.Integer(),
                    existing_nullable=False)
