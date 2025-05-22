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
