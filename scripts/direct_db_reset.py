#!/usr/bin/env python
"""
Direct Database Reset Script
---------------------------
This script directly resets the database to match the current model structure,
bypassing Alembic to avoid version string length issues.

WARNING: This will delete all existing data in the database.
"""

import sys
import os
import asyncio

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from db import sync_engine, Base
from sqlalchemy.schema import CreateTable, DropTable

# Import all models to ensure they're registered with Base.metadata
from models import *

def reset_database():
    """Reset the database by directly dropping and recreating all tables."""
    print("WARNING: This will delete all existing data in the database!")
    confirmation = input("Are you sure you want to continue? (yes/no): ")
    
    if confirmation.lower() != "yes":
        print("Operation cancelled.")
        return

    try:
        print("Dropping all existing tables...")
        
        # Use a connection context manager for SQLAlchemy 1.4+ compatibility
        with sync_engine.connect() as conn:
            # First drop the alembic_version table if it exists
            conn.execute(text("DROP TABLE IF EXISTS alembic_version CASCADE"))
            
            # Drop all tables in reverse dependency order
            conn.execute(text("DROP TABLE IF EXISTS artifacts CASCADE"))
            conn.execute(text("DROP TABLE IF EXISTS project_files CASCADE"))
            conn.execute(text("DROP TABLE IF EXISTS messages CASCADE"))
            conn.execute(text("DROP TABLE IF EXISTS conversations CASCADE"))
            conn.execute(text("DROP TABLE IF EXISTS projects CASCADE"))
            conn.execute(text("DROP TABLE IF EXISTS knowledge_bases CASCADE"))
            conn.execute(text("DROP TABLE IF EXISTS users CASCADE"))
            
            # Create PostgreSQL extension for UUID if needed
            conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'))
            
            # Commit the transaction
            conn.commit()
        print("Creating tables from SQLAlchemy models...")
        # Create all tables from model definitions
        Base.metadata.create_all(sync_engine)
        
        
        print("\nDatabase structure has been successfully reset to match the current models.")
        print("All tables have been recreated with the correct structure.")
    except Exception as e:
        print(f"Error resetting database: {e}")
        sys.exit(1)

if __name__ == "__main__":
    reset_database()