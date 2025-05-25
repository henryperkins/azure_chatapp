# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a full-stack, project-based chat and knowledge management application leveraging Azure OpenAI, Anthropic Claude, JWT authentication, and modular ES6 frontend with Tailwind CSS and DaisyUI.

### Key Features
- **Project-based organization**: Each user can manage multiple projects with isolated contexts
- **Real-time AI chat**: Support for Claude, GPT, Azure OpenAI, and other models
- **Secure authentication**: JWT with HttpOnly cookies, CSRF protection, and session management
- **File and artifact management**: Per-project file storage with knowledge base integration
- **Advanced knowledge base**: Vector search, file indexing, and context retrieval
- **Modular frontend architecture**: ES6 modules with strict dependency injection
- **Modern UI/UX**: Tailwind CSS v4 with DaisyUI theming and mobile-responsive design
- **Comprehensive monitoring**: Sentry integration for error tracking and performance monitoring
- **Structured logging**: Correlation IDs, context tracking, and centralized log management

## Development Commands

### Backend Setup

```bash
# Create and activate virtual environment
python -m venv .venv
source .venv/bin/activate  # Linux / macOS
# .venv\Scripts\activate   # Windows PowerShell

# Install backend dependencies
pip install -r requirements.txt
```

### Frontend Setup

```bash
# Install frontend dependencies (prefer pnpm)
pnpm install  # preferred (faster, reproducible)
# npm ci      # fallback if pnpm unavailable
```

### Development

```bash
# Start the FastAPI backend with hot reload
uvicorn main:app --reload

# Build and watch CSS changes (Tailwind v4)
pnpm run watch:css  # or: npm run watch:css

# Start the full development environment
pnpm run dev  # or: npm run dev

# Run pattern checker for frontend code quality
node scripts/patternsChecker.cjs static/js/**/*.js
```

### Linting

```bash
# JavaScript/TypeScript linting
pnpm run lint  # or: npm run lint
# With auto-fix
pnpm run lint -- --fix  # or: npm run lint -- --fix

# CSS linting
pnpm run lint:css  # or: npm run lint:css
# With auto-fix
pnpm run lint:css -- --fix  # or: npm run lint:css -- --fix

# Python linting
flake8 .
pylint $(git ls-files '*.py')
```

### Testing

```bash
# Run Python tests with pytest
pytest

# Run a specific test file
pytest path/to/test_file.py

# Run JavaScript tests (frontend)
# Check existing tests in /tests directory
```

## Architecture Overview

### Backend Architecture

The backend follows a layered architecture with clear separation of concerns:

1. **Route Handlers** (thin controllers): Parse requests, call services, format responses
   - Located in `/routes/` directory with organized sub-modules:
     - `routes/projects/`: Project-related endpoints (projects.py, files.py, artifacts.py)
     - `routes/knowledge_base_routes.py`: Knowledge base management
     - `routes/unified_conversations.py`: Conversation management
     - `routes/user_preferences.py`: User settings and preferences
     - `routes/admin.py`: Administrative functions
     - `routes/logs.py`: Client log ingestion with rate limiting

2. **Services** (business logic): All core logic, validation, state manipulation
   - Located in `/services/` directory with comprehensive coverage:
     - `project_service.py`: Project access control and CRUD operations
     - `conversation_service.py`: Chat and conversation management
     - `file_service.py`: File storage and management (unified for projects and KB)
     - `knowledgebase_service.py`: Vector search and knowledge base operations
     - `vector_db.py`: Vector database operations and file processing
     - `file_storage.py`: Physical file storage abstraction
     - `text_extraction.py`: Document text extraction and processing

3. **Models** (database): SQLAlchemy ORM models with relationships
   - Located in `/models/` directory:
     - `user.py`: User authentication and roles
     - `project.py`: Project entities and user associations
     - `conversation.py`: Chat conversations and metadata
     - `message.py`: Individual messages with token tracking
     - `project_file.py`: File metadata and relationships
     - `artifact.py`: Generated artifacts and exports
     - `knowledge_base.py`: Knowledge base configuration

4. **Utils** (shared functionality): Cross-cutting concerns
   - Located in `/utils/` directory:
     - `auth_utils.py`: JWT authentication and session management
     - `logging_config.py`: Structured logging with correlation IDs
     - `db_utils.py`: Database utilities and query helpers
     - `sentry_utils.py`: Error tracking and performance monitoring
     - `response_utils.py`: Standardized API response formatting

### Frontend Architecture

The frontend uses a modular ES6 architecture with strict dependency injection and a sophisticated initialization system:

1. **Main Entrypoint**: `static/js/app.js`
   - Orchestrates the full initialization sequence
   - Manages dependency system and service registration
   - Coordinates authentication, UI, and core system setup

2. **Initialization System** (`static/js/init/`):
   - `appState.js`: Centralized application state management with single source of truth
   - `authInit.js`: Authentication system initialization and state change handling
   - `coreInit.js`: Core systems (modal manager, auth module, model config, chat manager)
   - `serviceInit.js`: Service registration and dependency wiring
   - `uiInit.js`: UI component initialization and template loading
   - `errorInit.js`: Global error handling and unhandled promise rejection tracking

3. **Core Modules**:
   - `auth.js`: Authentication with AuthBus event system and consolidated state management
   - `projectManager.js`: Project data operations and lifecycle management
   - `chat.js`: Chat UI, messaging, and AI model interactions
   - `modelConfig.js`: AI model configuration and selection
   - `sidebar.js`: Navigation and UI components
   - `knowledgeBaseComponent.js`: Knowledge base functionality and file management

4. **Utility Modules** (`static/js/utils/`):
   - `domAPI.js`: Abstracted DOM manipulation with dependency injection
   - `apiClient.js`: Centralized HTTP client with CSRF and error handling
   - `domReadinessService.js`: Unified DOM and dependency readiness management
   - `browserService.js`: Browser API abstraction layer
   - `logger.js`: Structured logging with correlation IDs and server integration
   - `eventHandler.js`: Centralized event management with context tracking

## Code Guardrails

### Frontend Guardrails

1. **Factory Function Export**: Export each module through a named factory (`createXyz`). Validate all dependencies at the top and expose a cleanup API. No top-level logic.
2. **Strict Dependency Injection**: No direct access to `window`, `document`, `console`, or any global directly. Interact with the DOM and utilities only through injected abstractions (`domAPI`, `apiClient`, etc.).
3. **Pure Imports**: No side effects at import time; all initialization occurs inside the factory.
4. **Centralized Event Handling**: Register listeners with `eventHandlers.trackListener(..., { context })` and remove them with `eventHandlers.cleanupListeners({ context })`.
5. **Context Tags**: Supply a unique `context` string for every listener and log message.
6. **Sanitize All User HTML**: Always call `sanitizer.sanitize()` before inserting user content into the DOM.
7. **domReadinessService Only**: All DOM and application readiness must be performed solely via DI-injected `domReadinessService`:
   ```js
   await domReadinessService.waitForEvent('app:ready');
   await domReadinessService.dependenciesAndElements(['#myElement']);
   ```
8. **Authentication State Management**: Single source of truth is `appModule.state.isAuthenticated` and `appModule.state.currentUser`. No local auth state variables.
9. **Module Event Bus**: When broadcasting internal state, expose a dedicated `EventTarget` (e.g., `AuthBus`) so other modules can subscribe without tight coupling.
10. **Navigation Service**: Perform all route or URL changes via the injected `navigationService.navigateTo(...)`.
11. **Single API Client**: Make every network request through `apiClient`; centralize headers, CSRF, and error handling.
12. **Structured Logging**:
    - All logging through DI-provided logger with correlation IDs and context tracking
    - Direct use of `console.*` is forbidden (use logger.info, logger.error, etc.)
    - Every logger message must include a context string
    - Use `safeHandler` for wrapping event handlers to ensure errors are logged
    - Logger supports server-side log ingestion with session and trace correlation

### Backend Guardrails

1. **FastAPI Initialization**: Defined in `main.py`, with modularized APIRouters.
2. **Dependency Injection**: Use FastAPI's `Depends()`, avoid global state.
3. **Service Structure**: Clearly isolated, no HTTP responses, raise domain exceptions.
4. **Async ORM**: Use async SQLAlchemy ORM through utility patterns.
5. **Security**: Cookie-based sessions, validate all user/session claims.
6. **Configuration**: Environment-driven via Pydantic BaseSettings.
7. **Import Safety**: No side-effects, I/O, or HTTP calls at import-time.
8. **Async Design**: No blocking calls in async code paths.

## Common Workflows

1. Adding a new API endpoint:
   - Create/update route in appropriate file in `/routes/`
   - Implement business logic in service layer
   - Define request/response models with Pydantic

2. Adding new frontend features:
   - DO NOT create new modules unless absolutely necessary
   - Extend existing modules using factory pattern
   - Register with DependencySystem
   - Use event handlers for DOM interaction
   - Implement proper cleanup

3. Database changes:
   - Update models in `/models/` directory
   - Use SQLAlchemy async ORM patterns
   - Implement migration if needed

## Code Quality Tools

### Pattern Checker for Frontend

The project includes a pattern checker tool that validates frontend code against the guardrails:

```bash
# Run pattern checker on specific files
node scripts/patternsChecker.cjs path/to/file.js

# Check for violations of a specific rule
node scripts/patternsChecker.cjs --rule=1 path/to/file.js
```

This tool validates:
- Factory function exports
- Dependency injection
- Pure imports
- Event handling
- Proper error logging
- And more according to the frontend guardrails

## Recent Refactoring Progress (app.js)

### Completed Refactoring (24% Size Reduction)

**Original**: 1,611 lines → **Current**: 1,224 lines (**387 lines removed**)

#### Successful Extractions (Following Guardrails):

1. **authInit.js** (239 lines)
   - Auth system initialization
   - Auth state change handling
   - Auth header rendering
   - Login modal management

2. **appState.js** (86 lines)
   - Centralized app state management
   - Authentication state tracking
   - Lifecycle state management
   - Helper methods for state access

3. **errorInit.js** (108 lines)
   - Global error handling setup
   - Unhandled promise rejection tracking
   - Centralized error logging

#### Key Guardrails Compliance Lessons:

- **CRITICAL**: Never create new modules (.clinerules/custominstructions.md Rule #6)
- **Use existing structure**: Work within `init/` directory modules only
- **Extend, don't create**: Populate existing empty init files rather than creating new ones
- **Preserve patterns**: Follow existing factory function exports and DI patterns

#### Remaining Opportunities:

While respecting the "no new modules" rule, further reduction is possible by:
- Moving utility functions within existing modules
- Consolidating duplicate patterns (70+ `DependencySystem.modules.get()` calls)
- Refactoring within the existing init structure
- Simplifying the main init() function complexity

The refactoring successfully reduced app.js complexity while maintaining all functionality and strictly following project guardrails.
