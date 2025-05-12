Got it. I’ll review all JavaScript files under `static/js/` in your `henryperkins/azure_chatapp` repo, focusing on violations of the following rules:

1. Factory Function Export
2. Strict Dependency Injection
3. Pure Imports
4. Centralized Event Handling
5. App Readiness
6. Central `app.state` Only
7. Module Event Bus
8. Navigation Service
9. Single API Client

I’ll flag any anti-patterns found, explain the issues, and suggest compliant refactors.
I’ll get back to you once the audit is complete.


# LLM Frontend Code Guardrails Audit Report

## static/js/app.js

* **Top-Level Initialization Logic:** The `app.js` module executes significant setup code at import time (registering dependencies and global event handlers) instead of exporting a factory. For example, it registers the app and currentUser in the dependency system and attaches a global error listener as soon as the module loads. This violates **Rule 1 (Factory Function Export)** and **Rule 3 (Pure Imports)**. **Recommended Refactor:** Encapsulate all initialization inside a factory function (e.g. `export function createApp(...)`) or within an exported `init()` method. Remove top-level side effects like `DependencySystem.register` calls and global event listeners from the module scope. Instead, perform registration and event binding during the factory’s execution or on app startup. For example:

  ```js
  export function createApp(deps) {
    // ... create dependencies
    DependencySystem.register('app', app);
    // ... bind events via eventHandlers after DOM ready or app:ready
    return { init, cleanup };
  }
  ```

  Ensure a `cleanup()` method removes any global listeners using the provided `eventHandlers.cleanupListeners(...)` API.

* **Direct Global Access (DOMPurify):** The module directly references the `window` global to get `window.DOMPurify` and throws an error if not present. This contravenes **Rule 2 (Strict Dependency Injection)**. **Recommended Refactor:** Require a sanitizer to be injected (as done later with `DependencySystem.register('sanitizer', ...)`), and perform the DOMPurify check inside the app factory or initialization. For example, inject `sanitizer` via DI and remove direct `window.DOMPurify` usage. This ensures the module can operate in test or non-browser environments and only uses provided abstractions.

## static/js/notification-handler.js

* **Untracked Event Listener:** The Notification Handler initially uses a direct `closeBtn.addEventListener("click", ...)` to handle notification close events, which violates **Rule 4 (Centralized Event Handling)**. Although it later replaces it with a tracked listener, any direct listener is against the guidelines. **Recommended Refactor:** Use the injected `eventHandlers.trackListener` from the start, even before `eventHandlers` is fully available. For example, delay attaching the close button handler until the `eventHandlers` module is ready (using `DependencySystem.waitFor(['eventHandlers'])`) or initialize the Notification Handler **after** the EventHandlers module is registered. This way, you can call `eventHandlers.trackListener(closeBtn, 'click', ...)` directly without any interim direct listener. The code in lines 152-168 already demonstrates replacing the listener with `trackListener`; ideally, the initial `addEventListener` can be removed entirely by ensuring `eventHandlers` is injected before any UI binding.

## static/js/modalManager.js

* **Direct Global API Usage:** The ModalManager module uses global browser APIs where it should use abstractions. It creates custom events and sometimes falls back to the global `document` instead of always using the injected `domAPI`. For example, it constructs a `CustomEvent('modalmanager:initialized')` and dispatches it on the document. It also uses the `FormData` constructor directly inside `ProjectModal.handleSubmit`. These bypass **Rule 2 (Strict DI)** and **Rule 12 (Module Event Bus)**. **Recommended Refactor:** Use injected abstractions for all browser interactions. For instance, have `domAPI` provide an event creation method or simply dispatch events via `domAPI.dispatchEvent` consistently (which it already attempts). Instead of using `new CustomEvent` directly, consider wrapping it in a helper or at least always going through `domAPI.dispatchEvent` with an injected document reference. For module-internal broadcasts (like notifying that the modal manager initialized), prefer using a dedicated `EventTarget` on the module (e.g. `this.events = new EventTarget()`) to fire a custom event, or emit an app-level event via a central bus rather than the DOM. For file data, inject an upload utility or use the central `apiClient` to handle form submission. For example, instead of directly calling `new FormData()`, the `projectManager` (or an injected service) could provide a method to handle file form parsing, keeping the module free of direct global calls.

* **Missing Factory Wrapper:** Although ModalManager defines a class internally, it correctly exposes `createModalManager` and `createProjectModal` factory functions. Ensure that no logic runs on import; in this module the logic is mostly inside class constructors and the factories, which is compliant with **Rule 3**. Just ensure any future additions (like additional event listeners or DOM queries) occur after instantiation (e.g., in an `init()` method or the factory) rather than at the top level.

## static/js/accessibility-utils.js

* **Fallback to Global Window:** The Accessibility Utils module provides a fallback implementation for `domAPI.getComputedStyle` that directly calls `window.getComputedStyle` if the injected `domAPI` lacks that function. This violates **Rule 2 (Strict Dependency Injection)**, which forbids direct global access. **Recommended Refactor:** Extend the injected `domAPI` interface to include `getComputedStyle` (as a required method), rather than using the global function. If that’s not possible, at least detect and warn, but do not call `window` directly. For example, you could throw an error in the constructor if `domAPI.getComputedStyle` is missing (similar to how other dependencies are validated) instead of patching it with a global call.

* **Console Usage for Errors:** In the factory `createAccessibilityEnhancements`, the code logs an error to `console.error` when critical dependencies are missing. Direct console use breaks **Rule 2**. **Recommended Refactor:** Use the injected `notify` or `errorReporter` to log this error. For instance, replace `console.error(...)` with `notify.error("AccessibilityUtils: Missing dependencies...")` or throw an exception. This ensures all logging goes through the centralized notification system.

## static/js/projectManager.js

* **Global `window/document` Usage:** The ProjectManager uses global objects instead of injected services in a couple of places. It builds API request URLs by accessing `location.origin` directly, and its internal `_emit` function falls back to `document.dispatchEvent` when dispatching module events. These patterns break **Rule 2 (Strict DI)** and **Rule 13/14 (Navigation & Single API)**. **Recommended Refactor:** For URL construction, use the injected `browserService` or configuration to get the base origin or, better, let the injected `apiClient` handle base URLs so the module doesn’t touch `window.location`. For event emitting, avoid using the global document; instead, use the provided `eventHandlers` or a module-specific EventTarget. For example, ProjectManager could maintain its own `ProjectManagerBus` (EventTarget) for events like `projectsLoaded` rather than dispatching DOM events. If other modules need to know when projects load, they can subscribe to this bus. If you must use DOM events, always go through `eventHandlers.trackListener` and a provided `domAPI`. In practice, since `eventHandlers` is injected, ProjectManager could call `DependencySystem.waitFor(['app:ready'])` in its initialization to ensure the app is ready, then safely use `navigationService` for any routing and `apiClient` for network calls, removing any reliance on global `location`.

* **No Direct State Mutation:** (Compliant) The module reads `app.state` for authentication checks and updates local module state, which aligns with **Rule 11**. Just ensure any future state changes (like setting current project ID) call methods on `app` or `projectManager` rather than setting global variables. (For example, use `app.setCurrentProjectId()` instead of something like `window.currentProject = ...` – currently there is no such global usage, which is good.)

## static/js/sidebar.js

* **None Observed:** The Sidebar module follows the guardrails closely. It exports a factory `createSidebar` and defers all logic to after injection. It uses the injected `domAPI` for DOM queries and `eventHandlers.trackListener` for events. There is no direct `window` or `document` usage (it even throws an error if `domAPI.getActiveElement` is missing to avoid `document.activeElement`). All event listeners are tracked with context, and cleanup is done in `destroy()` via `eventHandlers.cleanupListeners`. **Compliance Note:** This module adheres to **Rules 1, 2, 3, 4,** and **10-14** well. No changes needed aside from continuing to enforce DI for any new features.

## static/js/chatExtensions.js

* **Bypassing DI for DOM:** The chatExtensions module attempts to resolve dependencies but falls back to global objects for DOM manipulation. Notably, if no `domAPI` is provided, it creates one using `document.getElementById/querySelector`, and later it directly uses `document` in an event listener (`trackListener(document, 'click', ...)`). This violates **Rule 2 (Strict DI)**. **Recommended Refactor:** Make `domAPI` a required dependency (throw an error if missing) instead of silently using `document`. In event handlers, always prefer `domAPI.getDocument()` over the global document. For example, replace `trackListener(document, 'click', ...)` with:

  ```js
  const doc = domAPI.getDocument();
  eventHandlers.trackListener(doc, 'click', ..., { context: MODULE_CONTEXT });
  ```

  This ensures the module never touches the real DOM except through the injected abstraction.

* **Event Listener Tracking:** The module correctly insists on `eventHandlers.trackListener` (it throws if `eventHandlers` is missing), which is good. However, the *removal* of listeners should also be handled. Ensure that the `destroy()` method (which is exposed and calls `cleanupListeners`) is called when unloading chat extensions. This aligns with **Rule 4** and provides a cleanup hook, satisfying **Rule 1**’s “expose a cleanup API” requirement.

## static/js/auth.js

* **Direct Cookie Access:** The Auth module reads `document.cookie` directly in multiple places to check token presence and parse values. This is a breach of **Rule 2 (Strict DI)**, since it touches a global browser API. **Recommended Refactor:** Abstract cookie access behind an injected `storage` or `authTokenService`. For example, provide an API in the backend or a small injected module for reading auth cookies. This way, the auth module could call `tokenStore.has('access_token')` instead of manipulating `document.cookie`. This change would decouple it from the browser global and make it easier to maintain or test. If direct cookie checks are absolutely necessary, consider at least routing them through a provided `browserService.getDocument().cookie` call (which you can stub in tests).

* **Event Handling and App Readiness:** Auth uses a dedicated `AuthBus` (EventTarget) internally, which is a good practice to broadcast `authStateChanged` events. However, the module adds a listener to `AuthBus` with `AuthBus.addEventListener(...)` at module creation time. This is a minor infraction of **Rule 4**, since that listener is not tracked by `eventHandlers`. **Recommended Refactor:** You can wrap `AuthBus` events with the central event handler if needed. For instance, instead of calling `AuthBus.addEventListener` directly, use `eventHandlers.trackListener(AuthBus, 'authStateChanged', ...)` so that it’s registered in the central system (assuming the EventTarget can be treated like a DOM node for tracking; if not, consider it an acceptable exception but document it). As for readiness (**Rule 10**), the auth module initializes only when `app.init()` calls it (after waiting for dependencies), so it essentially respects app readiness. Just ensure any UI interactions (like enabling forms) occur after the `'app:ready'` event or via `DependencySystem.waitFor` if auth depends on other modules (the code already ties into `'modalsLoaded'` via a tracked listener, which is appropriate).

## static/js/modelConfig.js

* **Direct DOM Manipulation:** The modelConfig module performs extensive DOM manipulation with no DOM API abstraction. It directly calls `document.getElementById`, `document.createElement`, and dispatches events on `document`, violating **Rule 2 (Strict DI)** and **Rule 3 (Pure Imports)**. Because it doesn’t accept a `domAPI`, it has no choice but to use global document, and all this occurs when the module’s functions are invoked (which could be during app runtime, but the definitions are essentially tied to the module). **Recommended Refactor:** Introduce `domAPI` as a dependency for modelConfig, similar to other modules. All DOM queries (`getElementById`, etc.) should go through `domAPI`. For example, instead of `const sel = document.getElementById('modelSelect')`, use `const sel = api.domAPI.getElementById('modelSelect')` where `api` is the collected dependencies object. Also, dispatch events like `'modelConfigRendered'` via `domAPI.dispatchEvent(api.domAPI.getDocument(), new CustomEvent(...))` rather than on `document` directly. This change would bring modelConfig in line with **Rule 2**. Additionally, ensure no initialization runs on import – the module currently only defines functions and returns an API from `createModelConfig`, which is good (satisfying **Rule 1** and **Rule 3**). Just move any remaining direct DOM usage into the returned object’s methods (e.g., inside `initializeUI` or `renderQuickConfig`, use injected APIs).

* **Single Source of Network Truth:** ModelConfig appears not to make direct network calls (it likely relies on other services for saving config). Continue to ensure it uses the central `apiClient` or `apiRequest` (injected via `DependencySystem`) for any future network operations, per **Rule 14**. For instance, if modelConfig needs to fetch model details, have it call an injected `apiClient.get('/models')` rather than a global `fetch`. (No such calls are present now, which is compliant.)

## static/js/projectListComponent.js

* **No Factory Function:** `ProjectListComponent` is exported as a class and is instantiated directly (`new ProjectListComponent(...)` in app.js). This breaks **Rule 1 (Factory Function Export)**, which mandates using a named factory (e.g., `createProjectListComponent`). **Recommended Refactor:** Wrap this class in a factory export for consistency. For example, add at the bottom:

  ```js
  export function createProjectListComponent(opts) {
    return new ProjectListComponent(opts);
  }
  ```

  and have the app use `createProjectListComponent`. This ensures the pattern is consistent across modules and allows you to enforce that no constructor logic runs until the factory is called.

* **Global Document Events:** The component registers and listens for events like `projectsLoaded`, `projectCreated`, etc., on the global document object. It also dispatches a custom `'projectlistcomponent:initialized'` event on `document` when initialized. This violates **Rule 2** and **Rule 12** – using the global DOM as an event bus. **Recommended Refactor:** Utilize the injected `eventHandlers` and a module-scoped EventTarget instead of `document`. For example, the module could have an internal `this.bus = new EventTarget()` and fire a `'ready'` event on it after initialization, which interested modules can listen to (via their own DI or a central registry). If using DOM events is necessary for interoperability, always go through `eventHandlers.trackListener` with an injected document: e.g. `const doc = this.domAPI ? this.domAPI.getDocument() : document; eventHandlers.trackListener(doc, 'projectsLoaded', ...)`. In code, there is already a pattern of retrieving `doc = this.domAPI?.getDocument() || document` – you should make `domAPI` required and drop the `|| document` fallback. This way, all event listening can remain, but under the hood it’s using an injected safe reference. For dispatching events like `'projectlistcomponent:initialized'`, consider not relying on DOM at all – since the app explicitly calls `projectListComponent.initialize()`, the app can directly handle what comes next (e.g., call other modules) without a DOM event. If decoupling via events is needed, at least use `domAPI.dispatchEvent(domAPI.getDocument(), new CustomEvent(...))` to avoid direct global access.

* **Cleanup on Destroy:** Ensure that any event listeners registered (e.g., filtering tabs, project item clicks) are cleaned up. The component does use `eventHandlers.trackListener` for all events, which means calling `eventHandlers.cleanupListeners({context: 'ProjectListComponent'})` on teardown will remove them (the code mentions context usage). Implement a `destroy()` method if not present, that calls this cleanup (similar to Sidebar’s destroy). This will fulfill the “expose a cleanup API” part of **Rule 1** and prevent memory leaks when the project list view is disposed or re-initialized.

## static/js/projectDetailsComponent.js

* **DOM Event Broadcasting:** The ProjectDetailsComponent class broadcasts many custom events (`projectConversationsRendered`, `projectDetailsReady`, etc.) on the document via the injected domAPI. While it does use `domAPI.dispatchEvent` when available, it falls back to `doc.dispatchEvent` as well. This is essentially using the DOM as a communication medium, violating **Rule 12 (Module Event Bus)**. **Recommended Refactor:** Introduce a dedicated event bus object for project details, or leverage the existing central event system. For instance, ProjectDetails could emit events through a provided `notify` or an injected event emitter rather than the DOM. If other components (like a parent dashboard) need to react, consider calling their methods directly (since the dashboard already gets the instance via DI) or emit an event on a shared event hub in the app (like `DependencySystem` or a state management store). If you keep the DOM events, ensure always to use `domAPI.dispatchEvent(document, ...)` uniformly (which you do when `domAPI` exists). Removing the fallback to raw `document` will enforce using injected `domAPI`. Essentially, **treat the injected `domAPI.getDocument()` as the only document**, and document in DI should be ready after `'app:ready'`. This aligns with **Rule 10** as well – in fact, consider wrapping those `dispatchEvent` calls in a check for app readiness if they signal completion of async loads.

* **Navigation via Router:** The ProjectDetails component uses an injected `router` (likely the NavigationService) for navigation (e.g., for “back” button via `onBack` and possibly to navigate on certain actions). This complies with **Rule 13 (Navigation Service)**. Just ensure all route changes call `router.navigate(...)` or the provided callback instead of manipulating `window.location`. (In the code, `router.navigate` is present but commented – presumably the actual navigation happens elsewhere via `onBack` or app logic, which is fine). The key is that no `window.location = ...` or `history.pushState` is called here (none was found). Keep it that way.

* **Factory Export:** Unlike ProjectList, ProjectDetails already provides a factory function (`createProjectDetailsComponent`) that simply instantiates the class. This satisfies **Rule 1**. Continue to use that for consistency. All initialization occurs in the class constructor or instance methods, which are invoked via the factory, so no top-level code runs on import (good compliance with **Rule 3**).

## static/js/knowledgeBaseComponent.js (and other remaining modules)

* **Event Bus vs. DOM Events:** (General observation for similar modules like KnowledgeBaseComponent, ChatManager, etc.) Many of these components follow a pattern of dispatching custom events on the document to inform other parts of the app. While this can work, it couples modules to the DOM. To fully adhere to **Rule 12**, consider introducing a lightweight event bus object per module or a publish/subscribe mechanism in the central app state. For example, KnowledgeBaseComponent could have an `KnowledgeBaseBus` EventTarget that ProjectDetails listens to for knowledge base updates, rather than both using `document` events. This avoids cluttering the global namespace with many custom events and keeps module communication testable (no need for a real DOM).

* **Strict DI Enforcement:** Each module should consistently require its dependencies rather than fallback to globals. Audit any remaining modules (e.g., if KnowledgeBaseComponent uses `document.getElementById` or similar) and refactor them to use injected `domAPI` or throw errors if not provided. The goal is that **no module touches `window` or `document` or other globals directly**, and does not start work until the app is ready and dependencies are in place (**Rule 10**). In practice, this means adding dependency checks (as many modules already do) and perhaps wrapping initialization calls with `DependencySystem.waitFor([...])` if they depend on other modules’ state. For instance, if ChatManager must not run until Auth is ready, ensure the app calls it after auth, or the module itself waits for an `'auth:ready'` event before performing certain actions.

By addressing the above issues, the codebase will conform to the LLM frontend guardrails. Each module will be more modular, testable, and maintainable – with clear initialization phases, no unintended side-effects on load, centralized event management, and proper use of injected services for all external interactions. This refactoring will reduce tight coupling and global dependency, making the application more robust and easier to evolve.
