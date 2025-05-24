"""
services/file_service.py
------------------------
Unified file service for all file operations across projects and knowledge bases.
Consolidates file upload, deletion, and listing logic into a single service.
"""

import logging
import os
from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import BackgroundTasks, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.project import Project
from models.project_file import ProjectFile
from services.knowledgebase_helpers import (
    StorageManager,
    TokenManager,
)
from services.knowledgebase_service import (
    ensure_project_has_knowledge_base,
    process_single_file_for_search,
)
from utils.db_utils import get_by_id, save_model
from utils.file_validation import FileValidator, sanitize_filename
from utils.tokens import count_tokens_text

logger = logging.getLogger(__name__)


class FileService:
    """
    Unified file service handling all file operations for projects and knowledge bases.
    Provides a single interface for upload, delete, list, and metadata operations.
    """

    def __init__(self, db: AsyncSession, storage: Optional[Any] = None):
        """
        Initialize FileService with database session and optional storage.

        Args:
            db: Database session
            storage: Optional storage instance (defaults to StorageManager.get())
        """
        self.db = db
        self.storage = storage or StorageManager.get()

    async def upload(
        self,
        project_id: UUID,
        file: UploadFile,
        user_id: int,
        *,
        index_kb: bool = False,
        background_tasks: Optional[BackgroundTasks] = None,
    ) -> Dict[str, Any]:
        """
        Unified file upload implementation for both project files and KB indexing.

        Args:
            project_id: Target project UUID
            file: Uploaded file object
            user_id: User performing the upload
            index_kb: Whether to index file in knowledge base
            background_tasks: Optional background task queue

        Returns:
            Dictionary with file metadata and upload results
        """
        # Get project and ensure KB exists if indexing requested
        project = await get_by_id(self.db, Project, project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        kb = None
        if index_kb:
            kb = project.knowledge_base or await ensure_project_has_knowledge_base(
                project_id, self.db, user_id
            )

        # Process file info and validate
        file_info = await self._process_upload_file_info(file)

        # Read file contents in chunks
        contents = await self._read_file_contents(file)

        # Validate file size (single canonical implementation)
        if not FileValidator.validate_size(len(contents)):
            raise HTTPException(
                status_code=413,
                detail=(
                    f"File exceeds maximum size of "
                    f"{FileValidator.get_max_file_size_mb():.1f} MB"
                ),
            )

        # Estimate tokens and validate project capacity
        token_data = await self._estimate_file_tokens(
            contents, file_info["sanitized_filename"]
        )
        has_capacity = await TokenManager.validate_usage(
            project, token_data["token_estimate"]
        )
        if not has_capacity:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Operation requires {token_data['token_estimate']} tokens, "
                    f"but only {project.max_tokens - project.token_usage} available"
                ),
            )

        # Store file
        stored_path = await self._store_file(
            contents, project_id, file_info["sanitized_filename"]
        )

        # Create file record
        project_file = await self._create_file_record(
            project_id, file_info, stored_path, len(contents), token_data
        )
        await save_model(self.db, project_file)
        await TokenManager.update_usage(project, token_data["token_estimate"], self.db)

        # Queue background processing if KB indexing requested
        if index_kb and background_tasks and kb:
            background_tasks.add_task(
                process_single_file_for_search,
                file_id=UUID(str(project_file.id)),
                project_id=project_id,
                knowledge_base_id=UUID(str(kb.id)),
                db=self.db,
            )

        return {
            "id": str(project_file.id),
            "filename": project_file.filename,
            "file_size": project_file.file_size,
            "file_type": project_file.file_type,
            "token_estimate": token_data["token_estimate"],
            "indexed_kb": index_kb,
            "created_at": (
                project_file.created_at.isoformat() if project_file.created_at else None
            ),
        }

    async def list_files(
        self,
        project_id: UUID,
        *,
        skip: int = 0,
        limit: int = 100,
        file_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        List files for a project with pagination and filtering.

        Args:
            project_id: Project UUID
            skip: Number of records to skip
            limit: Maximum number of records to return
            file_type: Optional file type filter

        Returns:
            Dictionary with files list and pagination info
        """
        # Build query
        query = select(ProjectFile).where(ProjectFile.project_id == project_id)

        if file_type:
            query = query.where(ProjectFile.file_type == file_type)

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        # Apply pagination and execute
        query = query.offset(skip).limit(limit).order_by(ProjectFile.created_at.desc())
        result = await self.db.execute(query)
        files = result.scalars().all()

        return {
            "files": [
                {
                    "id": str(f.id),
                    "filename": f.filename,
                    "file_size": f.file_size,
                    "file_type": f.file_type,
                    "token_estimate": f.config.get("token_count", 0) if f.config else 0,
                    "created_at": f.created_at.isoformat() if f.created_at else None,
                }
                for f in files
            ],
            "total": total,
            "skip": skip,
            "limit": limit,
        }

    async def get_file_metadata(
        self, project_id: UUID, file_id: UUID
    ) -> Dict[str, Any]:
        """
        Get metadata for a specific file.

        Args:
            project_id: Project UUID
            file_id: File UUID

        Returns:
            File metadata dictionary
        """
        file_record = await self.db.get(ProjectFile, file_id)
        if not file_record or file_record.project_id != project_id:
            raise HTTPException(status_code=404, detail="File not found")

        return {
            "id": str(file_record.id),
            "filename": file_record.filename,
            "file_size": file_record.file_size,
            "file_type": file_record.file_type,
            "file_path": file_record.file_path,
            "token_estimate": (
                file_record.config.get("token_count", 0) if file_record.config else 0
            ),
            "created_at": (
                file_record.created_at.isoformat() if file_record.created_at else None
            ),
            "updated_at": (
                file_record.updated_at.isoformat() if file_record.updated_at else None
            ),
        }

    async def delete_file(self, project_id: UUID, file_id: UUID) -> Dict[str, Any]:
        """
        Delete a file and clean up associated resources.

        Args:
            project_id: Project UUID
            file_id: File UUID

        Returns:
            Deletion result dictionary
        """
        file_record = await self.db.get(ProjectFile, file_id)
        if not file_record or file_record.project_id != project_id:
            raise HTTPException(status_code=404, detail="File not found")

        # Delete from storage (canonical path)
        storage_deleted = False
        try:
            storage_deleted = await self.storage.delete_file(file_record.file_path)
        except Exception as e:
            logger.warning(f"Failed to delete file from storage: {e}", exc_info=True)

        # Delete file record
        await self.db.delete(file_record)
        await self.db.commit()

        # Note: Vector cleanup is handled by database triggers/signals in KB service

        return {
            "id": str(file_id),
            "filename": file_record.filename,
            "deleted": True,
            "storage_deleted": storage_deleted,
        }

    # Private helper methods
    async def _process_upload_file_info(self, file: UploadFile) -> Dict[str, Any]:
        """Process and validate upload file information."""
        file_info = await FileValidator.validate_upload_file(file)
        filename, ext = os.path.splitext(file.filename or "untitled")
        return {
            "sanitized_filename": f"{sanitize_filename(filename)}{ext}",
            "file_ext": ext[1:].lower() if ext else "",
            "file_type": file_info.get("category", "unknown"),
        }

    async def _read_file_contents(self, file: UploadFile) -> bytes:
        """Read file contents in chunks to avoid memory issues."""
        chunk_size = 65536  # 64 KB
        file_chunks = []
        total_bytes = 0

        chunk = await file.read(chunk_size)
        while chunk:
            file_chunks.append(chunk)
            total_bytes += len(chunk)
            # Log progress for large files
            if total_bytes % (1024 * 1024) < chunk_size:
                logger.info(f"Reading file... total so far: {total_bytes} bytes")
            chunk = await file.read(chunk_size)

        logger.info(f"Finished reading file: total {total_bytes} bytes")
        return b"".join(file_chunks)

    async def _estimate_file_tokens(
        self, contents: bytes, filename: str
    ) -> Dict[str, Any]:
        """Estimate token count for file contents."""
        try:
            text_content = contents.decode("utf-8", errors="ignore")
            token_estimate = count_tokens_text(text_content)
        except Exception as e:
            logger.warning(
                f"Failed to estimate tokens for {filename}: {e}", exc_info=True
            )
            # Fallback estimation: roughly 4 characters per token
            token_estimate = len(contents) // 4

        return {
            "token_estimate": token_estimate,
            "file_size": len(contents),
        }

    async def _store_file(
        self, contents: bytes, project_id: UUID, filename: str
    ) -> str:
        """Store file contents and return storage path."""
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        rel_path = f"{project_id}/{timestamp}_{filename}"
        return await StorageManager.save_file(contents, rel_path, project_id)

    async def _create_file_record(
        self,
        project_id: UUID,
        file_info: Dict[str, Any],
        stored_path: str,
        file_size: int,
        token_data: Dict[str, Any],
    ) -> ProjectFile:
        """Create database record for uploaded file."""
        return ProjectFile(
            project_id=project_id,
            filename=file_info["sanitized_filename"],
            file_path=stored_path,
            file_size=file_size,
            file_type=file_info["file_type"],
            config={
                "token_count": token_data["token_estimate"],
                "file_extension": file_info.get("file_ext", ""),
                "upload_time": datetime.now().isoformat(),
            },
        )
