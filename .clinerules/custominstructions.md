# 🚧 **Code Generation Guardrails – 2025 Update**

## 🚨 **Critical Rules**

* **NO new feature modules**: Use existing modules only, unless splitting modules over 1000 lines.
* **Module size limit**: Keep modules below 1000 lines; refactor or split as needed.
* **Single source of truth**: No duplication of logic or state, anywhere.

---

## 📐 **Frontend Bootstrapping & Module Structure**

### ✅ **Mandatory App Entrypoint Pattern**

All top-level app setup happens **only** in `static/js/app.js` using the canonical `createAppInitializer` factory from `static/js/init/appInitializer.js`:

```javascript
// app.js
import { createAppInitializer } from './init/appInitializer.js';

// DependencySystem registration and wiring
const appInit = createAppInitializer({
  DependencySystem,
  domAPI,
  browserService,
  /* ...all factories registered here... */
});

// App boot
domReadinessService.documentReady().then(() => appInit.initializeApp());
```

**No business logic, orchestration, or singleton allocation outside `app.js` and `appInitializer.js`.**

---

### ❗ **DI and Canonical Factories**

* Every frontend service, utility, or component _must_ be exported as a **factory function** with explicit DI:
  ```javascript
  export function createMyFeature({ DependencySystem, logger, domAPI, ... }) {
    if (!DependencySystem || !logger) throw new Error("Missing dependencies");
    // ...
    return { cleanup() { ... } }; // Always supplies cleanup!
  }
  ```
* **No top-level side effects in modules:** Only factories. No listeners, timers, or DOM access until `.initialize()` or equivalent is called by DI.
* **Only app.js/appInitializer.js can use direct imports** for factories/services. All non-boot modules must get ALL dependencies via DI (DependencySystem).
* **No direct access to window, document, or global objects** except through injected `browserService`/`domAPI`.

---

### 🔗 **Dependency Access**

* **Only allowed via DependencySystem.modules.get()** - and only inside factories/modules, NEVER at the module scope or outside DI context.
* **Strict initializer pattern:** No direct logic or instance usage before DI registration in app.js/appInitializer.js.

---

### 🖥️ **DOM Readiness and Event Handling**

* **Only use DI-injected domReadinessService for DOM readiness checks:**
  - No custom listeners, manual promises, or DependencySystem.waitFor().
  - Canonical:
    ```javascript
    await domReadinessService.waitForEvent('app:ready');
    await domReadinessService.dependenciesAndElements(['#elementId']);
    ```
* **Use eventHandlers (DI) for all DOM/event listeners:**
  ```javascript
  eventHandlers.trackListener(el, 'click', handler, { context: 'MyModule' });
  return {
    cleanup: () => eventHandlers.cleanupListeners({ context: 'MyModule' })
  };
  ```
* **Never attach or clean up event listeners manually.**

---

### 🔐 **State & Authentication**

* **All global state (auth, user, project):** Only from canonical `appModule` (DI via DependencySystem).
* **Never use local state variables or direct instantiation for state.**
* **Only subscribe/mutate auth/project state via the injected AuthBus/EventBus/appModule.**
  - Canonical:
    ```javascript
    const appModule = DependencySystem.modules.get('appModule');
    const { isAuthenticated } = appModule.state;
    auth.AuthBus.addEventListener('authStateChanged', ({ detail }) => { ... });
    ```

---

### 🏗️ **UI & Components**

* **All components are factories & registered via DI** (`DependencySystem.register`) at bootstrap.
* **No component directly creates or manages others except via factories and explicit dependencies.**
* **No UI logic lives outside the DI context.**

---

### 🪝 **Cleanup & Listeners**

* **All factories must expose a cleanup() method** that removes all listeners via eventHandlers.
* **No ad-hoc, manual, or untracked event/observer setup or teardown.**

---

### 📦 **Canonical Implementations (2025)**

| Feature             | Canonical Location                   | Access via                          |
| ------------------- | ------------------------------------ | ----------------------------------- |
| Root App DI         | `app.js`, `appInitializer.js`        | Direct only at root                 |
| Logger              | `logger.js` (factory)                | Injected via DI, never direct import|
| App/Auth State      | `appModule.state`                    | DI (`DependencySystem.modules.get`) |
| Event Handlers      | `static/js/utils/eventHandlers.js`   | Injected via DI                     |
| DOM API             | `static/js/utils/domAPI.js`          | Injected via DI                     |
| API Endpoints       | `static/js/utils/apiEndpoints.js`    | Injected via DI                     |
| UI Components       | `static/js/`, `static/js/components/`| Registered via DI                   |
| Bootstrap Factories | `static/js/init/appInitializer.js`   | Canonical dependency registration   |

**No direct service imports, except at root. No top-level instance side effects outside app.js/appInitializer.js.**

---

### 🚫 **Forbidden Frontend Patterns**

* Direct imports of services/components (except in `app.js`/`appInitializer.js`).
* Module-level state, mutable globals, or local caches.
* Business logic in modules or UI outside factories/DI context.
* Event listeners, DOM access, or timers at module scope.
* “Shadow” state — anything not in appModule or canonical DI context.
* Any React/Vue/Angular-style context hack or global store pattern outside this DI system.
* _No_ direct invocation of DependencySystem.modules.get outside factory instantiation.

---

## 🐍 **Backend (Python/FastAPI) – Service-First Architecture**

### 🛤️ **Route/Service Pattern**

* **Routes are ultra-thin controllers:**
  - No business logic or DB queries in route handlers.
  - All DB/service/resource logic in dedicated service modules (e.g., `services/project_service.py`).
  - All mutation/checks delegated; routes only wire args and call service helpers.
* **All routes and services use explicit type annotations and async SQLAlchemy.**
* **Pydantic models are mandatory for all request/response schemas.**
* **No synchronous code inside async routes/services.**
* **No generic dict or Any-typed endpoints.**
* **All error raising/handling is performed in service layer — not in route logic — with structured exceptions.**
* **Structured logging is only present in service/route boundaries, not interleaved with business logic.**

---

## ⚡ **Quick Module Template (Frontend Example)**

```javascript
export function createMyModule({
  DependencySystem, logger, apiClient, domAPI, domReadinessService, eventHandlers, sanitizer
}) {
  if (!DependencySystem || !logger) throw new Error('Missing dependencies');

  await domReadinessService.waitForEvent('app:ready');
  eventHandlers.trackListener(el, 'click', handler, { context: 'MyModule' });

  return {
    cleanup() {
      eventHandlers.cleanupListeners({ context: 'MyModule' });
    }
  };
}
```

---

## 🔥 **Red Flags (ABSOLUTELY AVOID)**

* ❌ Direct `console.*` calls (use only via errorReporter DI, logger exception for early bootstrap/logging errors).
* ❌ Ad-hoc event listeners, timers, or callbacks outside factory/context.
* ❌ Mutable, module-level state or global caches.
* ❌ Any direct imports of services (except in app.js/appInitializer.js).
* ❌ Local duplication of “global state” outside appModule.
* ❌ DB queries, session management, or business logic in route files.
* ❌ Synchronous code inside async def.
* ❌ Response schemas that are `dict`, `Any`, or not pydantic-typed.

---

## 📝 **Update Process**

The above definitions represent the *enforced* architectural pattern for the project as of May 2025. Any deviation or “creative shortcut” will be rejected in code review, test, or CI.

**If in doubt: neither modules nor routes should contain logic/state not registered via DI at app-root or injected as a constructor dependency. When building new features, always check the latest registered factories/services as the source of truth.**

---
