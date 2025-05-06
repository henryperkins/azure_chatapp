"""
serializers.py
-------------
Provides standardized functions for serializing database models to dictionaries.
Ensures consistent response formats across endpoints.
"""

from datetime import datetime
from typing import Any, Optional, List, Sequence, Union

from models.project import Project
from models.conversation import Conversation
from models.message import Message
from models.artifact import Artifact
from models.project_file import ProjectFile
from models.knowledge_base import KnowledgeBase


def serialize_datetime(dt: Optional[Union[datetime, str]]) -> Optional[str]:
    """Convert datetime or ISO string to ISO format string"""
    if dt is None:
        return None

    if isinstance(dt, str):
        # If already ISO formatted, return as-is
        if "T" in dt and dt.endswith(("Z", "+00:00")):
            return dt
        # Try parsing if it's a non-ISO string
        try:
            dt = datetime.fromisoformat(dt)
        except ValueError:
            return dt  # Return raw string if formatting fails

    try:
        return dt.isoformat()
    except AttributeError:
        return str(dt)  # Fallback to string conversion


def serialize_uuid(id_value: Any) -> Optional[str]:
    """Convert UUID to string if not None"""
    if id_value is not None:
        return str(id_value)
    return None


def serialize_project(project: Project) -> dict[str, Any]:
    """
    Serialize a Project model to a dictionary.

    Args:
        project: Project database model

    Returns:
        Dictionary with serialized project data
    """
    # Project model no longer guarantees a `knowledge_base_id` attribute.
    # Gracefully handle its absence to avoid serialization failures that
    # bubble up as HTTP 500 errors in the `/api/projects` endpoint.
    kb_id = getattr(project, "knowledge_base_id", None)

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
        "knowledge_base_id": serialize_uuid(kb_id),
        "extra_data": project.extra_data or {},
    }


def serialize_conversation(conversation: Conversation) -> dict[str, Any]:
    """
    Serialize a Conversation model or dict to a dictionary.

    Args:
        conversation: Conversation database model or dict

    Returns:
        Dictionary with serialized conversation data
    """
    conv_dict = (
        conversation if isinstance(conversation, dict) else conversation.__dict__
    )

    # Explicitly handle datetime fields
    created_at = conv_dict.get("created_at")
    updated_at = conv_dict.get("updated_at")

    return {
        "id": serialize_uuid(conv_dict.get("id")),
        "title": conv_dict.get("title"),
        "model_id": conv_dict.get("model_id"),
        "project_id": serialize_uuid(conv_dict.get("project_id")),
        "created_at": serialize_datetime(created_at),
        "updated_at": serialize_datetime(updated_at),
        "is_deleted": conv_dict.get("is_deleted", False),
        "extra_data": conv_dict.get("extra_data", {}),
    }


def serialize_message(message: Message) -> dict[str, Any]:
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
        "updated_at": serialize_datetime(message.updated_at),
    }


def serialize_artifact(
    artifact: Artifact, include_content: bool = True
) -> dict[str, Any]:
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
        "extra_data": artifact.extra_data,
    }

    if include_content:
        result["content"] = artifact.content
    else:
        # Include a preview instead
        result["content_preview"] = (
            artifact.content[:150] + "..."
            if artifact.content and len(artifact.content) > 150
            else artifact.content
        )

    return result


def serialize_project_file(
    file: ProjectFile, include_content: bool = False, include_file_path: bool = False
) -> dict[str, Any]:
    """
    Serialize a ProjectFile model to a dictionary.

    Args:
        file: ProjectFile database model
        include_content: Whether to include the content
        include_file_path: Whether to include the file path

    Returns:
        Dictionary with serialized file data
    """
    result = {
        "id": serialize_uuid(file.id),
        "project_id": serialize_uuid(file.project_id),
        "filename": file.filename,
        "file_size": file.file_size,
        "file_type": file.file_type,
        "created_at": serialize_datetime(file.created_at),
        "updated_at": serialize_datetime(file.updated_at),
        "metadata": file.metadata or {},
    }

    if include_file_path:
        result["file_path"] = file.file_path

    if include_content and file.content:
        result["content"] = file.content

    return result


def serialize_list(
    items: Sequence[Any], serializer_func, **kwargs
) -> List[dict[str, Any]]:
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


def serialize_knowledge_base(kb: "KnowledgeBase") -> dict[str, Any]:
    """
    Serialize a KnowledgeBase model to a dictionary.

    Args:
        kb: KnowledgeBase database model

    Returns:
        Dictionary with serialized knowledge base data
    """
    return {
        "id": serialize_uuid(kb.id),
        "name": kb.name,
        "description": kb.description,
        "embedding_model": kb.embedding_model,
        "is_active": kb.is_active,
        "created_at": serialize_datetime(kb.created_at),
        "updated_at": serialize_datetime(kb.updated_at),
    }


def serialize_vector_result(result: dict[str, Any]) -> dict[str, Any]:
    """
    Standardize vector search results format.

    Args:
        result: Raw vector search result dict

    Returns:
        Standardized result dictionary
    """
    return {
        "id": result.get("id", ""),
        "score": round(float(result.get("score", 0)), 4),
        "text": (result.get("text", "") or "")[:500],  # Preview
        "metadata": result.get("metadata", {}),
        "file_info": result.get("file_info", {}),
    }
