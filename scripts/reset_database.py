import logging
import sys
import os

# Add project root to sys.path to allow imports from db, models, etc.
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, PROJECT_ROOT)

try:
    from db.db import Base, sync_engine
    # Import all models to ensure Base.metadata is populated
    import models.__init__  # This should trigger loading of all model files
except ImportError as e:
    print(f"Error importing necessary modules. Make sure your project structure and PYTHONPATH are correct. Details: {e}")
    sys.exit(1)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def reset_database():
    logger.info("Attempting to drop all tables from the database...")
    try:
        # Ensure all models are loaded by accessing Base.metadata.tables
        if not Base.metadata.tables:
            logger.warning("No tables found in Base.metadata. Ensure all models are imported.")
            # Attempt to explicitly load them if __init__ didn't catch all
            from models.user import User
            from models.project import Project, ProjectUserAssociation
            from models.knowledge_base import KnowledgeBase
            from models.conversation import Conversation
            from models.message import Message
            from models.artifact import Artifact
            from models.project_file import ProjectFile
            logger.info(f"Tables now in metadata: {list(Base.metadata.tables.keys())}")


        if not Base.metadata.tables:
            logger.error("Still no tables in metadata after explicit imports. Cannot proceed.")
            return

        # Drop all tables
        # It's often better to drop in reverse order of creation or handle dependencies manually
        # For simplicity here, drop_all attempts to do this.
        # For more complex scenarios, specific drop order or session-based drops might be needed.
        Base.metadata.drop_all(bind=sync_engine)
        logger.info("All tables dropped successfully.")

        # Alembic version table is also dropped by drop_all if it's managed by SQLAlchemy Base.
        # If it's managed separately by Alembic and not part of Base.metadata (unlikely for standard setup),
        # it might need explicit dropping or truncation. However, drop_all should cover it.
        logger.info("Database has been reset.")

    except Exception as e:
        logger.error(f"An error occurred during database reset: {e}")
        logger.error("Make sure the database server is running and accessible, and that no active connections are preventing table drops.")

if __name__ == "__main__":
    # Confirmation step
    confirm = input("Are you sure you want to drop all tables and reset the database? This action is irreversible. (yes/no): ")
    if confirm.lower() == 'yes':
        reset_database()
    else:
        logger.info("Database reset cancelled by user.")
