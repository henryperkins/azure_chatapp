"""Merge heads

Revision ID: e08f8e90a060
Revises: 20250318_add_performance_indexes, 20250318_model_consistency
Create Date: 2025-03-19 20:03:31.032649

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e08f8e90a060'
down_revision: Union[str, None] = ('20250318_add_performance_indexes', '20250318_model_consistency')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
