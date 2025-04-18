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

    # Filter out false positive timestamp mismatches
    # (where both types are "timestamp without time zone")
    filtered_mismatches = []
    for detail in mismatch_details:
        if "type mismatch" in detail.lower() and "timestamp without time zone vs orm: timestamp without time zone" in detail.lower():
            # Skip this mismatch as it's a false positive
            continue
        filtered_mismatches.append(detail)

    # Report results
    if filtered_mismatches:
        print(f"\n❌ Found {len(filtered_mismatches)} schema mismatches:")
        for detail in filtered_mismatches:
            print(f"  - {detail}")
        return False
    else:
        print("\n✅ Database schema matches application models!")
        return True

if __name__ == "__main__":
    result = asyncio.run(main())
    sys.exit(0 if result else 1)
