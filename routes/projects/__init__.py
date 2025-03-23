"""
Project routes package
---------------------
Organizes all project-related routes into a logical, hierarchical structure.
"""
from fastapi import APIRouter

from . import projects, conversations, files, artifacts

router = APIRouter()

# Project-associated resources (include first)
router.include_router(
    conversations.router,
    prefix="/{project_id}/conversations",
    tags=["project-conversations"]
)
router.include_router(
    files.router, 
    prefix="/{project_id}/files",
    tags=["project-files"]
)
router.include_router(
    artifacts.router, 
    prefix="/{project_id}/artifacts", 
    tags=["project-artifacts"]
)

# Core project operations (include after child routes)
router.include_router(projects.router, tags=["projects"])
