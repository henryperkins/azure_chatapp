"""
p_files.py
----------
Routes for managing files within a project.
Provides endpoints for uploading, listing, retrieving, and deleting files.
"""

import logging
import os
from uuid import UUID
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

# Internal imports
from services import knowledgebase_service
from services.vector_db import (
    get_vector_db,
    process_file_for_search,
    VECTOR_DB_STORAGE_PATH,
    DEFAULT_CHUNK_SIZE,
    DEFAULT_CHUNK_OVERLAP,
)
from services.file_storage import get_file_storage
import config
from db import get_async_session
from models.user import User
from models.project import Project
from models.project_file import ProjectFile
from utils.auth_utils import get_current_user_and_token
from utils.db_utils import validate_resource_access, get_all_by_condition
from utils.response_utils import create_standard_response

logger = logging.getLogger(__name__)
router = APIRouter()

# =================================================
# File Endpoints
# =================================================


@router.get("", response_model=dict)
async def list_project_files(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    # Validate skip/limit with safe defaults:
    skip: int = Query(0, ge=0, description="Pagination offset; must be >= 0"),
    limit: int = Query(
        100, ge=1, le=500, description="Max number of files to return, 1-500"
    ),
    # Validate file_type if you want to accept only certain patterns:
    file_type: Optional[str] = Query(
        None,
        min_length=1,
        max_length=50,
        regex="^[a-zA-Z0-9._-]+$",
        description="Filter by file type (e.g., 'pdf', 'docx', 'image').",
    ),
):
    """
    Returns a list of files for a project with optional filtering by file_type.
    Supports pagination with `skip` and `limit`.
    """
    # 1) Verify project access
    await validate_resource_access(
        project_id, Project, current_user, db, resource_name="Project"
    )

    # 2) Build conditions for query
    conditions = [ProjectFile.project_id == project_id]
    if file_type:
        conditions.append(ProjectFile.file_type == file_type.lower())

    # 3) Fetch from DB with the given skip/limit
    project_files = await get_all_by_condition(
        db,
        ProjectFile,
        *conditions,
        order_by=ProjectFile.created_at.desc(),
        limit=limit,
        offset=skip,
    )

    # 4) Return standardized response
    return await create_standard_response(
        {
            "files": [
                {
                    "id": str(file.id),
                    "filename": file.filename,
                    "file_type": file.file_type,
                    "file_size": file.file_size,
                    "created_at": (
                        file.created_at.isoformat() if file.created_at else None
                    ),
                    "processing_status": (
                        file.config.get("search_processing", {}).get(
                            "status", "not_processed"
                        )
                        if file.config
                        else "not_processed"
                    ),
                    "chunk_count": (
                        file.config.get("search_processing", {}).get("chunk_count", 0)
                        if file.config
                        else 0
                    ),
                    "last_processed": (
                        file.config.get("search_processing", {}).get("processed_at")
                        if file.config
                        else None
                    ),
                }
                for file in project_files
            ],
            "count": len(project_files),
            "skip": skip,
            "limit": limit,
            "file_type": file_type,
        }
    )


@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED)
async def upload_project_file(
    project_id: UUID,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Upload a file to a project and process it for the knowledge base."""
    try:
        return await knowledgebase_service.upload_file_to_project(
            project_id=project_id,
            file=file,
            db=db,
            user_id=current_user.id,
            background_tasks=background_tasks
        )
    except Exception as e:
        logger.error(f"File upload failed: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"File upload failed: {str(e)}"
        )


@router.get("/{file_id}", response_model=dict)
async def get_project_file(
    project_id: UUID,
    file_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Get file details and content using knowledge base service"""
    raise HTTPException(
        status_code=501, detail="Get file functionality is currently unavailable."
    )


@router.delete("/{file_id}", response_model=dict)
async def delete_project_file(
    project_id: UUID,
    file_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Delete a file from project storage and knowledge base"""
    try:
        result = await knowledgebase_service.delete_project_file(
            project_id=project_id, file_id=file_id, db=db, user_id=current_user.id
        )

        return {
            "success": result.get("success", False),
            "message": result.get("message", "File deleted successfully"),
            "file_id": str(file_id),
        }
    except Exception as e:
        logger.error(f"Error deleting file {file_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"File deletion failed: {str(e)}")


@router.post("/reprocess", response_model=dict)
async def reprocess_project_files(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Reprocess all files in a project for the knowledge base."""
    project = await validate_resource_access(
        project_id, Project, current_user, db, resource_name="Project"
    )

    if not project.knowledge_base_id:
        raise HTTPException(
            status_code=400, detail="Project does not have an associated knowledge base"
        )

    files = await get_all_by_condition(
        db, ProjectFile, ProjectFile.project_id == project_id
    )

    total_files = len(files)
    processed_count = 0
    failed_count = 0
    error_messages = []

    try:
        # Get knowledge base model name with safeguards
        default_embedding_model = getattr(
            config, "DEFAULT_EMBEDDING_MODEL", "all-MiniLM-L6-v2"
        )
        embedding_model = default_embedding_model

        # Get a fresh project instance with knowledge_base relationship loaded
        project_query = (
            select(Project)
            .options(selectinload(Project.knowledge_base))
            .where(Project.id == project_id)
        )
        project_result = await db.execute(project_query)
        fresh_project = project_result.scalars().first()

        if (
            fresh_project
            and fresh_project.knowledge_base_id
            and fresh_project.knowledge_base
        ):
            if fresh_project.knowledge_base.embedding_model:
                embedding_model = fresh_project.knowledge_base.embedding_model

        # Load all files with their project relationships
        file_query = (
            select(ProjectFile)
            .options(
                selectinload(ProjectFile.project).selectinload(Project.knowledge_base)
            )
            .where(ProjectFile.project_id == project_id)
        )
        file_result = await db.execute(file_query)
        file_records = file_result.scalars().all()

        if file_records:
            # Initialize vector DB
            vector_db = await get_vector_db(
                model_name=str(embedding_model),
                storage_path=os.path.join(VECTOR_DB_STORAGE_PATH, str(project_id)),
                load_existing=True,
            )

            # Configure storage
            storage_config = {
                "storage_type": getattr(config, "FILE_STORAGE_TYPE", "local"),
                "local_path": getattr(config, "LOCAL_UPLOADS_DIR", "./uploads"),
            }
            storage = get_file_storage(storage_config)

            # Process each file
            for file_record in file_records:
                try:
                    error_details = ""
                    file_content = None
                    file_found = False

                    # Try original path
                    try:
                        file_content = await storage.get_file(file_record.file_path)
                        file_found = True
                    except FileNotFoundError as e:
                        error_details = str(e)
                        # If not found, try alternative paths
                        base_dir = getattr(config, "LOCAL_UPLOADS_DIR", "./uploads")
                        current_dir = os.getcwd()
                        # Get the project ID and filename for better path reconstruction
                        project_id_str = str(file_record.project_id)
                        filename = os.path.basename(file_record.file_path)

                        # Try to extract just the base filename without any hash prefix
                        clean_filename = filename
                        if "_" in filename:
                            parts = filename.split("_")
                            if (
                                len(parts) >= 3
                            ):  # pattern is likely project_id_hash_filename
                                clean_filename = "_".join(
                                    parts[2:]
                                )  # Get everything after project_id and hash

                        possible_paths = [
                            # Paths matching the standard format: uploads/project_id_hash_filename
                            os.path.join(
                                base_dir, f"{project_id_str}_*_{clean_filename}"
                            ),
                            os.path.join(
                                base_dir, os.path.basename(file_record.file_path)
                            ),
                            os.path.join(base_dir, file_record.file_path),
                            os.path.join(
                                current_dir,
                                base_dir,
                                f"{project_id_str}_*_{clean_filename}",
                            ),
                            os.path.join(current_dir, file_record.file_path),
                            os.path.join(
                                current_dir,
                                base_dir,
                                os.path.basename(file_record.file_path),
                            ),
                        ]

                        for path in possible_paths:
                            if os.path.exists(path):
                                file_content = await storage.get_file(path)
                                file_record.file_path = (
                                    path  # Update to the working path
                                )
                                file_found = True
                                logger.info(f"Found file at alternative path: {path}")
                                break
                            # Special handling for glob patterns with wildcards
                            elif "*" in path:
                                import glob

                                matching_files = glob.glob(path)
                                if matching_files:
                                    # Use the first matching file
                                    match_path = matching_files[0]
                                    logger.info(
                                        f"Found file using pattern match: {match_path}"
                                    )
                                    file_content = await storage.get_file(match_path)
                                    file_record.file_path = (
                                        match_path  # Update to the actual path
                                    )
                                    file_found = True
                                    # Path will be saved when db.commit() is called later
                                break

                    # If file wasn't found after all attempts
                    if not file_found or file_content is None:
                        error_message = (
                            f"Error processing file {file_record.filename}: Local file not found: "
                            f"{file_record.file_path} {error_details}"
                        )
                        logger.error(error_message)
                        error_messages.append(error_message)
                        failed_count += 1
                        continue

                    # Process the file for search
                    result = await process_file_for_search(
                        project_file=file_record,
                        vector_db=vector_db,
                        file_content=file_content,
                        chunk_size=DEFAULT_CHUNK_SIZE,
                        chunk_overlap=DEFAULT_CHUNK_OVERLAP,
                    )

                    # Update file record
                    file_config = file_record.config or {}
                    file_config["search_processing"] = {
                        "success": result.get("success", False),
                        "chunk_count": result.get("chunk_count", 0),
                        "processed_at": datetime.now().isoformat(),
                    }
                    file_record.config = file_config

                    # Update counts
                    if result.get("success", False):
                        processed_count += 1
                    else:
                        failed_count += 1
                        if result.get("error"):
                            error_messages.append(
                                f"{file_record.filename}: {result.get('error')}"
                            )

                except Exception as e:
                    error_message = (
                        f"Error processing file {file_record.filename}: {str(e)}"
                    )
                    logger.exception(error_message)
                    error_messages.append(error_message)
                    failed_count += 1
                    # Continue processing other files instead of failing the entire operation
                    continue

    except Exception as e:
        error_message = f"Error initializing reprocessing: {str(e)}"
        logger.exception(error_message)
        raise HTTPException(status_code=500, detail=error_message)

    # Commit changes with transaction handling
    try:
        await db.commit()
    except SQLAlchemyError as e:
        if "transaction is already begun" not in str(e):
            logger.error(f"Database error in reprocess_project_files: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
        logger.info("Using existing transaction for reprocessing files")

    return await create_standard_response(
        {
            "total_files": total_files,
            "processed_success": processed_count,
            "processed_failed": failed_count,
            "errors": error_messages if error_messages else None,
        },
        "Files reprocessed for knowledge base",
    )
