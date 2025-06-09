# 🚧 **Code Generation Guardrails – 2025 Update**

## 🚨 **Critical Rules**

* **NO new feature modules**: Use existing modules only, unless splitting modules over 1000 lines.
* **Module size limit**: Keep modules below 1000 lines; refactor or split as needed.
  *(Oversize exemption: directly vendored external libraries such as DOMPurify may exceed this limit for integrity/documentation reasons, with clear vendor attribution comment at top of file.)*
* **Single source of truth**: No duplication of logic or state, anywhere.
  *(Duplication enforcement: ≥2 instances of an identical function or code block over 15 lines in separate modules is an audit violation.)*

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

* `static/js/init/appInitializer.js` **must not** import service-like modules directly; it receives them solely through its parameter object.

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
* **No direct access or polyfill writes to `window`, `document`, or any global object** except through injected `browserService`/`domAPI`.

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

* **Unified Event Bus** – All cross-module communication must flow through the DI-injected `eventService` facade.  The legacy `AuthBus`, `AppBus`, `chatUIBus`, etc. are deprecated and must be migrated to `eventService.emit()` / `eventService.on()` / `eventService.off()` helpers.  No component may create its own `EventTarget` or ad-hoc event bus.

---

### 🔐 **State & Authentication**

* **All global state (auth, user, project):** Only from canonical `appModule` (DI via DependencySystem).
* **Never use local state variables or direct instantiation for state.**
* **State interactions must go through canonical services** (`authenticationService`, `projectContextService`, `uiStateService`). Components **MUST NOT** read/write `appModule.state` directly.
* **Event subscriptions/publications related to state changes** must use the unified `eventService` (`eventService.on()`, `eventService.emit()`). Legacy `AuthBus` / `AppBus` usage is prohibited.
  - Canonical:
    ```javascript
    export function createSidebar({ authenticationService, projectContextService, eventService }) {
      const isAuthed = authenticationService.isAuthenticated();

      eventService.on('projectContextChanged', ({ detail }) => {
        // react to project change...
      });
    }
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
* **You *must* call `eventHandlers.cleanupListeners({ context })` inside the factory’s `cleanup()`; returning an empty stub is non-compliant.**


---

### 📦 **Canonical Implementations (2025)**

| Feature             | Canonical Location                   | Access via                          |
| ------------------- | ------------------------------------ | ----------------------------------- |
| Root App DI         | `app.js`, `appInitializer.js`        | Direct only at root                 |
| Logger              | `logger.js` (factory)                | Injected via DI **and every call ends with a metadata object `{ context }`.**|
| App/Auth State      | `appModule.state`                    | DI (`DependencySystem.modules.get`) |
| Event Handlers      | `static/js/eventHandler.js`          | Injected via DI                     |
| DOM API             | `static/js/utils/domAPI.js`          | Injected via DI                     |
| API Endpoints       | `static/js/utils/apiEndpoints.js`    | Injected via DI                     |
| UI Components       | `static/js/`,                        | Registered via DI                   |
| Authentication      | `services/authenticationService.js`  | Injected via DI (read-only façade over `appModule.state`) |
| Project Context     | `services/projectContextService.js`  | Injected via DI (single project source of truth) |
| Event Bus           | `services/eventService.js`           | Injected via DI (unified app-wide event emitter) |
| UI State            | `static/js/uiStateService.js`        | Injected via DI (component UI flags) |
| Bootstrap Factories | `static/js/init/appInitializer.js`   | Canonical dependency registration   |

**No direct service or side-effect imports, except in `app.js`. No top-level instance side effects outside app.js/appInitializer.js.**

---

### 🚫 **Forbidden Frontend Patterns**

* Direct imports of services/components (except in `app.js`/`appInitializer.js`).
* Module-level state, mutable globals, or local caches.
* Business logic in modules or UI outside factories/DI context.
* Event listeners, DOM access, or timers at module scope.
* “Shadow” state — anything not in appModule or canonical DI context.
* Any React/Vue/Angular-style context hack or global store pattern outside this DI system.
* _No_ direct invocation of DependencySystem.modules.get outside factory instantiation.
* Using `console.*` anywhere after bootstrap (replace with `logger.*` and metadata object).
* Direct access to `appModule.state.isAuthenticated` or `appModule.state.currentProject` **outside** the canonical services (`authenticationService`, `projectContextService`).

---

## 🐍 **Backend (Python/FastAPI) – Service-First Architecture**

### 🛤️ **Route/Service Pattern**

* **Routes are ultra-thin controllers:**
  - No business logic or DB queries in route handlers.
  - All DB/service/resource logic in dedicated service modules (e.g., `services/project_service.py`).
  - All mutation/checks delegated; routes only wire args and call service helpers.
* **All routes and services use explicit type annotations and async SQLAlchemy.**
* **No direct DB calls (`session.execute`, raw SQL) in `routes/*.py`; use dedicated service.**
* **Pydantic models are mandatory for all request/response schemas.**
* **No synchronous code inside async routes/services.**
* **No generic dict or Any-typed endpoints.**
  All Pydantic models must define concrete field types; usage of `dict`, `Any`, or untyped `data: object` is disallowed.
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

## 🛠️ **Test & Regression Requirements (Critical Changes)**

* After making **critical dependency, module interface, or DI chain changes**, you **must** run regression/unit tests using Jest to verify contracts are not broken:
  - Run all tests:
    ```
    npx jest
    ```
  - Or run the logger DI contract test specifically:
    ```
    npx jest tests/logger-di-order.test.js
    ```
  - Add `npm run lint` and `flake8` to CI gate; merges blocked if linters detect guard-rail breaches.
* If a contract regression is detected (e.g., missing DI, eventHandlers/logger contract break), revert or fix until the test passes.
* Tests ensure that critical initialization errors (like "Missing eventHandlers" or "Missing logger dependency") are never reintroduced in future refactors.

**Why:**
- Automated tests provide a “safety net” against breaking critical app startup and DI contracts.
- This must be part of your workflow anytime you:
  - Refactor DI registrations (e.g., logger, eventHandlers)
  - Change lifecycle/boot order of services
  - Touch persistent architectural patterns

## 📝 **Update Process**

The above definitions represent the *enforced* architectural pattern for the project as of May 2025. Any deviation or “creative shortcut” will be rejected in code review, test, or CI.

**If in doubt: neither modules nor routes should contain logic/state not registered via DI at app-root or injected as a constructor dependency. When building new features, always check the latest registered factories/services as the source of truth.**

---

## 🗺️ **State Management Overview (Quick Reference)**

The table below shows *exactly where* each category of state lives and which service you should use to
access or mutate it. Anything not on this map is an anti-pattern.

| State Category | Source of Truth | Access via | How to Update |
| -------------- | --------------- | ---------- | ------------- |
| **Authentication**<br>(`isAuthenticated`, `currentUser`) | `appModule.state` | `authenticationService` | Read-only façade. Auth flow mutates state internally and emits events; application code should *never* write. |
| **Project context**<br>(`currentProject`, `currentProjectId`) | `appModule.state` | `projectContextService` | Call `setCurrentProject(project)` which updates state **and** emits `projectContextChanged`. |
| **Conversation context**<br>(`currentConversationId`, etc.) | Internal memory held by `conversationManager` | `conversationManager` | Use `createNewConversation`, `loadConversation`, etc. Do **not** cache IDs in components. |
| **UI flags & view state**<br>(sidebar visibility, modal open, tab index) | In-memory `Map` inside `uiStateService` | `uiStateService` | `setState(component, key, value)` / `getState(component, key)`. |
| **User preferences**<br>(theme, pinned sidebar) | Browser storage (wrapped) | `storageService` or dedicated service | Persist through injected storage helper – **single** service should own a given key. |

### Developer checklist

1. Planning to add `let someState = …` at module scope? → **Stop.** Choose the correct service above.
2. Touching `appModule.state` directly? → **Stop.** Use its façade.
3. Need to announce a state change? → `eventService.emit('descriptiveEvent', detail)`.
4. Need transient view flags? → `uiStateService`.

Following this map guarantees a single authoritative copy of each piece of data, preventing UI
desynchronization and making debugging easier.

---

## 🧹 Deprecations & Transitional Shims (2025-06-09)

The following legacy patterns or stop-gap shims still exist in the codebase. **Do not introduce new
usage**. When you touch affected areas, migrate to the modern equivalent and strike the item off this
list (include commit SHA next to the bullet when removed).

| Area | Deprecated pattern | Replacement | Status |
|------|--------------------|-------------|--------|
| Event Bus | Direct `AuthBus`, `AppBus`, `chatUIBus` references | Inject `eventService` and call `eventService.emit/on/off` | In-progress (Phase 3 target) |
| DI | Runtime `DependencySystem.modules.get()` inside component logic | Pass the dependency as a constructor arg from `appInitializer.js` | Eliminated in critical modules; ~17 doc-only hits remain |
| UI State | Module-scope `visible`, `pinned`, etc. | `uiStateService` | Sidebar migrated; starred set pending |
| Auth | Logger `authModule` parameter | No param – logger auto-discovers auth via `authenticationService` | Some tests still pass param – remove as encountered |
| safeHandler | Internal fallbacks using `DependencySystem` | Inject `safeHandler` via DI | Low-risk utility modules still have fallback warnings |
| Backend routes | `/kb/files (deprecated routes)` | Use new REST endpoints shown in route docstrings | Call-site migration ongoing |
| CSS | Tailwind v3 opacity utilities (`bg-opacity-{n}`) | v4 slash syntax (`bg-black/50`) | Replace on sight |
| Token Stats | `tokenStatsManagerProxy` buffering shim | Direct `tokenStatsManager` once early init is stable | Remove after Phase 3 |

### How to update this section
1. When you **remove** a deprecated item, delete or edit the corresponding table row and append the
   commit SHA in parentheses to the description.
2. If you temporarily add a workaround or shim that must be cleaned up later, document it in a new row
   with “Temporary” in the Status column.

Maintainers review this table at each Phase exit gate. Keep it accurate — outdated documentation is a
compliance violation.

