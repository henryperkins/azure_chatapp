from alembic import op
import sqlalchemy as sa

# These identifiers must be explicitly set
revision = '57a4c1e6a22a'  # Random unique hash - generate a new one for your file
down_revision = 'YOUR_ACTUAL_PREVIOUS_REVISION_HASH'  # Get this from alembic history
branch_labels = None
depends_on = None

def upgrade():
    op.create_index(op.f('ix_messages_chat_id'), 'messages', ['chat_id'])
    op.create_index(op.f('ix_messages_timestamp'), 'messages', ['timestamp'])

def downgrade():
    op.drop_index(op.f('ix_messages_timestamp'), table_name='messages')
    op.drop_index(op.f('ix_messages_chat_id'), table_name='messages')
