"""
serializers.py
-------------
Provides standardized functions for serializing database models to dictionaries.
Ensures consistent response formats across endpoints.
"""
from datetime import datetime
from typing import Dict, Any, Optional, List, Union
from uuid import UUID

from models.project import Project
from models.conversation import Conversation
from models.message import Message
from models.artifact import Artifact
from models.project_file import ProjectFile


def serialize_datetime(dt: Optional[datetime]) -> Optional[str]:
    """Convert datetime to ISO format string if not None"""
    if dt is not None:
        return dt.isoformat()
    return None


def serialize_uuid(id_value: Optional[UUID]) -> Optional[str]:
    """Convert UUID to string if not None"""
    if id_value is not None:
        return str(id_value)
    return None


def serialize_project(project: Project) -> Dict[str, Any]:
    """
    Serialize a Project model to a dictionary.
    
    Args:
        project: Project database model
        
    Returns:
        Dictionary with serialized project data
    """
    return {
        "id": serialize_uuid(project.id),
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
        "created_at": serialize_datetime(project.created_at),
        "updated_at": serialize_datetime(project.updated_at),
        "knowledge_base_id": serialize_uuid(project.knowledge_base_id),
        "extra_data": project.extra_data or {}
    }


def serialize_conversation(conversation: Conversation) -> Dict[str, Any]:
    """
    Serialize a Conversation model to a dictionary.
    
    Args:
        conversation: Conversation database model
        
    Returns:
        Dictionary with serialized conversation data
    """
    return {
        "id": serialize_uuid(conversation.id),
        "title": conversation.title,
        "model_id": conversation.model_id,
        "project_id": serialize_uuid(conversation.project_id),
        "created_at": serialize_datetime(conversation.created_at),
        "updated_at": serialize_datetime(conversation.updated_at),
        "is_deleted": conversation.is_deleted,
        "extra_data": conversation.extra_data or {}
    }


def serialize_message(message: Message) -> Dict[str, Any]:
    """
    Serialize a Message model to a dictionary.
    
    Args:
        message: Message database model
        
    Returns:
        Dictionary with serialized message data
    """
    return {
        "id": serialize_uuid(message.id),
        "conversation_id": serialize_uuid(message.conversation_id),
        "role": message.role,
        "content": message.content,
        "metadata": message.get_metadata_dict(),
        "created_at": serialize_datetime(message.created_at),
        "updated_at": serialize_datetime(message.updated_at)
    }


def serialize_artifact(artifact: Artifact, include_content: bool = True) -> Dict[str, Any]:
    """
    Serialize an Artifact model to a dictionary.
    
    Args:
        artifact: Artifact database model
        include_content: Whether to include the full content
        
    Returns:
        Dictionary with serialized artifact data
    """
    result = {
        "id": serialize_uuid(artifact.id),
        "project_id": serialize_uuid(artifact.project_id),
        "conversation_id": serialize_uuid(artifact.conversation_id),
        "name": artifact.name,
        "content_type": artifact.content_type,
        "created_at": serialize_datetime(artifact.created_at),
        "updated_at": serialize_datetime(artifact.updated_at),
        "extra_data": artifact.extra_data
    }
    
    if include_content:
        result["content"] = artifact.content
    else:
        # Include a preview instead
        result["content_preview"] = (
            artifact.content[:150] + "..." if artifact.content and len(artifact.content) > 150 
            else artifact.content
        )
    
    return result


def serialize_project_file(file: ProjectFile, include_content: bool = False) -> Dict[str, Any]:
    """
    Serialize a ProjectFile model to a dictionary.
    
    Args:
        file: ProjectFile database model
        include_content: Whether to include the content
        
    Returns:
        Dictionary with serialized file data
    """
    result = {
        "id": serialize_uuid(file.id),
        "project_id": serialize_uuid(file.project_id),
        "filename": file.filename,
        "file_path": file.file_path,
        "file_size": file.file_size,
        "file_type": file.file_type,
        "created_at": serialize_datetime(file.created_at),
        "updated_at": serialize_datetime(file.updated_at),
        "extra_data": file.extra_data
    }
    
    if include_content and file.content:
        result["content"] = file.content
    
    return result


def serialize_list(items: List[Any], serializer_func, **kwargs) -> List[Dict[str, Any]]:
    """
    Serialize a list of items using the provided serializer function.
    
    Args:
        items: List of database models
        serializer_func: Function to serialize each item
        **kwargs: Additional arguments to pass to the serializer
        
    Returns:
        List of serialized dictionaries
    """
    return [serializer_func(item, **kwargs) for item in items]
