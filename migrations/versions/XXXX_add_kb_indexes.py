"""Add indexes for knowledge base performance

Revision ID: XXXX
Revises: YYYY 
Create Date: 2025-03-26 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic
revision = 'XXXX'
down_revision = 'YYYY'
branch_labels = None
depends_on = None

def upgrade():
    op.create_index(
        'idx_conversation_kb',
        'conversations',
        ['project_id', 'knowledge_base_id'],
        postgresql_where=sa.text("use_knowledge_base = TRUE")
    )
    op.create_index(
        'idx_kb_search_results',
        'conversations',
        ['search_results'],
        postgresql_using='gin'
    )

def downgrade():
    op.drop_index('idx_conversation_kb', table_name='conversations')
    op.drop_index('idx_kb_search_results', table_name='conversations')
