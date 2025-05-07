# Refactoring Plan for `static/js/app.js`: Strict Dependency Injection (DI) and Robust UI Initialization

## Background

The current implementation uses lazy/thunk/factory-based dependency passing (`() => DS.modules.get('dep')`), which is incompatible with strict DI component contracts. Many components require dependencies as ready-to-use objects, not functions. This plan outlines concrete steps to restructure app.js and related wiring for reliable, scalable, maintainable DI-based initialization.

---

## 1. Eliminate All Factory/Thunk Dependency Passing

- **Never pass a factory or function (e.g. `() => DS.modules.get('dep')`) as a DI argument.**
- Always resolve dependencies before construction and inject the **actual instance**.

**Before:**
```js
new ProjectListComponent({ projectManager: () => DS.modules.get('projectManager') });
```
**After:**
```js
const projectManager = DS.modules.get('projectManager');
new ProjectListComponent({ projectManager });
```

---

## 2. Refactor UI Component Initialization

- In `initializeUIComponents`, *assign and deref* all dependencies before using them to construct components.
- For each DI argument, pass the resolved instance.

**Example:**
```js
const projectManager = DependencySystem.modules.get('projectManager');
const modalManager = DependencySystem.modules.get('modalManager');
const fileUploadComponentClass = DependencySystem.modules.get('FileUploadComponent');
// ...
const projectListComponentInstance = new ProjectListComponent({
    projectManager,
    eventHandlers,
    modalManager,
    app,
    router: { /* ... */ },
    notify,
    storage: DependencySystem.modules.get('storage'),
    sanitizer: DependencySystem.modules.get('sanitizer'),
    domAPI
});
```
Repeat for all principal components.

---

## 3. Ensure DI System Populated With Concrete Instances

- **After constructing each instance, register it immediately.**
- Only register actual objects/functions, never thunks.

**Example:**
```js
DependencySystem.register('projectManager', projectManager);
DependencySystem.register('modalManager', modalManager);
DependencySystem.register('projectListComponent', projectListComponentInstance);
// ...etc
```

---

## 4. Correct Event Handler and Notification System Usage

- **Always pass DI-resolved instances of utilities like `eventHandlers`, `notify`, `notificationHandler`.**
- Consistency prevents multi-instance/ambiguous event wiring or log sinks.

**Example:**
```js
const eventHandlers = DependencySystem.modules.get('eventHandlers');
const notify = DependencySystem.modules.get('notify');
// Pass these everywhere needed!
```

---

## 5. Sequence All DOM Loading Before Initializing UI Components

- **Ensure all required DOM containers exist** before calling `.initialize()` on any component.
- If HTML fragments or views are loaded asynchronously, `await` or `.then()` those operations before DI component initialization.

**Example:**
```js
await loadFragmentsIfNeeded();
assertDomElementsExist();
projectListComponentInstance.initialize();
```

---

## 6. Remove Fallbacks in Component Instantiation

- **Do not allow component constructors/factories to attempt fallback resolution.**
- Remove or hard-fail code like:
  `dep = dep || DS.get('dep')`
- **Fail at the callsite** if any dependency is missing.

---

## 7. Test the Entire DI+Init Chain

- Once all dependencies are registered, attempt to initialize the complete UI.
- **Address errors at the DI/wiring level**—never by adding new fallbacks.
- Watch notification handler, error logs (e.g. Sentry), console.

---

## 8. Optional: Refactor `createOrGetChatManager`

- In any factory/creator like this, **always resolve each dependency first**, then inject at once.
- Register the complete, concrete instance in DependencySystem.

---

## 9. Summary Table of What to Refactor

| Location                      | Replace                 | With                    |
|-------------------------------|-------------------------|-------------------------|
| projectManager                | `() => DS.get('...')`   | `DS.get('...')`         |
| modalManager                  | `() => DS.get('...')`   | `DS.get('...')`         |
| FileUploadComponentClass      | `() => DS.get('...')`   | `DS.get('...')`         |
| sidebar                       | `() => DS.get('...')`   | `DS.get('...')`         |
| ...                           | ...                     | ...                     |

---

## 10. Validate DOM Structure Early

- **Before** each component's `.initialize()`, verify all its required DOM anchors exist.
- If missing, throw a clear, actionable error.

**Example:**
```js
function assertDomElementsExist() {
  if (!document.getElementById('projectList')) throw new Error('Missing #projectList in DOM');
  if (!document.getElementById('projectDetailsView')) throw new Error('Missing #projectDetailsView in DOM');
  // ...etc.
}
```
Apply these checks in orchestrator just before initialization.

---

## Summary: What This Refactor Achieves

- Complete, fail-fast, testable DI wiring for all major app services and UI components.
- Robust, sequential and observable initialization error handling.
- Guaranteed component isolation and maintainability.
- No ambiguity: every dependency is a live instance, never a function or a fallback.

---

**Adopt this plan and your application startup, module wiring, and runtime robustness will dramatically improve.**
