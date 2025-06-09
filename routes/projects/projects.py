"""
routes/projects/projects.py
--------------------------
Minimal placeholder aggregator for project-related routes.

Historically `main.py` imported `router` from this module.  The original file
was accidentally truncated, breaking app start-up.  We restore it here with a
*no-op* router so existing imports succeed while Phase-3 backend refactor work
decides whether to keep a dedicated aggregator or rely on explicit includes.

For now we do **NOT** `include_router()` any sub-routers to avoid duplicate
path registrations (they are already included individually in *main.py*).
"""

from fastapi import APIRouter

# Empty APIRouter – acts only as import placeholder.
router = APIRouter(prefix="/projects", tags=["Projects"])
