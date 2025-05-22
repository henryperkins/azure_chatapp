# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a full-stack, project-based chat and knowledge management application leveraging Azure OpenAI, Anthropic Claude, JWT authentication, and modular ES6 frontend with Tailwind CSS and DaisyUI.

### Key Features
- Project-based organization: each user can manage multiple projects
- Real-time chat with AI models (Claude, GPT, Azure OpenAI, etc.)
- JWT authentication with secure HttpOnly cookies and CSRF protection
- File and artifact management per project
- Knowledge base per project with file upload, search, and reindexing
- Modular, event-driven frontend (ES6 modules, DependencySystem DI)
- Tailwind CSS with DaisyUI for theming
- Sentry integration for error and performance monitoring (backend & frontend)

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

# Build and watch CSS changes
pnpm run watch:css  # or: npm run watch:css

# Start the full development environment
pnpm run dev  # or: npm run dev
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

The backend follows a layered architecture:

1. **Route Handlers** (thin controllers): Parse requests, call services, format responses
   - Located in `/routes/` directory
   - Organized by domain (projects, knowledge_base, conversations)

2. **Services** (business logic): All core logic, validation, state manipulation
   - Located in `/services/` directory 
   - Examples: `project_service.py`, `conversation_service.py`, `file_storage.py`

3. **Models** (database): SQLAlchemy ORM models
   - Located in `/models/` directory
   - Define database schema and relationships

4. **Utils** (shared functionality): Cross-cutting concerns
   - Located in `/utils/` directory
   - Authentication, logging, error handling, serialization

### Frontend Architecture

The frontend uses a modular ES6 architecture with strict dependency injection:

1. **Main Entrypoint**: `static/js/app.js`
   - Initializes the dependency system
   - Registers event listeners and bootstraps UI components

2. **Core Modules**:
   - `projectManager.js`: Manages project data and operations
   - `chat.js`: Handles chat UI and messaging
   - `modelConfig.js`: Configuration for AI models
   - `sidebar.js`: Navigation and UI components
   - `knowledgeBaseComponent.js`: Knowledge base functionality

3. **Utility Modules**:
   - Located in `/static/js/utils/`
   - API client, DOM manipulation, storage services

## Code Guardrails

### Frontend Guardrails

1. **Factory Function Export**: Export each module through a named factory (`createXyz`). Validate all dependencies at the top and expose a cleanup API. No top-level logic.
2. **Strict Dependency Injection**: No direct access to `window`, `document`, `console`, or any global directly. Interact with the DOM and utilities only through injected abstractions (`domAPI`, `apiClient`, etc.).
3. **Pure Imports**: No side effects at import time; all initialization occurs inside the factory.
4. **Centralized Event Handling**: Register listeners with `eventHandlers.trackListener(..., { context })` and remove them with `eventHandlers.cleanupListeners({ context })`.
5. **Context Tags**: Supply a unique `context` string for every listener.
6. **Sanitize All User HTML**: Always call `sanitizer.sanitize()` before inserting user content into the DOM.
7. **App Readiness via domReadinessService**: All DOM and application readiness must be performed solely via DI-injected `domReadinessService`. Use only:
   ```js
   await this.domReadinessService.waitForEvent(...);
   await this.domReadinessService.dependenciesAndElements(...);
   ```
8. **Central `app.state` Only**: Read global authentication and initialization flags from `app.state`; do not mutate them directly.
9. **Module Event Bus**: When broadcasting internal state, expose a dedicated `EventTarget` so other modules can subscribe without tight coupling.
10. **Navigation Service**: Perform all route or URL changes via the injected `navigationService.navigateTo(...)`.
11. **Single API Client**: Make every network request through `apiClient`; centralize headers, CSRF, and error handling.
12. **Logging & Observability**: 
    - All errors, warnings, and significant control-flow branches must be logged through the DI-provided logger
    - Direct use of `console.log`, `console.error`, etc. is forbidden
    - Every logger message must include a context string
    - Use `safeHandler` for wrapping event handlers to ensure errors are logged

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