#!/usr/bin/env python
"""
Reset Database Script
--------------------
This script resets the database to match the current model structure.
WARNING: This will delete all existing data in the database.
"""

import asyncio
import sys
import os

# Add the parent directory to the path so we can import from the root
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from alembic import command
from alembic.config import Config

def reset_database():
    """Reset the database using the latest migration."""
    print("WARNING: This will delete all existing data in the database!")
    confirmation = input("Are you sure you want to continue? (yes/no): ")
    
    if confirmation.lower() != "yes":
        print("Operation cancelled.")
        return
    
    try:
        # Get the alembic.ini path
        alembic_cfg = Config("alembic.ini")
        
        # Run the migration
        print("Running migration to reset database structure...")
        command.upgrade(alembic_cfg, "head")
        
        print("\nDatabase structure has been successfully reset to match the current models.")
        print("All tables have been recreated with the correct structure.")
        
        # Validate the schema after reset
        from db import validate_db_schema
        print("\nValidating database schema...")
        try:
            await validate_db_schema()
            print("✅ Database schema validated successfully")
        except Exception as e:
            print(f"❌ Schema validation failed: {e}")
            sys.exit(1)
    except Exception as e:
        print(f"Error resetting database: {e}")
        sys.exit(1)

if __name__ == "__main__":
    reset_database()
