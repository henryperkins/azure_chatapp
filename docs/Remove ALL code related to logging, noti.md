Remove ALL code related to logging, notification, debugging, Sentry/reporting or observation. This means all usage, DI, validation, import, and all variants of notification/event/logging APIs or helpers. Business logic and side effects not related to these features must be preserved; delete everything else.

---

## **Checklist for Each JavaScript/TypeScript Module**

### 1. **Imports & Requires**
- [ ] Delete any `import` or `require` line referencing modules like:
  - notify, notificationHandler, notifications-helpers, createNotify, createDebugTools, maybeCapture, wrapApi, safeInvoker, backendLogger, createBackendLogger, sentry-init, errorReporter, or context-aware notifiers.
  - Any cross-file notification/observation helper.

### 2. **Dependency Injection / Parameters**
- [ ] Remove any factory or function parameters (and destructuring) that introduce notification/logging/observation dependencies (e.g., `notify`, `notificationHandler`, `errorReporter`, `backendLogger`, `debugTools`, Sentry, etc).

### 3. **Validation & Contextual Notifiers**
- [ ] Delete any DI validation like `if (!notify) throw ...` or `notify.withContext(...)`
- [ ] Nuke all creation of contextual notifiers (e.g., `const localNotify = notify.withContext(...)` or similar)

### 4. **All Logging/Notification Calls**
- [ ] Delete **every** call to:
  - `notify.info()`, `notify.success()`, `notify.warn()`, `notify.error()`, `notify.debug()`, `notify.apiError()`, `notify.authWarn()`, `.log()`, `.capture()`, `.withContext()` and **any similar method** provided by custom notification libs.
  - Also: `errorReporter.capture`, `backendLogger.log`, `maybeCapture`, `wrapApi`, `safeInvoker`, and all code using those helpers.

### 5. **Side Effect Utilities**
- [ ] Remove any initialization, event registration, or teardown related to notification/logging/reporting/Sentry hooks, analytics, etc.
- [ ] Kill Sentry/analytics/monitoring *manager* code and any dependencies passed purely for those.

### 6. **Unused/Orphaned Files**
- [ ] If a module becomes empty, delete the file entirely.
- [ ] After changes, re-generate the project’s module index if required.

### 7. **Fallbacks & Shims**
- [ ] Delete any fallback notification/error functions or try/catch blocks left behind that just did logging or nothing.
- [ ] Remove all module-level notifiers, grouping logic, or observer buses that exist only for this stack.

### 8. **Business Logic**
- [ ] Keep only the actual application, UI, or feature code!
- [ ] Refactor as needed to avoid breaking business flow or side effect handling.

### 9. **Cross-cutting TODOs**
- [ ] Check removed dependencies in DI containers, app registries, and module indexes.
- [ ] If there are comments/docstrings about notification systems, Sentry, or error reporting, remove or update them.

---

**Quick grep for killed code patterns:**
`grep -E "(notify|notificationHandler|notifications-helpers|maybeCapture|createDebugTools|wrapApi|safeInvoker|backendLogger|createBackendLogger|sentry-init|errorReporter|capture|withContext|apiError|authWarn|logEventToServer|Sentry|analytics)" ./static/js`

Make these removals module-by-module. If a piece of code is only there for logs, reporting, or observation, DELETE IT. Don’t just comment it out.

---

**Summary**

For each module: Remove all direct and indirect references to custom log/notification/debug/reporting/observation systems—including all imports, DI, methods, context notifiers, event managers, reporting wrappers, and fallback logic. The only thing that should remain is side-effect-free application/feature code.
