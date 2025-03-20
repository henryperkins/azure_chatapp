"""add last_login column to users table

Revision ID: 85f154f612f7
Revises: 17e150e67f1c
Create Date: 2025-03-20 14:46:59

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic
revision = '85f154f612f7'
down_revision = '20250320_1320'  # Chains after default model migration
branch_labels = None
depends_on = None

def upgrade():
    from alembic import op
    from sqlalchemy import inspect

    inspector = inspect(op.get_bind())
    columns = [col['name'] for col in inspector.get_columns('users')]
    
    if 'last_login' not in columns:
        op.add_column('users',
            sa.Column('last_login', sa.DateTime(timetimezone=True), nullable=True)
        )

def downgrade():
    op.drop_column('users', 'last_login')
