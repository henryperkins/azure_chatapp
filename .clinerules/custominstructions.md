Here's your complete, clarified, and consistent set of **Code Generation Guardrails** with all contradictions addressed:

---

# 🚧 Code Generation Guardrails (Final)

## 🚨 CRITICAL RULES

1. **NO NEW FEATURE MODULES** – Work within the existing module structure only.
   **Exception**: Allowed only when splitting existing modules exceeding 1000 lines.
2. **Modules < 1000 lines** – Refactor or split if approaching this limit.
3. **Single Source of Truth** – No duplicate implementations.

---

## 📐 Frontend Architecture

### Core Patterns (MANDATORY)

```javascript
// ✅ Every module exports via factory
export function createModuleName(dependencies) {
  if (!dependencies.required) throw new Error('Missing dependency');

  // Module logic here

  return {
    cleanup() { /* Cleanup logic */ }
  };
}
```

---

### Dependency Injection Rules (MANDATORY)

* **NEVER** access globals directly (`window`, `document`, `console`).
* **ALWAYS** use injected abstractions (`domAPI`, `apiClient`, `logger`).
* **ONLY EXCEPTION**: Critical system errors in global error handlers **before DI is ready** (use `console.error` temporarily; remove once DI operational).

**Direct `DependencySystem.modules.get()` calls:**

* Allowed only in `app.js` bootstrap/setup code.
* **FORBIDDEN** everywhere else (modules must receive dependencies via DI).

---

### DOM Readiness (MANDATORY)

```javascript
// ✅ CORRECT – Only use injected domReadinessService
await domReadinessService.waitForEvent('app:ready');
await domReadinessService.dependenciesAndElements(['#myElement']);

// ❌ FORBIDDEN
// Custom promises, timeouts, manual listeners, DependencySystem.waitFor()
```

---

### Event Handling (MANDATORY)

```javascript
// ✅ Correct event handling pattern
eventHandlers.trackListener(element, 'click', handler, { context: 'ModuleName' });

return {
  cleanup: () => {
    eventHandlers.cleanupListeners({ context: "ModuleName" });
  }
};
```

---

## 🔐 Authentication (BREAKING CHANGE Dec 2024)

### ✅ NEW Pattern (ONLY)

```javascript
const appModule = DependencySystem.modules.get('appModule');
const { isAuthenticated, currentUser } = appModule.state;

// OR helpers:
const isAuthenticated = appModule.isAuthenticated();
const currentUser = appModule.getCurrentUser();

// Listen for changes
auth.AuthBus.addEventListener('authStateChanged', ({ detail }) => {
  const { authenticated, user } = detail;
});
```

### ❌ ELIMINATED Patterns

* Local `authState` variables
* `auth.isAuthenticated()` fallbacks
* Module-level `setAuthState()` methods
* Direct `appModule.state` access without DependencySystem

---

## 📚 Canonical Implementations (USE THESE)

| Feature                | Location                          | Access / Import (Allowed)                                     |
| ---------------------- | --------------------------------- | ------------------------------------------------------------- |
| SafeHandler            | app.js (bootstrap only)           | DependencySystem.modules.get('safeHandler')                   |
| Logger Factory         | logger.js                         | Imported in app.js only: `createLogger(...)`                  |
| App State              | appState.js                       | DependencySystem.modules.get('appModule')                     |
| Auth State             | appModule.state                   | `.isAuthenticated`, `.currentUser`                            |
| Project State          | appModule.state                   | `.currentProjectId`, `.currentProject`                        |
| Form Handlers          | auth.js                           | Imported in app.js only: `createAuthFormHandler()`            |
| URL Parsing            | navigationService                 | Injected via DI (`.navigateTo()`, `.parseURL()`)              |
| Error Objects          | Standard                          | `{ status, data, message }`                                   |
| Chat Init              | chatManager.js                    | Via AppBus/AuthBus events                                     |
| Application Config     | config.py                         | `from config import settings`                                 |
| Database Connection    | db.py                             | `from db import get_async_session, get_async_session_context` |
| Auth Utilities         | utils/auth_utils.py               | `from utils.auth_utils import get_current_user_and_token`     |
| Structured Logging     | utils/logging_config.py           | `from utils.logging_config import init_structured_logging`    |
| Telemetry              | utils/sentry_utils.py             | `from utils.sentry_utils import configure_sentry`             |
| Model Registry         | utils/model_registry.py           | `from utils.model_registry import get_model_config`           |
| Database Models        | models/                           | `from models import User, Project, Conversation`              |
| Service Exports        | services/__init__.py              | `from services import get_conversation_service`               |
| DOM API                | static/js/utils/domAPI.js         | Injected via DI only                                          |
| Event Handling         | static/js/utils/eventHandlers.js  | Injected via DI only                                          |
| API Endpoints          | static/js/utils/apiEndpoints.js   | Injected via DI only                                          |
| Browser Service        | static/js/utils/browserService.js | Injected via DI only                                          |
| Bootstrap Process      | utils/bootstrap.py                | `from utils.bootstrap import init_telemetry`                  |
| Frontend Model Config  | static/js/modelConfig.js          | Injected via DI only                                          |
| Frontend App Config    | static/js/appConfig.js            | Imported directly in app.js only                              |
| Knowledge Base Context | utils/ai_helper.py               | `from utils.ai_helper import retrieve_knowledge_context`      |

**General rule:** Only `app.js` may directly import services; all other modules must receive them through DI.

---

## 🔒 Security Requirements (MANDATORY)

* **Sanitize ALL user HTML**: `sanitizer.sanitize(userContent)`
* **CSRF Protection**: Always include tokens in API calls
* **No persistent sensitive data** in localStorage/sessionStorage – use in-memory transient module state instead.

---

## 🐍 Backend (Python/FastAPI) (MANDATORY)

### Structure

* **Routes**: Thin controllers delegating to services.
* **Services**: All business logic, domain exceptions.
* **Database**: Async SQLAlchemy queries strictly within services.
* **Responses**: Explicit Pydantic models only (never `dict` or `Any`).

### Key Rules

* NO database queries directly in route handlers.
* NO raising `HTTPException` in services (domain exceptions only).
* Structured JSON logging exclusively.
* Explicit dependency injection everywhere.

---

## 🚩 Red Flags to Avoid (MANDATORY)

* Direct `console.*` calls (except global error handlers pre-DI).
* Business logic directly in routes.
* Duplicate implementations.
* Silent failures or swallowed errors.
* Mutable module-level state.
* Generic (`dict` or `Any`) response types.
* Synchronous operations in async code.

---

## 📜 Logging Patterns (MANDATORY)

### ✅ Logger Factory Creation (app.js ONLY)

The `createLogger` factory initializes a logger instance with a base context and other configurations.

```javascript
// In app.js
import { createLogger } from './logger.js'; // Adjust path as needed
// const APP_CONFIG = DependencySystem.modules.get('appConfig'); // Or however APP_CONFIG is obtained
// const { getSessionId } = DependencySystem.modules.get('sessionManager'); // Example
// const { getTraceId } = DependencySystem.modules.get('telemetry'); // Example

const logger = createLogger({
  context: 'AppBase', // Base context for all logs from this instance
  debug: APP_CONFIG.DEBUG,
  minLevel: 'info',
  enableServer: true, // Or based on APP_CONFIG
  apiClient: DependencySystem.modules.get('apiClient'), // Inject apiClient
  browserService: DependencySystem.modules.get('browserService'),
  sessionIdProvider: () => getSessionId(), // Example
  traceIdProvider: () => getTraceId(),     // Example
  safeHandler: DependencySystem.modules.get('safeHandler'),
  // consoleEnabled: true, // Default
  // allowUnauthenticated: false // Default
});

DependencySystem.register('logger', logger); // Register the created logger

// After auth initialization (if server logging depends on auth state, though allowUnauthenticated helps)
// if (authModule.isAuthenticated()) { // Example condition
//   logger.setServerLoggingEnabled(true);
// }
```

### ✅ Logger Usage (ALL OTHER MODULES - via DI)

When using the DI-injected logger:
*   The first argument is the primary log message (string).
*   Subsequent arguments can be data objects or an Error object.
*   A **final metadata object** containing a `context` property (string) with a specific operational context **MUST** be provided. This `context` complements the base context set during `createLogger`.

```javascript
// In a module, e.g., createMyModule({ logger, ... })
export function createMyModule({ logger, apiClient, domAPI }) {
  // Validate deps
  if (!logger) throw new Error("Logger is required");

  // Example usages:
  logger.info('Module initialized successfully.', {
    timestamp: Date.now(),
    featureFlags: { /* ... */ },
    context: 'MyModule:init' // Specific operational context
  });

  try {
    // ... some operation ...
    throw new Error("Simulated failure");
  } catch (error) {
    logger.error('Operation failed unexpectedly.', error, { // Error object as second to last
      userId: 'user123',
      operationId: 'op456',
      context: 'MyModule:criticalOperation:failure' // Specific context for this error
    });
  }

  // If using logger.withContext (though less common with this pattern)
  // The primary context is set by withContext. The chained call's *last* argument
  // must still be an object with a 'context' property for the specific operational context.
  const userActionLogger = logger.withContext('UserActions'); // Sets a new base context
  userActionLogger.info('User clicked save button.', {
    buttonId: 'save-config',
    context: 'MyModule:userSaveAction' // Specific context for the action
  });


  return { cleanup() { /* ... */ } };
}
```

*   **FORBIDDEN in modules**: `logger.setServerLoggingEnabled()`, `logger.setMinLevel()`, direct logger import.

---

## ⚡ Quick Reference Template

```javascript
export function createMyModule({
  logger, apiClient, domAPI, navigationService,
  domReadinessService, eventHandlers, sanitizer
}) {
  // Validate deps

  await domReadinessService.waitForEvent('app:ready');

  const appModule = DependencySystem.modules.get('appModule');
  const { isAuthenticated } = appModule.state;

  eventHandlers.trackListener(el, 'click', handler, { context: 'MyModule' });

  return {
    cleanup() {
      eventHandlers.cleanupListeners({ context: 'MyModule' });
    }
  };
}
```

---

✅ **FINALIZED**: All contradictions resolved.
