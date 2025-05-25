"""
artifact_service.py
------------------
Service for managing project artifacts (generated content like code snippets, documents, visuals)
with advanced organization, filtering, and export capabilities.
"""

import logging
import base64
from typing import Any, List, Optional
from uuid import UUID
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import and_, or_, func, select
from models.artifact import Artifact
from models.user import User

from services.project_service import validate_project_access, validate_resource_access

logger = logging.getLogger(__name__)

# Artifact content types
ARTIFACT_TYPES = {
    "code": [
        "python",
        "javascript",
        "typescript",
        "html",
        "css",
        "sql",
        "java",
        "cpp",
        "csharp",
        "go",
        "rust",
        "shell",
    ],
    "document": ["text", "markdown", "json", "yaml", "xml"],
    "image": ["png", "jpeg", "svg"],
    "chart": ["bar", "line", "pie", "scatter"],
    "table": ["data_table", "matrix"],
}


def validate_artifact_type(content_type: str) -> str:
    """
    Validates and standardizes the artifact content type.
    Returns the standardized type or raises an exception.
    """
    # Check for main types
    if content_type in ARTIFACT_TYPES:
        return content_type

    # Check for subtypes
    for main_type, subtypes in ARTIFACT_TYPES.items():
        if content_type in subtypes:
            return main_type

    # If not found, default to the provided type
    return content_type


async def create_artifact(
    db: AsyncSession,
    project_id: UUID,
    name: str,
    content_type: str,
    content: str,
    conversation_id: Optional[UUID] = None,
    metadata: Optional[dict[str, Any]] = None,
    user_id: Optional[int] = None,
) -> Artifact:
    """
    Create a new artifact for a project.

    Args:
        project_id: UUID of the project
        name: Name of the artifact
        content_type: Type of content (code, document, etc.)
        content: The actual content text
        conversation_id: Optional UUID of the related conversation
        metadata: Optional additional metadata
        user_id: Optional user ID for permission checks
        db: SQLAlchemy async session

    Returns:
        Created Artifact object
    """
    # ----- canonical access check -------------------------------------
    user = await db.get(User, user_id) if user_id is not None else None
    project = await validate_project_access(
        project_id=project_id,
        user=user,
        db=db,
        skip_ownership_check=user is None,
    )

    # Standardize content type
    standardized_type = validate_artifact_type(content_type)

    # Create metadata if not provided
    if metadata is None:
        metadata = {}

    # Add content stats to metadata
    char_count = len(content)
    line_count = content.count("\n") + 1

    metadata.update(
        {
            "char_count": char_count,
            "line_count": line_count,
            "created_from_conversation": conversation_id is not None,
        }
    )

    # Create artifact
    new_artifact = Artifact(
        project_id=project_id,
        conversation_id=conversation_id,
        name=name,
        content_type=standardized_type,
        content=content,
        metadata=metadata,
    )

    db.add(new_artifact)
    await db.commit()
    await db.refresh(new_artifact)

    return new_artifact


async def get_artifact(
    db: AsyncSession, artifact_id: UUID, project_id: UUID, user_id: Optional[int] = None
) -> Artifact:
    user = await db.get(User, user_id) if user_id is not None else None
    artifact = await validate_resource_access(
        resource_id=artifact_id,
        model_class=Artifact,
        user=user,
        db=db,
        resource_name="Artifact",
        additional_filters=[Artifact.project_id == project_id],
        require_ownership=user is not None,
    )
    return artifact


async def list_artifacts(
    project_id: UUID,
    db: AsyncSession,
    conversation_id: Optional[UUID] = None,
    content_type: Optional[str] = None,
    search_term: Optional[str] = None,
    sort_by: str = "created_at",
    sort_desc: bool = True,
    skip: int = 0,
    limit: int = 100,
    user_id: Optional[int] = None,
) -> List[dict[str, Any]]:
    """
    List artifacts with filtering, search, and pagination.

    Args:
        project_id: UUID of the project
        db: SQLAlchemy async session
        conversation_id: Optional filter by conversation
        content_type: Optional filter by content type
        search_term: Optional search in name and content
        sort_by: Field to sort by
        sort_desc: True for descending order
        skip: Number of items to skip
        limit: Maximum number of items to return
        user_id: Optional user ID for permission checks

    Returns:
        List of artifact dictionaries
    """
    from services.project_service import get_paginated_resources

    user = await db.get(User, user_id) if user_id is not None else None
    await validate_project_access(
        project_id=project_id,
        user=user,
        db=db,
        skip_ownership_check=user is None,
    )

    # Build additional filters
    filters = []

    if conversation_id:
        filters.append(Artifact.conversation_id == conversation_id)

    if content_type:
        if content_type in ARTIFACT_TYPES:
            # If it's a main type, include all subtypes
            subtypes = ARTIFACT_TYPES[content_type]
            filters.append(
                or_(
                    Artifact.content_type == content_type,
                    Artifact.content_type.in_(subtypes),
                )
            )
        else:
            filters.append(Artifact.content_type == content_type)

    if search_term:
        search_pattern = f"%{search_term}%"
        filters.append(
            or_(
                Artifact.name.ilike(search_pattern),
                Artifact.content.ilike(search_pattern),
            )
        )

    additional_filter = and_(*filters) if filters else None

    from utils.serializers import serialize_artifact

    # Use shared pagination function with the proper artifact serializer
    return await get_paginated_resources(
        db=db,
        model_class=Artifact,
        project_id=project_id,
        sort_by=sort_by,
        sort_desc=sort_desc,
        skip=skip,
        limit=limit,
        additional_filters=additional_filter,
        serializer_func=serialize_artifact,
    )


async def update_artifact(
    db: AsyncSession,
    artifact_id: UUID,
    project_id: UUID,
    update_data: dict[str, Any],
    user_id: Optional[int] = None,
) -> Artifact:
    """
    Update an existing artifact.

    Args:
        artifact_id: UUID of the artifact
        project_id: UUID of the project
        update_data: Dictionary with fields to update
        user_id: Optional user ID for permission checks
        db: SQLAlchemy async session

    Returns:
        Updated Artifact object
    """
    # Get artifact
    artifact = await get_artifact(db, artifact_id, project_id, user_id)

    # Update fields
    allowed_fields = ["name", "content", "metadata"]
    update_dict = {k: v for k, v in update_data.items() if k in allowed_fields}

    # If content is being updated, update metadata too
    if "content" in update_dict:
        new_content = update_dict["content"]

        # Update content stats
        char_count = len(new_content)
        line_count = new_content.count("\n") + 1

        # Get current metadata or initialize
        metadata = artifact.metadata or {}
        metadata.update(
            {
                "char_count": char_count,
                "line_count": line_count,
                "last_updated": datetime.now().isoformat(),
            }
        )

        update_dict["metadata"] = metadata

    # Apply updates
    for key, value in update_dict.items():
        setattr(artifact, key, value)

    await db.commit()
    await db.refresh(artifact)

    return artifact


async def delete_artifact(
    db: AsyncSession, artifact_id: UUID, project_id: UUID, user_id: Optional[int] = None
) -> dict[str, Any]:
    """
    Delete an artifact.

    Args:
        artifact_id: UUID of the artifact
        project_id: UUID of the project
        user_id: Optional user ID for permission checks
        db: SQLAlchemy async session

    Returns:
        Dictionary with deletion status
    """
    # Check if artifact exists and user has permission
    artifact = await get_artifact(db, artifact_id, project_id, user_id)

    # Delete the artifact
    await db.delete(artifact)
    await db.commit()

    return {
        "success": True,
        "message": "Artifact deleted successfully",
        "artifact_id": str(artifact_id),
    }


async def export_artifact(
    db: AsyncSession,
    artifact_id: UUID,
    project_id: UUID,
    export_format: str = "text",
    user_id: Optional[int] = None,
) -> dict[str, Any]:
    """
    Export an artifact in various formats.

    Args:
        artifact_id: UUID of the artifact
        project_id: UUID of the project
        export_format: Format to export (text, json, html, md, base64)
        user_id: Optional user ID for permission checks
        db: SQLAlchemy async session

    Returns:
        Dictionary with export data and format
    """
    # Get artifact
    artifact = await get_artifact(db, artifact_id, project_id, user_id)

    # Basic artifact info
    export_data = {
        "id": str(artifact.id),
        "name": artifact.name,
        "content_type": artifact.content_type,
        "created_at": artifact.created_at.isoformat(),
        "project_id": str(artifact.project_id),
        "conversation_id": (
            str(artifact.conversation_id) if artifact.conversation_id else None
        ),
    }

    # Process based on requested format
    if export_format == "json":
        # Export as JSON with metadata
        export_data["content"] = artifact.content
        export_data["metadata"] = artifact.metadata
        export_data["format"] = "json"
        return export_data

    elif export_format == "text":
        # Raw text export
        return {
            "format": "text",
            "content": artifact.content,
            "filename": f"{artifact.name.replace(' ', '_').lower()}.txt",
        }

    elif export_format == "html":
        # HTML export with formatting
        html_content = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>{artifact.name}</title>
    <style>
        body {{ font-family: sans-serif; margin: 40px; line-height: 1.6; }}
        header {{ margin-bottom: 20px; }}
        .metadata {{ color: #666; font-size: 0.9em; margin-bottom: 20px; }}
        pre {{ background-color: #f5f5f5; padding: 15px; border-radius: 5px; overflow: auto; }}
    </style>
</head>
<body>
    <header>
        <h1>{artifact.name}</h1>
        <div class="metadata">
            <p>Type: {artifact.content_type}</p>
            <p>Created: {artifact.created_at.isoformat()}</p>
        </div>
    </header>
    <pre>{artifact.content}</pre>
</body>
</html>"""

        return {
            "format": "html",
            "content": html_content,
            "filename": f"{artifact.name.replace(' ', '_').lower()}.html",
        }

    elif export_format == "markdown" or export_format == "md":
        # Markdown export
        md_content = f"""# {artifact.name}

*Type: {artifact.content_type}*
*Created: {artifact.created_at.isoformat()}*

```
{artifact.content}
```
"""

        return {
            "format": "markdown",
            "content": md_content,
            "filename": f"{artifact.name.replace(' ', '_').lower()}.md",
        }

    elif export_format == "base64":
        # Base64 encoding for binary transport
        content_bytes = artifact.content.encode("utf-8")
        base64_content = base64.b64encode(content_bytes).decode("utf-8")

        # Determine file extension based on content type
        file_extension = "txt"
        for main_type, subtypes in ARTIFACT_TYPES.items():
            if artifact.content_type == main_type or artifact.content_type in subtypes:
                if main_type == "document":
                    file_extension = "txt"
                elif main_type == "image":
                    file_extension = "png"
                elif main_type == "code":
                    file_extension = "txt"
                break

        return {
            "format": "base64",
            "content": base64_content,
            "filename": f"{artifact.name.replace(' ', '_').lower()}.{file_extension}",
        }

    else:
        # Default to text if format not recognized
        return {
            "format": "text",
            "content": artifact.content,
            "filename": f"{artifact.name.replace(' ', '_').lower()}.txt",
        }


async def get_artifact_stats(
    project_id: UUID, db: AsyncSession, user_id: Optional[int] = None
) -> dict[str, Any]:
    user = await db.get(User, user_id) if user_id is not None else None
    await validate_project_access(
        project_id=project_id,
        user=user,
        db=db,
        skip_ownership_check=user is None,
    )

    # Total artifact count
    count_query = (
        select(func.count())
        .select_from(Artifact)
        .where(Artifact.project_id == project_id)
    )
    count_result = await db.execute(count_query)
    total_count = count_result.scalar() or 0

    # Count by type
    type_query = (
        select(Artifact.content_type, func.count().label("count"))
        .where(Artifact.project_id == project_id)
        .group_by(Artifact.content_type)
    )

    type_result = await db.execute(type_query)
    type_counts = {row[0]: row[1] for row in type_result}

    # Count by conversation
    conv_query = (
        select(Artifact.conversation_id, func.count().label("count"))
        .where(Artifact.project_id == project_id, Artifact.conversation_id.isnot(None))
        .group_by(Artifact.conversation_id)
    )

    conv_result = await db.execute(conv_query)
    conv_counts = {str(row[0]): row[1] for row in conv_result}

    # Get counts by creation date (for histogram)
    date_query = (
        select(
            func.date_trunc("day", Artifact.created_at).label("day"),
            func.count().label("count"),
        )
        .where(Artifact.project_id == project_id)
        .group_by(func.date_trunc("day", Artifact.created_at))
    )

    date_result = await db.execute(date_query)
    date_counts = {row[0].isoformat(): row[1] for row in date_result}

    return {
        "total_count": total_count,
        "by_type": type_counts,
        "by_conversation": conv_counts,
        "by_date": date_counts,
    }
