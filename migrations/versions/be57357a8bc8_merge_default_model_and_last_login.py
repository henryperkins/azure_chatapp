"""merge_default_model_and_last_login

Revision ID: be57357a8bc8
Revises: 85f154f612f7
Create Date: 2025-03-20 20:11:22.346004

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'be57357a8bc8'
down_revision: Union[str, None] = '85f154f612f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
