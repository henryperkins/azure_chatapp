# 🚀 Frontend Code Patterns – Quick Reference

Follow these guidelines to ensure consistency, maintainability, and security across all frontend modules.

---

## 1. Factory Function Export

Always export modules via a factory function:

```javascript
export function createXyz(deps) {
  if (!deps.eventHandlers) throw new Error('eventHandlers required');
  return new XyzModule(deps);
}
```

## 2. Strict Dependency Injection (No Globals)

Never directly access global `window`, `document`, or DOM APIs:

✅ **Good:**

```javascript
const sidebar = domAPI.getElementById('sidebar');
```

❌ **Bad:**

```javascript
const sidebar = document.getElementById('sidebar');
```

## 3. No Side Effects on Import

Avoid executing code or altering state upon module import:

✅ **Good:**

```javascript
export function createWidget(deps) { /* logic */ }
```

❌ **Bad:**

```javascript
setupListeners(); // side effect at import
```

## 4. Event Listener Cleanup

Always track listeners explicitly and provide cleanup methods:

```javascript
const listeners = [];
listeners.push(eventHandlers.trackListener(el, 'click', onClick, { context: 'sidebar' }));

function cleanup() {
  listeners.forEach(listener => listener.remove());
}
```

## 5. Contextual Listener Tracking

Include a clear context identifier for organized listener cleanup:

```javascript
eventHandlers.trackListener(el, 'click', handler, { context: 'myModule' });

function destroy() {
  eventHandlers.cleanupListeners({ context: 'myModule' });
}
```

## 6. Notifications (No Console or Alert)

Use injected `notify` utility for messaging and logging:

```javascript
notify.error('Failed to load data', { module: 'myModule', context: 'dataFetch' });
```

Simplify with context helpers:

```javascript
const moduleNotify = notify.withContext({ module: 'MyModule' });
moduleNotify.info('Operation started');
```

## 7. Debug and Trace Utilities

Leverage injected `notify` via `createDebugTools` for performance tracing:

```javascript
const debug = createDebugTools({ notify });
const traceId = debug.start('fetchData');
// ... perform operations ...
debug.stop(traceId, 'fetchData');
```

## 8. Context-Rich Error Logging

Always provide detailed context when logging errors:

```javascript
try {
  await api.getData(id);
} catch (err) {
  errorReporter.capture(err, { module: 'myModule', method: 'fetch', id });
}
```

## 9. DOM Security: Sanitized Inputs

Always sanitize user inputs before inserting them into the DOM:

```javascript
const safeHtml = sanitizer.sanitize(userInput);
el.innerHTML = safeHtml;
```

## 10. Application Readiness Coordination

Coordinate initialization by awaiting the global `app:ready` event or using `DependencySystem.waitFor`:

```javascript
await DependencySystem.waitFor(['serviceA']);
await new Promise(resolve => {
  eventHandlers.trackListener(domAPI.getDocument(), 'app:ready', resolve, { once: true });
});
```

Avoid dispatching module-specific readiness events.

---

### Always Remember:

* Explicitly inject all dependencies.
* Provide and implement event listener cleanup.
* Validate dependencies early.
* Ensure module imports are pure and side-effect free.
