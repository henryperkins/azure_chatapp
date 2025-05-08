# Python API Routes Developer Reference

This document provides a comprehensive overview of the FastAPI route modules in this project.  
Use it for onboarding, maintenance, and as a reference for extending or debugging the API.

---

## Table of Contents

- [General Architecture](#general-architecture)
- [routes/__init__.py](#routes__init__py)
- [routes/admin.py](#routesadminpy)
- [routes/log_notification.py](#routeslog_notificationpy)
- [routes/knowledge_base_routes.py](#routesknowledge_base_routespy)
- [routes/projects/__init__.py](#routesprojects__init__py)
- [routes/projects/artifacts.py](#routesprojectsartifactspy)
- [routes/projects/files.py](#routesprojectsfilespy)
- [routes/projects/projects.py](#routesprojectsprojectspy)
- [routes/sentry_test.py](#routessentry_testpy)
- [routes/unified_conversations.py](#routesunified_conversationspy)
- [routes/user_preferences.py](#routesuser_preferencespy)

---

## General Architecture

- **FastAPI** is used for all route definitions.
- **Dependency Injection** is used for DB sessions, user authentication, and service access.
- **Sentry** is integrated for error monitoring, performance tracing, and metrics.
- **Standardized responses** are returned using `create_standard_response` or similar helpers.
- **Project structure**: routes are grouped by domain (projects, files, artifacts, conversations, knowledge base, etc.).
- **Error handling**: All endpoints use try/except with logging and Sentry capture.
- **User authentication**: All sensitive endpoints require user authentication via `get_current_user_and_token`.

---

## routes/__init__.py

**Purpose:**  
Marks the `routes` directory as a Python package.  
**No endpoints defined.**

---

## routes/admin.py

**Purpose:**  
Admin-only endpoints for system maintenance.

**Key Endpoints:**
- `POST /admin/fix-project-knowledge-bases`  
  - **Admin only**. Scans all projects and creates missing knowledge bases.

**Dependencies:**  
- `get_current_user_and_token` (for admin check)
- `get_async_session` (DB session)
- `knowledgebase_service.ensure_project_has_knowledge_base`

**Notes:**  
- Uses a custom dependency to ensure the user is an admin.
- Returns a summary of fixed projects and errors.

---

## routes/log_notification.py

**Purpose:**  
**Deprecated**. Previously handled client log notifications.

**Key Endpoints:**  
- None (all endpoints commented out).

**Notes:**  
- Only logs a warning that this route is deprecated.

---

## routes/knowledge_base_routes.py

**Purpose:**  
Knowledge base management for projects.

**Key Endpoints:**
- `POST /{project_id}/knowledge-bases` – Create a KB for a project.
- `GET /{project_id}/knowledge-bases` – List all KBs for a project.
- `GET /{project_id}/knowledge-bases/{kb_id}` – Get KB details.
- `PATCH /{project_id}/knowledge-bases/{kb_id}` – Update KB.
- `DELETE /{project_id}/knowledge-bases/{kb_id}` – Delete KB.
- `GET /{project_id}/knowledge-bases/status` – Get KB status/health.
- `POST /{project_id}/knowledge-bases/search` – Search KB.
- `POST /{project_id}/knowledge-bases/files` – Upload file to KB.
- `POST /{project_id}/knowledge-bases/reindex` – Reindex KB.
- `DELETE /{project_id}/knowledge-bases/files/{file_id}` – Delete KB file.
- `POST /{project_id}/knowledge-bases/toggle` – Enable/disable KB.
- `POST /{project_id}/knowledge-bases/github/attach` – Attach GitHub repo as KB source.
- `POST /{project_id}/knowledge-bases/github/detach` – Detach GitHub repo.

**Dependencies:**  
- `get_current_user_and_token` (user auth)
- `get_async_session` (DB session)
- `validate_project_access` (project access check)
- Knowledge base and vector DB services

**Notes:**  
- All endpoints are project-scoped.
- Uses Pydantic schemas for request validation.
- Handles background file processing with FastAPI `BackgroundTasks`.
- Consistent error handling and logging.

---

## routes/projects/__init__.py

**Purpose:**  
Aggregates all project-related subroutes.

**Key Endpoints:**  
- None directly; includes:
  - `/projects` (core project CRUD)
  - `/{project_id}/files` (file management)
  - `/{project_id}/artifacts` (artifact management)
  - `/projects/{project_id}/conversations` (conversation management)

**Notes:**  
- Uses FastAPI `APIRouter.include_router` to compose subroutes.

---

## routes/projects/artifacts.py

**Purpose:**  
Artifact management within a project.

**Key Endpoints:**
- `POST /{project_id}/artifacts` – Create artifact.
- `GET /{project_id}/artifacts` – List artifacts (with filters).
- `GET /{project_id}/artifacts/stats` – Get artifact stats.
- `GET /{project_id}/artifacts/{artifact_id}` – Get artifact by ID.
- `PUT /{project_id}/artifacts/{artifact_id}` – Update artifact.
- `DELETE /{project_id}/artifacts/{artifact_id}` – Delete artifact.
- `GET /{project_id}/artifacts/{artifact_id}/export` – Export artifact.

**Dependencies:**  
- `get_current_user_and_token` (user auth)
- `get_async_session` (DB session)
- `artifact_service` (artifact business logic)

**Notes:**  
- All endpoints are project-scoped.
- Uses Pydantic schemas for request validation.
- Consistent error handling and logging.

---

## routes/projects/files.py

**Purpose:**  
File management within a project (not knowledge base files).

**Key Endpoints:**
- `GET /{project_id}/files` – List files (with optional type filter).
- `GET /{project_id}/files/{file_id}` – Get file metadata.
- `DELETE /{project_id}/files/{file_id}` – Delete file.
- `GET /{project_id}/files/{file_id}/download` – (Stub) Download file.

**Dependencies:**  
- `get_current_user_and_token` (user auth)
- `get_async_session` (DB session)
- `validate_project_access` (project access check)
- `get_file_storage` (file storage abstraction)

**Notes:**  
- All endpoints are project-scoped.
- File download endpoint is not yet implemented.
- File deletion also removes from storage backend.

---

## routes/projects/projects.py

**Purpose:**  
Core project CRUD and actions, with Sentry monitoring.

**Key Endpoints:**
- `POST /projects` – Create project (with KB and default conversation).
- `GET /projects` – List projects (with filters, admin/all-users support).
- `GET /projects/{project_id}` – Get project details.
- `PATCH /projects/{project_id}` – Update project.
- `DELETE /projects/{project_id}` – Delete project (with full cleanup).
- `PATCH /projects/{project_id}/archive` – Toggle archive status.
- `POST /projects/{project_id}/pin` – Toggle pin status.
- `GET /projects/{project_id}/stats` – Get project statistics.

**Dependencies:**  
- `get_current_user_and_token` (user auth)
- `get_async_session` (DB session)
- `check_project_permission`, `coerce_project_id`, `_lookup_project` (project service)
- Sentry SDK for tracing, metrics, and error capture

**Notes:**  
- All endpoints are project-scoped.
- Uses Pydantic schemas for request validation.
- Extensive Sentry integration for tracing, metrics, and error reporting.
- Project creation also creates a knowledge base and a default conversation.
- Project deletion performs full resource cleanup (files, artifacts, KB, conversations).

---

## routes/sentry_test.py

**Purpose:**  
Test endpoints for Sentry integration and monitoring.

**Key Endpoints:**
- `/test-error` – Raises an exception to test Sentry error capture.
- `/test-message` – Sends a custom message to Sentry.
- `/test-performance` – Creates Sentry spans for performance monitoring.
- `/test-profiling` – Triggers CPU/memory-intensive operations for profiling.
- `/test-mcp` – Tests Sentry MCP server integration.
- `/test-distributed-tracing` – Demonstrates distributed tracing.

**Dependencies:**  
- Sentry SDK and custom sentry_utils/mcp_sentry helpers

**Notes:**  
- For development/testing only.
- No authentication required.

---

## routes/unified_conversations.py

**Purpose:**  
Conversation and message management for projects, with Sentry monitoring.

**Key Endpoints:**
- `GET /{project_id}/conversations` – List conversations.
- `POST /{project_id}/conversations` – Create conversation.
- `GET /{project_id}/conversations/{conversation_id}` – Get conversation.
- `PATCH /{project_id}/conversations/{conversation_id}` – Update conversation.
- `DELETE /{project_id}/conversations/{conversation_id}` – Delete conversation.
- `POST /{project_id}/conversations/{conversation_id}/messages` – Create message.
- `GET /{project_id}/conversations/{conversation_id}/messages` – List messages.
- `POST /{project_id}/conversations/{conversation_id}/summarize` – Summarize conversation.
- `POST /{project_id}/conversations/batch-delete` – Batch delete conversations.

**Dependencies:**  
- `get_current_user_and_token` (user auth)
- `get_async_session` (DB session)
- `ConversationService` (conversation business logic)
- Sentry SDK for tracing, metrics, and error capture

**Notes:**  
- All endpoints are project-scoped.
- Uses Pydantic schemas for request validation.
- Extensive Sentry integration for tracing, metrics, and error reporting.
- AI operations (message processing, summarization) are monitored for performance.

---

## routes/user_preferences.py

**Purpose:**  
User preferences and profile management.

**Key Endpoints:**
- `GET /api/user/me` – Get current user profile and preferences.
- `GET /api/user/projects` – Get user's project list and last project.
- `GET /api/preferences/starred` – Get starred conversations.
- `PATCH /api/user/preferences` – Update user preferences.

**Dependencies:**  
- `get_current_user_and_token` (user auth)
- `get_async_session` (DB session)

**Notes:**  
- All endpoints require authentication.
- Returns user profile and preferences for frontend bootstrapping.
- Project list is ordered chronologically by user preferences.

---

# How to Add a New Route Module

1. **Create a new file** in the `routes/` or `routes/projects/` directory.
2. **Define an `APIRouter`** and endpoints using FastAPI.
3. **Use dependency injection** for DB sessions and user authentication.
4. **Add error handling and logging** (and Sentry integration if needed).
5. **Register the router** in the appropriate parent router or in `main.py`.

---

# How to Extend Functionality

- **Add new endpoints** to the appropriate router.
- **Use Pydantic models** for request/response validation.
- **Add Sentry tracing/metrics** for observability.
- **Update documentation** as you add new features.

---

# Debugging and Monitoring

- **Sentry** is used for error and performance monitoring.
- **Logging** is present in all endpoints for traceability.
- **Standardized error responses** are returned for all exceptions.

---

# Conclusion

This codebase is designed for modularity, observability, and maintainability.  
Always use dependency injection, standardized responses, and Sentry/logging for all new endpoints.

**For more details, see the docstrings and comments in each file.**  
If you need API details for a specific module, see the file or ask for that module’s API documentation.

---
