# Frontend Code Patterns (Condensed)

Use these guidelines to keep frontend code consistent, maintainable, and secure. Each pattern shows preferred usage and highlights common pitfalls.

---

## 1. Factory Function Export
**Do**
```js
export function createXyz(deps) {
  if (!deps.eventHandlers) throw new Error('missing eventHandlers');
  return new XyzModule(deps);
}
```
**Don’t**
```js
// Running logic directly on import
setupListeners(); // side effect
```
• Always export a factory that takes dependencies.
• Validate dependencies at the start.

---

## 2. Strict Dependency Injection (No Globals)
**Do**
```js
const sidebar = domAPI.getElementById('sidebar');
```
**Don’t**
```js
const sidebar = document.getElementById('sidebar');
```
• Never directly use global objects (window, document, console).
• Inject and use abstractions (domAPI, notify, etc.).

---

## 3. No Side Effects on Import
• Keep modules "pure" at import.
• Only start processes or attach listeners inside an exported initializer function.

---

## 4. Centralized Event Handling & Cleanup
**Do**
```js
eventHandlers.trackListener(el, 'click', onClick, { context: 'myModule' });
// later…
eventHandlers.cleanupListeners({ context: 'myModule' });
```
• Use a single eventHandlers utility.
• Provide a unique `context` for each module’s listeners.

---

## 5. Contextual Listener Tracking
• Always specify a meaningful `context` for eventHandlers.
• That context is used for easy listener cleanup.

---

## 6. Notifications (Avoid console/alert)
**Do**
```js
notify.error('Failed to load data', { module: 'myModule', context: 'dataFetch' });
```
• Use injected `notify` for all messages.
• Helps maintain a consistent user experience and log format.

---

## 7. Debug & Trace
**Do**
```js
const dbg = createDebugTools({ notify });
const id = dbg.start('fetch');
// operations…
dbg.stop(id, 'fetch completed');
```
• Use a single debugging utility to measure performance and gather diagnostic info.

---

## 8. Context-Rich Error Logging
**Do**
```js
try {
  await api.getData(id);
} catch (err) {
  errorReporter.capture(err, { module: 'myModule', method: 'fetch', id });
}
```
• Always include module/method details.
• Helps trace issues quickly.

---

## 9. DOM Security – Sanitize Inputs
**Do**
```js
el.innerHTML = sanitizer.sanitize(userInput);
```
• Never trust user inputs. Clean them before injecting into the DOM.

---

## 10. App Readiness Coordination
```js
await DependencySystem.waitFor(['serviceA']);
```
• Wait or listen for `'app:ready'` before starting module logic.

---

## 11. Central `app.state`
• Store key global states (authenticated, currentUser) in `app.state`.
• Modules read or subscribe rather than directly mutating.

---

## 12. Module-Specific Event Bus
```js
// AuthBus in auth module
AuthBus.dispatchEvent(new CustomEvent('authChanged', { detail: {...} }));
```
• If a module manages significant internal state, expose an EventTarget.
• Other modules listen without tight coupling.

---

## 13. Uniform Navigation Service
```js
navigationService.navigateTo('projectDetails', { projectId: 123 });
```
• Route and URL management go through a single `navigationService`.
• Ensures consistent transitions, history, and event hooks.

---

## 14. Single API Client
```js
const response = await apiRequest('/login', {
  method: 'POST',
  body: { username, password }
});
```
• Centralize fetch logic in one `apiClient`.
• Handles CSRF, headers, error handling in one place.

---

## 15. Contextual Notifier Factories
```js
const authNotify = notify.withContext({ module: 'Auth', context: 'login' });
authNotify.info('Logging in...');
```
• Use `notify.withContext` to automatically tag notifications with module/context/source.
• Encourages consistent, easily traceable logging.

---

### Final Reminders
• **Inject everything you use** – no hidden globals.
• **Centralize repeated tasks** (events, nav, API, notifications).
• **No initialization on import** – do it in your factory.
• **Use contexts** for cleaning up listeners or tagging logs.

By adhering to these patterns and verifying each module against them, you’ll avoid anti-patterns like global references, scattered event cleanup, uncontrolled side effects, and inconsistent notification or logging approaches.
