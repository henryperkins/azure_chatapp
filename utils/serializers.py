"""
serializers.py
-------------
Provides standardized functions for serializing database models to dictionaries.
Ensures consistent response formats across endpoints.
"""

from datetime import datetime, date
from typing import Any, Optional, List, Sequence, Union, Mapping
from sqlalchemy import MetaData
from uuid import UUID

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
    Serialize a Project model to a dictionary, including nested knowledge_base if present.

    Args:
        project: Project database model

    Returns:
        Dictionary with serialized project data
    """
    kb_id = getattr(project, "knowledge_base_id", None)
    kb_obj = getattr(project, "knowledge_base", None)
    knowledge_base = serialize_knowledge_base(kb_obj) if kb_obj is not None else None

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
        "knowledge_base": knowledge_base,
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
    # Instead of using __dict__, access attributes directly from the ORM object
    # This is safer and more standard for SQLAlchemy models.
    return {
        "id": serialize_uuid(conversation.id if hasattr(conversation, 'id') else None),
        "title": conversation.title if hasattr(conversation, 'title') else None,
        "model_id": conversation.model_id if hasattr(conversation, 'model_id') else None,
        "project_id": serialize_uuid(conversation.project_id if hasattr(conversation, 'project_id') else None),
        "created_at": serialize_datetime(conversation.created_at if hasattr(conversation, 'created_at') else None),
        "updated_at": serialize_datetime(conversation.updated_at if hasattr(conversation, 'updated_at') else None),
        "is_deleted": conversation.is_deleted if hasattr(conversation, 'is_deleted') else False,
        "user_id": serialize_uuid(conversation.user_id if hasattr(conversation, 'user_id') else None),
        "knowledge_base_id": serialize_uuid(conversation.knowledge_base_id if hasattr(conversation, 'knowledge_base_id') else None),
        "model_config": getattr(conversation, 'model_config', {}) or {},
        "kb_enabled": getattr(conversation, 'kb_enabled', False),
        "context_token_usage": getattr(conversation, 'context_token_usage', None),
        "extra_data": conversation.extra_data if hasattr(conversation, 'extra_data') else {},
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
        "raw_text": getattr(message, "raw_text", None),
        "formatted_text": getattr(message, "formatted_text", None),
        "token_count": getattr(message, "token_count", None),
        "content": getattr(message, "raw_text", None),  # TEMP for legacy, remove in future
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

# ------------------------------------------------------------------
# Generic helper: convert any SQLAlchemy ORM object / collection to
# plain serialisable Python primitives, skipping MetaData objects.
# ------------------------------------------------------------------
def to_serialisable(obj):  # noqa: N802  (keep snake-case for local helper)
    """Recursively convert ORM instances / collections to JSON-safe data."""
    # primitives already OK
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, (datetime, date)):
        return serialize_datetime(obj)
    if isinstance(obj, UUID):
        return serialize_uuid(obj)

    # SQLAlchemy MetaData → drop
    if isinstance(obj, MetaData):
        return None

    # list / tuple / set
    if isinstance(obj, (list, tuple, set)):
        return [to_serialisable(x) for x in obj]

    # mapping / dict
    if isinstance(obj, Mapping):
        return {k: to_serialisable(v) for k, v in obj.items()}

    # SQLAlchemy mapped instance (has __table__)
    if hasattr(obj, "__table__"):
        return {
            col.name: to_serialisable(getattr(obj, col.name))
            for col in obj.__table__.columns
        }

    # fallback – best-effort string representation
    return str(obj)
