# Custom Instructions

This document defines the concrete code patterns and idioms that every module in our frontend codebase must follow. Each section includes a code-snippet example that matches both the guideline and our codebase’s style.

---

## Factory Function Export Pattern
*(slug: `factory-function-export-pattern`)*

```javascript
/**
 * Project Manager module.
 * Manages project entities and coordinates high-level actions.
 *
 * @param {Object} deps - Dependencies injected by DI or the orchestrator.
 * @param {DependencySystem} deps.DependencySystem - Central orchestrator and service locator.
 * @param {EventHandlers} deps.eventHandlers - DOM and custom event wiring abstraction.
 * @returns {ProjectManager} - Fully initialized, teardown-ready project manager.
 */
export function createProjectManager(deps) {
  if (!deps.DependencySystem) throw new Error('DependencySystem required');
  // ...other dep validations...
  return new ProjectManager(deps);
}
````

---

## Strict Dependency Injection, No Globals

*(slug: `strict-dependency-injection`)*

```javascript
export function createSidebar({ eventHandlers, app, DependencySystem, domAPI }) {
  if (!DependencySystem) throw new Error('DependencySystem required');
  // Only use injected DOM accessors:
  const sidebarEl = domAPI.getElementById('sidebar');
  // Never: document.getElementById('sidebar');
}
```

---

## Event Listener & Cleanup Pattern

*(slug: `event-listener--cleanup-pattern`)*

```javascript
function setupSidebarEvents({ eventHandlers, domAPI }) {
  const listeners = [];
  const el = domAPI.getElementById('sidebar');
  const onClick = () => { /*...*/ };

  listeners.push(
    eventHandlers.trackListener(el, 'click', onClick, { description: 'Open sidebar' })
  );

  function cleanup() {
    listeners.forEach(l => l.remove());
    listeners.length = 0;
  }
  return { cleanup };
}
```

---

## Notifications via DI—Inject `notify` Util, Never Console/Alert

*(slug: `notifications-via-di`)*

#### **Basic Usage**

```javascript
export function createProjectManager({ DependencySystem, eventHandlers, notify }) {
  if (!notify) throw new Error('notify utility required');

  function loadProject(id) {
    notify.info('Loading project…', {
      group: true,
      context: 'projectManager',
      module: 'ProjectManager',
      source: 'loadProject',
      traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
      transactionId: DependencySystem?.generateTransactionId?.(),
      extra: { projectId: id }
    });

    // On error:
    notify.error('Could not load project file', {
      group: true,
      context: 'projectManager',
      module: 'ProjectManager',
      source: 'loadProject',
      traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
      transactionId: DependencySystem?.generateTransactionId?.(),
      extra: { projectId: id, reason: 'file not found' }
    });
  }

  return { loadProject };
}
```

#### **Preferred Context Helper**

```javascript
const pmNotify = notify.withContext({
  module: 'ProjectManager',
  context: 'projectManager'
});
pmNotify.info('Loading project', { source: 'loadProject' });
```

#### **Notification API**

* `notify.info(msg, opts)`
* `notify.success(msg, opts)`
* `notify.warn(msg, opts)`
* `notify.error(msg, opts)`
* `notify.apiError(msg, opts)` – built-in grouping for API failures
* `notify.authWarn(msg, opts)` – built-in grouping for auth issues
* `notify.withContext({ module, context })` – returns a helper that auto-fills those fields

---

## Global Debug/Trace Forwarding (notify + globalUtils integration)

**ALWAYS** call `setGlobalUtilsNotifier(notify)` (from `utils/globalUtils.js`) after creating your DI notify instance in app bootstrap. This ensures all trace/debug and timer logs, including all generated trace IDs and performance events from `createDebugTools`, are mirrored to the terminal via the notify logger, not just to browser console or test stubs.
Example:
```js
import { createNotify } from "./utils/notify.js";
import { setGlobalUtilsNotifier } from "./utils/globalUtils.js";
const notify = createNotify({...});
setGlobalUtilsNotifier(notify);
```
This guarantees all trace/debug/stopwatch events, and their context (traceId/session/label), are received by the notification pipeline and thus visible on the backend/terminal logs.

---

## Error Handling – Context-Rich Logging

*(slug: `error-handling--context-rich-logging`)*

```javascript
async function fetchData({ apiClient, errorReporter, DependencySystem }, id) {
  try {
    const data = await apiClient.get(`/item/${id}`);
    return data;
  } catch (err) {
    errorReporter.capture(err, {
      module: 'projectManager',
      method: 'fetchData',
      itemId: id,
      traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
      transactionId: DependencySystem?.generateTransactionId?.()
    });
    throw err;
  }
}
```

---

## DOM Security – Sanitized Inputs Only

*(slug: `dom--security-sanitized-inputs`)*

```javascript
export function renderUserComment({ domAPI, sanitizer }, userHtml) {
  // Always sanitize any HTML before injecting:
  const safeHtml = sanitizer.sanitize(userHtml);
  const el = domAPI.createElement('div');
  el.innerHTML = safeHtml;
  return el;
}
```

---

## Testing & Mockability—Pure Module Contracts

*(slug: `testing--pure-module-contracts`)*

```javascript
// No side-effects or state modifications at import-time!
export function createSomething(deps) {
  // All interaction with DOM, storage, timers, or APIs via injected deps only.
  // ...
}
```

---

## File-level Docstring, JSDoc, Idiomatic Modern JS

```javascript
/**
 * Sidebar Enhancement Module.
 * Adds accessibility and visual features to the user sidebar.
 *
 * @param {Object} deps - See below for list.
 * @returns {Object} API - { enable, disable, cleanup }
 */
// (Code follows...)
```

---

## Application Readiness Event (`app:ready`)

*(slug: `application-readiness-event`)*

To ensure modules initialize in the correct order and only after the core application and essential services are ready, the application (`app.js`) dispatches a single global event named `app:ready` on the `document` object.

**Dispatching `app:ready` (in `app.js`):**
```javascript
// Inside app.js, at the end of the main init() function:
// ... all core initializations complete ...
domAPI.dispatchEvent(domAPI.getDocument(), new CustomEvent('app:ready', { detail: { success: true } }));

// On failure:
domAPI.dispatchEvent(domAPI.getDocument(), new CustomEvent('app:ready', { detail: { success: false, error: err } }));
```

**Consuming `app:ready` (in other modules):**
Modules should generally rely on `DependencySystem.waitFor([...deps])` to ensure their direct dependencies are available. If a module also needs to wait for the overall application to be fully ready before performing certain actions (e.g., interacting with UI that `app.js` finalizes), it can listen for the `app:ready` event.

```javascript
// Inside a module that needs to wait for full app readiness
async function initializeMyModule({ DependencySystem, eventHandlers, domAPI }) {
  // Wait for direct dependencies
  await DependencySystem.waitFor(['someService', 'anotherService']);

  // Then, wait for the app:ready event
  return new Promise((resolve, reject) => {
    const appReadyHandler = (event) => {
      if (event.detail.success) {
        // Perform app-ready actions
        console.log('App is ready, MyModule can now proceed with app-dependent setup.');
        resolve(true);
      } else {
        console.error('App failed to initialize. MyModule cannot proceed.', event.detail.error);
        reject(new Error('App initialization failed'));
      }
      // Clean up this specific listener if eventHandlers is available and supports untrackListener by original handler
      // Or rely on module-level cleanup if this listener is tracked with a context.
    };
    eventHandlers.trackListener(domAPI.getDocument(), 'app:ready', appReadyHandler, { once: true, context: 'myModule', description: 'MyModule app:ready listener' });
  });
}
```
**Note:** Individual modules should no longer dispatch their own "ready" events (e.g., `moduleX:initialized`). Module readiness is determined by their successful registration in `DependencySystem` and the subsequent global `app:ready` event. Data-specific events (e.g., `projectFilesLoaded`) are still acceptable.

---

## Contextual Event Listener Cleanup Pattern

*(slug: `contextual-event-listener-cleanup`)*

To prevent memory leaks from event listeners that are not properly removed, all calls to `eventHandlers.trackListener` must include a `context` property in their `options` object. This context is a string that uniquely identifies the module or component registering the listener.

Each module that registers listeners must also provide a `destroy` or `cleanup` method. This method is responsible for calling `DependencySystem.cleanupModuleListeners('yourModuleContext')` or `eventHandlers.cleanupListeners({ context: 'yourModuleContext' })` to remove all listeners associated with that specific context.

**Registering a listener with context (in `myModule.js`):**
```javascript
const MODULE_CONTEXT = 'myModule'; // Define a context string for the module

// ... inside a method ...
eventHandlers.trackListener(
  someElement,
  'click',
  this.handleClick,
  {
    description: 'MyModule specific click',
    context: MODULE_CONTEXT // Provide the module's context
  }
);
```

**Implementing cleanup (in `myModule.js`):**
```javascript
// ... inside the module's class or factory ...
function destroy() {
  // Option 1: Using DependencySystem helper (preferred if available)
  if (this.DependencySystem && typeof this.DependencySystem.cleanupModuleListeners === 'function') {
    this.DependencySystem.cleanupModuleListeners(MODULE_CONTEXT);
  }
  // Option 2: Directly using eventHandlers (if DependencySystem helper is not set up)
  else if (this.eventHandlers && typeof this.eventHandlers.cleanupListeners === 'function') {
    this.eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
  }
  // ... other cleanup logic for the module ...
}

return {
  init: /* ... */,
  destroy // Expose the destroy method
};
```

**`eventHandler.js` modifications:**
- `trackListener(element, type, handler, options)`:
  - Expects `options.context` (string).
  - If `context` is missing, it logs a warning and defaults to `'unknown_context'`.
  - Stores the `context` with the listener details.
- `cleanupListeners(options)`:
  - Expects `options.context` (string).
  - If `context` is provided, only removes listeners matching that context.
  - If no `context` is provided, it logs a warning and cleans up all tracked listeners (this global cleanup is discouraged).

**`DependencySystem` helper (in `app.js`):**
```javascript
// Added to DependencySystem instance in app.js
DependencySystem.cleanupModuleListeners = function(moduleContext) {
  const eventHandlers = DependencySystem.modules.get('eventHandlers');
  if (!eventHandlers || typeof eventHandlers.cleanupListeners !== 'function') {
    // notify.error(...)
    return;
  }
  if (!moduleContext || typeof moduleContext !== 'string') {
    // notify.warn(...)
    return;
  }
  eventHandlers.cleanupListeners({ context: moduleContext });
};
```
This pattern ensures that listeners are properly namespaced by their module context and can be reliably cleaned up when a module is destroyed or no longer needed, preventing common sources of memory leaks in SPAs.
