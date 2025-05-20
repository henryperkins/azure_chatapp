"""
Services package initialization.
This module exposes the core functionality from each service module.

Last updated: 2025-03-27
"""

# Define explicit exports based on actually existing modules and functions
__all__ = [
    # File storage
    "FileStorage",
    "get_file_storage",
    "save_file_to_storage",
    "get_file_from_storage",
    "delete_file_from_storage",
    # Text extraction
    "TextExtractor",
    "get_text_extractor",
    "TextExtractionError",
    # Vector database
    "VectorDB",
    "get_vector_db",
    "process_file_for_search",
    # Knowledge base
    "delete_project_file",
    "get_project_files_stats",
    "search_project_context",
    "create_knowledge_base",
    # Project
    "validate_project_access",
    "get_default_project",
    "create_project",
    "get_project_token_usage",
    "validate_resource_access",
    "get_project_conversations",
    "get_paginated_resources",
    # Artifact
    "create_artifact",
    "get_artifact",
    "list_artifacts",
    "update_artifact",
    "delete_artifact",
    "export_artifact",
    "get_artifact_stats",
    "validate_artifact_type",
    # Conversation
    "validate_model_and_params",
    "get_conversation_service",
    "ConversationService",
    # User
    "get_user_by_username",
    # Context/window manager + web search
    "ContextManager",
    "search",
    # Knowledge base helpers
    "list_knowledge_bases",
    "get_knowledge_base",
    "update_knowledge_base",
    "delete_knowledge_base",
    "toggle_project_kb",
    "get_project_file_list",
    "get_knowledge_base_health",
]

# File storage services
from services.file_storage import (
    FileStorage,
    get_file_storage,
    save_file_to_storage,
    get_file_from_storage,
    delete_file_from_storage,
)

# Text extraction services
from services.text_extraction import (
    TextExtractor,
    get_text_extractor,
    TextExtractionError,
)

# Vector database services
from services.vector_db import (
    VectorDB,
    get_vector_db,
    process_file_for_search,
)

# Knowledge base services
from services.knowledgebase_service import (
    delete_project_file,
    get_project_files_stats,
    search_project_context,
    create_knowledge_base,
    list_knowledge_bases,
    get_knowledge_base,
    update_knowledge_base,
    delete_knowledge_base,
    toggle_project_kb,
    get_project_file_list,
    get_knowledge_base_health,
)

# Project services
from services.project_service import (
    validate_project_access,
    get_default_project,
    create_project,
    get_project_token_usage,
    validate_resource_access,
    get_project_conversations,
    get_paginated_resources,
)

# Artifact services
from services.artifact_service import (
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
from services.conversation_service import (
    validate_model_and_params,
    get_conversation_service,
    ConversationService,
)

# User services
from services.user_service import (
    get_user_by_username,
)

# Context/window manager + web search
from services.context_manager import ContextManager
from services.web_search_service import search
