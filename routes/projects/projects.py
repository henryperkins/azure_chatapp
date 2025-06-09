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
from typing import Optional, Tuple, Union
from enum import Enum

from fastapi import APIRouter, Depends, HTTPException, status, Request, Query
from fastapi.responses import JSONResponse  # NEW
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select, true
from sqlalchemy.orm import (
    selectinload,
    attributes as orm_attributes,
)  # Added for selectinload and flag_modified
from sentry_sdk import (
    capture_exception,
    configure_scope,
    start_transaction,
    set_tag,
    metrics,
    capture_message,
)

from db import get_async_session
from models.user import User, UserRole
from models.project import Project, ProjectUserAssociation
from models.conversation import Conversation
from models.project_file import ProjectFile
from models.artifact import Artifact
from models.knowledge_base import KnowledgeBase
from utils.auth_utils import get_current_user_and_token
from services.project_service import (
    check_project_permission,
    ProjectAccessLevel,
    coerce_project_id,
    _lookup_project,
    validate_project_access,  # <-- ensure strict access/exists check
)
from utils.db_utils import get_all_by_condition, save_model
from utils.response_utils import create_standard_response
from utils.serializers import serialize_project
from services.file_service import FileService
from utils.sentry_utils import sentry_span_context

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


@router.post("/", response_class=JSONResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    project_data: ProjectCreate,
    current_user_tuple: Tuple[User, str] = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Create a new project with full monitoring and always auto-attach a knowledge base.
    """
    current_user, _token = current_user_tuple
    logger.info(
        f"[PROJECT_CREATE_START] User ID {current_user.id} ({current_user.username}) creating project '{project_data.name}'"
    )
    transaction = start_transaction(
        op="project",
        sampled=random.random() < PROJECT_SAMPLE_RATE,
    )
    try:
        with transaction:
            transaction.set_tag("user.id", str(current_user.id))
            transaction.set_data("project.name", project_data.name)
            transaction.set_data("max_tokens", project_data.max_tokens)

            metrics.incr("project.create.attempt")
            start_time = time.time()

            # Create project (with auto-KB) via service
            from services.project_service import create_project as svc_create_project

            project = await svc_create_project(
                user_id=current_user.id,
                name=project_data.name,
                db=db,
                description=project_data.description,
                goals=project_data.goals,
                max_tokens=project_data.max_tokens,
                default_model="claude-3-sonnet-20240229",
            )

            from services.conversation_service import ConversationService

            conv_service = ConversationService(db)
            await conv_service.create_conversation(
                user_id=current_user.id,
                title="Default Conversation",
                model_id="claude-3-sonnet-20240229",
                project_id=project.id,
            )

            # The conversation creation commits the session, which expires all
            # attributes (``expire_on_commit=True``).  Re-load the KB
            # relationship to avoid an implicit lazy-load – implicit loads
            # inside an async context trigger the notorious
            # "greenlet_spawn has not been called; can't call await_only()"
            # error.  An explicit refresh keeps the operation fully async-safe.
            await db.refresh(project, ["knowledge_base"])

            duration = (time.time() - start_time) * 1000
            metrics.distribution(
                "project.create.duration", duration, unit="millisecond"
            )
            metrics.incr("project.create.success")

            with configure_scope():
                set_tag("user.id", str(current_user.id))
                set_tag("project.id", str(project.id))
                if getattr(project, "knowledge_base", None):
                    set_tag("kb.id", str(project.knowledge_base.id))

            # Update user preferences
            user_stmt = (
                select(User)
                .where(User.id == current_user.id)
                .options(
                    selectinload(User.conversations),
                    selectinload(User.project_associations).selectinload(
                        ProjectUserAssociation.project
                    ),
                )
            )
            user_result = await db.execute(user_stmt)
            user_to_update = user_result.scalar_one_or_none()

            if not user_to_update:
                logger.error(
                    f"User {current_user.id} not found in current session with selectinload."
                )
                raise HTTPException(
                    status_code=500,
                    detail="User session error during project creation (selectinload)",
                )

            project_for_prefs_update = await db.get(Project, project.id)
            if not project_for_prefs_update:
                logger.error(
                    f"Project {project.id} not found in current session before updating user preferences."
                )
                raise HTTPException(
                    status_code=500,
                    detail="Project session error during user preferences update",
                )
            await db.refresh(project_for_prefs_update)

            if user_to_update.preferences is None:
                user_to_update.preferences = {}
            user_to_update.preferences["last_project_id"] = str(
                project_for_prefs_update.id
            )

            temp_projects_list = user_to_update.preferences.get("projects", [])
            temp_projects_list.append(
                {
                    "id": str(project_for_prefs_update.id),
                    "title": project_for_prefs_update.name,
                }
            )
            user_to_update.preferences["projects"] = temp_projects_list

            orm_attributes.flag_modified(user_to_update, "preferences")
            await save_model(db, user_to_update)

            logger.info(
                f"Created project {project_for_prefs_update.id} with KB {getattr(project_for_prefs_update, 'knowledge_base', None) and project_for_prefs_update.knowledge_base.id}"
            )

            # For the final response, ensure the main project object is fully loaded as needed for serialization
            await db.refresh(
                project_for_prefs_update, ["knowledge_base", "conversations"]
            )

            return await create_standard_response(
                serialize_project(project_for_prefs_update),
                "Project and knowledge base created successfully",
                span_or_transaction=transaction,
            )

    except HTTPException:
        raise
    except Exception as e:
        transaction.set_tag("error", True)
        capture_exception(e)
        metrics.incr("project.create.failure")
        logger.error(f"Project creation failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Project creation failed: {str(e)}",
        ) from e


@router.get("/", response_class=JSONResponse)
async def list_projects(
    request: Request,
    filter_type: ProjectFilter = Query(
        ProjectFilter.all, alias="filter", description="Filter type"
    ),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    all_users: bool = Query(
        False, description="Admin only: List projects for all users"
    ),
    current_user_tuple: Tuple[User, str] = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """List projects with performance tracing"""
    current_user, _token = current_user_tuple
    logger.info(
        f"[PROJECT_LIST_START] User ID {current_user.id} ({current_user.username}) listing projects with filter: {filter_type.value}"
    )
    with sentry_span_context(
        op="project",
        description=f"List projects with filter: {filter_type.value}",
    ) as span:
        try:
            span.set_tag("user.id", str(current_user.id))
            span.set_data("filter", filter_type.value)
            span.set_data("pagination.skip", skip)
            span.set_data("pagination.limit", limit)

            metrics.incr("project.list.attempt")
            start_time = time.time()

            if all_users and current_user.role == UserRole.ADMIN.value:
                condition = true()
                span.set_tag("admin.all_users", True)
            else:
                condition = Project.user_id == current_user.id

            projects = await get_all_by_condition(
                db,
                Project,
                condition,
                limit=limit,
                offset=skip,
                order_by=Project.created_at.desc(),
            )

            if filter_type == ProjectFilter.pinned:
                projects = [p for p in projects if p.pinned]
            elif filter_type == ProjectFilter.archived:
                projects = [p for p in projects if p.archived]
            elif filter_type == ProjectFilter.active:
                projects = [p for p in projects if not p.archived]

            duration = (time.time() - start_time) * 1000
            metrics.distribution("project.list.duration", duration, unit="millisecond")
            metrics.incr(
                "project.list.success",
                tags={"count": len(projects), "filter": filter_type.value},
            )

            return await create_standard_response(
                {
                    "projects": [serialize_project(p) for p in projects],
                    "count": len(projects),
                    "filter": {
                        "type": filter_type.value,
                        "applied": {
                            "archived": filter_type == ProjectFilter.archived,
                            "pinned": filter_type == ProjectFilter.pinned,
                        },
                    },
                },
                span_or_transaction=span,
            )

        # Allow explicit HTTPExceptions (e.g. 4xx coming from permission /
        # archived-project checks) to bubble up untouched so the client
        # receives the correct status-code.
        except HTTPException:
            raise
        # If underlying logic raised an HTTPException (e.g., project is archived
        # or permission denied) propagate it as-is so the client receives the
        # intended 4xx status instead of an internal-server error.
        except Exception as e:
            span.set_tag("error", True)
            capture_exception(e)
            metrics.incr("project.list.failure")
            logger.exception("Failed to list projects")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to retrieve projects",
            ) from e


@router.get("/{project_id}/", response_class=JSONResponse)
async def get_project(
    project_id: str,
    current_user_tuple: Tuple[User, str] = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Return a single project object as a dictionary.

    The function follows the strict error-handling pattern:

        • Catch and immediately re-raise `HTTPException` instances so that
          FastAPI can turn them into the correct 4xx/5xx response without
          further processing.
        • Catch every other `Exception`, log it, and wrap it in a new
          `HTTPException(status_code=500)` so that we never end the handler
          without either returning a dictionary or raising an `HTTPException`.
    """

    try:
        current_user, _token = current_user_tuple

        try:
            proj_id: Union[str, int, UUID] = coerce_project_id(project_id)
        except Exception as coercion_err:
            logger.exception("Project ID coercion failed for %s", project_id)
            metrics.incr("project.view.failure", tags={"reason": "id_coercion"})
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid project ID: {project_id}",
            ) from coercion_err

        with sentry_span_context(op="project", description=f"Get project {proj_id}") as span:
            span.set_tag("project.id", str(proj_id))
            span.set_tag("user.id", str(current_user.id))

            # ------------------------------------------------------------------
            # Strict existence + permission validation in a single call
            # ------------------------------------------------------------------
            project = await validate_project_access(
                proj_id, current_user, db, skip_ownership_check=False
            )
            # Eager-load knowledge_base to avoid additional I/O later on
            await db.refresh(project, ["knowledge_base"])

            with configure_scope() as scope:
                scope.set_context("project", serialize_project(project))

            metrics.incr("project.view.success")

            # ------------------------------------------------------------------
            # Align *single-project* response layout with the collection endpoint
            # (`/api/projects/`) which wraps the data inside an object keyed by
            # `projects`.  Returning the raw project dict at `data` introduced a
            # subtle client-side mismatch because the frontend normalisation
            # helper (`normalizeProjectResponse` in `static/js/projectManager.js`)
            # expects **all** project payloads to be provided under either
            # `data.projects[]` **or** `data.project`.  Without this wrapper the
            # helper received an object whose direct `id` property is undefined
            # (`res.data.id === undefined`) and subsequently threw the
            # “Invalid project ID in server response” error observed in Sentry
            # and browser logs.
            #
            # To keep the public contract consistent we now wrap the serialized
            # record in `{ "project": … }` – mirroring the plural endpoint and
            # making it trivial for the client to extract the ID regardless of
            # whether it is dealing with a list or a single entity.
            # ------------------------------------------------------------------

            return await create_standard_response(
                {"project": serialize_project(project)},
                span_or_transaction=span,
            )

    # ------------------------------------------------------------------
    # Maintain correct HTTP error semantics
    # ------------------------------------------------------------------
    except HTTPException:
        # Re-raise so FastAPI preserves original status code and message
        raise
    except Exception as e:
        logger.exception("Unhandled error in get_project")
        capture_exception(e)
        metrics.incr("project.view.failure", tags={"reason": "exception"})
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error while retrieving the project",
        ) from e


@router.patch("/{project_id}/", response_class=JSONResponse)
async def update_project(
    project_id: str,
    update_data: ProjectUpdate,
    current_user_tuple: Tuple[User, str] = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Update project with change tracking"""
    current_user, _token = current_user_tuple
    proj_id: Union[str, int, UUID] = coerce_project_id(project_id)
    transaction = start_transaction(
        op="project",
        sampled=random.random() < PROJECT_SAMPLE_RATE,
    )
    try:
        with transaction:
            transaction.set_tag("project.id", str(proj_id))
            transaction.set_tag("user.id", str(current_user.id))

            await check_project_permission(
                proj_id, current_user, db, ProjectAccessLevel.EDIT
            )
            project = await _lookup_project(db, proj_id)
            if not project:
                raise HTTPException(status_code=404, detail="Project not found")

            changes = {}
            updates = update_data.dict(exclude_unset=True)
            transaction.set_data("updates", updates)

            if "max_tokens" in updates and updates["max_tokens"] < project.token_usage:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Token limit below current usage",
                )

            with sentry_span_context(
                op="db.update", description="Update project record"
            ):
                for key, value in updates.items():
                    if getattr(project, key) != value:
                        old_val = getattr(project, key)
                        setattr(project, key, value)
                        changes[key] = {"old": old_val, "new": value}
                await save_model(db, project)

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


@router.delete("/{project_id}/", response_class=JSONResponse)
async def delete_project(
    project_id: str,
    current_user_tuple: Tuple[User, str] = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Delete project with resource cleanup tracking"""
    current_user, _token = current_user_tuple
    proj_id: Union[str, int, UUID] = coerce_project_id(project_id)
    transaction = start_transaction(
        op="project",
        sampled=random.random() < PROJECT_SAMPLE_RATE,
    )
    try:
        with transaction:
            transaction.set_tag("project.id", str(proj_id))
            transaction.set_tag("user.id", str(current_user.id))

            await check_project_permission(
                proj_id, current_user, db, ProjectAccessLevel.MANAGE
            )
            project = await _lookup_project(db, proj_id)
            if not project:
                raise HTTPException(status_code=404, detail="Project not found")

            files_deleted = 0
            files_failed = 0
            total_size = 0

            fs = FileService(db)
            project_uuid = coerce_project_id(project_id)

            with sentry_span_context(
                op="storage", description="Delete project files"
            ):
                files = await get_all_by_condition(
                    db, ProjectFile, ProjectFile.project_id == project_id
                )
                for f in files:
                    try:
                        # Ensure both arguments are proper UUIDs (enforce type safety)
                        pid = project_uuid if isinstance(project_uuid, UUID) else UUID(str(project_uuid))
                        fid = f.id if isinstance(f.id, UUID) else UUID(str(f.id))
                        await fs.delete_file(pid, fid)
                        files_deleted += 1
                        total_size += f.file_size
                    except Exception as file_err:
                        files_failed += 1
                        capture_exception(file_err)
                        logger.warning(f"Failed to delete file {f.id}: {file_err}")

            transaction.set_data(
                "files",
                {
                    "deleted": files_deleted,
                    "failed": files_failed,
                    "total_size": total_size,
                },
            )

            from sqlalchemy import delete as sqlalchemy_delete

            convo_del = await db.execute(
                sqlalchemy_delete(Conversation).where(
                    Conversation.project_id == project_id
                )
            )
            logger.info(
                f"Deleted {convo_del.rowcount if hasattr(convo_del, 'rowcount') else '?'} conversations for project {project_id}"
            )

            artifact_del = await db.execute(
                sqlalchemy_delete(Artifact).where(Artifact.project_id == project_id)
            )
            logger.info(
                f"Deleted {artifact_del.rowcount if hasattr(artifact_del, 'rowcount') else '?'} artifacts for project {project_id}"
            )

            if project.knowledge_base:
                await db.delete(project.knowledge_base)
                logger.info(
                    f"Deleted knowledge base {project.knowledge_base.id} for project {project_id}"
                )

            file_del = await db.execute(
                sqlalchemy_delete(ProjectFile).where(
                    ProjectFile.project_id == project_id
                )
            )
            logger.info(
                f"Deleted {file_del.rowcount if hasattr(file_del, 'rowcount') else '?'} file records for project {project_id}"
            )

            with sentry_span_context(
                op="db.delete", description="Delete project record"
            ):
                await db.delete(project)
                await db.commit()

            user = current_user
            prefs = user.preferences or {}
            old_projects = prefs.get("projects", [])
            updated_projects = [
                p for p in old_projects if p.get("id") != str(project_id)
            ]
            prefs["projects"] = updated_projects
            if prefs.get("last_project_id") == str(project_id):
                if updated_projects:
                    prefs["last_project_id"] = updated_projects[-1]["id"]
                else:
                    prefs["last_project_id"] = None
            user.preferences = prefs
            await save_model(db, user)

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


@router.patch("/{project_id}/archive", response_class=JSONResponse)
async def toggle_archive_project(
    project_id: str,
    current_user_tuple: Tuple[User, str] = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Toggle archive status with state tracking"""
    current_user, _token = current_user_tuple
    proj_id: Union[str, int, UUID] = coerce_project_id(project_id)
    with sentry_span_context(
        op="project",
        description=f"Toggle archive for project {proj_id}",
    ) as span:
        try:
            span.set_tag("project.id", str(proj_id))
            span.set_tag("user.id", str(current_user.id))

            await check_project_permission(
                proj_id, current_user, db, ProjectAccessLevel.MANAGE
            )
            project = await _lookup_project(db, proj_id)
            if not project:
                raise HTTPException(status_code=404, detail="Project not found")

            old_state = project.archived
            project.archived = not project.archived

            if project.archived and project.pinned:
                project.pinned = False
                span.set_tag("pinned_cleared", True)

            await save_model(db, project)

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

        except HTTPException:
            raise
        except Exception as e:
            span.set_tag("error", True)
            capture_exception(e)
            metrics.incr("project.archive.failure")
            logger.error(f"Archive toggle failed: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to toggle archive status",
            ) from e


@router.post("/{project_id}/pin", response_class=JSONResponse)
async def toggle_pin_project(
    project_id: str,
    current_user_tuple: Tuple[User, str] = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Toggle pin status of a project with validation"""
    current_user, _token = current_user_tuple
    proj_id: Union[str, int, UUID] = coerce_project_id(project_id)
    with sentry_span_context(
        op="project",
        description=f"Toggle pin for project {proj_id}",
    ) as span:
        try:
            span.set_tag("project.id", str(proj_id))
            span.set_tag("user.id", str(current_user.id))

            await check_project_permission(
                proj_id, current_user, db, ProjectAccessLevel.MANAGE
            )
            project = await _lookup_project(db, proj_id)
            if not project:
                raise HTTPException(status_code=404, detail="Project not found")

            if project.archived and not project.pinned:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot pin archived projects",
                )

            project.pinned = not project.pinned
            await save_model(db, project)

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


@router.get("/{project_id}/stats", response_class=JSONResponse)
async def get_project_stats(
    project_id: str,
    current_user_tuple: Tuple[User, str] = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
):
    """Return usage statistics for a single project as a dictionary."""

    try:
        current_user, _token = current_user_tuple
        proj_id: Union[str, int, UUID] = coerce_project_id(project_id)

        with sentry_span_context(
            op="project", description=f"Get stats for project {proj_id}"
        ) as span:
            span.set_tag("project.id", str(proj_id))
            span.set_tag("user.id", str(current_user.id))

            await check_project_permission(
                proj_id, current_user, db, ProjectAccessLevel.READ
            )

            project = await db.get(Project, proj_id)
            if not project:
                raise HTTPException(status_code=404, detail="Project not found")

            metrics.incr("project.stats.requested")
            start_time = time.time()

            # ------------------------------------------------------------------
            # Conversations
            # ------------------------------------------------------------------
            conversations = await get_all_by_condition(
                db,
                Conversation,
                Conversation.project_id == project_id,
                Conversation.is_deleted.is_(False),
            )

            # ------------------------------------------------------------------
            # Files
            # ------------------------------------------------------------------
            files_result = await db.execute(
                select(func.count(ProjectFile.id), func.sum(ProjectFile.file_size))
                .select_from(ProjectFile)
                .where(ProjectFile.project_id == project_id)
            )
            file_count, total_size = files_result.first() or (0, 0)

            # ------------------------------------------------------------------
            # Artifacts
            # ------------------------------------------------------------------
            artifacts = await get_all_by_condition(
                db, Artifact, Artifact.project_id == project_id
            )

            # ------------------------------------------------------------------
            # Knowledge-base details (ignore errors gracefully)
            # ------------------------------------------------------------------
            kb_info = None
            try:
                kb_query = await db.execute(
                    select(KnowledgeBase).where(KnowledgeBase.project_id == project_id)
                )
                kb = kb_query.scalars().first()
                if kb:
                    processed_result = await db.execute(
                        select(func.count(ProjectFile.id)).where(
                            ProjectFile.project_id == project_id,
                            ProjectFile.config.isnot(None),
                            ProjectFile.config.contains({"processed_for_search": True}),
                        )
                    )
                    processed = processed_result.scalar() or 0
                    kb_info = {
                        "id": str(kb.id),
                        "is_active": kb.is_active,
                        "indexed_files": processed,
                    }
            except Exception as kb_err:
                capture_exception(kb_err)
                kb_info = {
                    "id": None,
                    "is_active": False,
                    "indexed_files": 0,
                    "error": str(kb_err),
                }

            usage_percentage = (
                (project.token_usage / project.max_tokens * 100)
                if project.max_tokens > 0
                else 0
            )

            duration = (time.time() - start_time) * 1000
            metrics.distribution("project.stats.duration", duration, unit="millisecond")
            metrics.incr("project.stats.success")

            return await create_standard_response(
                {
                    "token_usage": project.token_usage,
                    "max_tokens": project.max_tokens,
                    "usage_percentage": usage_percentage,
                    "conversation_count": len(conversations),
                    "file_count": file_count,
                    "total_file_size": total_size or 0,
                    "artifact_count": len(artifacts),
                    "knowledge_base": kb_info,
                },
                span_or_transaction=span,
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unhandled error while computing project stats")
        capture_exception(e)
        metrics.incr("project.stats.failure")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error while retrieving project statistics",
        ) from e

# ------------------------------------------------------------------
# Backwards-compatibility: expose endpoints without the trailing “/”
# to avoid 307 HTML redirects when the client omits the slash.
# ------------------------------------------------------------------

router.add_api_route(
    "/{project_id}",
    get_project,
    methods=["GET"],
    response_class=JSONResponse,
)

router.add_api_route(
    "/{project_id}",
    update_project,
    methods=["PATCH"],
    response_class=JSONResponse,
)

router.add_api_route(
    "/{project_id}",
    delete_project,
    methods=["DELETE"],
    response_class=JSONResponse,
)
