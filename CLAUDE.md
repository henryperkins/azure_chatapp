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

### Frontend Guardrails (Actual Implementation)

1. **Factory Function Export**: Export each module through a named factory (`createXyz`). Validate dependencies and expose cleanup API:
   ```js
   export function createMyModule({ DependencySystem, logger, domAPI }) {
     if (!DependencySystem || !logger || !domAPI) {
       throw new Error('[myModule] Missing required dependencies');
     }
     return { cleanup() { /* cleanup logic */ } };
   }
   ```

2. **Strict Dependency Injection**: No direct globals. Use injected abstractions:
   - `domAPI` for DOM manipulation (not `document`)
   - `apiClient` for HTTP requests (not `fetch`)
   - `logger` for logging (not `console`)
   - `browserService` for browser APIs (not `window`)

3. **Pure Imports**: No side effects at import time. Only `app.js` is exempt as the bootstrap orchestrator.

4. **Centralized Event Handling**: Use `eventHandlers.trackListener()` with context:
   ```js
   eventHandlers.trackListener(element, 'click', handler, { context: 'ModuleName' });
   eventHandlers.cleanupListeners({ context: 'ModuleName' });
   ```

5. **Authentication State**: Single source of truth is `appModule.state.isAuthenticated` and `appModule.state.currentUser`. No local auth state variables.

6. **Structured Logging**: Use DI logger with correlation IDs:
   ```js
   logger.info('Operation completed', { context: 'ModuleName.operation', userId: user.id });
   logger.error('Operation failed', error, { context: 'ModuleName.operation' });
   ```

7. **DOM Readiness**: Use `domReadinessService` for all DOM/dependency waiting:
   ```js
   await domReadinessService.documentReady();
   await domReadinessService.dependenciesAndElements({
     deps: ['auth', 'modalManager'],
     domSelectors: ['#myElement']
   });
   ```

8. **Error Handling**: Use `safeHandler` for event handlers:
   ```js
   const safeHandler = DependencySystem.modules.get('safeHandler');
   const handler = safeHandler(myFunction, 'ModuleName.handler');
   ```

### Backend Guardrails (Actual Implementation)

1. **FastAPI Initialization**: Defined in `main.py` with modularized APIRouters:
   ```python
   app.include_router(auth_router, prefix="/api/auth", tags=["authentication"])
   app.include_router(projects_router, prefix="/api/projects", tags=["projects"])
   app.include_router(project_files_router, prefix="/api/projects/{project_id}/files", tags=["files"])
   ```

2. **Route Structure**: Thin controllers that delegate to services:
   ```python
   @router.post("/", response_model=dict)
   async def create_project(
       project_data: ProjectCreate,
       current_user_tuple: Tuple[User, str] = Depends(get_current_user_and_token),
       db: AsyncSession = Depends(get_async_session),
   ):
       # Delegate to service layer
       project = await svc_create_project(user_id=current_user.id, ...)
   ```

3. **Service Layer**: Business logic with domain exceptions (no HTTPException):
   ```python
   async def create_project(user_id: int, name: str, db: AsyncSession) -> Project:
       if not name.strip():
           raise ValueError("Project name cannot be empty")  # Domain exception
   ```

4. **Structured Logging**: Context variables and JSON formatting:
   ```python
   from utils.logging_config import request_id_var, trace_id_var
   logger.info("Project created", extra={
       "request_id": request_id_var.get(),
       "project_id": str(project.id)
   })
   ```

5. **Sentry Integration**: Performance tracing and error monitoring:
   ```python
   with sentry_span_context(op="project", description="Create project") as span:
       span.set_tag("user.id", str(current_user.id))
       metrics.incr("project.create.success")
   ```

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

The project includes a comprehensive pattern checker (`scripts/patternsChecker.cjs`) that validates frontend code against 18 specific guardrail rules:

```bash
# Run pattern checker on specific files
node scripts/patternsChecker.cjs static/js/**/*.js

# Check for violations of a specific rule
node scripts/patternsChecker.cjs --rule=1 static/js/myModule.js
```

**Validated Rules** (from actual implementation):
1. Factory Function Export - `createXyz` pattern with dependency validation
2. Strict Dependency Injection - No direct `window`, `document`, `console` access
3. Pure Imports - No side effects at import time
4. Centralized Event Handling - `eventHandlers.trackListener` usage
5. Context Tags - Required context strings for all listeners/logs
6. Sanitize All User HTML - `sanitizer.sanitize()` before DOM insertion
7. domReadinessService Only - No custom DOM readiness patterns
8. Authentication State Management - Single source via `appModule.state`
9. Module Event Bus - Dedicated EventTarget usage
10. Navigation Service - Centralized routing
11. Single API Client - No direct fetch usage
12. Structured Logging - DI logger with context required
13. Authentication Consolidation - No duplicate auth patterns
14. Module Size Limit - Maximum 1000 lines per module
15. Canonical Implementations - Use approved patterns only
16. Error Object Structure - Standard `{ status, data, message }` format
17. Logger Factory Placement - Only in `logger.js` or `app.js`
18. Obsolete Logger APIs - Deprecated patterns detection

**Configuration** (from `package.json`):
```json
"patternsChecker": {
  "objectNames": {
    "globalApp": "appModule",
    "stateProperty": "state"
  },
  "knownBusNames": ["eventBus", "moduleBus", "appBus", "AuthBus"]
}
```

## Recent Refactoring Progress (app.js)

### Completed Refactoring (24% Size Reduction)

**Original**: 1,611 lines → **Current**: 1,224 lines (**387 lines removed**, 24% reduction)

#### Successful Extractions (Following Guardrails):

1. **authInit.js** (239 lines) - Authentication system initialization
   - Auth system initialization with dependency validation
   - Auth state change handling via AuthBus events
   - Auth header rendering and UI updates
   - Login modal management and form handling

2. **appState.js** (86 lines) - Centralized application state
   - Single source of truth for authentication state (`isAuthenticated`, `currentUser`)
   - Project state management (`currentProjectId`, `currentProject`)
   - Lifecycle state tracking (`isInitialized`, `isShuttingDown`)
   - Helper methods for state access and updates

3. **errorInit.js** (108 lines) - Global error handling
   - Global error handling setup with structured logging
   - Unhandled promise rejection tracking and reporting
   - Centralized error logging with correlation IDs
   - Sentry integration for error monitoring

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

## Development Workflow

### Frontend Development (Actual Patterns)

1. **Module Creation**: Follow factory pattern with strict dependency validation:
   ```js
   export function createMyModule({ DependencySystem, logger, domAPI, apiClient }) {
     // Validate all dependencies first
     if (!DependencySystem || !logger || !domAPI || !apiClient) {
       throw new Error('[MyModule] Missing required dependencies');
     }
     // Module implementation
     return { cleanup() { /* cleanup logic */ } };
   }
   ```

2. **Testing**: Use pattern checker for code quality validation:
   ```bash
   node scripts/patternsChecker.cjs static/js/**/*.js
   ```

3. **Debugging**: Use structured logging with correlation IDs:
   ```js
   logger.info('Operation started', { context: 'MyModule.operation', userId: user.id });
   ```

4. **Event Handling**: Always use centralized event system with context:
   ```js
   eventHandlers.trackListener(element, 'click', handler, { context: 'MyModule' });
   ```

### Backend Development (Actual Patterns)

1. **Route Creation**: Thin controllers that delegate to services:
   ```python
   @router.post("/")
   async def create_item(data: ItemCreate, user: User = Depends(get_current_user)):
       return await item_service.create(user.id, data.dict())
   ```

2. **Service Implementation**: Business logic with domain exceptions:
   ```python
   async def create_item(user_id: int, data: dict) -> Item:
       if not data.get('name'):
           raise ValueError("Name is required")  # Domain exception, not HTTPException
   ```

3. **Database Operations**: Async SQLAlchemy with proper session management:
   ```python
   async def get_items(user_id: int, db: AsyncSession) -> List[Item]:
       result = await db.execute(select(Item).where(Item.user_id == user_id))
       return result.scalars().all()
   ```

4. **Error Handling**: Structured logging with context variables:
   ```python
   logger.error("Operation failed", extra={
       "request_id": request_id_var.get(),
       "user_id": str(user_id)
   })
   ```
