# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Azure Chat Application Commands and Guidelines

---

## Core Modules Overview

This section summarizes the responsibilities of the main backend and frontend modules to provide clear onboarding for new contributors and architectural clarity across the team.

### Backend (Python/FastAPI)

- **models/**
  Database ORM models for core entities (using SQLAlchemy 2.0 style with `Mapped[]` and `mapped_column`):
  - `user.py`: User accounts, roles, and authentication-related data.  
    - Fields: `last_login`, `last_activity`, `preferences` (JSONB for user settings).
    - Includes `TokenBlacklist` model for JWT revocation and token security.
  - `conversation.py`: Represents conversations including access validation and knowledge base relationships.
    - Fields: `use_knowledge_base` (bool), `knowledge_base_id` (FK), validation logic for KB usage.
  - `message.py`: Messages within conversations, metadata validation.
  - `project.py`: Project entity and project-user association.
    - Enforces one-to-one relationship with `KnowledgeBase` via unique `project_id`.
    - Explicit DB constraints: token usage cannot exceed max, archive/pin/default exclusivity.
  - `project_file.py`: Files associated with projects.
    - Fields: `file_hash` (SHA-256 for deduplication), `content` (inline storage), plus config/metadata.
  - `knowledge_base.py`: Represents knowledge base metadata and linkage.
    - GitHub repo integration: `repo_url`, `branch`, `file_paths` (list of paths).
  - `artifact.py`: Content generated in projects/conversations.
    - Allowed `content_type` values: `code`, `document`, `image`, `audio`, `video`.
    - Dual relationship: can belong to both a project and a conversation.

- **services/**
  Business logic/services for major features:
  - `artifact_service.py`: CRUD and export for project artifacts.
  - `conversation_service.py`: Encapsulates all conversation and message creation, access, search, update, and summary logic; ensures secure access.
  - `file_storage.py`: Unified abstraction for saving/retrieving/deleting files (local, Azure, AWS S3).
  - `knowledgebase_service.py` & `knowledgebase_helpers.py`: Handles knowledge base creation, search, file upload, cleanup, and project context.
  - `project_service.py`: Project creation, access/validation, token usage tracking.
  - `user_service.py`: User management and lookup.
  - `text_extraction.py`: Extract text/content from various filetypes for indexing or knowledge base ingestion.
  - `vector_db.py`: Vector database management for embeddings/context search (tokenization, chunking, similarity, project-level scoping).

- **routes/**
  FastAPI routers for REST API endpoints:
  - `admin.py`: Administrative and database-maintenance endpoints.
  - `knowledge_base_routes.py`: Knowledge base CRUD, search, upload, status, and file-level APIs.
  - `unified_conversations.py`: Endpoints for project conversations and messages (list, create, update, delete, summarize, batch operations).
  - `user_preferences.py`: User-specific state/preferences (starred conversations, UI settings).
  - `sentry_test.py`: Endpoint(s) for Sentry health and error injection/testing.

- **schemas/**
  Pydantic models for API request/response validation:
  - All schemas use `from_attributes = True` for ORM compatibility.
  - Custom JSON encoders for `datetime` and `UUID` ensure proper serialization.
  - `chat_schemas.py`: Message creation.
  - `file_upload_schemas.py`: File upload response formatting.
  - `project_schemas.py`: Project and artifact serialization, request validation, and output schemas.
    - New fields in `ProjectResponse`, `ArtifactResponse`, etc. are included (e.g., `extra_data`, `knowledge_base_id`).

- **utils/**
  Utilities and cross-cutting helpers:
  - `ai_helper.py`, `ai_response.py`: AI context building, token counting, and augmentation for OpenAI/Azure/Claude.
  - `auth_utils.py`: JWT security, CSRF, and token/user extraction and validation.
  - `context.py`: Context window, summarization, token tracking/helpers.
  - `db_utils.py`: Helper functions for async DB access, periodic health/tasks.
  - `file_validation.py`: Validates and sanitizes uploaded files.
  - `openai.py`: Core functions for API calls to Azure OpenAI and model payload composition.
  - `middlewares.py`: Security (headers), Sentry tracing/context, and app middleware registration.
  - `mcp_sentry.py`, `sentry_utils.py`: Sentry and MCP error tracking, trace propagation, sanitization, event filtering.
  - `serializers.py`: Serializes DB models for downstream API use (JSON-friendly).
  - `message_handlers.py`: Message creation/helpers, token usage, and image data validation.
  - `response_utils.py`: Standardizes backend responses, Azure API helpers.


---

### Frontend (HTML, Tailwind CSS, Vanilla JavaScript)

- **static/js/app.js** — Application bootstrap/entrypoint, common state.
- **auth.js** — Handles authentication, session management, and user login/logout flows.
- **chat.js, chatExtensions.js** — Chat UI, message handling, and browser extension logic for chat features.
- **eventHandler.js** — Centralized DOM event delegation for UI elements.
- **FileUploadComponent.js** — UI/logic for drag-and-drop and direct file uploads.
- **notification-handler.js** — Displays/schedules notifications and error popups.
- **sidebar.js, sidebar-enhancements.js** — Sidebar rendering, toggling, and responsiveness.
- **projectDashboard.js, projectDashboardUtils.js, projectDetailsComponent.js, projectListComponent.js, projectManager.js** — Project management dashboard, details, utilities, page rendering, and CRUD for projects.
- **modalManager.js, modalConstants.js** — Modal opening/closing and configuration.
- **formatting.js** — Helpers for formatting numbers, dates, code blocks, etc.
- **knowledgeBaseComponent.js, kb-result-handlers.js** — Knowledge base browsing, search integration, and results display.
- **modelConfig.js** — Fetches and manages AI model settings for frontend-side use.
- **theme-toggle.js** — Light/dark mode switching (with Tailwind CSS support).
- **accessibility-utils.js** — A11y tools, keyboard navigation, focus trapping.
- **sentry-init.js** — Frontend Sentry setup: browser tracing, replay, error collection.

Review each file for lower-level utilities or new features as the codebase evolves.

---

## Development Setup
```bash
# Setup Python environment
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Frontend build (Tailwind CSS)
npm install
npm run build:css
npm run dev:css -- --watch  # For development mode

# Start application
uvicorn main:app --reload
```

## Testing
```bash
# Run all tests
pytest

# Run a single test file/module
pytest path/to/test_file.py

# Run a specific test function
pytest path/to/test_file.py::test_function_name -v

# Run with coverage
pytest --cov=./ --cov-report=term

# Run Playwright tests
npx playwright test
```

## Linting and Formatting
```bash
# Run pylint on a specific file
pylint path/to/file.py

# Run pylint on entire codebase
find . -name "*.py" -not -path "*/venv/*" | xargs pylint

# CSS linting
npm run lint:css

# JavaScript linting
npm run lint
```

## Database Management
```bash
# Reset database (WARNING: Deletes all data)
python scripts/reset_database.py

# Create migration
alembic revision --autogenerate -m "description"

# Apply migrations
alembic upgrade head

# Repair broken conversations
python scripts/repair_broken_conversations.py
```

## Frontend Development
```bash
# Build CSS only
npm run build:css

# Watch CSS changes during development
npm run watch:css
# or 
npm run dev

# Run JavaScript audit
npm run audit

# Apply code transformations
npm run codemod
```

## Environment Configuration

The application requires several environment variables to be set properly. Create a `.env` file based on `.env.example` with these key variables:

### Core Application
- `APP_NAME`, `APP_VERSION`, `ENV`, `DEBUG`
- `SESSION_SECRET`, `JWT_SECRET`, `JWT_KEY_ID`
- `DATABASE_URL`
- `CORS_ORIGINS`, `COOKIE_DOMAIN`

### AI API Keys
- `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`
- `OPENAI_API_KEY`
- `CLAUDE_API_KEY`
- `EMBEDDING_API`, `COHERE_API_KEY`

### Sentry Integration
- `SENTRY_DSN`, `SENTRY_ENABLED`
- `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_PROFILES_SAMPLE_RATE`

See the config.py file for full details on all available environment variables.

## Project Structure
```
.
├── .eslintrc.js
├── .gitignore
├── .pylintrc
├── auth.py
├── CLAUDE.md
├── config.py
├── eslint.config.js
├── main.py
├── package.json
├── postcss.config.mjs
├── README.md
├── requirements.txt
├── tailwind.config.js
├── db/
│   ├── __init__.py
│   ├── db.py
│   ├── db.sqlite3
│   └── schema_manager.py
├── models/
│   ├── __init__.py
│   ├── artifact.py
│   ├── conversation.py
│   ├── knowledge_base.py
│   ├── message.py
│   ├── project.py
│   ├── project_file.py
│   └── user.py
├── routes/
│   ├── __init__.py
│   ├── admin.py
│   ├── knowledge_base_routes.py
│   ├── sentry_test.py
│   ├── unified_conversations.py
│   ├── user_preferences.py
│   └── projects/
│       ├── __init__.py
│       ├── artifacts.py
│       ├── files.py
│       └── projects.py
├── schemas/
│   ├── chat_schemas.py
│   ├── file_upload_schemas.py
│   └── project_schemas.py
├── services/
│   ├── __init__.py
│   ├── artifact_service.py
│   ├── conversation_service.py
│   ├── file_storage.py
│   ├── knowledgebase_helpers.py
│   ├── knowledgebase_service.py
│   ├── project_service.py
│   ├── text_extraction.py
│   ├── user_service.py
│   ├── vector_db.py
│   └── utils/
│       └── __init__.py
├── static/
│   ├── favicon.ico
│   ├── localStorage.json
│   ├── css/
│   │   ├── enhanced-components.css
│   │   ├── file-upload-enhanced.css
│   │   ├── legacy-dracula-theme.css
│   │   └── tailwind.css
│   ├── html/
│   │   ├── base.html
│   │   ├── chat_ui.html
│   │   ├── debug.html
│   │   ├── file-upload-component.html
│   │   ├── login.html
│   │   ├── modals.html
│   │   ├── project_details.html
│   │   ├── project_list.html
│   │   └── partials/
│   ├── js/
│   │   ├── accessibility-utils.js
│   │   ├── app.js
│   │   ├── auth.js
│   │   ├── chat.js
│   │   ├── chatExtensions.js
│   │   ├── eventHandler.js
│   │   ├── FileUploadComponent.js
│   │   ├── formatting.js
│   │   ├── kb-result-handlers.js
│   │   ├── knowledgeBaseComponent.js
│   │   ├── modalConstants.js
│   │   ├── modalManager.js
│   │   ├── modelConfig.js
│   │   ├── notification-handler.js
│   │   ├── projectDashboard.js
│   │   ├── projectDashboardUtils.js
│   │   ├── projectDetailsComponent.js
│   │   ├── projectListComponent.js
│   │   ├── projectManager.js
│   │   ├── sentry-init.js
│   │   ├── sidebar.js
│   │   ├── theme-toggle.js
│   │   └── utils/
├── storage/
│   └── vector_db/
├── utils/
│   ├── __init__.py
│   ├── ai_helper.py
│   ├── ai_response.py
│   ├── auth_utils.py
│   ├── context.py
│   ├── db_utils.py
│   ├── file_validation.py
│   ├── mcp_sentry.py
│   ├── message_handlers.py
│   ├── middlewares.py
│   ├── openai.py
│   ├── response_utils.py
│   ├── sentry_utils.py
│   └── serializers.py
```

## Common Issues and Troubleshooting

### Database Issues
- If conversations are missing project associations: `python scripts/repair_broken_conversations.py`
- For migration issues: `alembic upgrade head` or create a new migration
- Database errors related to SSL: Check `PG_SSL_ALLOW_SELF_SIGNED` environment variable

### Authentication Issues
- JWT token problems: Check `TokenBlacklist` table and token expiration settings
- Cookie domain mismatch: Ensure `COOKIE_DOMAIN` matches your deployment domain

### Frontend Issues
- Missing CSS: Run `npm run build:css` to generate required files
- Missing event tracking: Review event handler registration with context
- UI notifications not working: Check notification system registration

### API Integration Issues
- Azure OpenAI: Verify correct endpoint and API key configuration
- Claude API: Check API key and extended thinking settings
- Vector DB: Ensure storage path exists and is writable

### Deployment Issues
- Container deployment: Mount volumes for persistent storage
- Environment configuration: Ensure all required variables in `.env`
- Frontend assets: Build CSS files before deployment

---

## Frontend Code Guardrails (Pocket Reference)

When working with JavaScript/TypeScript in this codebase, follow these strict guardrails:

1. **Factory Functions**: Export modules through named factories (`createXyz`), validate dependencies at the top, and expose cleanup APIs.
2. **Dependency Injection**: Never access globals directly (`window`, `document`, `console`); use injected dependencies.
3. **No Import Side Effects**: Initialization happens inside factories, not at import time.
4. **Event Handling**: Register with `eventHandlers.trackListener(..., { context })`, cleanup with `eventHandlers.cleanupListeners({ context })`.
5. **Context Tags**: Supply unique `context` strings for listeners and notifications.
6. **Notification System**: Use injected `notify` utility with metadata: `notify.info('Message', { module: 'MyModule', context: 'operation', source: 'function' })`.
7. **Debug Tools**: Use `createDebugTools({ notify })` for performance timing and tracing.
8. **Error Reporting**: Capture with `errorReporter.capture(err, { module, method, ... })`, never leak sensitive data.
9. **HTML Sanitization**: Always use `sanitizer.sanitize()` before DOM insertion.
10. **App Readiness**: Wait for `DependencySystem.waitFor([...])` or the `'app:ready'` event.
11. **App State**: Read from `app.state`, don't mutate directly.
12. **Event Bus**: Expose a dedicated `EventTarget` for module-specific events.
13. **Navigation**: Use injected `navigationService.navigateTo(...)` for all routing.
14. **API Client**: Make all network requests through `apiClient`.
15. **Contextual Notifiers**: Create module-scoped notifiers with `notify.withContext({ module: 'MyModule' })`.
16. **Backend Logging**: Use `backendLogger.log({ level, message, module, ... })`.
17. **User Consent**: Honor opt-out preferences for monitoring and analytics.

### Notification Best Practices
- Always include context metadata: `module`, `context`, `source` properties
- Create contextual notifiers at module level
- Include original errors when catching exceptions
- Use specialized methods for common scenarios
- Group related notifications to prevent UI clutter

## Sentry Integration

### Overview

Sentry is integrated across both backend (Python/FastAPI) and frontend (JavaScript) for end-to-end error tracking, performance monitoring, and distributed tracing. All Sentry instrumentation is privacy-preserving by default and designed to facilitate efficient debugging and security analysis.

---

### Backend (FastAPI/Python)

- **Configuration**:
  - Controlled via environment variables (see `config.py`):
    - `SENTRY_DSN`, `SENTRY_ENABLED`, `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_PROFILES_SAMPLE_RATE`, `SENTRY_REPLAY_SESSION_SAMPLE_RATE`, `SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE`
    - MCP Sentry bridge options: `SENTRY_MCP_SERVER_ENABLED`, `SENTRY_MCP_SERVER_URL`
  - Enable or disable Sentry and advanced performance/profiling on a per-deploy basis.
- **Initialization**:
  - Sentry is initialized at startup in main.py or the app's entrypoint via `utils/sentry_utils.py`'s `configure_sentry` function.
  - Integrates with FastAPI, SQLAlchemy, asyncio, and structured logging for high-fidelity tracing and error capture.
- **Privacy and Filtering**:
  - All outgoing Sentry events are scrubbed of sensitive data: keys like `password`, `token`, `secret`, `auth`, and headers such as `Authorization` are filtered (`[FILTERED]`).
  - User, request, and context objects are reduced to safe fields only.
- **Advanced Features**:
  - **Custom Tagging & Context**:
    Use `set_sentry_user`, `set_sentry_tag`, and `set_sentry_context` to attach information and facilitate log correlation with business events.
  - **Breadcrumbs / Logs**:
    Manual and automatic breadcrumbs for important actions, custom error messages, and attaching server logs to Sentry issues.
  - **Span/Transaction Management**:
    Rich tracing: custom transactions, distributed trace header propagation, performance metrics, and execution profiling.
  - **Transaction Filtering**:
    Noisy endpoints (`/health`, `/metrics`, etc.) are automatically excluded.
  - **MCP Server Integration**:
    Sentry can connect to a Model Context Protocol server for enhanced developer analysis and cross-stack context (see `utils/mcp_sentry.py`). Health-check and validation logic included.
  - **Testing and Verification**:
    Use endpoints in `routes/sentry_test.py` to verify Sentry error/event capture and distributed tracing in development.

---

### Frontend (JavaScript)

- **Configuration**:
  - Sentry is initialized dynamically in `static/js/sentry-init.js`:
    - Only enabled for production by default; in development/localhost, it must be explicitly toggled via `localStorage.setItem('enable_monitoring', 'true')`.
    - Can also be disabled by users (`localStorage.setItem('disable_monitoring', 'true')`).
    - DSN, environment, and release version can be overriden via global ENV values.
- **Instrumentation**:
  - Browser performance tracing and session replay are enabled.
  - Captures unhandled errors, promise rejections, console errors, and navigation/click breadcrumbs.
  - Can automatically or manually tag current user/context; listens for `authStateChanged` events to update Sentry identity.
  - Tracing headers are propagated with fetch/XHR to link frontend and backend errors for distributed traceability.
- **Privacy**:
  - Sensitive URL parameters, session, authentication, and other secrets are redacted in all outbound events.
  - Breadcrumbs and replays will not expose sensitive UI or business data.
  - You can extend or customize event privacy via the `beforeSend` hook in the setup code.
- **Tuning and Debugging**:
  - Sentry is only fully initialized after DOMReady or when your SPA app is initialized.
  - All handlers for click/navigation/global error events are connected and SPA-aware.
  - Custom integration points for enhanced visibility or troubleshooting—see comments in `sentry-init.js`.

---

### Tips for Extending or Debugging Sentry

- **To add business context/tags**:
  - Backend: Use `utils/sentry_utils.py` helpers in your services or routes.
  - Frontend: Use `Sentry.setTag()` or `Sentry.setContext()` at any point after initialization.

- **To force a Sentry test event**:
  - Hit the dedicated endpoints in `routes/sentry_test.py` (backend) or trigger an error in the frontend with `throw new Error("Test Sentry")`.

- **To check/discover distributed tracing**:
  - Inspect outbound requests for `sentry-trace` and `baggage` headers.
  - Correlate errors in the Sentry dashboard using trace IDs/tags.

- **Where to find Sentry code**:
  - `utils/sentry_utils.py`, `utils/mcp_sentry.py` (backend core)
  - `static/js/sentry-init.js` (frontend logic)
  - See also `config.py` for relevant environment variables

---

## Code Style Guidelines
- **Imports**: Group standard library, third-party, and local imports (separated by newlines)
- **Type Hints**: Use typing module; annotate function parameters and return values
- **Docstrings**: Triple quotes for modules and functions with description and parameters
- **Error Handling**: Use try/except with specific exceptions; log errors with context
- **Naming**: snake_case for variables/functions, PascalCase for classes, UPPER_CASE for constants
- **Formatting**: 4 spaces for indentation, maximum line length of 100 characters
- **SQLAlchemy**: Use SQLAlchemy 2.0 style (`Mapped[]`, `mapped_column`), async session, and proper relationship definitions
- **FastAPI**: Router grouping by feature, dependency injection for auth/DB
- **Frontend**: Vanilla JavaScript with Tailwind CSS v4 and DaisyUI for styling
- **Security**: Follow OWASP practices; use JWT tokens; validate all inputs; enforce JWT blacklist for token revocation
- **Logging**: Use built-in logging module with appropriate severity levels
- **Azure**: Use Azure best practices for cloud-related code

When completing tasks, run appropriate tests and linting before committing changes.

## Developer Documentation

This section provides a high-level reference for backend developers working on this codebase.

#### Model Relationships (Summary Table)

| Model           | Key Fields / Relationships                                                                                 |
|-----------------|-----------------------------------------------------------------------------------------------------------|
| User            | `id`, `username`, `role`, `last_login`, `last_activity`, `preferences`, `project_associations`, `conversations`<br>Has many Projects (via association), many Conversations. |
| TokenBlacklist  | `jti`, `user_id`, `expires`, `token_type`<br>Tracks revoked JWT tokens for security.                      |
| Project         | `id`, `name`, `user_id`, `knowledge_base` (one-to-one), `files`, `artifacts`, `conversations`, `members`<br>Constraints: token usage ≤ max, archive/pin/default exclusivity. |
| KnowledgeBase   | `id`, `project_id` (unique, one-to-one), `embedding_model`, `repo_url`, `branch`, `file_paths`, `is_active`<br>Backref to Project. |
| ProjectFile     | `id`, `project_id`, `file_hash`, `filename`, `file_path`, `content`, `config`<br>Belongs to Project.      |
| Conversation    | `id`, `user_id`, `project_id`, `knowledge_base_id`, `use_knowledge_base`, `messages`, `artifacts`<br>Validates KB usage. |
| Message         | `id`, `conversation_id`, `role`, `content`, `extra_data`, `context_used`<br>Belongs to Conversation.      |
| Artifact        | `id`, `project_id`, `conversation_id`, `content_type` (`code`, `document`, `image`, `audio`, `video`), `content`<br>Belongs to Project and optionally Conversation. |

- All models use SQLAlchemy 2.0 style (`Mapped[]`, `mapped_column`).
- Cascade deletes and DB-level constraints are used for data integrity.
- JWT blacklist (`TokenBlacklist`) is enforced for token security.

### Architecture Overview

- **User**: Authenticated entity, owns projects and conversations.
- **Project**: Workspace grouping files, conversations, and a knowledge base (one-to-one).
- **Knowledge Base**: Semantic search index (vector DB) for project files, optionally linked to a GitHub repo (`repo_url`, `branch`, `file_paths`).
- **ProjectFile**: File attached to a project, processed for search/context, with deduplication (`file_hash`) and optional inline `content`.
- **VectorDB**: Handles embeddings, similarity search, and storage (FAISS, sklearn, or manual).
- **AI Chat**: Conversational interface, optionally augmented with project knowledge context.
- **TokenBlacklist**: Tracks revoked JWT tokens for secure authentication.

### Main Components

- **Models**: User, TokenBlacklist, Project, KnowledgeBase, ProjectFile, Conversation, Message, Artifact.
- **Services**: Knowledge base management, vector DB, text extraction, file storage, GitHub integration.
- **Utilities**: File validation, AI/model config, DB helpers, Sentry/MCP integration, serialization, response formatting.
- **Configuration**: All runtime settings in `config.py` (env-driven).

### Core Flows

- **File Upload**: Validated, stored, chunked, embedded, and indexed for semantic search.
- **Knowledge Search**: Project vector DB is searched for relevant context, which can be injected into chat prompts.
- **AI Chat**: User messages can be augmented with knowledge context; responses are generated via OpenAI/Azure/Claude.
- **GitHub Integration**: Projects can link a repo; files are fetched and processed into the knowledge base.

### Error Handling & Observability

- Consistent error handling via decorators and HTTPException.
- Sentry: Deep integration for error, performance, and trace monitoring.
- MCP: Optional advanced Sentry server integration.

### Extending the System

- Add new file types: Extend `TextExtractor` and `FileValidator`.
- Add new embedding models: Update `VectorDB` and config.
- Add new AI providers: Extend `utils/openai.py` and model config.
- Add new endpoints: Use FastAPI, leverage existing service and utility layers.

### Security Notes

- Never use debug/insecure config in production!
- Set all secrets and API keys via environment variables.
- JWT blacklist (`TokenBlacklist`) is enforced for token security and revoked token handling.
- Review Sentry and CORS settings before deployment.

For more details, see module docstrings and comments in `config.py`.