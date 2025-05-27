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
| Auth Utilities         | utils/auth\_utils.py              | `from utils.auth_utils import get_current_user_and_token`     |
| Structured Logging     | utils/logging\_config.py          | `from utils.logging_config import init_structured_logging`    |
| Telemetry              | utils/sentry\_utils.py            | `from utils.sentry_utils import configure_sentry`             |
| Model Registry         | utils/model\_registry.py          | `from utils.model_registry import get_model_config`           |
| Database Models        | models/                           | `from models import User, Project, Conversation`              |
| Service Exports        | services/**init**.py              | `from services import get_conversation_service`               |
| DOM API                | static/js/utils/domAPI.js         | Injected via DI only                                          |
| Event Handling         | static/js/utils/eventHandlers.js  | Injected via DI only                                          |
| API Endpoints          | static/js/utils/apiEndpoints.js   | Injected via DI only                                          |
| Browser Service        | static/js/utils/browserService.js | Injected via DI only                                          |
| Bootstrap Process      | utils/bootstrap.py                | `from utils.bootstrap import init_telemetry`                  |
| Frontend Model Config  | static/js/modelConfig.js          | Injected via DI only                                          |
| Frontend App Config    | static/js/appConfig.js            | Imported directly in app.js only                              |
| Knowledge Base Context | utils/ai\_helper.py               | `from utils.ai_helper import retrieve_knowledge_context`      |

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

```javascript
import { createLogger } from './logger.js';
const logger = createLogger({
  context: 'App',
  debug: APP_CONFIG.DEBUG,
  minLevel: 'info',
  enableServer: false,
  sessionIdProvider: () => getSessionId(),
  traceIdProvider: () => DependencySystem?.modules?.get?.('traceId')
});

// After auth initialization
logger.setServerLoggingEnabled(true);
```

### ✅ Logger Usage (ALL OTHER MODULES)

```javascript
export function createMyModule({ logger, apiClient, domAPI }) {
  const context = 'MyModule';
  logger.info(context, 'Module initialized', { timestamp: Date.now() });
  logger.error(context, 'Operation failed', error, { userId: user.id });

  return { cleanup() { /* ... */ } };
}
```

* **FORBIDDEN in modules**: `logger.setServerLoggingEnabled()`, `logger.setMinLevel()`, direct logger import.

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
