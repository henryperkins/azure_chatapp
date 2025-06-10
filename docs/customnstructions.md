# Application Initialization Guide

_Last updated: 2025-06-10_

This document explains **how the Azure Chat application boots** and how the
code under `static/js/initialization/` is organised after the 2025
remediation refactor.  It is intended for new contributors and for reviewers
who need to trace where a service or component is wired into the Dependency
Injection (DI) graph.

---

## 1. High-level boot sequence

```text
app.js ──► createAppInitializer(opts)
            │
            ▼
        bootstrapCore.initializeCoreServices()  (critical single call)
            │  (registers logger, domAPI, eventHandlers, …)
            ▼
       createAppState()      ← central appModule/state object
            │
            ▼
        Phase runners (in order) ──────────────────────────────────────┐
        │                                                              │
        ▼                                                              ▼
  serviceInit.registerBasicServices()                          serviceInit.registerAdvancedServices()
        │                                                              │
        ├── Registers low-level services (apiEndpoints, eventBus, …)   ├── Registers apiClient, navigationService, …
        │                                                              │
        ▼                                                              ▼
  errorInit.initializeErrorHandling()                          coreInit.initializeCoreSystems()
        │                                                              │
        ▼                                                              ▼
 authInit.initializeAuthSystem()                               uiInit.initializeUIComponents()
        │                                                              │
        └───────────────►   emits `app:ready`  ◄───────────────────────┘
```

The _phase runner_ inside **appInitializer** logs each phase’s start/finish
and ensures that an error in one phase fails the boot cleanly, emitting the
`app:failed` event.

---

## 2. Directory layout

```
static/js/initialization/
  ├─ appInitializer.js          ↶ 90-line orchestrator
  │
  ├─ bootstrap/
  │   ├─ bootstrapCore.js       ◄─ sets up logger, domAPI, eventHandlers …
  │   └─ circularDeps.js        (tiny helper kept for legacy imports)
  │
  ├─ phases/
  │   ├─ serviceInit.js         ◄─ registers dependency *factories*
  │   ├─ errorInit.js           ◄─ global error / unhandled rejection hooks
  │   ├─ coreInit.js            ◄─ ModalManager, ProjectManager, ChatManager
  │   ├─ authInit.js            ◄─ AuthFormHandler + Auth state wiring
  │   └─ uiInit.js              ◄─ late-stage UI widgets & navigation views
  │
  └─ state/
      └─ appState.js            ◄─ Single source of truth for `appModule.state`
```

Each **phase** module exposes two methods:

```
initializeXy…()   // executed exactly once by appInitializer
cleanup()         // idempotent tear-down called during SPA navigation or tests
```

---

## 3. bootstrapCore – what it does

1. **Browser / DOM bindings** – registers the injected `browserService` with
   the session utils so any call to `getSessionId()` can access a stable
   `crypto.randomUUID` polyfill.
2. **Sanitizer guarantee** – throws if `DOMPurify` is missing (security hard
   gate).  Tests provide a stub via the injected window.
3. **Core facades** – creates and registers:
   • `domAPI`  • `eventHandlers`  • `logger`  • `errorReporter`  •
   `safeHandler`  • `eventService` (unified EventTarget wrapper).
4. **tokenStatsManagerProxy** – lightweight proxy registered _both_ as
   `tokenStatsManagerProxy` **and** `tokenStatsManager` so that ChatManager
   can call `estimateTokens()` before UI phase replaces it with the real
   implementation.

---

## 4. serviceInit – basic vs. advanced

• **Basic services** (_must succeed for boot to continue_)
  – apiEndpoints, storage, sanitizer aliases, uiUtils, etc.

• **Advanced services** (_optional, may be skipped in minimal tests_)
  – apiClient, navigationService, htmlTemplateLoader, accessibilityUtils.

No placeholders are created here anymore – bootstrapCore already handles the
`tokenStatsManager` proxy.

---

## 5. Replacing the proxy with the real manager

`uiInit.initializeUIComponents()` builds the heavy `tokenStatsManager` and
then:

```js
const proxy = DependencySystem.modules.get('tokenStatsManagerProxy');
proxy.setRealManager(realInst);          // flush buffered calls
DependencySystem.register('tokenStatsManager', realInst);
```

From that moment on, all modules transparently use the concrete
implementation.

---

## 6. Writing tests for initialization

• **Unit tests** should _not_ run the full initializer.  Instead, register
  only the factories needed and stub any heavy services.

• **Integration / smoke tests** can execute up to the `serviceInit`
  phase (see `static/js/__tests__/token-stats-di.test.js`).  Always provide:

```js
DependencySystem, browserService, MODAL_MAPPINGS = {},
createApiEndpoints(), createChatManager()
```

• Don’t forget to stub `window.DOMPurify` and `window.crypto.randomUUID` in
  your fake `browserService.getWindow()`.

---

## 7. Cleanup contract

Each phase returns a `cleanup()` that:

1. Calls `eventHandlers.cleanupListeners({ context })`
2. Invokes `instance.cleanup()` on any service it created (if present)

`appInitializer.cleanup()` triggers phase cleanups in the **reverse** order
of initialization.

---

### Appendix – DI module names registered during boot

| Phase           | Module names (non-exhaustive)                               |
|-----------------|-------------------------------------------------------------|
| bootstrapCore   | logger, domAPI, eventHandlers, errorReporter,              |
|                 | safeHandler, eventService, uiStateService,                 |
|                 | tokenStatsManagerProxy, tokenStatsManager (alias)          |
| serviceInit     | apiEndpoints, apiRequest, apiClient, navigationService…    |
| coreInit        | modalManager, projectManager, chatManager                  |
| authInit        | authenticationService, authFormHandler, authApiService…    |
| uiInit          | projectDetailsEnhancements, tokenStatsManager (real)       |

Keep this table in sync when you add or rename modules!
