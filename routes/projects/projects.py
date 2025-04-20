"""
projects.py
---------
Project management routes with full Sentry integration for:
- Error monitoring
- Performance tracing
- Operational metrics
"""

import logging
import random
import time
from uuid import UUID
from typing import Optional, Dict
from enum import Enum

from fastapi import APIRouter, Depends, HTTPException, status, Request, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from sentry_sdk import (
    capture_exception,
    configure_scope,
    start_transaction,
    set_tag,
    set_context,
    metrics,
    capture_message,
)

from db import get_async_session
from models.user import User
from models.project import Project
from models.conversation import Conversation
from models.project_file import ProjectFile
from models.artifact import Artifact
from models.knowledge_base import KnowledgeBase
from utils.auth_utils import get_current_user_and_token
from services.project_service import validate_project_access
import config
from utils.db_utils import get_all_by_condition, save_model
from utils.response_utils import create_standard_response
from utils.serializers import serialize_project
from services.file_storage import get_file_storage
from utils.sentry_utils import sentry_span, tag_transaction

logger = logging.getLogger(__name__)
router = APIRouter()

# Sentry sampling rates
PROJECT_SAMPLE_RATE = 1.0  # Sample all critical project operations
METRICS_SAMPLE_RATE = 0.3  # Sample 30% of metrics-heavy operations

# ============================
# Pydantic Schemas
# ============================


class ProjectCreate(BaseModel):
    """Schema for creating a new project"""

    name: str = Field(..., min_length=1, max_length=200)
    goals: Optional[str] = Field(None, max_length=1000)
    description: Optional[str] = Field(None, max_length=2000)
    custom_instructions: Optional[str] = Field(None, max_length=5000)
    max_tokens: int = Field(default=200000, ge=50000, le=500000)


class ProjectUpdate(BaseModel):
    """Schema for updating a project"""

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    goals: Optional[str] = Field(None, max_length=1000)
    custom_instructions: Optional[str] = Field(None, max_length=5000)
    is_default: Optional[bool]
    pinned: Optional[bool]
    archived: Optional[bool]
    extra_data: Optional[dict]
    max_tokens: Optional[int] = Field(default=None, ge=50000, le=500000)


class ProjectFilter(str, Enum):
    """Filter options for listing projects"""

    all = "all"
    pinned = "pinned"
    archived = "archived"
    active = "active"


# ============================
# Core Project CRUD with Sentry
# ============================


@router.post("/", response_model=Dict, status_code=status.HTTP_201_CREATED)
async def create_project(
    project_data: ProjectCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Create a new project with full monitoring"""
    transaction = start_transaction(
        op="project",
        name="Create Project",
        sampled=random.random() < PROJECT_SAMPLE_RATE,
    )

    try:
        with transaction:
            # Set context
            transaction.set_tag("user.id", str(current_user.id))
            transaction.set_data("project.name", project_data.name)
            transaction.set_data("max_tokens", project_data.max_tokens)

            # Track metrics
            metrics.incr("project.create.attempt")
            start_time = time.time()

            # Create project
            with sentry_span(op="db", description="Create project record"):
                project = Project(
                    **project_data.dict(),
                    user_id=current_user.id,
                )
                await save_model(db, project)

            # Record success
            duration = (time.time() - start_time) * 1000
            metrics.distribution(
                "project.create.duration", duration, unit="millisecond"
            )
            metrics.incr("project.create.success")

            # Set user context
            with configure_scope() as scope:
                scope.set_context(
                    "project",
                    {
                        "id": str(project.id),
                        "name": project.name,
                        "created_at": project.created_at.isoformat(),
                    },
                )

            logger.info(f"Created project {project.id}")
            return await create_standard_response(
                serialize_project(project), "Project created successfully"
            )

    except Exception as e:
        transaction.set_tag("error", True)
        capture_exception(e)
        metrics.incr("project.create.failure")
        logger.error(f"Project creation failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Project creation failed: {str(e)}",
        ) from e


@router.get("/", response_model=Dict)
async def list_projects(
    request: Request,
    filter_param: ProjectFilter = Query(ProjectFilter.all, description="Filter type"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """List projects with performance tracing"""
    with sentry_span(
        op="project",
        name="List Projects",
        description=f"List projects with filter: {filter_param.value}",
    ) as span:
        try:
            span.set_tag("user.id", str(current_user.id))
            span.set_data("filter", filter_param.value)
            span.set_data("pagination.skip", skip)
            span.set_data("pagination.limit", limit)

            # Track metrics
            metrics.incr("project.list.attempt")
            start_time = time.time()

            # Query projects
            projects = await get_all_by_condition(
                db,
                Project,
                Project.user_id == current_user.id,
                limit=limit,
                offset=skip,
                order_by=Project.created_at.desc(),
            )

            # Apply filters
            if filter_param == ProjectFilter.pinned:
                projects = [p for p in projects if p.pinned]
            elif filter_param == ProjectFilter.archived:
                projects = [p for p in projects if p.archived]
            elif filter_param == ProjectFilter.active:
                projects = [p for p in projects if not p.archived]

            # Record success
            duration = (time.time() - start_time) * 1000
            metrics.distribution("project.list.duration", duration, unit="millisecond")
            metrics.incr(
                "project.list.success",
                tags={"count": len(projects), "filter": filter_param.value},
            )

            return {
                "projects": [serialize_project(p) for p in projects],
                "count": len(projects),
                "filter": {
                    "type": filter_param.value,
                    "applied": {
                        "archived": filter_param == ProjectFilter.archived,
                        "pinned": filter_param == ProjectFilter.pinned,
                    },
                },
            }

        except Exception as e:
            span.set_tag("error", True)
            capture_exception(e)
            metrics.incr("project.list.failure")
            logger.error(f"Failed to list projects: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to retrieve projects",
            ) from e


@router.get("/{project_id}/", response_model=Dict)
async def get_project(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Get project details with monitoring"""
    with sentry_span(
        op="project", name="Get Project", description=f"Get project {project_id}"
    ) as span:
        try:
            span.set_tag("project.id", str(project_id))
            span.set_tag("user.id", str(current_user.id))

            # Validate access
            project = await validate_project_access(project_id, current_user, db)

            # Set context
            with configure_scope() as scope:
                scope.set_context("project", serialize_project(project))

            metrics.incr("project.view.success")
            return await create_standard_response(serialize_project(project))

        except HTTPException as http_exc:
            span.set_tag("error.type", "http")
            span.set_data("status_code", http_exc.status_code)
            metrics.incr(
                "project.view.failure",
                tags={"reason": "access_denied", "status_code": http_exc.status_code},
            )
            raise
        except Exception as e:
            span.set_tag("error", True)
            capture_exception(e)
            metrics.incr("project.view.failure", tags={"reason": "exception"})
            logger.error(f"Failed to get project {project_id}: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to retrieve project",
            ) from e


@router.patch("/{project_id}/", response_model=Dict)
async def update_project(
    project_id: UUID,
    update_data: ProjectUpdate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Update project with change tracking"""
    transaction = start_transaction(
        op="project",
        name="Update Project",
        sampled=random.random() < PROJECT_SAMPLE_RATE,
    )

    try:
        with transaction:
            transaction.set_tag("project.id", str(project_id))
            transaction.set_tag("user.id", str(current_user.id))

            # Validate access
            project = await validate_project_access(project_id, current_user, db)

            # Track changes
            changes = {}
            updates = update_data.dict(exclude_unset=True)
            transaction.set_data("updates", updates)

            # Validate token limit
            if "max_tokens" in updates and updates["max_tokens"] < project.token_usage:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Token limit below current usage",
                )

            # Apply updates
            with sentry_span(op="db.update", description="Update project record"):
                for key, value in updates.items():
                    if getattr(project, key) != value:
                        # Save old value for logging
                        old_val = getattr(project, key)
                        setattr(project, key, value)
                        changes[key] = {"old": old_val, "new": value}

                await save_model(db, project)

            # Record metrics
            metrics.incr("project.update.success")
            metrics.distribution(
                "project.update.field_count",
                len(changes),
                tags={"project_id": str(project_id)},
            )

            if changes:
                capture_message(
                    "Project updated",
                    level="info",
                    data={"project_id": str(project_id), "changes": changes},
                )

            return await create_standard_response(
                serialize_project(project), "Project updated successfully"
            )

    except HTTPException as http_exc:
        transaction.set_tag("error.type", "http")
        transaction.set_data("status_code", http_exc.status_code)
        metrics.incr(
            "project.update.failure",
            tags={"reason": "validation", "status_code": http_exc.status_code},
        )
        raise
    except Exception as e:
        transaction.set_tag("error", True)
        capture_exception(e)
        metrics.incr("project.update.failure", tags={"reason": "exception"})
        logger.error(f"Project update failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update project: {str(e)}",
        ) from e


@router.delete("/{project_id}/", response_model=Dict)
async def delete_project(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Delete project with resource cleanup tracking"""
    transaction = start_transaction(
        op="project",
        name="Delete Project",
        sampled=random.random() < PROJECT_SAMPLE_RATE,
    )

    try:
        with transaction:
            transaction.set_tag("project.id", str(project_id))
            transaction.set_tag("user.id", str(current_user.id))

            # Validate access
            project = await validate_project_access(project_id, current_user, db)

            # Initialize storage
            storage = get_file_storage(
                {
                    "storage_type": getattr(config, "FILE_STORAGE_TYPE", "local"),
                    "local_path": getattr(config, "LOCAL_UPLOADS_DIR", "./uploads"),
                }
            )

            # File deletion tracking
            files_deleted = 0
            files_failed = 0
            total_size = 0

            with sentry_span(op="storage", description="Delete project files"):
                files = await get_all_by_condition(
                    db, ProjectFile, ProjectFile.project_id == project_id
                )

                for file in files:
                    try:
                        await storage.delete_file(file.file_path)
                        files_deleted += 1
                        total_size += file.file_size
                    except Exception as file_err:
                        files_failed += 1
                        capture_exception(file_err)
                        logger.warning(f"Failed to delete file {file.id}: {file_err}")

            transaction.set_data(
                "files",
                {
                    "deleted": files_deleted,
                    "failed": files_failed,
                    "total_size": total_size,
                },
            )

            # Delete project
            with sentry_span(op="db.delete", description="Delete project record"):
                await db.delete(project)
                await db.commit()

            # Record metrics
            metrics.incr(
                "project.delete.success",
                tags={"files_deleted": files_deleted, "files_failed": files_failed},
            )

            capture_message(
                "Project deleted",
                level="info",
                data={
                    "project_id": str(project_id),
                    "files_deleted": files_deleted,
                    "storage_freed": total_size,
                },
            )

            return await create_standard_response(
                {"id": str(project_id)}, "Project deleted successfully"
            )

    except Exception as e:
        transaction.set_tag("error", True)
        capture_exception(e)
        metrics.incr("project.delete.failure")
        logger.error(f"Project deletion failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete project: {str(e)}",
        ) from e


# ============================
# Project Actions with Monitoring
# ============================


@router.patch("/{project_id}/archive", response_model=Dict)
async def toggle_archive_project(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Toggle archive status with state tracking"""
    with sentry_span(
        op="project",
        name="Toggle Archive",
        description=f"Toggle archive for project {project_id}",
    ) as span:
        try:
            span.set_tag("project.id", str(project_id))

            # Validate access
            project = await validate_project_access(project_id, current_user, db)

            # Track state change
            old_state = project.archived
            project.archived = not project.archived
            if project.archived and project.pinned:
                project.pinned = False
                span.set_tag("pinned_cleared", True)

            await save_model(db, project)

            # Record metrics
            metrics.incr(
                "project.archive.toggle",
                tags={
                    "new_state": str(project.archived),
                    "was_pinned": str(old_state and project.pinned),
                },
            )

            return await create_standard_response(
                serialize_project(project),
                f"Project {'archived' if project.archived else 'unarchived'}",
            )

        except Exception as e:
            span.set_tag("error", True)
            capture_exception(e)
            metrics.incr("project.archive.failure")
            logger.error(f"Archive toggle failed: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to toggle archive status",
            ) from e


@router.post("/{project_id}/pin", response_model=Dict)
async def toggle_pin_project(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Toggle pin status with validation"""
    with sentry_span(
        op="project",
        name="Toggle Pin",
        description=f"Toggle pin for project {project_id}",
    ) as span:
        try:
            span.set_tag("project.id", str(project_id))

            # Validate access
            project = await validate_project_access(project_id, current_user, db)

            if project.archived and not project.pinned:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot pin archived projects",
                )

            project.pinned = not project.pinned
            await save_model(db, project)

            # Record metrics
            metrics.incr("project.pin.toggle", tags={"new_state": str(project.pinned)})

            return await create_standard_response(
                serialize_project(project),
                f"Project {'pinned' if project.pinned else 'unpinned'}",
            )

        except HTTPException as http_exc:
            span.set_tag("error.type", "http")
            span.set_data("status_code", http_exc.status_code)
            metrics.incr(
                "project.pin.failure",
                tags={"reason": "validation", "status_code": http_exc.status_code},
            )
            raise
        except Exception as e:
            span.set_tag("error", True)
            capture_exception(e)
            metrics.incr("project.pin.failure", tags={"reason": "exception"})
            logger.error(f"Pin toggle failed: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to toggle pin status",
            ) from e


# ============================
# Project Stats with Monitoring
# ============================


@router.get("/{project_id}/stats", response_model=dict)
async def get_project_stats(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Get project statistics with performance tracing"""
    with sentry_span(
        op="project",
        name="Get Stats",
        description=f"Get stats for project {project_id}",
        sampled=random.random() < METRICS_SAMPLE_RATE,
    ) as span:
        try:
            span.set_tag("project.id", str(project_id))

            # Validate access
            project = await validate_project_access(project_id, current_user, db)

            # Track metrics collection
            metrics.incr("project.stats.requested")
            start_time = time.time()

            # Get conversation count
            conversations = await get_all_by_condition(
                db,
                Conversation,
                Conversation.project_id == project_id,
                Conversation.is_deleted.is_(False),
            )

            # Get file statistics
            files_result = await db.execute(
                select(
                    func.count(ProjectFile.id), func.sum(ProjectFile.file_size)
                ).where(ProjectFile.project_id == project_id)
            )
            file_count, total_size = files_result.first() or (0, 0)

            # Get artifact count
            artifacts = await get_all_by_condition(
                db, Artifact, Artifact.project_id == project_id
            )

            # KB information
            kb_info = None
            if project.knowledge_base_id:
                kb_info = {
                    "id": str(project.knowledge_base_id),
                    "is_active": False,
                    "indexed_files": 0,
                }
                try:
                    kb = await db.get(KnowledgeBase, project.knowledge_base_id)
                    if kb:
                        kb_info["is_active"] = kb.is_active
                        # Retrieve how many files have processed_for_search = True
                        processed_result = await db.execute(
                            select(func.count(ProjectFile.id)).where(
                                ProjectFile.project_id == project_id,
                                ProjectFile.processed_for_search == True,  # noqa
                            )
                        )
                        processed = processed_result.scalar() or 0
                        kb_info["indexed_files"] = processed
                except Exception as kb_err:
                    capture_exception(kb_err)
                    kb_info["error"] = str(kb_err)

            # Calculate usage
            usage_percentage = (
                (project.token_usage / project.max_tokens * 100)
                if project.max_tokens > 0
                else 0
            )

            # Record performance
            duration = (time.time() - start_time) * 1000
            metrics.distribution("project.stats.duration", duration, unit="millisecond")
            metrics.incr("project.stats.success")

            return {
                "token_usage": project.token_usage,
                "max_tokens": project.max_tokens,
                "usage_percentage": usage_percentage,
                "conversation_count": len(conversations),
                "file_count": file_count,
                "total_file_size": total_size or 0,
                "artifact_count": len(artifacts),
                "knowledge_base": kb_info,
            }

        except Exception as e:
            span.set_tag("error", True)
            capture_exception(e)
            metrics.incr("project.stats.failure")
            logger.error(f"Failed to get project stats: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to retrieve project statistics",
            ) from e
