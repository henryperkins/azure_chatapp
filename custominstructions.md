## Custom Module Development Guidelines

### 1. Core Principles

| ✔︎ | Principle                              | Why it Matters                                                                                                                   |
| -- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
|    | **Purely modular code**                | Predictable composition, parallel development, low coupling.                                                                     |
|    | **Explicit dependency injection (DI)** | No hidden contracts or side-effects; everything required is named and mock-friendly.                                             |
|    | **Zero global footprint**              | Prevents name clashes, memory leaks, test flakiness, and security gaps.                                                          |
|    | **Deterministic teardown**             | Every resource you acquire (DOM listener, timer, WebSocket, etc.) must be releasable through a public `cleanup()` or equivalent. |

---

### 2. Module Bootstrap & Dependency Injection

* **Factory first** – export **one** of the following, *and nothing else*:

  ```ts
  export function createXyzModule(deps: XyzDeps): XyzModule { … }
  // – or –
  export class XyzModule { constructor(deps: XyzDeps) { … } }
  ```

  The caller provides a `deps` object or DI container; there are **no implicit `import`-side effects** that talk to the network, touch DOM, or mutate globals.
* **Globals ban** – `window`, `document`, `localStorage`, `fetch`, etc. must be passed in through `deps` (or accessed through an injected façade) so they can be mocked in unit tests.
* **No singleton exports** – stateful singletons encourage hidden coupling; if you need a shared resource, expose an explicit orchestrator service and inject it.

---

### 3. Imports & Exports Hygiene

* Import only what you reference. Dead imports or re-exports break tree-shaking and confuse code readers.
* When inter-module references are unavoidable, keep them **acyclic** (e.g., push events one way instead of calling back).

---

### 4. Event & Listener Management

1. **Register through the tracked API**

   ```ts
   deps.eventHandlers.trackListener(el, 'click', onClick, { description: 'Xyz action' });
   ```

   * Never call `el.addEventListener` directly except inside the tracking helper itself.
2. **Contextual metadata** – every listener is tagged with `{ description }` so debugging tools can pinpoint its origin.
3. **Guaranteed cleanup**

   * Call `module.cleanup()` inside test tear-downs and before hot-module replacement.
   * The tracking helper must remove **all** listeners it registered.

---

### 5. User Notifications

* Route every user-facing message through the injected `notificationHandler` (or `deps.showNotification`).
  **Prohibited**: `alert()`, `confirm()`, stray `console.log()` for user messages, custom ad-hoc toasts created outside the notification service.

---

### 6. State Management & Side-Effects

* **Immutable boundaries** – never reassign or monkey-patch imported objects or fields on `window`.
* **Encapsulation** – internal mutable variables live in closures or `this`, never as module-level `let`/`var`.
* For cross-module shared state, create a dedicated store service and inject it.

---

### 7. Error Handling & Logging

* Wrap **every** `await`/promise in `try { … } catch (err) { … }`.
* Propagate or surface errors through a unified `errorReporter` service (part of DI) so UX and telemetry remain consistent.
* Include structured context:

  ```ts
  errorReporter.capture(err, {
    module: 'xyz',
    method: 'fetchData',
    itemId,
  });
  ```

---

### 8. Security Best Practices

* **Sanitize untrusted HTML** with an injected sanitizer (e.g., DOMPurify).

  ```ts
  const safeHtml = deps.sanitizer.sanitize(userHtml);
  ```
* Never concatenate user input into `innerHTML`, `eval`, URL query strings, or command strings without proper encoding/escaping.
* Treat every external API call as untrusted → validate and fail closed.

---

### 9. Testing & Mockability

* **No code runs at import time**. Tests should be able to `import` modules without side-effects.
* All I/O (fetch, WebSocket, storage) must be behind an injected interface so unit tests supply mocks/stubs.
* Provide a `createXyzModuleMock(depsOverrides?)` helper when the module is a frequent fixture dependency.

---

### 10. Documentation & Readability

* **Header banner** (JSDoc or multi-line comment) at the top of each file: purpose, public surface, mandatory dependencies.
* Function/class-level JSDoc: concise description, parameters, return type, thrown errors.
* Idiomatic modern JS/TS: `const`/`let`, arrow functions where expressive, template literals over string concatenation—no ES3 artifacts.
* Disabling a linter rule (`eslint-disable`, `ts-ignore`) requires an inline comment explaining *why*.

---

### 11. Merge Gate

> **Absolute requirement:**
> If any single checklist item above is unmet, the reviewer must request changes. A “looks good” review is invalid until the guideline violations are resolved or a project maintainer grants an explicit, documented exception.
