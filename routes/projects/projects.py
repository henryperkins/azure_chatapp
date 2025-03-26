"""
projects.py
---------
Core project management routes with CRUD operations,
statistics, and project-level actions.
"""

import logging
from uuid import UUID
from typing import Optional, Dict
import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select

from db import get_async_session
from models.user import User
from models.project import Project
from models.conversation import Conversation
from models.project_file import ProjectFile
from models.artifact import Artifact
from utils.auth_utils import get_current_user_and_token
from services.project_service import validate_project_access
import config
from services import knowledgebase_service
from utils.db_utils import get_all_by_condition, save_model
from utils.response_utils import create_standard_response
from utils.serializers import serialize_project
from services.vector_db import get_vector_db, process_file_for_search, VECTOR_DB_STORAGE_PATH, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP
from services.file_storage import get_file_storage
from models.project_file import ProjectFile

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================
# Pydantic Schemas
# ============================

class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    goals: Optional[str] = Field(None, max_length=1000)
    description: Optional[str] = Field(None, max_length=2000)
    custom_instructions: Optional[str] = Field(None, max_length=5000)
    max_tokens: int = Field(
        default=200000,
        ge=50000,
        le=500000
    )


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    goals: Optional[str] = Field(None, max_length=1000)
    custom_instructions: Optional[str] = Field(None, max_length=5000)
    is_default: Optional[bool]
    pinned: Optional[bool]
    archived: Optional[bool]
    extra_data: Optional[dict]
    max_tokens: Optional[int] = Field(
        default=None,
        ge=50000,
        le=500000
    )


# ============================
# Project CRUD Operations
# ============================

@router.post("/", response_model=Dict, status_code=status.HTTP_201_CREATED)
async def create_project(
    project_data: ProjectCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Create new project"""
    try:
        # Create project using db utility
        project = Project(
            **project_data.dict(),
            user_id=current_user.id,
        )
        await save_model(db, project)
        logger.info(f"Project created successfully: {project.id} for user {current_user.id}")
        
        # Serialize project for response
        serialized_project = serialize_project(project)
        
        return await create_standard_response(serialized_project, "Project created successfully")
        
    except Exception as e:
        logger.error(f"Project creation failed: {str(e)}")
        raise HTTPException(500, "Project creation failed")


@router.get("/", response_model=Dict)
async def list_projects(
    filter: Optional[str] = None, 
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """List all projects owned by the current user with optional filtering"""
    conditions = [Project.user_id == current_user.id]
    
    # Handle filter parameter from UI
    if filter == "pinned":
        conditions.append(Project.pinned == True)
        conditions.append(Project.archived == False)
    elif filter == "archived":
        conditions.append(Project.archived == True)
    elif filter == "active":
        conditions.append(Project.archived == False)
    # 'all' filter shows everything
    
    # Use consolidated function for database query
    projects = await get_all_by_condition(
        db,
        Project,
        *conditions,
        limit=limit,
        offset=skip,
        order_by=Project.created_at.desc()
    )
    
    # Log the projects being returned
    logger.info(f"Retrieved {len(projects)} projects for user {current_user.id}")
    
    # Serialize projects to dict for JSON response
    serialized_projects = [serialize_project(project) for project in projects]
    
    # Return standardized response format
    return await create_standard_response({
        "projects": serialized_projects,
        "count": len(serialized_projects),
        "filter": {
            "type": filter or "all",
            "applied": {
                "archived": filter == "archived",
                "pinned": filter == "pinned"
            }
        }
    })


@router.get("/{project_id}/", response_model=Dict)
async def get_project(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Retrieves details for a single project. Must belong to the user.
    """
    # Use the enhanced validation function
    project = await validate_project_access(
        project_id,
        current_user,
        db
    )

    # Serialize project to dict for JSON response
    serialized_project = serialize_project(project)
    
    return await create_standard_response(serialized_project)


@router.patch("/{project_id}/", response_model=Dict)
async def update_project(
    project_id: UUID,
    update_data: ProjectUpdate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Update project details"""
    # Verify project ownership
    project = await validate_project_access(
        project_id,
        current_user,
        db
    )

    update_dict = update_data.dict(exclude_unset=True)
    if 'max_tokens' in update_dict and update_dict['max_tokens'] < project.token_usage:
        raise HTTPException(400, "New token limit below current usage")
    
    for key, value in update_dict.items():
        setattr(project, key, value)
    
    await save_model(db, project)
    
    # Serialize project for response
    serialized_project = serialize_project(project)
    
    return await create_standard_response(serialized_project, "Project updated successfully")


@router.delete("/{project_id}/", response_model=Dict)
async def delete_project(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Delete a project and all associated resources"""
    # Verify project ownership
    project = await validate_project_access(
        project_id,
        current_user,
        db
    )

    # Delete the project and rely on CASCADE for related resources
    await db.delete(project)
    await db.commit()
    
    return await create_standard_response(
        {"id": str(project_id)},
        "Project and all associated resources deleted successfully"
    )


# ============================
# Project Actions
# ============================

@router.patch("/{project_id}/archive")
async def toggle_archive_project(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Toggle archive status of a project.
    Cannot have pinned and archived simultaneously.
    """
    project = await validate_project_access(
        project_id,
        current_user,
        db
    )

    # Toggle archived status
    project.archived = not project.archived
    
    # If archiving, also remove pin
    if project.archived and project.pinned:
        project.pinned = False
        
    await save_model(db, project)
    
    return await create_standard_response(
        serialize_project(project), 
        message=f"Project {'archived' if project.archived else 'unarchived'} successfully"
    )


@router.post("/{project_id}/pin")
async def toggle_pin_project(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Pin or unpin a project for quick access.
    Cannot pin archived projects.
    """
    project = await validate_project_access(
        project_id,
        current_user,
        db
    )

    if project.archived and not project.pinned:
        raise HTTPException(status_code=400, detail="Cannot pin an archived project")

    project.pinned = not project.pinned
    await save_model(db, project)
    
    return await create_standard_response(
        serialize_project(project),
        message=f"Project {'pinned' if project.pinned else 'unpinned'} successfully"
    )


@router.get("/{project_id}/stats", response_model=dict)
async def get_project_stats(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Get statistics for a project including token usage, file count, and knowledge base info.
    """
    project = await validate_project_access(
        project_id,
        current_user,
        db
    )

    # Get conversation count
    conversations = await get_all_by_condition(
        db,
        Conversation,
        Conversation.project_id == project_id,
        Conversation.is_deleted.is_(False)
    )
    conversation_count = len(conversations)
    
    # Get file count and size
    files_result = await db.execute(
        select(func.count(), func.sum(ProjectFile.file_size)).where(ProjectFile.project_id == project_id)
    )
    file_count, total_file_size = files_result.first()
    file_count = file_count or 0
    total_file_size = total_file_size or 0
    
    # Get artifact count
    artifacts = await get_all_by_condition(
        db,
        Artifact,
        Artifact.project_id == project_id
    )
    artifact_count = len(artifacts)
    
    # Get knowledge base information
    knowledge_base_info = None
    if project.knowledge_base_id:
        try:
            # Get processed files count
            indexed_files_query = select(func.count()).where(
                ProjectFile.project_id == project_id,
                ProjectFile.metadata.has_key("search_processing"),
                ProjectFile.metadata["search_processing"]["success"].astext == "true"
            )
            indexed_result = await db.execute(indexed_files_query)
            indexed_files_count = indexed_result.scalar() or 0
            
            knowledge_base_info = {
                "id": str(project.knowledge_base_id),
                "name": project.knowledge_base.name if project.knowledge_base else None,
                "embedding_model": project.knowledge_base.embedding_model if project.knowledge_base else None,
                "is_active": project.knowledge_base.is_active if project.knowledge_base else False,
                "indexed_files": indexed_files_count,
                "pending_files": file_count - indexed_files_count
            }
        except Exception as e:
            logger.error(f"Error getting knowledge base info: {str(e)}")
            knowledge_base_info = {
                "id": str(project.knowledge_base_id),
                "error": "Could not retrieve full knowledge base information"
            }
    
    usage_percentage = (project.token_usage / project.max_tokens) * 100 if project.max_tokens > 0 else 0
    
    logger.info(f"Returning stats for project {project_id}: {conversation_count} conversations, {file_count} files")
    return await create_standard_response({
        "token_usage": project.token_usage,
        "max_tokens": project.max_tokens,
        "usage_percentage": usage_percentage,
        "conversation_count": conversation_count,
        "file_count": file_count,
        "total_file_size": total_file_size,
        "artifact_count": artifact_count,
        "knowledge_base": knowledge_base_info
    })

class KnowledgeBaseCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    embedding_model: Optional[str] = Field(None, description="Embedding model to use")
    process_existing_files: bool = Field(True, description="Process existing files for search")

@router.post("/{project_id}/knowledge-base", response_model=Dict)
async def create_project_knowledge_base(
    project_id: UUID,
    kb_data: KnowledgeBaseCreateRequest,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Create a knowledge base for a specific project and optionally process existing files."""
    # Validate project access
    project = await validate_project_access(project_id, current_user, db)
    
    # Check if project already has a knowledge base
    if project.knowledge_base_id:
        raise HTTPException(
            status_code=400, 
            detail="Project already has an associated knowledge base"
        )
    
    try:
        # Create knowledge base
        kb = await knowledgebase_service.create_knowledge_base(
            name=kb_data.name,
            description=kb_data.description,
            embedding_model=kb_data.embedding_model,
            db=db
        )
        
        # Associate with project
        project.knowledge_base_id = kb.id
        await db.commit()
        
        # Process existing files if requested
        processed_files = 0
        if kb_data.process_existing_files:
            # Get files
            files = await knowledgebase_service.list_project_files(project_id, db)
            for file in files.get("files", []):
                try:
                    # Get file record
                    file_query = select(ProjectFile).where(
                        ProjectFile.id == UUID(file["id"]),
                        ProjectFile.project_id == project_id
                    )
                    file_result = await db.execute(file_query)
                    file_record = file_result.scalars().first()
                    
                    if file_record:
                        # Process file for search
                        vector_db = await get_vector_db(
                            model_name=kb.embedding_model,
                            storage_path=os.path.join(
                                VECTOR_DB_STORAGE_PATH, 
                                str(project_id)
                            ),
                            load_existing=True
                        )
                        
                        # Get file content
                        storage_config = {
                            "storage_type": getattr(config, "FILE_STORAGE_TYPE", "local"),
                            "local_path": getattr(config, "LOCAL_UPLOADS_DIR", "./uploads")
                        }
                        storage = get_file_storage(storage_config)
                        file_content = await storage.get_file(file_record.file_path)
                        
                        # Process the file
                        await process_file_for_search(
                            project_file=file_record,
                            vector_db=vector_db,
                            file_content=file_content,
                            chunk_size=DEFAULT_CHUNK_SIZE,
                            chunk_overlap=DEFAULT_CHUNK_OVERLAP
                        )
                        processed_files += 1
                        
                except Exception as e:
                    logger.error(f"Error processing file {file['id']}: {str(e)}")
        
        return await create_standard_response({
            "knowledge_base_id": str(kb.id),
            "name": kb.name,
            "project_id": str(project_id),
            "processed_files": processed_files,
            "total_files": len(files.get("files", [])) if kb_data.process_existing_files else 0
        }, "Knowledge base created and associated with project successfully")
    
    except Exception as e:
        logger.error(f"Error creating knowledge base for project: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create knowledge base: {str(e)}"
        )
