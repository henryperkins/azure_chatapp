"""
db.py
-----
Sets up the PostgreSQL database connection using SQLAlchemy.
Defines the async init_db process for migrations or table creation.
"""

import os
import sqlalchemy
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Example: 'postgresql://user:pass@localhost:5432/azure_chat'
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:pass@localhost:5432/azure_chat")

engine = sqlalchemy.create_engine(DATABASE_URL, echo=False)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
Base = declarative_base()

async def init_db():
    """
    Called by main.py @startup event.

    If using Alembic: run migrations here.
    If not, you can do:
      from .models import user, chat, ...
      Base.metadata.create_all(bind=engine)
    """
    pass
