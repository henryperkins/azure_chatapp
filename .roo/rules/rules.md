Below are **concrete code patterns and idioms** you must adopt—illustrated with code-snippet examples matching both the guideline and your codebase’s style.

---

## 1. Factory Function Export Pattern

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

---

## 2. Strict Dependency Injection, No Globals

```javascript
export function createSidebar({ eventHandlers, app, DependencySystem, domAPI }) {
  if (!DependencySystem) throw new Error('DependencySystem required');
  // Only use injected DOM accessors:
  const sidebarEl = domAPI.getElementById('sidebar');
  // Never: document.getElementById('sidebar');
}
```

---

## 3. Event Listener & Cleanup Pattern

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

## 4. Notifications via DI—Inject `notify` Util, Never Console/Alert

### 🚨 **You MUST use the canonical structured payload pattern for notifications:**

**Always provide as much context as possible for logging, grouping, tracing, and debugging.**

### **Notification Usage Pattern**

```javascript
export function createProjectManager({ DependencySystem, eventHandlers, notify }) {
  if (!notify) throw new Error('notify utility required');
  // ...other dep validations...

  function loadProject(id) {
    // Always provide context, module, source, and if possible, traceId/transactionId.
    notify.info('Loading project…', {
      group: true,
      context: 'projectManager',
      module: 'ProjectManager',
      source: 'loadProject',
      traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
      transactionId: DependencySystem?.generateTransactionId?.(),
      extra: { projectId: id }
    });

    // On error, grouped by module context with traceability
    notify.error('Could not load project file', {
      group: true,
      context: 'projectManager',
      module: 'ProjectManager',
      source: 'loadProject',
      traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
      transactionId: DependencySystem?.generateTransactionId?.(),
      extra: { projectId: id, reason: 'file not found' }
    });

    // For API errors (uses built-in grouping/context)
    notify.apiError('API call failed', {
      module: 'ProjectManager',
      source: 'loadProject',
      context: 'projectManager',
      traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
      transactionId: DependencySystem?.generateTransactionId?.(),
      extra: { apiUri: '/api/project/load', projectId: id }
    });
  }

  return { loadProject };
}
```

#### **Preferred: Use notify.withContext() for modules/components**

```javascript
const pmNotify = notify.withContext({
  module: 'ProjectManager',
  context: 'projectManager'
});
pmNotify.info('Loading project', { source: 'loadProject' });
```

### **Notification Payload Contract**

Supply these fields where possible (auto-generated if omitted):

- `groupKey` – Deterministic key (type|module|source|context) – preferred for grouping/deduplication
- `context` – Feature or workflow context ("projectManager")
- `module` – Subsystem/component name ("ProjectManager")
- `source` – Specific method/event ("loadProject")
- `traceId`, `transactionId` – For distributed tracing; inject/generate/propagate using DI
- `group` – Boolean: group accordion display in UI
- `extra` – Arbitrary metadata (object)
- `id` – Event ID (`groupKey:timestamp`, auto if omitted)

**Minimum for grouped notifications:**
At least one of `context`, `module`, or `source` (preferably all).

#### Example:

```javascript
notify.error('Could not load file', {
  group: true,
  context: 'file-upload',
  module: 'FileUploadComponent',
  source: 'handleUpload',
  traceId,
  transactionId,
  extra: { fileName: 'foo.txt', reason: 'quota' }
});
```

**DEV Tip:** If you omit `context`, `module`, and `source` for grouped notifications, you’ll get a developer warning (`devCheckContextCoverage`).

---

### **Notification API**

- `notify.info(msg, opts)`
- `notify.success(msg, opts)`
- `notify.warn(msg, opts)`
- `notify.error(msg, opts)`
- `notify.apiError(msg, opts)` – opinionated for API grouping/context
- `notify.authWarn(msg, opts)` – opinionated for auth
- `notify.withContext({ module, context, source })` – generates a helper with context attached

---

## 5. Error Handling, Context-Rich Logging

```javascript
async function fetchData({ apiClient, errorReporter, DependencySystem }, id) {
  try {
    const data = await apiClient.get(`/item/${id}`);
    return data;
  } catch (err) {
    // Provide all available context for tracing and analysis
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

## 6. DOM & Security—Sanitized Inputs Only

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

## 7. Testing & Mockability—Pure Module Contracts

```javascript
// No side-effects or state modifications at import-time!
export function createSomething(deps) {
  // All interaction with DOM, storage, timers, or APIs via injected deps only.
  // ...
}
```

---

## 8. File-level Docstring, JSDoc, Idiomatic Modern JS

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
