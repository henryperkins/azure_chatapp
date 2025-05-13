## Module: `static/js/modalManager.js`

The **ModalManager** (and its inner `ProjectModal`) handles modal dialogs. We identified a couple of code smells here:

* **Direct Global API Usage:** The module was creating and dispatching a custom event `modalmanager:initialized` on the global `document` using `new CustomEvent`. It also directly used the global `FormData` constructor to gather form data on file uploads. These bypass DI abstractions (no use of injected `domAPI` or services) and violate strict DI principles.
* **Tightly Coupled Event Bus:** Emitting `modalmanager:initialized` on `document` couples module state to the DOM. A better practice is to use either the injected `eventHandlers`/`domAPI` or a module-specific event emitter.

We refactor to use **injected abstractions for all external interactions**. For the initialization event, we dispatch it via the provided `domAPI` instead of directly on `document`. For example, if `domAPI.dispatchEvent` is available, we call `domAPI.dispatchEvent(domAPI.getDocument(), customEvent)` so it consistently goes through the injected DOM reference (or we introduce an internal `EventTarget` for ModalManager events). We also replace raw `FormData` usage with an injected service or utility. The `browserService` (or a new `uploadService`) can provide a `createFormData` helper, or we pass the form element to the `projectManager` which handles uploading.

Patch excerpts:

```diff
@@ static/js/modalManager.js @@
- // Dispatch modal manager ready event on global document
- document.dispatchEvent(
-    new CustomEvent('modalmanager:initialized', { detail: { success: true } })
- );
+ // Dispatch modal manager ready event via injected DOM API for decoupling
+ const initEvent = new CustomEvent('modalmanager:initialized', { detail: { success: true } });
+ domAPI.dispatchEvent(domAPI.getDocument(), initEvent);
@@ ProjectModal.handleSubmit @@
- const formData = new FormData(this.formElement);
- // ... use formData directly for upload ...
+ // Use an injected service to handle form data to avoid direct global usage
+ const formData = browserService?.createFormData
+   ? browserService.createFormData(this.formElement)
+   : new FormData(this.formElement);  // fallback, if absolutely necessary
+ apiClient.uploadProjectFiles(formData)  // example of using a central API client
+   .catch(err => notify.error("File upload failed", { detail: err }));
```

*Now, `CustomEvent` emissions go through `domAPI` (which internally references the real `document`), aligning with **Strict DI** (no direct `document` use). For internal module events, we could also maintain a dedicated `EventTarget` (`ModalManager.events = new EventTarget()`) and dispatch on that, further decoupling from the DOM. The **FormData** call is abstracted behind `browserService` or handled in `projectManager`, so ModalManager itself remains free of direct global calls. These changes reduce tight coupling and make the module easier to test in isolation.*

## Module: `static/js/accessibility-utils.js`

The **Accessibility Utilities** module generally followed good practices (factory export, no top-level execution), but two issues stood out:

* **Global Fallback in DOM API:** If the injected `domAPI` lacked a `getComputedStyle` function, the code patched it by calling `window.getComputedStyle`. This contradicts strict DI rules. We remove this fallback to global. Instead, we enforce that the passed-in `domAPI` must implement `getComputedStyle`. If it doesn’t, we throw an error (or at least log through `notify`) rather than reaching into `window`. This way, the responsibility is on the app to provide a complete `domAPI`.
* **Console Logging for Errors:** The module logged missing dependencies with `console.error` (e.g. if required options are absent). We replace these with the injected `notify.error` (or `errorReporter.capture`) to keep error handling centralized. This addresses **insufficient error handling** by using the app’s notification system instead of naked console calls.

Refactored snippet:

```diff
@@ static/js/accessibility-utils.js @@
- // Fallback to global getComputedStyle if domAPI is missing it
- if (typeof this.domAPI.getComputedStyle !== 'function') {
-   this.domAPI.getComputedStyle = (el) => {
-     if (typeof window !== 'undefined' && window.getComputedStyle) {
-       return window.getComputedStyle(el);
-     }
-     return { visibility: '', display: '' }; // stub for non-browser
-   };
- }
+ // Require domAPI.getComputedStyle to be provided; no global fallback
+ if (typeof this.domAPI.getComputedStyle !== 'function') {
+   throw new Error('AccessibilityUtils: domAPI must implement getComputedStyle()');
+ }
@@
- console.error('AccessibilityUtils: Missing one or more core dependencies (domAPI, eventHandlers, notify, errorReporter). Cannot initialize.');
+ this.notify?.error('AccessibilityUtils: Missing core dependencies, cannot initialize.');
```

*With these changes, **no window globals are accessed** even in edge cases. Instead of silently patching missing functions via `window`, the module now fails fast, making the contract clear (the caller must supply a proper `domAPI` including `getComputedStyle`). Error messages now go through the unified notification/error-reporting mechanism, improving consistency and observability of issues.*



## Module: `static/js/projectManager.js`

The **ProjectManager** coordinates project data and state. We found instances of **global object usage** that break DI:

* It built API URLs using `window.location.origin` directly, instead of using a config or injected base URL. This hard-codes the environment and hinders testing or changing the base path.
* It dispatched custom events (like `projectManagerReady` or other `project...Loaded` events) on the global `document` as a way to notify other parts of the app. Using the DOM as an event bus is a form of tight coupling (to global state) and can be fragile.

We refactor to remove these. For URL construction, we utilize the injected `browserService` or `apiClient` to get the base URL or perform requests, instead of touching `window.location`. For broadcasting events, we either rely on the central event system or design a dedicated event emitter. In practice, other modules can call `DependencySystem.waitFor('projectManager')` and then proceed when available (especially now that we fire a single `'app:ready'` event). Thus, a separate `'projectManagerReady'` event is unnecessary and removed. Specific data events (e.g. `projectLoaded`) can be handled via the app state or an EventTarget on ProjectManager.

Example adjustments:

```diff
@@ static/js/projectManager.js @@
- // Construct API URL with global location
- const url = `${location.origin}/api/projects/${projectId}/details`;
- fetch(url).then(...);
+ // Construct API URL via browserService or config
+ const baseUrl = browserService.getOrigin();  // e.g. http://example.com
+ const url = `${baseUrl}/api/projects/${projectId}/details`;
+ apiClient.get(url).then(...);  // use centralized API client for requests
@@
- // Emit ready event on global document for other modules
- document.dispatchEvent(new CustomEvent('projectManagerReady'));
+ // Remove global ready event – other modules will wait for 'app:ready' or use DependencySystem
+ // (ProjectManager can instead call notify.info or use an internal EventTarget if needed)
```

*By eliminating direct `location.origin` references, ProjectManager honors **single source of truth for network configuration** (others will use the same injected `apiClient` base URL). And by **removing global DOM events** for readiness, we decouple modules and rely on the DI system and centralized signals. If ProjectManager needs to announce data loaded (like projects list fetched), it could invoke callbacks on injected collaborators or emit events via a provided event bus, rather than `document.dispatchEvent`. These changes make the module more testable and prevent hidden dependencies on global state.*

## Module: `static/js/chatExtensions.js`

The **chatExtensions** module augments chat UI behavior. Originally it attempted to resolve dependencies but fell back to globals, which is problematic:

* **Bypassing DI / Global DOM Access:** If no `domAPI` was provided, it defaulted to using `document.getElementById`/`querySelector` internally (direct DOM access). It even had a case of `eventHandlers.trackListener(document, 'click', ...)` using the global document. This undermines the DI pattern.
* **Encapsulation & Cleanup:** The module insisted on using `trackListener` (throwing if `eventHandlers` was missing, which is good), but we must also ensure it cleans up those listeners. It should expose a `destroy()` that calls `eventHandlers.cleanupListeners({context})` when the chat UI is torn down, to prevent leaks.

We refactor **chatExtensions** to strictly require `domAPI`. If `domAPI` is not passed, the factory will now throw an error instead of silently using global DOM. All event bindings use the injected DOM reference. For example, we replace `trackListener(document, 'click', ...)` with:

```js
const doc = domAPI.getDocument();
eventHandlers.trackListener(doc, 'click', handler, { context: 'ChatExtensions' });
```

Additionally, we add a `destroy()` method to ChatExtensions (if not already) which calls `eventHandlers.cleanupListeners({ context: 'ChatExtensions' })` to remove any registered handlers. This mirrors the pattern in other modules and addresses potential **memory leaks** from lingering event listeners.

Illustrative patch:

```diff
@@ static/js/chatExtensions.js @@
- this.domAPI = opts.domAPI || {
-   // fallback implementation (direct document usage)...
-   querySelector: (sel) => document.querySelector(sel),
-   getElementById: (id) => document.getElementById(id),
-   // ...
- };
- if (!this.eventHandlers) throw new Error("ChatExtensions: eventHandlers required");
+ if (!opts.domAPI) {
+   throw new Error("ChatExtensions: domAPI dependency is required");
+ }
+ this.domAPI = opts.domAPI;
+ if (!opts.eventHandlers) {
+   throw new Error("ChatExtensions: eventHandlers required");
+ }
@@ binding some event @@
- // Using global document fallback (original code)
- eventHandlers.trackListener(document, 'click', onClick, { context: 'chatExt' });
+ // Use injected DOM reference for event binding
+ const doc = this.domAPI.getDocument();
+ this.eventHandlers.trackListener(doc, 'click', onClick, { context: 'ChatExtensions' });
@@
+ // Provide a cleanup method to remove event listeners on teardown
+ destroy() {
+   this.eventHandlers.cleanupListeners({ context: 'ChatExtensions' });
+ }
```

*Now, ChatExtensions never touches the real `document` except through `domAPI` (which the app supplies), satisfying **Strict DI**. The added `destroy()` ensures that all events tracked under its context can be purged, preventing any **memory leaks** if the chat module is reloaded or disposed. The module’s dependencies are explicit and it fails loudly if they are missing, rather than silently degrading with global fallbacks.*

## Module: `static/js/auth.js`

The **Auth** module handles user authentication flows. Two main issues were identified:

* **Global Cookie Access:** The module read and parsed `document.cookie` directly to check tokens. Direct cookie access is a global operation that breaks encapsulation and can’t be easily mocked. We refactor this to use an injected **storage or auth service**. For example, if a `storageService` (or `browserService`) is provided, we call something like `storage.getCookie('access_token')` or a dedicated `authTokenService` to retrieve tokens. This abstracts away the cookie implementation.
* **Untracked Internal Events:** Auth uses an internal `AuthBus` (an `EventTarget`) to emit `'authStateChanged'` events, and it was adding a listener to it directly (e.g. `AuthBus.addEventListener(...)`). While this is mostly internal, it wasn’t using the centralized event tracking. We update it to use `eventHandlers.trackListener(AuthBus, 'authStateChanged', ...)` if possible, or at least document this exception. This way, if needed, these listeners can be cleaned up or observed via the central system.

Revised code snippet:

```diff
@@ static/js/auth.js @@
- // Check auth token via global cookie
- const cookies = document.cookie.split(';').map(c => c.trim());
- const tokenCookie = cookies.find(c => c.startsWith('access_token='));
- this.hasToken = !!tokenCookie;
+ // Use injected storage service to check auth token
+ const token = storage?.getCookie('access_token');
+ this.hasToken = Boolean(token);
@@
- // Listen for auth state changes on AuthBus (untracked)
- AuthBus.addEventListener('authStateChanged', this._onStateChange);
+ // Use central eventHandlers to track AuthBus events, if possible
+ eventHandlers.trackListener(AuthBus, 'authStateChanged', () => this._onStateChange(), { context: 'AuthModule' });
```

*With these changes, Auth no longer peeks into `document.cookie` directly. By **injecting a storage/credentials service**, we can manage tokens in one place (which could be using `localStorage`, cookies, or other mechanisms under the hood) and easily adjust it (for example, switching to HTTP-only cookies or an API call) without changing the Auth module. The event listener on `AuthBus` is now tracked; while `AuthBus` isn’t a DOM element, our event handler system might treat any EventTarget similarly. At minimum, we ensure this usage is noted and doesn’t slip through cleaning – or we treat it as an acceptable isolated event source.*

*(Aside: The Auth module already uses an `'authStateChanged'` event bus internally which is a good design for decoupling. We just ensure consistency with how events are tracked and that any UI enabling/disabling waits for app readiness signals, which in this case happens via the Auth module’s integration in app startup.)*

## Module: `static/js/modelConfig.js`

The **modelConfig** module was performing DOM manipulation and dispatching events without using DI, a clear **encapsulation breach**:

* It accessed DOM elements with `document.getElementById`, `document.createElement`, and fired events on `document` directly. This goes against the pattern used elsewhere of injecting a `domAPI`.

We refactor modelConfig to accept a `domAPI` dependency (just like most other UI modules). All DOM operations are routed through that object. For example, where it originally had `document.getElementById('modelSelect')`, we replace with `domAPI.getElementById('modelSelect')`. Similarly, events like `'modelConfigRendered'` are dispatched via `domAPI.dispatchEvent(domAPI.getDocument(), new CustomEvent('modelConfigRendered'))` instead of `document.dispatchEvent(...)`. The module’s factory function signature and usage in `app.js` are updated to supply `domAPI`.

Patch example:

```diff
@@ static/js/modelConfig.js @@
- // Direct DOM query
- const modelSelectEl = document.getElementById('modelSelect');
+ const modelSelectEl = domAPI.getElementById('modelSelect');
@@
- // Direct event dispatch on global document
- document.dispatchEvent(new CustomEvent('modelConfigRendered', { detail: { /*...*/ } }));
+ domAPI.dispatchEvent(domAPI.getDocument(), new CustomEvent('modelConfigRendered', { detail: {/*...*/} }));
@@ factory signature @@
- export function createModelConfig(options) {
-   // ... no domAPI in options ...
+ export function createModelConfig({ domAPI, notify, ...rest }) {
+   if (!domAPI) throw new Error("ModelConfig: domAPI is required");
```

*Now ModelConfig fully adheres to **Strict DI**. It does not touch the real DOM on its own. This not only avoids unpredictable behavior in different contexts, but also means we could test modelConfig with a fake domAPI (or run it in a non-browser environment) without issues. All UI updates and event broadcasts go through the provided interfaces. Additionally, this module refrained from making network calls directly – and we continue that practice, ensuring if it ever needs data (e.g. available models list), it would use an injected `apiClient` or rely on `projectManager` to supply that, keeping **async handling** centralized.*

## Module: `static/js/projectListComponent.js`

The **ProjectListComponent** was originally implemented as a class without a factory function, and it directly interacted with global DOM events. Key issues:

* **Missing Factory Export:** It was exported as a class only, and the app was instantiating it via `new ProjectListComponent(...)` directly. This is inconsistent with the factory pattern used elsewhere and can lead to initialization happening at constructor call time. We introduce a factory `export function createProjectListComponent(opts) { return new ProjectListComponent(opts); }`. The app will use this factory, allowing us to manage any pre/post steps if needed and keeping the export style uniform.
* **Global Document Events:** The component added event listeners for events like `projectsLoaded`, `projectCreated` on `document` (sometimes using `this.domAPI?.getDocument() || document` as a fallback). It also dispatched a custom `'projectlistcomponent:initialized'` event on the global document. This couples the component to a global event system. We refactor to require `domAPI` (no fallback to `document`), and use `eventHandlers.trackListener` for any event subscriptions. For example, instead of `document.addEventListener('projectsLoaded', ...)`, we do `eventHandlers.trackListener(domAPI.getDocument(), 'projectsLoaded', ...)`. And for broadcasting its own initialization, we remove the `document.dispatchEvent('projectlistcomponent:initialized')` – since the app knows when it has initialized the component, it can directly call other logic without a DOM event. If needed, we could emit an event on a provided event bus or just rely on the app’s control flow.
* **Cleanup and Memory Leaks:** The component registers a number of event listeners (for filtering UI, click handlers on project items, etc.). In the original code, these were tracked with a context (e.g. `'ProjectListComponent'`) via `trackListener`. We ensure that the component provides a `destroy()` method that calls `eventHandlers.cleanupListeners({ context: 'ProjectListComponent' })` to remove all its listeners. This prevents memory leaks if the project list is ever re-created or on SPA navigation.

Refactoring patch:

```diff
@@ static/js/projectListComponent.js @@
+ // Add a factory function for consistency with other modules
+ export function createProjectListComponent(options) {
+   return new ProjectListComponent(options);
+ }
@@ inside class ProjectListComponent @@
   constructor(opts) {
-    this.domAPI = opts.domAPI || null;
+    if (!opts.domAPI) throw new Error('ProjectListComponent: domAPI is required');
+    this.domAPI = opts.domAPI;
     this.eventHandlers = opts.eventHandlers;
     // ...
   }
   initialize() {
-    // Listen for when projects are loaded (fallback to global document if domAPI not provided)
-    const doc = this.domAPI?.getDocument() || document;
-    doc.addEventListener('projectsLoaded', () => this.refreshList());
+    // Use injected domAPI and centralized event handler for events
+    const doc = this.domAPI.getDocument();
+    this.eventHandlers.trackListener(doc, 'projectsLoaded', () => this.refreshList(), { context: 'ProjectListComponent' });
     // ... (similar for other events like 'projectCreated', etc.)
-    // Announce that the project list is ready
-    document.dispatchEvent(new CustomEvent('projectlistcomponent:initialized'));
+    // (Removed custom global event dispatch; app can directly proceed after initialize())
   }
+  destroy() {
+    // Cleanup all event listeners registered by this component
+    this.eventHandlers.cleanupListeners({ context: 'ProjectListComponent' });
+  }
}
```

*With these changes, ProjectListComponent now conforms to the expected module pattern. It no longer touches the global document directly – all event binding goes through `eventHandlers` with the provided `domAPI`. The addition of `destroy()` addresses potential **memory leaks** by ensuring no event listeners linger when the component is destroyed. And the removal of the global `'projectlistcomponent:initialized'` event means less **tightly coupled** communication – the app can simply call the next steps after `initialize()` returns, or we could emit on a shared bus if truly needed. The result is a cleaner, more testable component lifecycle.*

## Module: `static/js/projectDetailsComponent.js`

The **ProjectDetailsComponent** (often a class with a factory) had a pattern of broadcasting many events (`projectConversationsRendered`, `projectDetailsReady`, etc.) on the DOM. Notably, it used `domAPI.dispatchEvent` when available, but fell back to `doc.dispatchEvent` on the real document if `domAPI` wasn’t provided. This approach, while DI-aware, still uses the DOM as an event bus and included a global fallback.

We improve this by enforcing the presence of `domAPI` (no fallback to global document) and by rethinking how those events are used:

* **No Global Fallback:** Similar to other modules, we now require `domAPI` outright. In any place where the code did `this.domAPI?.dispatchEvent(...) || document.dispatchEvent(...)`, we drop the `|| document` part. The component must be given a `domAPI`. If for some reason it isn’t, it will throw an error rather than quietly using the global document.
* **Decoupling Event Broadcasts:** We consider whether these custom events on `document` are needed. Often, since the app orchestrator is aware of ProjectDetails initialization (and perhaps passes the instance to other modules or keeps track), we could replace some of these with direct method calls or state updates. If events are still the chosen mechanism, we ensure they go through an injected channel. For example, we might provide ProjectDetails with an `eventBus` (like an `EventTarget` or use the app’s central event system) to emit `'projectDetails:ready'` rather than using the DOM. However, to keep changes minimal, we can continue to use DOM events but via `domAPI` only. For instance: `domAPI.dispatchEvent(domAPI.getDocument(), new CustomEvent('projectDetailsReady', {...}));` with no fallback, so it’s always using the injected document. This aligns with the idea that **the injected document is the only document** the module knows about.

In code form:

```diff
@@ static/js/projectDetailsComponent.js @@
- // Possibly fall back to global document if domAPI missing
- const doc = this.domAPI?.getDocument() || document;
- doc.dispatchEvent(new CustomEvent('projectDetailsReady', { detail: {...} }));
+ if (!this.domAPI) throw new Error('ProjectDetailsComponent: domAPI required');
+ const doc = this.domAPI.getDocument();
+ this.domAPI.dispatchEvent(doc, new CustomEvent('projectDetailsReady', { detail: {...} }));
@@ navigation example @@
- // Navigate using injected router (or fallback to location)
- if (this.router) {
-    this.router.navigate('/projects');
- } else {
-    window.location.hash = '#/projects';
- }
+ // Always use injected navigationService (router) for navigation
+ this.router.navigate('/projects');
```

*After refactoring, ProjectDetailsComponent uses **only injected services for events and navigation**. All its custom events are dispatched via the provided `domAPI` (never directly on `window.document`). In fact, we could remove some events entirely: for example, instead of firing `'projectDetailsReady'`, the app could directly call whatever needs to happen next once it has initialized ProjectDetails. But if keeping events, we ensure they're not global. Navigation calls use the injected `router/navigationService` exclusively – no direct `window.location` changes – which was already mostly the case (the code had a router, with any `window.location` usage commented out as legacy). By treating the DOM event system as an implementation detail behind `domAPI`, we maintain loose coupling and make the component easier to integrate or test (we could simulate `domAPI` events without a real DOM).*

Notably, ProjectDetails already had a factory function (`createProjectDetailsComponent`) and did not run code on import (complying with the patterns) – we keep that intact, focusing our changes on event handling and DI strictness.

