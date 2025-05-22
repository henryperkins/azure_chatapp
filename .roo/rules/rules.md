# 🛡️ LLM System Prompt – Frontend Code Guardrails

Apply these guardrails whenever you (the LLM) generate, refactor, or review **JavaScript/TypeScript frontend code** in this repository. Enforce them strictly; flag any violation and propose a compliant fix.

1. **Factory Function Export** – Export each module through a named factory (`createXyz`). Validate all dependencies at the top and expose a cleanup API. _No top‑level logic._
2. **Strict Dependency Injection** – Do **not** access `window`, `document`, `console`, or any global directly. Interact with the DOM and utilities only through injected abstractions (`domAPI`, `apiClient`, etc.).
3. **Pure Imports** – Produce no side effects at import time; all initialization occurs inside the factory.
4. **Centralized Event Handling** – Register listeners with `eventHandlers.trackListener(..., { context })` and remove them with `eventHandlers.cleanupListeners({ context })`.
5. **Context Tags** – Supply a unique `context` string for every listener.
6. **Sanitize All User HTML** – Always call `sanitizer.sanitize()` before inserting user content into the DOM.
7. **App Readiness via domReadinessService (MANDATORY)** –
   _Do NOT use custom readiness logic (no ad-hoc promises, timeouts, manual `'app:ready'` listeners, or direct `DependencySystem.waitFor([…])` calls)._
   **All DOM and application readiness must be performed solely via DI-injected `domReadinessService`.**
   - Every module MUST receive `domReadinessService` via DI (never import directly except as a factory for fallback).
   - Use ONLY:
     ```js
     await this.domReadinessService.waitForEvent(...);
     await this.domReadinessService.dependenciesAndElements(...);
     ```
   - Flag any module logic waiting for DOM/app readiness outside this service and refactor accordingly.

8. **Central `app.state` Only** – Read global authentication and initialization flags from `app.state`; do **not** mutate them directly.
9. **Module Event Bus** – When broadcasting internal state, expose a dedicated `EventTarget` (e.g., `AuthBus`) so other modules can subscribe without tight coupling.
10. **Navigation Service** – Perform all route or URL changes via the injected `navigationService.navigateTo(...)`.
11. **Single API Client** – Make every network request through `apiClient`; centralize headers, CSRF, and error handling.

---

### 🚨 Logging & Observability Guardrails (Strict)

- **Logger Usage**:
  All errors, warnings, and significant control-flow branches in frontend code **MUST** be logged through the DI-provided logger:
  ```js
  const logger = DependencySystem.modules.get('logger');
  logger.error('Something failed', err);
  ```
  - Direct use of `console.log`, `console.error`, etc. is **forbidden**.
  - Only use the injected/DI logger throughout modules. If logger is not available, fail fast or surface a clear module-level initialization error.
- **Error Logging in Factories & Event Handlers**:
  Any exception thrown or caught inside:
    - Main module flows (`init`, `destroy`, etc.)
    - Any UI event handler, callback, or async handler
  **MUST** be reported via `logger.error` (with context description and stack, if possible).
- **Contextual Tagging**:
  Every logger message **MUST** include a context string or description for source traceability, and should provide a stack/context if it is available.
- **No Global Console**:
  Suppress all `console.*` usage within this codebase—route all logging through the DI-registered logger per above.
- **Logging Implementation**:
  The unified logger (see `static/js/logger.js`) must support logging to both browser console and server (via `/api/logs`). All `logger` methods must trigger a server log, and log entries should be structured (level, context, args, timestamp).
- **Code Example (event handler wrapping):**
  ```js
  function safeHandler(handler, description) {
    return (...args) => {
      try {
        return handler(...args);
      } catch (err) {
        logger.error(`[Sidebar][${description}]`, err && err.stack ? err.stack : err);
        throw err;
      }
    }
  }
  ```
  Use this pattern for **all** user-facing button handlers, tabs, search inputs, etc.

---

**Golden Rules**: Inject every dependency, avoid global side effects, tag artifacts with `context`, route all logs through DI logging, clean up listeners and resources.

---

Please ensure all frontend code contributions comply with these guardrails.


---

Here's a refined and simplified version of your Python Backend Code Guardrails, optimized specifically to be easily understood by humans and clearly interpretable by LLMs. This version emphasizes actionable instructions and explicitly highlights common anti-patterns for each guideline.

---

# 🛡️ Python Backend Code Guardrails

These guardrails ensure consistent, secure, and maintainable Python backend code across this project. They are mandatory for human and AI-assisted development.

## ✅ **1. Application Structure**

* **FastAPI Initialization**:

  * **Required**: Define FastAPI initialization explicitly in `main.py`.
  * **Required**: Modularize routes using separate `APIRouter` files per domain.
  * **Anti-Pattern**: Defining routes directly in `main.py`; mixing unrelated routes.

* **Route Handlers (Thin Controllers)**:

  * **Required**: Handlers ONLY parse requests, call services, and format responses.
  * **Anti-Pattern**: Implementing DB queries or business logic directly in route handlers.

* **Pydantic Response Models**:

  * **Required**: Always specify concrete Pydantic models for responses (`response_model`).
  * **Anti-Pattern**: Returning raw dictionaries or generic types (`dict`).

---

## ✅ **2. Dependency Injection (DI)**

* **Explicit DI**:

  * **Required**: Inject dependencies explicitly using FastAPI’s `Depends()`.
  * **Anti-Pattern**: Importing global or singleton dependencies directly at module-level.

* **Avoid Global State**:

  * **Required**: Resources like DB sessions, API clients, or configuration MUST be injected.
  * **Anti-Pattern**: Module-level initialization (e.g., `client = SomeClient(settings.KEY)`).

---

## ✅ **3. Services and Business Logic**

* **Domain Isolation**:

  * **Required**: Clearly isolate services by domain (`project_service.py`, `chat_service.py`).
  * **Anti-Pattern**: Mixed or vague boundaries across domains (e.g., embedding logic in route handlers).

* **Business Logic Encapsulation**:

  * **Required**: All business logic, including DB interactions, validation, and state changes, MUST reside in services.
  * **Anti-Pattern**: Direct business logic or database calls within routers or utilities.

* **Service Errors**:

  * **Required**: Raise application-specific exceptions from services (e.g., `ProjectNotFoundError`).
  * **Anti-Pattern**: Raising FastAPI `HTTPException` directly from services.

---

## ✅ **4. Database Management**

* **Async ORM Usage**:

  * **Required**: Use Async SQLAlchemy ORM exclusively via `db_utils.py`.
  * **Anti-Pattern**: Using synchronous SQLAlchemy or raw SQL in routers/services.

* **Database Logic Confinement**:

  * **Required**: Keep all DB operations confined strictly within services or repositories.
  * **Anti-Pattern**: Database calls directly inside route handlers or utilities.

---

## ✅ **5. Authentication & Security**

* **Cookie-Based Sessions**:

  * **Required**: Use HttpOnly, Secure, and SameSite cookies. Implement CSRF protection explicitly.
  * **Anti-Pattern**: JWTs stored in localStorage; omitting CSRF protection.

* **Explicit User Validation**:

  * **Required**: Always validate user permissions against the authenticated session context.
  * **Anti-Pattern**: Trusting client-supplied user or resource identifiers without server-side checks.

---

## ✅ **6. Configuration Handling**

* **Pydantic BaseSettings**:

  * **Required**: Manage all config via environment variables using Pydantic's `BaseSettings`.
  * **Anti-Pattern**: Hard-coding API keys or sensitive configuration values.

* **Injection over Global Access**:

  * **Required**: Inject configuration explicitly via DI.
  * **Anti-Pattern**: Globally importing configuration (`from config import settings`).

---

## ✅ **7. Logging & Monitoring**

* **Structured Logging**:

  * **Required**: Use structured JSON logs (`logging_config.py`).
  * **Anti-Pattern**: Using raw `print()` statements or inconsistent log formatting.

* **Contextual Logs**:

  * **Required**: Include Request IDs, User IDs, etc., using context variables.
  * **Anti-Pattern**: Logs lacking contextual metadata.

---

## ✅ **8. Validation & Serialization**

* **Mandatory Pydantic**:

  * **Required**: Use strict Pydantic models for request and response validation.
  * **Anti-Pattern**: Hand-written validation logic or weakly typed models (`dict`).

---

## ✅ **9. Background Tasks**

* **Dedicated Task Modules**:

  * **Required**: Isolate long-running tasks in dedicated Celery tasks or FastAPI BackgroundTasks.
  * **Anti-Pattern**: Executing synchronous, long-running logic directly inside route handlers.

---

## ✅ **10. External Integrations**

* **Dedicated Client Modules**:

  * **Required**: Use dedicated modules/classes for external APIs (`openai.py`).
  * **Anti-Pattern**: Scattered or duplicated external API logic.

* **Error Abstraction**:

  * **Required**: Abstract external errors into custom app exceptions.
  * **Anti-Pattern**: Exposing external library exceptions directly.

---

## ✅ **11. Utility Modules & Shared Code**

* **Import-Safe Modules**:

  * **Required**: Modules must avoid I/O, external calls, or heavy computation at import time.
  * **Anti-Pattern**: Executing HTTP requests, DB connections, or loading ML models at import.

* **Async-Friendly Design**:

  * **Required**: Avoid blocking calls (`time.sleep`, synchronous I/O). Use `aiofiles`, `asyncio.sleep`, and `asyncio.to_thread` as necessary.
  * **Anti-Pattern**: Synchronous blocking operations within async paths.

---

## ✅ **12. Middleware**

* **Scoped Middleware**:

  * **Required**: Clearly scoped middleware in dedicated modules (`middlewares.py`).
  * **Anti-Pattern**: Implementing complex business logic inside middleware.

---

## ✅ **13. Testing**

* **Comprehensive pytest Suite**:

  * **Required**: Use `pytest`, including `pytest-asyncio` for async code paths.
  * **Anti-Pattern**: Untested or poorly tested code; test gaps.

* **Dependency Mocking**:

  * **Required**: Mock dependencies in tests explicitly.
  * **Anti-Pattern**: Tight coupling, hindering mocking during tests.

---

## ✅ **14. Performance**

* **Non-blocking Async Operations**:

  * **Required**: Strictly use async code in all critical I/O paths.
  * **Anti-Pattern**: Blocking operations (`time.sleep`, synchronous file or DB calls) in async contexts.

* **Database Query Optimization**:

  * **Required**: Prevent N+1 queries using eager-loading strategies (`selectinload`, etc.).
  * **Anti-Pattern**: Unoptimized ORM queries causing performance degradation.

---

## ✅ **15. DRY (Don't Repeat Yourself)**

* **Eliminate Duplication**:

  * **Required**: Extract common logic into utilities, services, or FastAPI dependencies.
  * **Anti-Pattern**: Similar logic scattered across multiple files.

---

## 🚩 **Common Anti-Patterns Checklist (for AI Interpretation)**

LLMs MUST actively detect and avoid the following anti-patterns:

* Database or heavy logic in route handlers
* Global imports of configuration objects
* Blocking operations in async code paths
* External resources initialized at module import
* Generic response types (`dict`) in API responses
* Hard-coded secrets/configuration values
* Middleware used for business logic
* Unhandled or external exceptions directly exposed
* Unclear or overlapping domain/service boundaries
* Unmockable dependencies causing testing friction

---

## 🔍 **Document Purpose**

These guardrails clearly outline **what to do**, **what to avoid**, and explicitly flag **common anti-patterns**. They are designed explicitly for:

* **Easy comprehension** by developers.
* **Clear, unambiguous interpretation** by LLMs or code-generation tools.
* **Maintaining quality, security, and performance** of the backend codebase.

Regularly revisit this document to evolve alongside the project’s needs and discoveries.

---

