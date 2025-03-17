from alembic import op
import sqlalchemy as sa

def upgrade():
    op.create_index(op.f("ix_messages_chat_id"), "messages", ["chat_id"])
    op.create_index(op.f("ix_messages_timestamp"), "messages", ["timestamp"])

def downgrade():
    op.drop_index(op.f("ix_messages_timestamp"), table_name="messages")
    op.drop_index(op.f("ix_messages_chat_id"), table_name="messages")
