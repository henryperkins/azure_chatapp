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
from typing import Optional, Tuple
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
from services.project_service import check_project_permission, ProjectAccessLevel
import config
from utils.db_utils import get_all_by_condition, save_model
from utils.response_utils import create_standard_response
from utils.serializers import serialize_project
from services.file_storage import get_file_storage
from utils.sentry_utils import sentry_span

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


@router.post("/", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_project(
    project_data: ProjectCreate,
    current_user_tuple: Tuple[User, str] = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Create a new project with full monitoring and always create a knowledge base.
    """
    current_user, _token = current_user_tuple
    # --- BEGIN ADDED LOGGING ---
    logger.info(f"[PROJECT_CREATE_START] User ID {current_user.id} ({current_user.username}) creating project '{project_data.name}'")
    # --- END ADDED LOGGING ---
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

            # 1. Create project
            with sentry_span(op="db", description="Create project record"):
                project = Project(
                    user_id=current_user.id,
                    name=project_data.name,
                    goals=project_data.goals,
                    description=project_data.description,
                    custom_instructions=project_data.custom_instructions,
                    max_tokens=project_data.max_tokens,
                )
                await save_model(db, project)

            # 2. Immediately create a knowledge base for this project
            from services.knowledgebase_service import create_knowledge_base

            kb = await create_knowledge_base(
                name=f"{project.name} Knowledge Base",
                project_id=project.id,
                description="Auto-created KB for project",
                db=db,
            )

            # 3. Attach KB to project and save
            import uuid
            project.knowledge_base_id = uuid.UUID(str(kb.id))
            await save_model(db, project)

            # 4. Immediately create a default conversation for this project
            from services.conversation_service import ConversationService

            conv_service = ConversationService(db)
            default_conversation = await conv_service.create_conversation(
                user_id=current_user.id,
                title="Default Conversation",
                model_id="claude-3-sonnet-20240229",
                project_id=project.id,
            )

            # Record success
            duration = (time.time() - start_time) * 1000
            metrics.distribution(
                "project.create.duration", duration, unit="millisecond"
            )
            metrics.incr("project.create.success")

            # Set user context
            with configure_scope() as scope:
                set_tag("user.id", str(current_user.id))
                set_tag("project.id", str(project.id))
                set_tag("kb.id", str(kb.id))

            # Update user preferences with last_project_id and chronologically ordered projects array
            user = current_user
            if user.preferences is None:
                user.preferences = {}
            user.preferences["last_project_id"] = str(project.id)

            # Maintain a chronological array of projects w/ id and title
            projects_list = user.preferences.get("projects", [])
            projects_list.append({"id": str(project.id), "title": project.name})
            user.preferences["projects"] = projects_list
            await save_model(db, user)

            logger.info(f"Created project {project.id} with KB {kb.id}")
            return await create_standard_response(
                serialize_project(project),
                "Project and knowledge base created successfully",
                span_or_transaction=transaction,
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


@router.get("/", response_model=dict)
async def list_projects(
    request: Request,
    filter_type: ProjectFilter = Query(
        ProjectFilter.all, alias="filter", description="Filter type"
    ),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    current_user_tuple: Tuple[User, str] = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """List projects with performance tracing"""
    current_user, _token = current_user_tuple
    # --- BEGIN ADDED LOGGING ---
    logger.info(f"[PROJECT_LIST_START] User ID {current_user.id} ({current_user.username}) listing projects with filter: {filter_type.value}")
    # --- END ADDED LOGGING ---
    with sentry_span(
        op="project",
        name="List Projects",
        description=f"List projects with filter: {filter_type.value}",
    ) as span:
        try:
            span.set_tag("user.id", str(current_user.id))
            span.set_data("filter", filter_type.value)
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
            if filter_type == ProjectFilter.pinned:
                projects = [p for p in projects if p.pinned]
            elif filter_type == ProjectFilter.archived:
                projects = [p for p in projects if p.archived]
            elif filter_type == ProjectFilter.active:
                projects = [p for p in projects if not p.archived]

            # Record success
            duration = (time.time() - start_time) * 1000
            metrics.distribution("project.list.duration", duration, unit="millisecond")
            metrics.incr(
                "project.list.success",
                tags={"count": len(projects), "filter": filter_type.value},
            )

            return {
                "projects": [serialize_project(p) for p in projects],
                "count": len(projects),
                "filter": {
                    "type": filter_type.value,
                    "applied": {
                        "archived": filter_type == ProjectFilter.archived,
                        "pinned": filter_type == ProjectFilter.pinned,
                    },
                },
            }

        except Exception as e:
            span.set_tag("error", True)
            capture_exception(e)
            metrics.incr("project.list.failure")
            logger.exception("Failed to list projects")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to retrieve projects",
            ) from e


@router.get("/{project_id}/", response_model=dict)
async def get_project(
    project_id: UUID,
    current_user_tuple: Tuple[User, str] = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Get project details with centralized permission validation"""
    current_user, _token = current_user_tuple
    with sentry_span(
        op="project", name="Get Project", description=f"Get project {project_id}"
    ) as span:
        try:
            span.set_tag("project.id", str(project_id))
            span.set_tag("user.id", str(current_user.id))

            # Centralized permission check
            await check_project_permission(
                project_id,
                current_user,
                db,
                ProjectAccessLevel.READ
            )
            # Fetch project after permission check
            project = await db.get(Project, project_id)
            if not project:
                raise HTTPException(status_code=404, detail="Project not found")

            # Set context in Sentry
            with configure_scope() as scope:
                scope.set_context("project", serialize_project(project))

            metrics.incr("project.view.success")
            return await create_standard_response(
                serialize_project(project), span_or_transaction=span
            )

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


@router.patch("/{project_id}/", response_model=dict)
async def update_project(
    project_id: UUID,
    update_data: ProjectUpdate,
    current_user_tuple: Tuple[User, str] = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Update project with change tracking"""
    current_user, _token = current_user_tuple
    transaction = start_transaction(
        op="project",
        name="Update Project",
        sampled=random.random() < PROJECT_SAMPLE_RATE,
    )
    try:
        with transaction:
            transaction.set_tag("project.id", str(project_id))
            transaction.set_tag("user.id", str(current_user.id))

            # Centralized permission check
            await check_project_permission(
                project_id,
                current_user,
                db,
                ProjectAccessLevel.EDIT
            )
            project = await db.get(Project, project_id)
            if not project:
                raise HTTPException(status_code=404, detail="Project not found")

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
                serialize_project(project),
                "Project updated successfully",
                span_or_transaction=transaction,
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


@router.delete("/{project_id}/", response_model=dict)
async def delete_project(
    project_id: UUID,
    current_user_tuple: Tuple[User, str] = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Delete project with resource cleanup tracking"""
    current_user, _token = current_user_tuple
    transaction = start_transaction(
        op="project",
        name="Delete Project",
        sampled=random.random() < PROJECT_SAMPLE_RATE,
    )
    try:
        with transaction:
            transaction.set_tag("project.id", str(project_id))
            transaction.set_tag("user.id", str(current_user.id))

            # Centralized permission check
            await check_project_permission(
                project_id,
                current_user,
                db,
                ProjectAccessLevel.MANAGE
            )
            project = await db.get(Project, project_id)
            if not project:
                raise HTTPException(status_code=404, detail="Project not found")

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

            # FULL CLEANUP before deleting the project

            # -- Delete all conversations and messages for this project
            from sqlalchemy import delete as sqlalchemy_delete
            convo_del = await db.execute(
                sqlalchemy_delete(Conversation).where(Conversation.project_id == project_id)
            )
            logger.info(f"Deleted {convo_del.rowcount if hasattr(convo_del, 'rowcount') else '?'} conversations for project {project_id}")

            # -- Delete all artifacts for this project
            artifact_del = await db.execute(
                sqlalchemy_delete(Artifact).where(Artifact.project_id == project_id)
            )
            logger.info(f"Deleted {artifact_del.rowcount if hasattr(artifact_del, 'rowcount') else '?'} artifacts for project {project_id}")

            # -- Delete the knowledge base (if any)
            if getattr(project, 'knowledge_base_id', None):
                kb_row = await db.get(KnowledgeBase, project.knowledge_base_id)
                if kb_row:
                    await db.delete(kb_row)
                    logger.info(f"Deleted knowledge base {project.knowledge_base_id} for project {project_id}")

            # -- Delete all ProjectFile rows (already handled file removal above)
            file_del = await db.execute(
                sqlalchemy_delete(ProjectFile).where(ProjectFile.project_id == project_id)
            )
            logger.info(f"Deleted {file_del.rowcount if hasattr(file_del, 'rowcount') else '?'} file records for project {project_id}")

            # Delete project
            with sentry_span(op="db.delete", description="Delete project record"):
                await db.delete(project)
                await db.commit()

            # Cleanup user.preferences for this project
            user = current_user
            prefs = user.preferences or {}

            # Remove from projects list
            old_projects = prefs.get("projects", [])
            updated_projects = [p for p in old_projects if p.get("id") != str(project_id)]
            prefs["projects"] = updated_projects

            # If this was last_project_id, update to previous or None
            if prefs.get("last_project_id") == str(project_id):
                if updated_projects:
                    prefs["last_project_id"] = updated_projects[-1]["id"]
                else:
                    prefs["last_project_id"] = None

            user.preferences = prefs
            await save_model(db, user)

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
                {"id": str(project_id)},
                "Project deleted successfully",
                span_or_transaction=transaction,
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


@router.patch("/{project_id}/archive", response_model=dict)
async def toggle_archive_project(
    project_id: UUID,
    current_user_tuple: Tuple[User, str] = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Toggle archive status with state tracking"""
    current_user, _token = current_user_tuple
    with sentry_span(
        op="project",
        name="Toggle Archive",
        description=f"Toggle archive for project {project_id}",
    ) as span:
        try:
            span.set_tag("project.id", str(project_id))
            span.set_tag("user.id", str(current_user.id))

            # Centralized permission check
            await check_project_permission(
                project_id,
                current_user,
                db,
                ProjectAccessLevel.MANAGE
            )
            project = await db.get(Project, project_id)
            if not project:
                raise HTTPException(status_code=404, detail="Project not found")

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
                span_or_transaction=span,
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


@router.post("/{project_id}/pin", response_model=dict)
async def toggle_pin_project(
    project_id: UUID,
    current_user_tuple: Tuple[User, str] = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Toggle pin status of a project with validation"""
    current_user, _token = current_user_tuple
    with sentry_span(
        op="project",
        name="Toggle Pin",
        description=f"Toggle pin for project {project_id}",
    ) as span:
        try:
            span.set_tag("project.id", str(project_id))
            span.set_tag("user.id", str(current_user.id))

            # Centralized permission check
            await check_project_permission(
                project_id,
                current_user,
                db,
                ProjectAccessLevel.MANAGE
            )
            project = await db.get(Project, project_id)
            if not project:
                raise HTTPException(status_code=404, detail="Project not found")

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
                span_or_transaction=span,
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
    current_user_tuple: Tuple[User, str] = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Get project statistics with performance tracing.
    """
    current_user, _token = current_user_tuple
    with sentry_span(
        op="project",
        name="Get Stats",
        description=f"Get stats for project {project_id}",
        sampled=random.random() < METRICS_SAMPLE_RATE,
    ) as span:
        try:
            span.set_tag("project.id", str(project_id))
            span.set_tag("user.id", str(current_user.id))

            # Centralized permission check
            await check_project_permission(
                project_id,
                current_user,
                db,
                ProjectAccessLevel.READ
            )
            project = await db.get(Project, project_id)
            if not project:
                raise HTTPException(status_code=404, detail="Project not found")

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
                )
                .select_from(ProjectFile)
                .where(ProjectFile.project_id == project_id)
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
                                ProjectFile.config.isnot(None),
                                ProjectFile.config.contains(
                                    {"processed_for_search": True}
                                ),
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
