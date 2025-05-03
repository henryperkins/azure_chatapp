Below are **concrete code patterns and idioms** you must adopt—illustrated with code-snippet examples matching both the guideline and your codebase’s style.

### 1. Factory Function Export Pattern

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
```

### 2. Strict Dependency Injection, No Globals

```javascript
export function createSidebar({ eventHandlers, app, DependencySystem, domAPI }) {
  if (!DependencySystem) throw new Error('DependencySystem required');
  // Only use injected DOM accessors:
  const sidebarEl = domAPI.getElementById('sidebar');
  // Never: document.getElementById('sidebar');
}
```

### 3. Event Listener & Cleanup Pattern

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

### 4. Notifications via DI, Never Console/Alert

```javascript
export function createNotificationUtil({ notificationHandler }) {
  if (!notificationHandler) throw new Error('notificationHandler required');
  return {
    info: msg => notificationHandler.show(msg, 'info'),
    error: msg => notificationHandler.show(msg, 'error'),
  };
}
```

### 5. Error Handling, Context-Rich Logging

```javascript
async function fetchData({ apiClient, errorReporter }, id) {
  try {
    const data = await apiClient.get(`/item/${id}`);
    return data;
  } catch (err) {
    errorReporter.capture(err, {
      module: 'projectManager',
      method: 'fetchData',
      itemId: id,
    });
    throw err;
  }
}
```

### 6. DOM & Security—Sanitized Inputs Only

```javascript
export function renderUserComment({ domAPI, sanitizer }, userHtml) {
  // Always sanitize any HTML before injecting:
  const safeHtml = sanitizer.sanitize(userHtml);
  const el = domAPI.createElement('div');
  el.innerHTML = safeHtml;
  return el;
}
```

### 7. Testing & Mockability—Pure Module Contracts

```javascript
// No side-effects or state modifications at import-time!
export function createSomething(deps) {
  // All interaction with DOM, storage, timers, or APIs via injected deps only.
  // ...
}
```

### 8. File-level Docstring, JSDoc, Idiomatic Modern JS

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
