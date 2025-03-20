"""
project_routes.py
-----------------
Enhanced project routes with UUIDs, token tracking, and advanced features.
Using consolidated auth and database utilities.
"""

import logging
from uuid import UUID
from typing import Optional, List, Dict
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from pydantic import BaseModel, Field
from schemas.project_schemas import (
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
    ArtifactCreate,
    ArtifactResponse
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import update, and_
from models.artifact import Artifact

from db import get_async_session
from models.user import User
from models.project import Project
from models.project_file import ProjectFile
from utils.auth_deps import (
    get_current_user_and_token, 
    validate_resource_ownership,
    verify_project_access,
    process_standard_response
)
from utils.context import get_by_id, get_all_by_condition, save_model, create_response

logger = logging.getLogger(__name__)
router = APIRouter()

# -----------------------------
# Project Routes
# -----------------------------
@router.post("", response_model=Dict, status_code=status.HTTP_201_CREATED)
async def create_project(
    project_data: ProjectCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Create new project with Azure Cognitive Search integration"""
    try:
        # Create project using db utility
        project = Project(
            **project_data.dict(),
            user_id=current_user.id,
        )
        await save_model(db, project)
        logger.info(f"Project created successfully: {project.id} for user {current_user.id}")
        
        # Serialize project for response
        serialized_project = {
            "id": str(project.id),
            "name": project.name,
            "description": project.description,
            "goals": project.goals,
            "custom_instructions": project.custom_instructions,
            "token_usage": project.token_usage,
            "max_tokens": project.max_tokens,
            "version": project.version,
            "archived": project.archived,
            "pinned": project.pinned,
            "is_default": project.is_default,
            "user_id": project.user_id,
            "created_at": project.created_at,
            "updated_at": project.updated_at,
            "knowledge_base_id": str(project.knowledge_base_id) if project.knowledge_base_id else None,
            "extra_data": project.extra_data
        }
        
        return await process_standard_response(serialized_project, "Project created successfully")
        
    except Exception as e:
        logger.error(f"Project creation failed: {str(e)}")
        raise HTTPException(500, "Project creation failed")
        raise HTTPException(500, "Project creation failed")

@router.get("", response_model=Dict)
async def list_projects(
    archived: Optional[bool] = None,
    pinned: Optional[bool] = None,
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    # Create conditions list based on filters
    conditions = [Project.user_id == current_user.id]
    if archived is not None:
        conditions.append(Project.archived == archived)
    if pinned is not None:
        conditions.append(Project.pinned == pinned)
    
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
    serialized_projects = []
    for project in projects:
        serialized_projects.append({
            "id": str(project.id),
            "name": project.name,
            "description": project.description,
            "goals": project.goals,
            "custom_instructions": project.custom_instructions,
            "token_usage": project.token_usage,
            "max_tokens": project.max_tokens,
            "version": project.version,
            "archived": project.archived,
            "pinned": project.pinned,
            "is_default": project.is_default,
            "user_id": project.user_id,
            "created_at": project.created_at.isoformat() if project.created_at else None,
            "updated_at": project.updated_at.isoformat() if project.updated_at else None,
            "knowledge_base_id": str(project.knowledge_base_id) if project.knowledge_base_id else None,
            "extra_data": project.extra_data
        })
    
    # Return standardized response format
    return await process_standard_response(serialized_projects)


@router.get("/{project_id}", response_model=Dict)
async def get_project(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Retrieves details for a single project. Must belong to the user.
    """
    # Use the enhanced validation function
    project = await validate_resource_ownership(
        project_id,
        Project,
        current_user,
        db,
        "Project",
        [Project.user_id == current_user.id]
    )
    
    # Serialize project to dict for JSON response
    serialized_project = {
        "id": str(project.id),
        "name": project.name,
        "description": project.description,
        "goals": project.goals,
        "custom_instructions": project.custom_instructions,
        "token_usage": project.token_usage,
        "max_tokens": project.max_tokens,
        "version": project.version,
        "archived": project.archived,
        "pinned": project.pinned,
        "is_default": project.is_default,
        "user_id": project.user_id,
        "created_at": project.created_at.isoformat() if project.created_at else None,
        "updated_at": project.updated_at.isoformat() if project.updated_at else None,
        "knowledge_base_id": str(project.knowledge_base_id) if project.knowledge_base_id else None,
        "extra_data": project.extra_data
    }
    
    return await process_standard_response(serialized_project)


@router.patch("/{project_id}", response_model=Dict)
async def update_project(
    project_id: UUID,
    update_data: ProjectUpdate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    # Verify project ownership
    project = await verify_project_access(project_id, current_user, db)
    
    update_dict = update_data.dict(exclude_unset=True)
    if 'max_tokens' in update_dict and update_dict['max_tokens'] < project.token_usage:
        raise HTTPException(400, "New token limit below current usage")
    
    for key, value in update_dict.items():
        setattr(project, key, value)
    
    await save_model(db, project)
    
    # Serialize project for response
    serialized_project = {
        "id": str(project.id),
        "name": project.name,
        "description": project.description,
        "goals": project.goals,
        "custom_instructions": project.custom_instructions,
        "token_usage": project.token_usage,
        "max_tokens": project.max_tokens,
        "version": project.version,
        "archived": project.archived,
        "pinned": project.pinned,
        "is_default": project.is_default,
        "user_id": project.user_id,
        "created_at": project.created_at.isoformat() if project.created_at else None,
        "updated_at": project.updated_at.isoformat() if project.updated_at else None,
        "knowledge_base_id": str(project.knowledge_base_id) if project.knowledge_base_id else None,
        "extra_data": project.extra_data
    }
    
    return await process_standard_response(serialized_project)


@router.patch("/{project_id}/archive")
async def toggle_archive_project(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    project = await verify_project_access(project_id, current_user, db)
    
    # Toggle archived status
    project.archived = not project.archived
    
    # If archiving, also remove pin
    if project.archived and project.pinned:
        project.pinned = False
        
    await save_model(db, project)
    
    # Serialize project for response
    serialized_project = {
        "id": str(project.id),
        "name": project.name,
        "description": project.description,
        "goals": project.goals,
        "custom_instructions": project.custom_instructions,
        "token_usage": project.token_usage,
        "max_tokens": project.max_tokens,
        "version": project.version,
        "archived": project.archived,
        "pinned": project.pinned,
        "is_default": project.is_default,
        "user_id": project.user_id,
        "created_at": project.created_at.isoformat() if project.created_at else None,
        "updated_at": project.updated_at.isoformat() if project.updated_at else None,
        "knowledge_base_id": str(project.knowledge_base_id) if project.knowledge_base_id else None,
        "extra_data": project.extra_data
    }
    
    return await process_standard_response(
        serialized_project, 
        message=f"Project {'archived' if project.archived else 'unarchived'} successfully"
    )

@router.post("/{project_id}/artifacts", response_model=ArtifactResponse, status_code=status.HTTP_201_CREATED)
async def create_artifact(
    project_id: UUID,
    artifact_data: ArtifactCreate,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Create a new artifact for the project
    """
    # Verify project access first
    project = await verify_project_access(project_id, current_user, db)
    
    # Create the artifact
    new_artifact = Artifact(
        project_id=project_id,
        conversation_id=artifact_data.conversation_id,
        name=artifact_data.name,
        content_type=artifact_data.content_type,
        content=artifact_data.content
    )
    
    await save_model(db, new_artifact)
    
    # Serialize artifact for response
    serialized_artifact = {
        "id": str(new_artifact.id),
        "project_id": str(new_artifact.project_id),
        "conversation_id": str(new_artifact.conversation_id) if new_artifact.conversation_id else None,
        "name": new_artifact.name,
        "content_type": new_artifact.content_type,
        "content": new_artifact.content,
        "created_at": new_artifact.created_at.isoformat() if new_artifact.created_at else None
    }
    
    return await process_standard_response(serialized_artifact, "Artifact created successfully")

@router.get("/{project_id}/artifacts", response_model=dict)
async def list_artifacts(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    List all artifacts for a project
    """
    # Verify project access
    await verify_project_access(project_id, current_user, db)
    
    # Get artifacts using enhanced db utility
    artifacts = await get_all_by_condition(
        db,
        Artifact,
        Artifact.project_id == project_id,
        order_by=Artifact.created_at.desc()
    )
    
    return await process_standard_response({
        "artifacts": [
            {
                "id": str(a.id),
                "name": a.name,
                "content_type": a.content_type,
                "created_at": a.created_at
            }
            for a in artifacts
        ]
    })

@router.get("/{project_id}/conversations", response_model=dict)
async def get_project_conversations(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """Get conversations for a project"""
    await verify_project_access(project_id, current_user, db)
    from models.conversation import Conversation
    conversations = await get_all_by_condition(
        db,
        Conversation,
        Conversation.project_id == project_id,
        Conversation.is_deleted.is_(False),
        order_by=Conversation.created_at.desc()
    )
    return await process_standard_response([{
        "id": str(c.id),
        "title": c.title,
        "created_at": c.created_at
    } for c in conversations])

@router.get("/{project_id}/stats", response_model=dict)
async def get_project_stats(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Get statistics for a project including token usage, file count, etc.
    """
    project = await verify_project_access(project_id, current_user, db)
    
    from models.conversation import Conversation
    from models.project_file import ProjectFile
    from models.artifact import Artifact
    from sqlalchemy import func
    
    # Get conversation count using db utility
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
    
    usage_percentage = (project.token_usage / project.max_tokens) * 100 if project.max_tokens > 0 else 0
    
    logger.info(f"Returning stats for project {project_id}: {conversation_count} conversations, {file_count} files")
    return await process_standard_response({
        "token_usage": project.token_usage,
        "max_tokens": project.max_tokens,
        "usage_percentage": usage_percentage,
        "conversation_count": conversation_count,
        "file_count": file_count,
        "total_file_size": total_file_size,
        "artifact_count": artifact_count
    })

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
   project = await verify_project_access(project_id, current_user, db)
   
   if project.archived and not project.pinned:
       raise HTTPException(status_code=400, detail="Cannot pin an archived project")

   project.pinned = not project.pinned
   await save_model(db, project)
   
   # Serialize project for response
   serialized_project = {
       "id": str(project.id),
       "name": project.name,
       "description": project.description or "",
       "goals": project.goals or "",
       "custom_instructions": project.custom_instructions or "",
       "token_usage": project.token_usage,
       "max_tokens": project.max_tokens,
       "version": project.version,
       "archived": project.archived,
       "pinned": project.pinned,
       "is_default": project.is_default,
       "user_id": project.user_id,
       "created_at": project.created_at.isoformat(),
       "updated_at": project.updated_at.isoformat(),
       "knowledge_base_id": str(project.knowledge_base_id) if project.knowledge_base_id else None,
       "extra_data": project.extra_data or {}
   }
   
   return await process_standard_response(
       serialized_project,
       message=f"Project {'pinned' if project.pinned else 'unpinned'} successfully"
   )

@router.get("/{project_id}/artifacts/{artifact_id}", response_model=ArtifactResponse)
async def get_artifact(
   project_id: UUID,
   artifact_id: UUID,
   current_user: User = Depends(get_current_user_and_token),
   db: AsyncSession = Depends(get_async_session)
):
   """
   Get a specific artifact by ID
   """
   # Use validate_resource_ownership to check both project and artifact access
   artifact = await validate_resource_ownership(
       artifact_id,
       Artifact,
       current_user,
       db,
       "Artifact",
       [Artifact.project_id == project_id]
   )

   # Serialize artifact for response
   serialized_artifact = {
       "id": str(artifact.id),
       "project_id": str(artifact.project_id),
       "conversation_id": str(artifact.conversation_id) if artifact.conversation_id else None,
       "name": artifact.name,
       "content_type": artifact.content_type,
       "content": artifact.content,
       "created_at": artifact.created_at.isoformat() if artifact.created_at else None
   }
   
   return await process_standard_response(serialized_artifact)

@router.delete("/{project_id}/artifacts/{artifact_id}", response_model=dict)
async def delete_artifact(
   project_id: UUID,
   artifact_id: UUID,
   current_user: User = Depends(get_current_user_and_token),
   db: AsyncSession = Depends(get_async_session)
):
   """
   Delete an artifact by ID
   """
   # Validate project access
   await verify_project_access(project_id, current_user, db)
   
   # Get the artifact
   artifact = await validate_resource_ownership(
       artifact_id,
       Artifact,
       current_user,
       db,
       "Artifact",
       [Artifact.project_id == project_id]
   )

   # Delete the artifact
   await db.delete(artifact)
   await db.commit()
   
   return await process_standard_response(
       {"artifact_id": str(artifact_id)},
       message="Artifact deleted successfully"
   )

# -----------------------------
# Project Files Routes
# -----------------------------
from fastapi import UploadFile, Form, File
from models.project_file import ProjectFile
import os
import uuid
import shutil
from services.file_storage import save_file_to_storage, delete_file_from_storage

@router.get("/{project_id}/files", response_model=dict)
async def list_project_files(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Returns a list of files for a project.
    """
    # Verify project access
    await verify_project_access(project_id, current_user, db)
    
    # Get files using enhanced db utility
    project_files = await get_all_by_condition(
        db,
        ProjectFile,
        ProjectFile.project_id == project_id,
        order_by=ProjectFile.created_at.desc()
    )
    
    return await process_standard_response({
        "files": [
            {
                "id": str(file.id),
                "filename": file.filename,
                "file_type": file.file_type,
                "file_size": file.file_size,
                "created_at": file.created_at.isoformat() if file.created_at else None
            }
            for file in project_files
        ]
    })

@router.post("/{project_id}/files", response_model=dict, status_code=status.HTTP_201_CREATED)
async def upload_project_file(
    project_id: UUID,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Upload a file to a project
    """
    # Verify project access
    project = await verify_project_access(project_id, current_user, db)
    
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    
    # Read file content and get size
    file_content = await file.read()
    file_size = len(file_content)
    
    # Get file extension
    file_ext = os.path.splitext(file.filename)[1].lower().lstrip('.')
    if not file_ext:
        file_ext = "bin"  # Default extension if none found
    
    # Save file to storage (in a real implementation, this would save to S3 or Azure Blob)
    try:
        # Generate a unique filename to avoid collisions
        unique_filename = f"{uuid.uuid4().hex}_{file.filename}"
        file_path = f"project_files/{project_id}/{unique_filename}"
        
        # Create project_file record
        new_file = ProjectFile(
            project_id=project_id,
            filename=file.filename,
            file_path=file_path,
            file_size=file_size,
            file_type=file_ext
        )
        
        # If it's a text file under 1MB, store content inline
        if file_ext in ["txt", "md", "csv", "json"] and file_size < 1_000_000:
            try:
                new_file.content = file_content.decode('utf-8')
            except UnicodeDecodeError:
                pass  # Not UTF-8 text, skip inline storage
                
        # Save the file to actual storage
        os.makedirs(os.path.dirname(f"./uploads/{file_path}"), exist_ok=True)
        with open(f"./uploads/{file_path}", "wb") as f:
            # Reset file pointer to beginning
            await file.seek(0)
            # Copy file content to disk
            shutil.copyfileobj(file.file, f)
            
        # Save file record to database
        await save_model(db, new_file)
        
        return await process_standard_response({
            "id": str(new_file.id),
            "filename": new_file.filename,
            "file_type": new_file.file_type,
            "file_size": new_file.file_size,
            "created_at": new_file.created_at.isoformat() if new_file.created_at else None
        }, "File uploaded successfully")
    except Exception as e:
        logger.error(f"Error uploading file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to upload file: {str(e)}")

@router.get("/{project_id}/files/{file_id}", response_model=dict)
async def get_project_file(
    project_id: UUID,
    file_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Get file details and content
    """
    # Verify project access
    await verify_project_access(project_id, current_user, db)
    
    # Get the file
    project_file = await validate_resource_ownership(
        file_id,
        ProjectFile,
        current_user,
        db,
        "File",
        [ProjectFile.project_id == project_id]
    )
    
    # If the file has inline content, return it directly
    if project_file.content:
        return await process_standard_response({
            "id": str(project_file.id),
            "filename": project_file.filename,
            "file_type": project_file.file_type,
            "file_size": project_file.file_size,
            "content": project_file.content,
            "created_at": project_file.created_at.isoformat() if project_file.created_at else None
        })
    
    # Otherwise, check if the file exists in storage
    file_path = f"./uploads/{project_file.file_path}"
    if not os.path.exists(file_path):
        return await process_standard_response({
            "id": str(project_file.id),
            "filename": project_file.filename,
            "file_type": project_file.file_type,
            "file_size": project_file.file_size,
            "content": None,
            "created_at": project_file.created_at.isoformat() if project_file.created_at else None,
            "error": "File content not available"
        })
    
    # Read the file content if it's a text file and not too large
    if project_file.file_type in ["txt", "md", "csv", "json"] and project_file.file_size < 1_000_000:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()
            return await process_standard_response({
                "id": str(project_file.id),
                "filename": project_file.filename,
                "file_type": project_file.file_type,
                "file_size": project_file.file_size,
                "content": content,
                "created_at": project_file.created_at.isoformat() if project_file.created_at else None
            })
        except Exception as e:
            logger.error(f"Error reading file: {str(e)}")
    
    # For non-text or large files, just return metadata
    return await process_standard_response({
        "id": str(project_file.id),
        "filename": project_file.filename,
        "file_type": project_file.file_type,
        "file_size": project_file.file_size,
        "content": None,
        "created_at": project_file.created_at.isoformat() if project_file.created_at else None
    })

@router.delete("/{project_id}/files/{file_id}", response_model=dict)
async def delete_project_file(
    project_id: UUID,
    file_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Delete a file from a project
    """
    # Verify project access
    await verify_project_access(project_id, current_user, db)
    
    # Get the file
    project_file = await validate_resource_ownership(
        file_id,
        ProjectFile,
        current_user,
        db,
        "File",
        [ProjectFile.project_id == project_id]
    )
    
    # Try to delete the actual file from storage
    try:
        file_path = f"./uploads/{project_file.file_path}"
        if os.path.exists(file_path):
            os.remove(file_path)
    except Exception as e:
        logger.error(f"Error deleting file from storage: {str(e)}")
        # Continue with deletion even if physical file removal fails
    
    # Delete the file record
    await db.delete(project_file)
    await db.commit()
    
    return await process_standard_response(
        {"file_id": str(file_id)},
        message="File deleted successfully"
    )
