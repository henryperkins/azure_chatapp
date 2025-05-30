# 🚧 **Code Generation Guardrails**

## 🚨 **Critical Rules**

* **NO new feature modules**: Use existing modules only, unless splitting modules over 1000 lines.
* **Module size limit**: Keep modules below 1000 lines; refactor or split as needed.
* **Single source of truth**: No duplication of logic.

---

## 📐 **Frontend Module Structure**

### ✅ **Mandatory Export Pattern**

```javascript
export function createModuleName(dependencies) {
  if (!dependencies.required) throw new Error('Missing dependency');
  
  // Module logic here
  
  return {
    cleanup() { /* cleanup logic */ }
  };
}
```

---

## 🔗 **Dependency Injection (DI)**

* **Always** inject dependencies (e.g., `domAPI`, `apiClient`, `logger`).
* **Never** directly access global objects (`window`, `document`, `console`).
* **Only Exception**: `console.error` temporarily allowed for critical errors during global bootstrap before DI is ready.

### **Direct Dependency Access (`DependencySystem.modules.get()`):**

* ✅ Allowed **only** in `app.js` (bootstrap/setup).
* ❌ Forbidden elsewhere.

---

## 🖥️ **DOM Readiness**

* ✅ Use only injected `domReadinessService`:

```javascript
await domReadinessService.waitForEvent('app:ready');
await domReadinessService.dependenciesAndElements(['#myElement']);
```

* ❌ No custom promises, manual listeners, or `DependencySystem.waitFor()`.

---

## 🎯 **Event Handling**

* ✅ Correct usage:

```javascript
eventHandlers.trackListener(element, 'click', handler, { context: 'ModuleName' });

return {
  cleanup: () => eventHandlers.cleanupListeners({ context: 'ModuleName' })
};
```

---

## 🔐 **Authentication**

**ONLY permitted patterns:**

```javascript
const appModule = DependencySystem.modules.get('appModule');
const { isAuthenticated, currentUser } = appModule.state;

// OR using helpers:
const isAuthenticated = appModule.isAuthenticated();
const currentUser = appModule.getCurrentUser();

// Listen to auth state changes:
auth.AuthBus.addEventListener('authStateChanged', ({ detail }) => {
  const { authenticated, user } = detail;
});
```

**Prohibited patterns:**

* ❌ Local `authState` variables
* ❌ `auth.isAuthenticated()` fallbacks
* ❌ Module-level auth state methods
* ❌ Direct `appModule.state` access without DependencySystem

---

## 📚 **Canonical Implementations**

**Follow these exact canonical patterns:**

| Feature             | Canonical Location                  | Access via                          |
| ------------------- | ----------------------------------- | ----------------------------------- |
| Logger              | `logger.js`                         | Imported only in `app.js`           |
| App/Auth State      | `appModule.state`                   | DI (`DependencySystem.modules.get`) |
| SafeHandler         | `app.js` (bootstrap only)           | DI (`DependencySystem.modules.get`) |
| Form Handlers       | `auth.js`                           | Imported only in `app.js`           |
| DOM API             | `static/js/utils/domAPI.js`         | Injected via DI                     |
| Event Handlers      | `static/js/utils/eventHandlers.js`  | Injected via DI                     |
| API Endpoints       | `static/js/utils/apiEndpoints.js`   | Injected via DI                     |
| Browser Service     | `static/js/utils/browserService.js` | Injected via DI                     |
| Knowledge Context   | `utils/ai_helper.py`                | `retrieve_knowledge_context()`      |
| Telemetry           | `utils/sentry_utils.py`             | `configure_sentry()`                |
| Structured Logging  | `utils/logging_config.py`           | `init_structured_logging()`         |
| Database Connection | `db.py`                             | `get_async_session()`               |

**General rule**: Only `app.js` directly imports canonical services; all other modules **must** use DI.

---

## 🔒 **Security Requirements**

* ✅ Always sanitize user input (`sanitizer.sanitize()`).
* ✅ Always include CSRF tokens in API requests.
* ❌ No sensitive data in `localStorage` or `sessionStorage`.

---

## 🐍 **Backend (Python/FastAPI)**

### Structure:

* **Routes**: Thin controllers delegating to services.
* **Services**: Contain business logic and domain exceptions.
* **Database Access**: Async SQLAlchemy queries **only in services**.
* **Responses**: Use explicit Pydantic models.

### Mandatory Rules:

* ❌ NO database logic directly in route handlers.
* ❌ NO raising `HTTPException` in services.
* ✅ Explicit DI throughout.
* ✅ Structured JSON logging only.

---

## 🚩 **Red Flags (AVOID)**

* ❌ Direct `console.*` calls (except initial global bootstrap errors).
* ❌ Business logic in routes.
* ❌ Duplicate implementations.
* ❌ Silenced or swallowed errors.
* ❌ Mutable state at module-level scope.
* ❌ Generic (`dict` or `Any`) responses.
* ❌ Synchronous code inside async functions.

---

## 📜 **Logging Patterns**

### **Logger Factory (`app.js` only):**

```javascript
import { createLogger } from './logger.js';

const logger = createLogger({
  context: 'AppBase',
  debug: APP_CONFIG.DEBUG,
  minLevel: 'info',
  enableServer: true,
  apiClient: DependencySystem.modules.get('apiClient'),
  browserService: DependencySystem.modules.get('browserService'),
  sessionIdProvider: () => getSessionId(),
  traceIdProvider: () => getTraceId(),
  safeHandler: DependencySystem.modules.get('safeHandler'),
});

DependencySystem.register('logger', logger);
```

### **Logger Usage (all other modules, via DI):**

```javascript
export function createMyModule({ logger, apiClient }) {
  if (!logger) throw new Error('Logger required');

  logger.info('Initialization complete.', {
    timestamp: Date.now(),
    context: 'MyModule:init'
  });

  try {
    throw new Error('Simulated error');
  } catch (error) {
    logger.error('Operation failed.', error, {
      operationId: 'op456',
      context: 'MyModule:operation:failure'
    });
  }

  return { cleanup() { /*...*/ } };
}
```

* ❌ Forbidden methods in modules:

  * `logger.setServerLoggingEnabled()`
  * Direct logger imports.

---

## ⚡ **Quick Module Template**

```javascript
export function createMyModule({
  logger, apiClient, domAPI,
  domReadinessService, eventHandlers, sanitizer
}) {
  if (!logger || !apiClient) throw new Error('Missing dependencies');

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