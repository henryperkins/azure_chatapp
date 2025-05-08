# Python Services & Utilities Developer Reference

This document provides a comprehensive overview of the Python service and utility modules in this project.  
Use it for onboarding, maintenance, and as a reference for extending or debugging the backend.

---

## Table of Contents

- [General Architecture](#general-architecture)
- [Services Modules](#services-modules)
- [Utilities Modules](#utilities-modules)
- [How to Add or Extend a Service/Utility](#how-to-add-or-extend-a-serviceutility)
- [Debugging and Monitoring](#debugging-and-monitoring)
- [Conclusion](#conclusion)

---

## General Architecture

- **Async/Await:** All DB and I/O operations are async for scalability.
- **Dependency Injection:** Services expect explicit dependencies (e.g., `db: AsyncSession`).
- **Separation of Concerns:** Each service or utility module is focused on a single domain (artifacts, conversations, files, knowledge base, etc.).
- **Error Handling:** Consistent use of custom exceptions, FastAPI `HTTPException`, and logging.
- **Sentry Integration:** Many modules include Sentry tracing, error capture, and performance monitoring.
- **Serialization:** All model-to-dict conversions are handled by `utils/serializers.py` for consistency.
- **Configurable:** Uses a central `config/settings` for environment and feature toggles.

---

## Services Modules

### services/__init__.py
- **Purpose:** Aggregates and re-exports all core service functions and classes for easy import.
- **Exports:** File storage, text extraction, vector DB, knowledge base, project, artifact, conversation, and user services.

### services/artifact_service.py
- **Purpose:** Manages project artifacts (code, documents, images, etc.) with CRUD, filtering, and export.
- **Key Functions:** `create_artifact`, `get_artifact`, `list_artifacts`, `update_artifact`, `delete_artifact`, `export_artifact`, `get_artifact_stats`, `validate_artifact_type`
- **Notes:** Handles permission checks, content stats, and multiple export formats (text, JSON, HTML, markdown, base64).

### services/conversation_service.py
- **Purpose:** Manages conversations and messages, including AI response generation and parameter validation.
- **Key Classes/Functions:** `ConversationService` (main class), `validate_model_and_params`, `get_conversation_service` (FastAPI dependency), `conversation_exception_handler` (middleware)
- **Notes:** Handles conversation CRUD, message creation, AI response, title/summary generation, and search. Validates model capabilities and parameters.

### services/file_storage.py
- **Purpose:** Abstracts file storage operations for local, Azure Blob, and AWS S3 backends.
- **Key Classes/Functions:** `FileStorage` (main class), `get_file_storage`, `save_file_to_storage`, `get_file_from_storage`, `delete_file_from_storage`, `get_storage_config`
- **Notes:** All file operations are async. Handles file saving, retrieval, and deletion with consistent interface.

### services/github_service.py
- **Purpose:** Performs GitHub repository operations (clone, fetch files, add/remove files, push).
- **Key Class:** `GitHubService`
- **Notes:** Uses GitPython for repo operations. Supports optional personal access token for authentication.

### services/knowledgebase_helpers.py
- **Purpose:** Centralized helpers for knowledge base operations (config, storage, vector DB, token accounting, metadata).
- **Key Classes:** `KBConfig`, `StorageManager`, `VectorDBManager`, `TokenManager`, `MetadataHelper`
- **Notes:** Used by `knowledgebase_service.py` for DRY and maintainability.

### services/knowledgebase_service.py
- **Purpose:** Main service for managing knowledge bases: file upload, processing, chunking, embedding, search, token tracking.
- **Key Functions:** `create_knowledge_base`, `ensure_project_has_knowledge_base`, `upload_file_to_project`, `process_single_file_for_search`, `delete_project_file`, `search_project_context`, `attach_github_repository`, `detach_github_repository`, `cleanup_orphaned_kb_references`, `get_kb_status`, `get_knowledge_base_health`, `get_project_files_stats`, `list_knowledge_bases`, `get_knowledge_base`, `update_knowledge_base`, `delete_knowledge_base`, `toggle_project_kb`, `get_project_file_list`
- **Notes:** Uses helper classes for config, storage, vector DB, and token management. Handles background processing and error handling via decorators.

### services/project_service.py
- **Purpose:** Centralizes project validation, access control, CRUD, token usage, and resource pagination.
- **Key Functions:** `validate_project_access`, `get_valid_project`, `check_project_permission`, `create_project`, `get_default_project`, `get_project_token_usage`, `validate_resource_access`, `get_project_conversations`, `get_paginated_resources`, `check_knowledge_base_status`
- **Notes:** Handles both UUID and integer project IDs for legacy support. Uses enums for access levels.

### services/text_extraction.py
- **Purpose:** Extracts text from various file formats (txt, md, pdf, docx, json, csv, code).
- **Key Class:** `TextExtractor`
- **Key Functions:** `get_text_extractor` (factory)
- **Notes:** Handles chunking, token counting, and metadata extraction. Conditional imports for optional dependencies (pypdf, python-docx, tiktoken).

### services/user_service.py
- **Purpose:** User-related services (e.g., lookup by username).
- **Key Function:** `get_user_by_username`

### services/utils/__init__.py
- **Purpose:** Marks the `services/utils` directory as a package for reusable service-level utilities.

### services/vector_db.py
- **Purpose:** Handles vector embeddings, similarity search, and storage (in-memory, FAISS, or API-based).
- **Key Class:** `VectorDB`
- **Key Functions:** `get_vector_db`, `initialize_project_vector_db`, `process_file_for_search`, `search_project_context`, `cleanup_project_resources`, `process_files_for_project`, `search_context_for_query`
- **Notes:** Supports local and API-based embedding generation. Handles batch document addition, search, deletion, and stats.

---

## Utilities Modules

### utils/__init__.py
- **Purpose:** Marks the `utils` directory as a package.

### utils/ai_helper.py
- **Purpose:** Utilities for integrating knowledge base context into AI interactions.
- **Key Functions:** `get_model_config`, `calculate_tokens`, `retrieve_knowledge_context`, `augment_with_knowledge`
- **Notes:** Handles model config lookup, token estimation, and context augmentation for AI prompts.

### utils/ai_response.py
- **Purpose:** Generates AI responses for conversations, handling model specifics, streaming, and token usage.
- **Key Function:** `generate_ai_response`
- **Notes:** Handles knowledge context injection, model config, and usage tracking.

### utils/auth_utils.py
- **Purpose:** Centralized authentication utilities (JWT creation/verification, token blacklist, user extraction, CSRF).
- **Key Functions:** `create_access_token`, `verify_token`, `clean_expired_tokens`, `validate_csrf_token`, `extract_token`, `get_user_from_token`, `get_current_user_and_token`
- **Notes:** Handles both HTTP and WebSocket authentication. Enforces security best practices (with dev-mode exceptions).

### utils/context.py
- **Purpose:** Conversation summarization and token-limit enforcement.
- **Key Functions:** `do_summarization`, `manage_context`, `token_limit_check`, `estimate_token_count`, `estimate_tokens`
- **Notes:** Uses tiktoken if available, otherwise falls back to character-based estimation.

### utils/db_utils.py
- **Purpose:** Database utility functions for model access, periodic tasks, and resource validation.
- **Key Functions:** `run_periodic_task`, `schedule_token_cleanup`, `save_model`, `get_all_by_condition`, `validate_resource_access`, `get_by_id`
- **Notes:** Used for background cleanup and generic DB access patterns.

### utils/file_validation.py
- **Purpose:** File validation utilities (extension, size, type, sanitization).
- **Key Class:** `FileValidator`
- **Key Functions:** `validate_file_size`, `sanitize_filename`

### utils/message_handlers.py
- **Purpose:** Utilities for message handling in conversations (creation, validation, context management).
- **Key Functions:** `validate_image_data`, `create_user_message`, `get_conversation_messages`, `update_project_token_usage`

### utils/mcp_sentry.py
- **Purpose:** Utilities for interacting with the Sentry MCP server (issue details, search, events, stats, breadcrumbs).
- **Key Functions:** `get_issue_details`, `search_issues`, `get_issue_events`, `get_project_stats`, `resolve_issue`, `get_breadcrumbs`, `enable_mcp_integrations`, `get_mcp_status`
- **Notes:** Includes retry logic, caching, and Sentry span integration.

### utils/middlewares.py
- **Purpose:** Middleware components for security headers, Sentry tracing, and context (debug/insecure version).
- **Key Classes:** `SecurityHeadersMiddleware`, `SentryTracingMiddleware`, `SentryContextMiddleware`
- **Key Function:** `setup_middlewares`

### utils/openai.py
- **Purpose:** Unified OpenAI/Azure/Claude chat API integration with Sentry tracing and error handling.
- **Key Functions:** `openai_chat`, `azure_chat`, `claude_chat`, `get_model_config`, `get_azure_api_version`, `get_completion`, `get_moderation`, `count_claude_tokens`
- **Notes:** Handles streaming and non-streaming responses, vision, reasoning, and moderation.

### utils/response_utils.py
- **Purpose:** Standardized response formatting and Azure API request helper.
- **Key Functions:** `create_standard_response`, `azure_api_request`

### utils/sentry_utils.py
- **Purpose:** Enhanced Sentry integration utilities (performance, trace, event filtering, logging).
- **Key Functions:** `configure_sentry`, `configure_sentry_loggers`, `extract_sentry_trace`, `inject_sentry_trace_headers`, `set_sentry_user`, `set_sentry_tag`, `set_sentry_context`, `get_current_trace_id`, `tag_transaction`, `sentry_span`, `capture_breadcrumb`, `capture_custom_message`, `filter_sensitive_event`, `filter_transactions`, `make_sentry_trace_response`

### utils/serializers.py
- **Purpose:** Standardized serialization of database models to dictionaries.
- **Key Functions:** `serialize_project`, `serialize_conversation`, `serialize_message`, `serialize_artifact`, `serialize_project_file`, `serialize_knowledge_base`, `serialize_vector_result`, `serialize_list`, `serialize_datetime`, `serialize_uuid`

---

## How to Add or Extend a Service/Utility

1. **Create a new module** in the appropriate directory (`services/` or `utils/`).
2. **Define classes/functions** with clear, single-responsibility logic.
3. **Use async/await** for all DB and I/O operations.
4. **Handle errors** with logging and FastAPI `HTTPException` as appropriate.
5. **Add Sentry tracing** for observability if the function is performance- or error-critical.
6. **Document** with docstrings and update this reference as needed.

---

## Debugging and Monitoring

- **Sentry** is used for error and performance monitoring.
- **Logging** is present in all modules for traceability.
- **Standardized error responses** are returned for all exceptions.

---

## Conclusion

This codebase is designed for modularity, observability, and maintainability.  
Always use dependency injection, standardized responses, and Sentry/logging for all new services and utilities.

**For more details, see the docstrings and comments in each file.**  
If you need API details for a specific module, see the file or ask for that module’s API documentation.

---
