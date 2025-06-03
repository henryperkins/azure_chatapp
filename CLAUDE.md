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
- **Modern UI/UX**: Tailwind CSS v4 and DaisyUI v5, fully supported (with mobile-responsive design)

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
# Install frontend dependencies (use npm for canonical installs)
npm ci  # canonical, reproducible
# pnpm install   # allowed if syncing lockfiles (see repo policy)
```

### Development

```bash
# Start the FastAPI backend with hot reload
uvicorn main:app --reload

# Build and watch Tailwind CSS via PostCSS
npm run watch:css

# (Optional) One-shot CSS build
npm run build:css

# Run end-to-end Playwright tests
npm run test:e2e

# Run pattern checker for frontend code quality
node scripts/patternsChecker.cjs static/js/**/*.js
```

### Linting

```bash
# JavaScript/TypeScript linting
npm run lint
# With auto-fix
npm run lint -- --fix

# CSS linting
npm run lint:css
# With auto-fix
npm run lint:css -- --fix

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

## 🔍 Pull-Request Guardrails Checklist

(_CI will block the merge unless every box is ticked; mirrors
`.github/pull_request_template.md`_)

- [ ] No module except **`static/js/init/appInitializer.js`** tracks lifecycle / initialization flags internally
- [ ] All public module methods remain stateless and idempotent; internal mutation of the shared state object is allowed
- [ ] Initialization sequencing is managed **only** from
      `static/js/init/appInitializer.js` ( `app.js` is a thin wrapper)
- [ ] Every source file exports exactly one factory function (pure DI);
      no top-level side-effects

  _Exceptions: canonical root-level DI factories (`logger.js`, `logDeliveryService.js`, `safeHandler.js`, and `constants/*.js`) are allowed._
  These must **also** follow the factory pattern (e.g. `createLogger`, `createLogDeliveryService`) and _not_ export singleton objects. This ensures strict DI compliance while permitting their special root placement.

- [ ] Every `cleanup()` exists, is idempotent, and calls
      `eventHandlers.cleanupListeners({ context })`

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

1. **Bootstrap Entrypoint**: `static/js/init/appInitializer.js`
   - Performs the full initialization sequence (dependency registration, service wiring, state-store creation)
   - Coordinates authentication, UI, model configuration, chat, and logging pipelines
   - **`static/js/app.js`** now acts only as a thin wrapper that instantiates and calls `appInitializer.initializeApp()`

2. **Initialization System** (`static/js/init/`):
   - `appInitializer.js`: **Single-file orchestrator** that sets up DependencySystem, registers modules, constructs the shared state container, and kicks off services (auth, UI, model config, chat, logging).
   _All previous split init files (`authInit.js`, `coreInit.js`, etc.) were merged during the 2025 refactor._

3. **Core Modules**:
   - `auth.js`: Authentication with AuthBus event system and consolidated state management
   - `projectManager.js`: Project data operations and lifecycle management
   - `chat.js`: Chat UI, messaging, and AI model interactions
   - `modelConfig.js`: AI model configuration and selection
   - `sidebar.js`: Navigation and UI components
   - `knowledgeBaseComponent.js`: Knowledge base functionality and file management

4. **Utility Modules** (`static/js/utils/` and root `static/js/`):
   - `domAPI.js`: Abstracted DOM manipulation with dependency injection
   - `apiClient.js`: Centralized HTTP client with CSRF and error handling
   - `domReadinessService.js`: Unified DOM and dependency readiness management
   - `browserService.js`: Browser API abstraction layer
   - `logger.js`: Structured logging core (root)
   - `logDeliveryService.js`: Batched server log delivery (root)
   - `safeHandler.js`: DI-safe wrapper for error-resilient callbacks (root)
   - `utils/getSafeHandler.js`: Helper to retrieve the shared SafeHandler instance
   - `eventHandler.js`: Centralized event management with context tracking

> **Tailwind CSS/DaisyUI Note**:
> The project uses Tailwind CSS v4 and DaisyUI v5. DaisyUI now fully supports Tailwind CSS v4—no pinning or compatibility workarounds are required.

### Frontend Logging Architecture

The client-side logging stack ensures robust, structured diagnostics and seamless server aggregation:

1. **[`logger.js`](static/js/logger.js:1)** – Core logger **factory** (`createLogger`) producing structured log objects, console mirroring, and dispatching `app:log` `CustomEvent`s.
2. **[`logDeliveryService.js`](static/js/logDeliveryService.js:1)** – Batched server log delivery **factory** (`createLogDeliveryService`). Listens for `app:log`, batches `warn`/`error`/`critical` entries (100 × 5 s default) and POSTs them to `/api/logs` using the DI-injected `apiClient`.
3. **[`safeHandler.js`](static/js/safeHandler.js:1)** – Provides `safeHandler(fn, description)` to wrap callbacks, capture exceptions, and forward them to the logger without breaking UI flow.
4. **[`utils/getSafeHandler.js`](static/js/utils/getSafeHandler.js:1)** – Convenience helper that retrieves the active `safeHandler` instance from `DependencySystem`.
5. **[`eventHandler.js`](static/js/eventHandler.js:1)** – Central listener orchestrator that automatically wraps handlers with `safeHandler`, tags events with context, and propagates logs.
6. **[`init/appInitializer.js`](static/js/init/appInitializer.js:21)** – Wires the logging pipeline: creates the logger, injects it into `eventHandlers`, upgrades the stub `safeHandler`, and boots `logDeliveryService` during `serviceInit`.

_Log Flow:_
`module → safeHandler → logger (dispatch ⟶ app:log) → logDeliveryService → /api/logs`

Logging behaviour is configurable via `APP_CONFIG.LOGGING` (levels, console echo, backend toggle).

---

## Code Guardrails

### Guardrails (Actual Implementation)

#### Adding New Modules

The repository uses `allowed-modules.json` to enforce the "no new modules except by allow-list" policy. When adding a necessary new module, update `allowed-modules.json` in the same PR.

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

5. **Authentication State**: Do **not** create local auth state variables. Retrieve canonical auth state via
   `DependencySystem.modules.get('auth').state` (exposed by `createAuthModule`).

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

5. **ValueError → HTTPException Mapping**

FastAPI automatically converts certain domain exceptions to HTTP errors using an exception handler:

   ```python
   # utils/middlewares.py
   from fastapi.responses import JSONResponse

   @app.exception_handler(ValueError)
   async def value_error_handler(_, exc):
       return JSONResponse(status_code=400, content={"detail": str(exc)})
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
* **Lifecycle Flags** – No module other than **`appInitializer.js`** may declare or mutate lifecycle / readiness flags (`initialized`, `initializing`,`isReady`, `ready`, etc.). These flags live exclusively on the shared state object created inside `appInitializer.js`.
3. Pure Imports - No side effects at import time
4. Centralized Event Handling - `eventHandlers.trackListener` usage
5. Context Tags - Required context strings for all listeners/logs
6. Sanitize All User HTML - `sanitizer.sanitize()` before DOM insertion
7. domReadinessService Only - No custom DOM readiness patterns
8. Authentication State Management - Single source via `DependencySystem.modules.get('auth').state`
9. Module Event Bus - Dedicated EventTarget usage
10. Navigation Service - Centralized routing
11. Single API Client - Direct fetch calls are discouraged; new code must use `apiClient`. (Legacy direct fetch use remains in some modules.)
12. Structured Logging - DI logger with context required
13. Authentication Consolidation - No duplicate auth patterns
14. Module Size Limit - Maximum 1000 lines per module (static/js/init/appInitializer.js is exempt)
15. Canonical Implementations - Use approved patterns only
16. Error Object Structure - Standard `{ status, data, message }` format
17. Logger/Log Delivery Factory Placement - Only in `logger.js`, `logDeliveryService.js`, or `app.js` (see exemption note above). Root-level placement for these factories is canonical and compliant **if** they follow the explicit DI factory pattern.
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

<!-- [Removed 'Recent Refactoring Progress' section—see refactor.md for historical details] -->


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
