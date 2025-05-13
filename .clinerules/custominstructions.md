# 🛡️ LLM System Prompt – Frontend Code Guardrails

Apply these guardrails whenever you (the LLM) generate, refactor, or review **JavaScript/TypeScript frontend code** in this repository. Enforce them strictly; flag any violation and propose a compliant fix.

1. **Factory Function Export** – Export each module through a named factory (`createXyz`). Validate all dependencies at the top and expose a cleanup API. _No top‑level logic._
2. **Strict Dependency Injection** – Do **not** access `window`, `document`, `console`, or any global directly. Interact with the DOM and utilities only through injected abstractions (`domAPI`, `notify`, `apiClient`, etc.).
3. **Pure Imports** – Produce no side effects at import time; all initialization occurs inside the factory.
4. **Centralized Event Handling** – Register listeners with `eventHandlers.trackListener(..., { context })` and remove them with `eventHandlers.cleanupListeners({ context })`.
5. **Context Tags** – Supply a unique `context` string for every listener and notification.
6. **Notifications via `notify`** – Replace `console` or `alert` calls with the injected `notify` utility. Always include metadata: `notify.info('Message', { module: 'MyModule', context: 'operation', source: 'function' })`. For repeated notifications, create a contextual notifier with `notify.withContext({ module, context })`.
7. **Debug & Trace Utilities** – Use `createDebugTools({ notify })` for performance timing and trace IDs; emit diagnostic messages through the same `notify` pipeline.
8. **Context‑Rich Error Logging** – Capture errors with `errorReporter.capture(err, { module, method, … })`, never leaking tokens or PII.
9. **Sanitize All User HTML** – Always call `sanitizer.sanitize()` before inserting user content into the DOM.
10. **App Readiness** – Wait for `DependencySystem.waitFor([...])` _or_ the global `'app:ready'` event before interacting with app‑level resources.
11. **Central `app.state` Only** – Read global authentication and initialization flags from `app.state`; do **not** mutate them directly.
12. **Module Event Bus** – When broadcasting internal state, expose a dedicated `EventTarget` (e.g., `AuthBus`) so other modules can subscribe without tight coupling.
13. **Navigation Service** – Perform all route or URL changes via the injected `navigationService.navigateTo(...)`.
14. **Single API Client** – Make every network request through `apiClient`; centralize headers, CSRF, and error handling.
15. **Notifier Factories** – Create module‑scoped notifiers with `notify.withContext({ module: 'MyModule', context: 'operations' })`. Use this contextual notifier throughout the module for consistent metadata tagging.
16. **Backend Event Logging** – Log critical client events with `backendLogger.log({ level, message, module, … })`
17. **User Consent for Monitoring** – Honor user opt‑out preferences before initializing analytics or error‑tracking SDKs.

---

## Notification System Best Practices

- **Always include context metadata** in notifications: `module`, `context`, and `source` properties
- **Create contextual notifiers** at the module level: `const moduleNotify = notify.withContext({ module: 'MyModule', context: 'operations' })`
- **Include original errors** when catching exceptions: `notify.error('Failed', { originalError: err })`
- **Use specialized methods** for common scenarios: `notify.apiError()`, `notify.authWarn()`
- **Group related notifications** with `group: true` to prevent UI clutter
- **Use helper utilities** like `wrapApi()` for API calls and `safeInvoker()` for event handlers
- **Leverage debug tools** for performance monitoring: `const dbg = createDebugTools({ notify })`

---

**Golden Rules**: Inject every dependency, avoid global side effects, tag artifacts with `context`, clean up listeners and resources, and route logs, traces, and errors through the central utilities.
