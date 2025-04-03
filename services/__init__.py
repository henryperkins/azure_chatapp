"""
Services package initialization.
This module exposes the core functionality from each service module.

Last updated: 2025-03-27
"""

# Define explicit exports based on actually existing modules and functions
__all__ = [
    # File storage
    "FileStorage", "get_file_storage", "save_file_to_storage", 
    "get_file_from_storage", "delete_file_from_storage",
    
    # Text extraction
    "TextExtractor", "get_text_extractor", "TextExtractionError",
    
    # Vector database
    "VectorDB", "get_vector_db", "process_file_for_search",
    
    # Knowledge base
    "delete_project_file", "get_project_files_stats", "search_project_context",
    "create_knowledge_base",
    
    # Project
    "validate_project_access", "get_default_project", "create_project",
    "get_project_token_usage", "validate_resource_access", 
    "get_project_conversations", "get_paginated_resources",
    
    # Artifact
    "create_artifact", "get_artifact", "list_artifacts", "update_artifact",
    "delete_artifact", "export_artifact", "get_artifact_stats",
    "validate_artifact_type",
    
    # Conversation
    "validate_model", "get_conversation_service", "ConversationService",
    
    # User
    "get_user_by_username",
]

# File storage services
from .file_storage import (
    FileStorage,
    get_file_storage,
    save_file_to_storage,
    get_file_from_storage,
    delete_file_from_storage,
)

# Text extraction services
from .text_extraction import (
    TextExtractor, 
    get_text_extractor,
    TextExtractionError,
)

# Vector database services
from .vector_db import (
    VectorDB,
    get_vector_db,
    process_file_for_search,
)

# Knowledge base services
from .knowledgebase_service import (
    delete_project_file,
    get_project_files_stats,
    search_project_context,
    create_knowledge_base,
)

# Project services
from .project_service import (
    validate_project_access,
    get_default_project,
    create_project,
    get_project_token_usage,
    validate_resource_access,
    get_project_conversations,
    get_paginated_resources,
)

# Artifact services
from .artifact_service import (
    create_artifact,
    get_artifact,
    list_artifacts,
    update_artifact,
    delete_artifact,
    export_artifact,
    get_artifact_stats,
    validate_artifact_type,
)

# Conversation services
from .conversation_service import (
    validate_model,
    get_conversation_service,
    ConversationService,
)

# User services
from .user_service import (
    get_user_by_username,
)
