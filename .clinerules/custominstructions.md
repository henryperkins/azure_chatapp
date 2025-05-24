# 🛡️ Unified Code Guardrails

These guidelines apply strictly to **all** backend (Python/FastAPI) and frontend (JavaScript/TypeScript) development, maintenance, and AI-assisted code generation within this project. They ensure consistency, maintainability, performance, and security throughout the codebase.
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

8. **Central State Access** – Read global authentication and initialization flags from `appModule.state` (or its alias `app.state`); do **not** mutate them directly.
9. **Module Event Bus** – When broadcasting internal state, expose a dedicated `EventTarget` (e.g., `AuthBus`) so other modules can subscribe without tight coupling.
10. **Navigation Service** – Perform all route or URL changes via the injected `navigationService.navigateTo(...)`.
11. **Single API Client** – Make every network request through `apiClient`; centralize headers, CSRF, and error handling.

## 🚨 **CRITICAL: Authentication Pattern Change**

**⚠️ BREAKING CHANGE ALERT: Dual Authentication State ELIMINATED**

As of **December 2024**, the authentication system has been **completely consolidated** to eliminate dual state management:

### **✅ NEW PATTERN (MANDATORY):**
- **Single Source of Truth**: `appModule.state` is the ONLY place authentication state exists
- **Read Authentication**: `appModule.state.isAuthenticated` and `appModule.state.currentUser`
- **Listen for Changes**: Subscribe to `'authStateChanged'` events on `AuthBus`
- **No Local State**: Never store authentication state in individual modules

### **❌ OLD PATTERN (FORBIDDEN):**
- ~~`authState` object~~ - **ELIMINATED**
- ~~`auth.isAuthenticated()` fallback checks~~ - **REMOVED**
- ~~Individual module `setAuthState()` methods~~ - **REMOVED**
- ~~Dual authentication state synchronization~~ - **ELIMINATED**

### **🔧 Required Implementation:**
```javascript
// ✅ CORRECT: Read from canonical source
const appModule = DependencySystem.modules.get('appModule');
const isAuthenticated = appModule.state.isAuthenticated;
const currentUser = appModule.state.currentUser;

// ✅ CORRECT: Listen for auth changes
auth.AuthBus.addEventListener('authStateChanged', (event) => {
  const { authenticated, user } = event.detail;
  // React to auth state changes
});

// ❌ FORBIDDEN: No local authState variables
// const authState = { isAuthenticated: false }; // DON'T DO THIS

// ❌ FORBIDDEN: No fallback auth checks
// if (appModule.state.isAuthenticated || auth.isAuthenticated()) // DON'T DO THIS
```

**Any code using the old dual authentication pattern will be flagged as a violation and must be refactored immediately.**

## 🔧 **Code Standardization (CONSOLIDATED)**

**ALL hostile duplications have been eliminated. The following patterns are now MANDATORY:**

### **✅ CONSOLIDATED PATTERNS (ENFORCED):**

1. **SafeHandler Pattern**:
   - **Canonical Implementation**: `app.js` registered in DI system
   - **Usage**: All modules MUST use `DependencySystem.modules.get('safeHandler')`
   - **FORBIDDEN**: Custom safeHandler implementations, duplicate error handling wrappers

2. **Project State Management**:
   - **Single Source of Truth**: `appModule.state.currentProjectId` and `appModule.state.currentProject`
   - **Access**: Use `appModule.getCurrentProject()` and `appModule.setCurrentProject()`
   - **FORBIDDEN**: Local project state variables, competing project trackers

3. **Form Handlers**:
   - **Canonical Implementation**: `createAuthFormHandler()` in `auth.js`
   - **Pattern**: Generic factory with parameterized differences (login vs register)
   - **FORBIDDEN**: Duplicate form validation, separate login/register handlers

4. **URL Parsing**:
   - **Canonical Implementation**: `navigationService.js`
   - **Delegation**: `app.js` and other modules MUST delegate to navigationService
   - **FORBIDDEN**: Fallback URL parsing, duplicate URLSearchParams usage

5. **Error Objects**:
   - **Standard Structure**: `{ status, data, message }` (matches apiClient.js)
   - **Consistency**: Same error format across auth.js and apiClient.js
   - **FORBIDDEN**: Custom error object structures, inconsistent error properties

6. **Chat Initialization**:
   - **Canonical Handler**: `chatManager.js` via AppBus/AuthBus events
   - **Integration**: `projectDetailsComponent._restoreChatAndModelConfig()`
   - **FORBIDDEN**: Duplicate chat initialization logic in app.js or other modules

### **❌ ELIMINATED ANTI-PATTERNS:**
- Multiple `currentProjectId` trackers (was in 3 places)
- Competing authentication state managers (was in 3 places)
- Duplicate form handlers (70+ lines eliminated)
- Scattered URL parsing logic (3+ implementations)
- Inconsistent error object creation
- Redundant chat initialization triggers
- Multiple safeHandler implementations

### **🚨 ENFORCEMENT:**
Any code that reintroduces these eliminated patterns will be flagged as a **CRITICAL VIOLATION** and must be immediately refactored to use the canonical implementations.

---

## 📌 Table of Contents

1. [General Principles](#general-principles)
2. [Python Backend Code Guardrails](#python-backend-code-guardrails)
3. [Frontend Code Guardrails](#frontend-code-guardrails)
4. [🚩 Universal Red-Flag Checklist](#universal-red-flag-checklist)

---

## 🚧 General Principles

* **Dependency Injection Everywhere** – Inject all dependencies explicitly; avoid hidden globals.
* **Thin Boundaries** – Keep routes/controllers lightweight; delegate business logic to dedicated services.
* **Side-Effect-Free Imports** – No I/O, network calls, or heavy computations at import time.
* **Structured Logging & Observability** – JSON-formatted logs with contextual metadata; avoid plain `print()` or `console.*` calls.
* **Security First** – Validate all inputs, sanitize all outputs, enforce least privilege.
* **Async Consistency** – Maintain async/await consistency; never mix synchronous, blocking calls.
* **Fail Fast & Loud** – Surface errors quickly with descriptive contextual logs; no silent failures.

---

## 🐍 Python Backend Code Guardrails

> **Scope**: FastAPI applications using async SQLAlchemy and PostgreSQL.

### Application Structure

* **FastAPI Initialization**

  * ✅ Define explicitly in `main.py`.
  * ✅ Modularize routes using domain-specific `APIRouter` modules.
  * ❌ Avoid declaring routes directly in `main.py` or mixing unrelated routes in one file.

* **Route Handlers (Thin Controllers)**

  * ✅ Limit handlers to request validation, delegation, and response formatting.
  * ❌ Avoid DB queries or business logic inside handlers.

* **Response Models**

  * ✅ Use specific Pydantic models.
  * ❌ Avoid generic or ambiguous responses (`dict`, `Any`).

* **Package Organization**

  * ✅ Keep `__init__.py` minimal.
  * ❌ Avoid complex logic or side-effect imports in package inits.

### Dependency Injection

* ✅ Use explicit DI with FastAPI’s `Depends()`, constructor parameters, and factory methods.
* ✅ Defer resource-heavy initialization to DI or lifecycle events; never at module top.

### Services & Business Logic

* ✅ Domain-specific service modules; encapsulate all logic and raise domain-specific exceptions.
* ❌ Never raise FastAPI `HTTPException` directly from services.

### Database Management

* ✅ Exclusively use asynchronous SQLAlchemy.
* ✅ Confine queries strictly within service layers.
* ✅ Optimize queries using eager loading techniques (`selectinload`, `joinedload`); address N+1 issues proactively.

### Authentication & Security

* ✅ Implement secure cookie attributes (`HttpOnly`, `Secure`), enforce CSRF protection.
* ✅ Separate clearly authentication and authorization logic.

### Configuration Management

* ✅ Configure settings using Pydantic’s `BaseSettings` class sourced from environment variables.
* ✅ Inject settings explicitly via DI.

### Logging & Monitoring

* ✅ Structured JSON logs; include contextual metadata (request ID, user ID).
* ✅ Integrate error monitoring tools (e.g., Sentry).

### Validation & Serialization

* ✅ Use Pydantic consistently for all request/response validation; enforce strict schema validation.

### Background & Long-Running Tasks

* ✅ Move intensive tasks to Celery or FastAPI’s `BackgroundTasks`; include robust tracking and idempotency.

### External Integrations

* ✅ Encapsulate external APIs within dedicated client modules; handle retries and translate errors internally.

### Utility Modules & Shared Code

* ✅ Ensure modules are import-safe (no side effects at import time).
* ✅ Load heavy resources lazily; perform all I/O asynchronously (via `httpx.AsyncClient`, `aiofiles`).

### Middleware

* ✅ Restrict middleware to cross-cutting concerns (logging, auth); no business logic.

### Testing

* ✅ Write comprehensive async-compatible tests using `pytest` and `pytest-asyncio`.
* ✅ Leverage dependency overrides for isolation and accuracy in integration tests.

### Performance

* ✅ Ensure async consistency throughout; properly pool resources and connections.
* ✅ Regularly monitor and optimize query performance.

### Code Duplication (DRY Principle)

* ✅ Abstract repeated logic into reusable utilities; prioritize composition over inheritance.

---

## ⚛️ Frontend Code Guardrails

> **MOST IMPORTANT RULE:**
> **DO NOT, UNDER ANY CIRCUMSTANCES, CREATE A NEW MODULE FOR ANY REASON.**

* **Factory Function Export** – Export via named factories (`createXyz`); avoid top-level execution.
* **Strict Dependency Injection** – No direct globals (`window`, `document`, `console`); only use DI abstractions.
* **Pure Imports** – Ensure no side effects at import time.
* **Centralized Event Handling** – Register listeners using central handlers (`eventHandlers.trackListener`).
* **Context Tags** – Provide a unique context tag for each listener.
* **Sanitize User HTML** – Always sanitize via `sanitizer.sanitize()` before DOM insertion.
* **DOM Readiness (Mandatory)** – Use DI-provided `domReadinessService`; never ad-hoc readiness checks.
* **Centralized State Access** – Access global state via `appModule.state`; never mutate it directly.
* **Module Event Bus** – Use dedicated `EventTarget` instances for module events.
* **Navigation Service** – Route all URL/navigation changes through injected `navigationService.navigateTo`.
* **Single API Client** – Centralize API requests via injected `apiClient`.

### 🚨 Logging & Observability

* **Logger Usage** – Exclusively use DI-provided `logger`; no direct `console.*` calls.
* **Structured Logging** – Report errors with context and stack traces.
* **Logger Implementation** – Structured logs sent to server endpoint (`/api/logs`); include rich metadata.
* **Fallback Logging** – When DI logger is unavailable, use standardized fallback pattern for critical system errors.

**Canonical SafeHandler Pattern (CONSOLIDATED):**

```javascript
// ✅ CORRECT: Use canonical safeHandler from DI (registered in app.js)
const safeHandler = DependencySystem.modules.get('safeHandler');
const wrappedHandler = safeHandler(myHandler, 'MyModule:handlerDescription');

// ❌ FORBIDDEN: Custom safeHandler implementations
// function myCustomSafeHandler(handler, description) { ... } // DON'T DO THIS

// ✅ FALLBACK: Only if DI safeHandler is unavailable (rare edge cases)
function _safeHandler(handler, description) {
  const safeHandler = DependencySystem.modules.get('safeHandler');
  if (!safeHandler) {
    logger.warn('[MyModule] safeHandler not available in DI, using fallback', { context: 'MyModule' });
    return (...args) => {
      try {
        return handler(...args);
      } catch (err) {
        logger.error(`[MyModule][${description}]`, err, { context: 'MyModule' });
        throw err;
      }
    };
  }
  return safeHandler(handler, description);
}
```

**Fallback Logging Pattern:**

```javascript
// ONLY use for critical system errors when DI logger is unavailable
// Examples: DependencySystem failures, logger initialization errors, configuration validation
function logFallback(level, message, data) {
  if (typeof window !== 'undefined' && window.console && window.console[level]) {
    window.console[level](message, data);
  }
}

// Usage example:
if (typeof window !== 'undefined' && window.console && window.console.error) {
  window.console.error('[DependencySystem] Critical error:', errorData);
}
```

---

## 🚩 Universal Red-Flag Checklist

Actively detect and eliminate these anti-patterns:

* Direct database queries in route handlers.
* Business logic outside dedicated service layers.
* Generic response types in FastAPI routes (`dict`, `Any`).
* Blocking synchronous operations in async paths.
* Resource-heavy initializations at module-level scope.
* Direct imports of global configuration or settings.
* Services directly raising `HTTPException`.
* Mutable state at module-level without proper management.
* Missing contextual details in logs or error reports.
* Silent, unlogged exceptions.
* Hard-coded sensitive configuration values.

**Frontend-specific anti-patterns:**

* Adding new modules without approval.
* Using direct `console.*` calls (except in fallback logging patterns for critical system errors).
* DOM readiness checks performed outside `domReadinessService`.
* Direct DOM manipulation without sanitization.
* Missing context tags for event listeners.

**Code Duplication anti-patterns (CRITICAL - ALL ELIMINATED):**

* Duplicate safeHandler implementations (use canonical DI version from app.js).
* Local project state tracking (use canonical appModule.state).
* Custom form handlers (use createAuthFormHandler() in auth.js).
* Fallback URL parsing (delegate to navigationService.js).
* Custom error object structures (use standard status/data/message format).
* Duplicate chat initialization (chatManager.js handles all cases).
* Competing event dispatchers (single source in appState.js).

**Authentication anti-patterns (CRITICAL):**

* Creating local `authState` variables or objects.
* Using dual authentication state patterns (old + new).
* Fallback authentication checks (`auth.isAuthenticated()` when `appModule.state` exists).
* Individual module `setAuthState()` methods.
* Any authentication state storage outside `appModule.state`.

---

**Reminder:** These guardrails are mandatory. All code must comply, and any violation must be flagged clearly with a corrective proposal.
