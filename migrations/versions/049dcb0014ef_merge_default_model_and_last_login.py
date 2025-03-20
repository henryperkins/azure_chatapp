"""merge_default_model_and_last_login

Revision ID: 049dcb0014ef
Revises: be57357a8bc8
Create Date: 2025-03-20 20:11:41.533067

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '049dcb0014ef'
down_revision: Union[str, None] = 'be57357a8bc8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
