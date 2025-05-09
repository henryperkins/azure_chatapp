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
