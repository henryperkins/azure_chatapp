"""Add performance indexes"""

from alembic import op
import sqlalchemy as sa

revision = "20250318_add_performance_indexes"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.create_index("ix_conversations_created_at", "conversations", ["created_at"])
    op.create_index("ix_projects_user_id", "projects", ["user_id"])
    op.create_index("ix_artifacts_content_type", "artifacts", ["content_type"])
    op.create_index("ix_messages_role", "messages", ["role"])

def downgrade():
    op.drop_index("ix_conversations_created_at", table_name="conversations")
    op.drop_index("ix_projects_user_id", table_name="projects")
    op.drop_index("ix_artifacts_content_type", table_name="artifacts")
    op.drop_index("ix_messages_role", table_name="messages")
