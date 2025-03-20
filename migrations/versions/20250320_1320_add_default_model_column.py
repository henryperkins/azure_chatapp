"""add default_model column

Revision ID: 20250320_1320
Revises: 
Create Date: 2025-03-20 13:20:00

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic
revision = '20250320_1320'
down_revision = '17e150e67f1c'  # Points to initial migration
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('projects', 
        sa.Column('default_model', sa.String(50), nullable=False, server_default="o1")
    )

def downgrade():
    op.drop_column('projects', 'default_model')
