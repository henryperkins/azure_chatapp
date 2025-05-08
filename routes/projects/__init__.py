"""
Project routes package
---------------------
Organizes all project-related routes into a logical, hierarchical structure.
"""

from fastapi import APIRouter
from routes.unified_conversations import router as conversations_router

from routes.projects import (
    projects,
    files,
    artifacts,
)  # Removed knowledge_base from imports

router = APIRouter()

# Project-associated resources (include first)
router.include_router(conversations_router, tags=["project-conversations"])
router.include_router(
    files.router, prefix="/{project_id}/files", tags=["project-files"]
)
router.include_router(
    artifacts.router, prefix="/{project_id}/artifacts", tags=["project-artifacts"]
)

# Core project operations (include after child routes)
router.include_router(projects.router, tags=["projects"])
