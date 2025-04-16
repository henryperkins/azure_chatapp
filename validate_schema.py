"""
Script to validate database schema against application models.
"""
import asyncio
import sys
from db import validate_db_schema, Base

async def main():
    """Run schema validation and print results."""
    print("Validating database schema...")

    # Import all models to ensure they're registered with Base
    # This is important for the validate_db_schema function to work correctly
    from models.user import User
    from models.project import Project
    from models.project_file import ProjectFile
    from models.conversation import Conversation
    from models.message import Message
    from models.knowledge_base import KnowledgeBase
    from models.artifact import Artifact

    # Run validation
    mismatch_details = await validate_db_schema()

    if mismatch_details:
        print(f"\n❌ Found {len(mismatch_details)} schema mismatches:")
        for detail in mismatch_details:
            print(f"  - {detail}")
        return False
    else:
        print("\n✅ Database schema matches application models!")
        return True

if __name__ == "__main__":
    result = asyncio.run(main())
    sys.exit(0 if result else 1)
