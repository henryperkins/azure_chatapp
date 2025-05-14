**Comprehensive Removal Plan for Logging/Notification/Debugging/Observation Code (Static JS/TS Frontend)**

---

**Scope and Findings:**
A search through `static/js/` returns deep integration of notification/logging/reporting systems across the codebase, with contextual notifiers, dependency injection, debug/event wrappers, error reporting, Sentry, backend logging, and cross-module helpers. Dozens of modules—especially feature containers, entrypoints, and UI factories—use these patterns. Top offenders include:
- `notify`, `notificationHandler`, `errorReporter`, `backendLogger`, contextual notifiers
- Specialized wrappers/helpers: `wrapApi`, `safeInvoker`, `maybeCapture`, `createDebugTools`
- Sentry/analytics/observation setup modules
- All forms of logging, context, and notification calls (debug, info, warn, error, apiError, withContext, capture, log, and similar)

---

### **Step-by-Step Plan**

#### **1. Targeted Removals in Each Module**
- **Imports/Requires:** Delete all references to notification/logging/reporting/analytics utilities and helpers (as per checklist/search pattern).
- **Dependency Injection/Params:** Remove any DI parameter for notification/logging/event/reporting utilities; reshape factory/function params accordingly.
- **Validation:** Eliminate any logic validating presence of such DI (e.g., `if (!notify) throw ...`).
- **Contextual Notifiers/Creation:** Remove all calls to `withContext`, contextual notifiers, fallback notifiers, and related initialization.
- **Usage:** Remove all usage of notification/logging/reporting/observation methods (across debug, info, warn, error, success, apiError, capture, log, etc.).
- **Side-Effect Utilities & Event Handling:** Kill event managers, observation setup, sentry hooks, and other side-effect code related only to the killed stack.
- **Docstrings/Comments/TODOs:** Delete inline docs, docstrings, or comments referencing old notification/log/error observation logic.

#### **2. Remove Entire Files if:**
- They exist solely for notification/logging/event bus/reporting/debug, or become empty after removals (e.g., `notification-handler.js`, `notifications-helpers.js`, `backendLogger.js`, `errorReporter.js`, `sentry-init.js`, any dedicated helpers).
- If after the above, any index/DI reference to these files exists, update or delete as required.

#### **3. Regenerate Module Index**
- Scan any module indexes, loader configs, or container/DI registries for now-missing notification/reporting/observation modules.
- Delete or refactor registry code no longer necessary.

#### **4. Orphan Checks / Fallbacks**
- Remove leftover shims, fallback notification logic, or "try/catch" that just logged/captured errors.

#### **5. Business Logic Preservation**
- Retain all application, UI, and main feature logic—just strip all notification/log/debug/reporting code.
- Refactor any affected input/output parameters to follow business logic needs, not notification system legacy.

---

**Example (Before/After):**
```js
// Before:
import { notify } from './utils/notifications-helpers.js';
export function createFoo({ notify, apiClient }) {
  if (!notify) throw new Error("notify required");
  const fooNotify = notify.withContext({ module: 'Foo' });
  fooNotify.info("Foo initialized");
  ...
}

// After:
export function createFoo({ apiClient }) {
  ...
}
```

---

**You must now toggle to Act mode to actually enact this plan!**

- All logging/notification/debug/reporting/observation infrastructure (including contextual notifiers, reporting wrappers, and fallback logic) will be fully deleted project-wide, as per your checklist and search targets.
- The only code left standing will be side-effect-free business logic and core functionality.

Once toggled to Act mode, I’ll proceed file by file and systematically execute these changes (including file deletion where applicable) until the codebase is clean.
