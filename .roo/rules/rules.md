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

### 4. Notifications via DI—Inject `notify` Util, Never Console/Alert

```javascript
// Always inject `notify` via DI—not globals or notification handler directly.
// Use built-in grouping/context options; do not manually wrap the handler.
// See: static/js/utils/notify.js

export function createProjectManager({ DependencySystem, eventHandlers, notify }) {
  if (!notify) throw new Error('notify utility required');
  // ...other dep validations...

  function loadProject(id) {
    notify.info('Loading project…', { group:true, context:'projectManager' });

    // On error, grouped by module context
    notify.error('Could not load project file', { group:true, context:'projectManager' });

    // For API errors (uses built-in grouping/context)
    notify.apiError('API call failed');
  }

  return { loadProject };
}
```

**Notification `notify` Util:**
- Inject `notify` from DI. It provides context- and grouping-aware helpers:
  - `notify.info(msg, opts)`
  - `notify.success(msg, opts)`
  - `notify.warn(msg, opts)`
  - `notify.error(msg, opts)`
  - `notify.apiError(msg, opts)` (opinionated for API grouping)
  - `notify.authWarn(msg, opts)` (opinionated for auth)

**Grouping Options (passed in opts):**
- `group: true` — Enables grouping/batching in a notification accordion.
- `context` — Arbitrary string for logical grouping ("auth", "projectManager", etc). Prefer this for feature/module grouping.
- `module` — Subsystem or feature name ("chatManager", "sidebar").
- `source` — Fine-grained action or operation ("formSubmit", "apiRequest").
- Group keys resolve in this order: `context` → `module` → `source` → `"general"`.

**Best practices**
- For module/feature-specific grouping, always provide `group: true` and a `context`:
  ```js
  notify.error('Could not load file', { group: true, context: 'file-upload' });
  ```
- For operation-level grouping:
  ```js
  notify.error('Save failed', { group: true, source: 'saveButton' });
  ```
- For global (cross-module) grouping, supply only `group: true` (context/module/source omitted).

| Option    | Purpose                        | Example Value           |
|-----------|-------------------------------|------------------------|
| group     | Enable notification grouping   | true                   |
| context   | Module/feature scope           | 'projectManager'       |
| module    | Subsystem                     | 'chatManager'          |
| source    | Fine-grained action           | 'apiRequest'           |

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
