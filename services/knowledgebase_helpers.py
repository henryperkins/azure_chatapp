"""
knowledgebase_helpers.py
------------------------
Centralized helper classes for knowledge base operations.

Contains:
- Configuration management
- Storage operations
- VectorDB management
- Token accounting
- Common utilities
"""

import os
import logging
from typing import Optional, Any
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession

import config
from services.vector_db import VectorDB, get_vector_db
from services.file_storage import get_file_storage
from models.project import Project
from models.project_file import ProjectFile
from models.knowledge_base import KnowledgeBase
from utils.db_utils import save_model

logger = logging.getLogger(__name__)

class KBConfig:
    """Centralized configuration for knowledge base service"""

    @staticmethod
    def get() -> dict[str, Any]:
        """
        Get all configuration values with defaults.

        Returns:
            Dictionary containing:
            - max_file_bytes: Maximum allowed file size in bytes
            - stream_threshold: Size threshold for streaming processing
            - default_embedding_model: Default embedding model name
            - vector_db_storage_path: Base path for vector storage
            - default_chunk_size: Default text chunk size
            - default_chunk_overlap: Default chunk overlap
            - allowed_sort_fields: Set of sortable fields
        """
        return {
            "max_file_bytes": getattr(config, "MAX_FILE_SIZE", 30_000_000),
            "stream_threshold": getattr(config, "STREAM_THRESHOLD", 10_000_000),
            "default_embedding_model": getattr(
                config, "DEFAULT_EMBEDDING_MODEL", "all-MiniLM-L6-v2"
            ),
            "vector_db_storage_path": getattr(
                config, "VECTOR_DB_STORAGE_PATH", "./storage/vector_db"
            ),
            "default_chunk_size": getattr(config, "DEFAULT_CHUNK_SIZE", 1000),
            "default_chunk_overlap": getattr(config, "DEFAULT_CHUNK_OVERLAP", 200),
            "allowed_sort_fields": {"created_at", "filename", "file_size"},
        }


class StorageManager:
    """Handles all file storage operations with consistent configuration"""

    @staticmethod
    def get() -> Any:
        """
        Get configured file storage instance.

        Returns:
            Initialized file storage adapter
        """
        return get_file_storage({
            "storage_type": getattr(config, "FILE_STORAGE_TYPE", "local"),
            "local_path": getattr(config, "LOCAL_UPLOADS_DIR", "./uploads"),
        })

    @staticmethod
    async def save_file(contents: bytes, path: str, project_id: UUID) -> str:
        """
        Save file contents to storage.

        Args:
            contents: File bytes
            path: Relative storage path
            project_id: Associated project ID

        Returns:
            Full storage path
        """
        storage = StorageManager.get()
        return await storage.save_file(contents, path, project_id=project_id)

    @staticmethod
    async def delete_file(path: str) -> bool:
        """
        Delete file from storage.

        Args:
            path: File path to delete

        Returns:
            True if deletion succeeded
        """
        storage = StorageManager.get()
        return await storage.delete_file(path)


class VectorDBManager:
    """Manages VectorDB instances and operations with consistent configuration"""

    @staticmethod
    async def get_for_project(
        project_id: UUID,
        model_name: Optional[str] = None,
        db: Optional[AsyncSession] = None
    ) -> VectorDB:
        """
        Get or create VectorDB instance for a project.

        Args:
            project_id: Project UUID
            model_name: Optional embedding model override
            db: Optional database session for model lookup

        Returns:
            Initialized VectorDB instance
        """
        config = KBConfig.get()

        # Get model name from knowledge base if not specified
        if model_name is None and db is not None:
            kb = await VectorDBManager._get_knowledge_base(project_id, db)
            model_name = kb.embedding_model if kb else None

        return await get_vector_db(
            model_name=model_name or config["default_embedding_model"],
            storage_path=os.path.join(
                config["vector_db_storage_path"],
                str(project_id)
            ),
            load_existing=True
        )

    @staticmethod
    async def _get_knowledge_base(
        project_id: UUID,
        db: AsyncSession
    ) -> Optional[KnowledgeBase]:
        """
        Helper to get knowledge base for a project.

        Args:
            project_id: Project UUID
            db: Database session

        Returns:
            KnowledgeBase instance or None
        """
        project = await db.get(Project, project_id)
        if project and project.knowledge_base_id:
            return await db.get(KnowledgeBase, project.knowledge_base_id)
        return None


class TokenManager:
    """Handles token counting and project limits"""

    @staticmethod
    async def update_usage(
        project: Project,
        delta: int,
        db: AsyncSession
    ) -> None:
        """
        Update project token count.

        Args:
            project: Project instance
            delta: Token count change (positive or negative)
            db: Database session
        """
        project.token_usage = max(0, project.token_usage + delta)
        await save_model(db, project)

    @staticmethod
    async def validate_usage(
        project: Project,
        additional_tokens: int
    ) -> bool:
        """
        Check if project can accommodate more tokens.

        Args:
            project: Project instance
            additional_tokens: Tokens to be added

        Returns:
            True if within limits
        """
        if not project.max_tokens:
            return True
        return (project.token_usage + additional_tokens) <= project.max_tokens


class MetadataHelper:
    """Utilities for handling file and search metadata"""

    @staticmethod
    def extract_file_metadata(
        file_record: ProjectFile,
        include_token_count: bool = True
    ) -> dict[str, Any]:
        """
        Extract standardized metadata from file record.

        Args:
            file_record: ProjectFile instance
            include_token_count: Whether to include token info

        Returns:
            Dictionary of file metadata
        """
        metadata = {
            "filename": file_record.filename,
            "file_type": file_record.file_type,
            "file_size": file_record.file_size,
            "created_at": file_record.created_at.isoformat() if file_record.created_at else None,
        }

        if include_token_count and file_record.config:
            metadata["token_count"] = file_record.config.get("token_count", 0)

        if file_record.config and "search_processing" in file_record.config:
            metadata["processing"] = file_record.config["search_processing"]

        return metadata

    @staticmethod
    async def expand_query(original_query: str) -> str:
        """
        Basic query expansion with synonyms.

        Args:
            original_query: Search query string

        Returns:
            Expanded query string
        """
        try:
            keywords = set()
            for word in original_query.lower().split():
                if len(word) > 3:
                    keywords.add(word)
                    if word in ["how", "what", "why"]:
                        keywords.update(["method", "process", "reason"])
                    elif word in ["best", "good"]:
                        keywords.add("effective")
            return " ".join(keywords) + " " + original_query[:100]
        except Exception:
            return original_query[:150]
