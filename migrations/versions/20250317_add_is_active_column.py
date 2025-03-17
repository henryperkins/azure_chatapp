from alembic import op
import sqlalchemy as sa

# Revision identifiers, used by Alembic.
revision = '20250317_add_is_active_column'
down_revision = None  # Replace with the previous migration ID if you have one
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('users', 
        sa.Column('is_active', sa.Boolean(), 
                  server_default=sa.text('true'), 
                  nullable=False)
    )

def downgrade():
    op.drop_column('users', 'is_active')
