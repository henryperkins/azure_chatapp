"""
Project routes package
---------------------
Organizes all project-related routes into a logical, hierarchical structure.
"""
from fastapi import APIRouter

from . import projects, conversations, files, artifacts

router = APIRouter()

# Core project operations
router.include_router(projects.router, tags=["projects"])

# Project-associated resources
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
