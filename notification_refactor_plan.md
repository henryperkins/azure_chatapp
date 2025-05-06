# Notification System Refactoring Plan

This document outlines the step-by-step plan to refactor the notification system across the specified JavaScript files. The goal is to centralize notification logic, improve maintainability, and ensure consistent behavior according to the guidelines in `notification-integration.md` and the project's custom rules.

## Overall Strategy

1.  **Dependency Injection**: `notify` instance (created via `createNotify`) will be the single source of truth for notifications. It will be registered with `DependencySystem` and injected into all modules requiring notification capabilities.
2.  **Contextual Notifications**: Each module will use `notify.withContext()` to create a localized notifier, ensuring all notifications from that module carry appropriate `context`, `module`, and `source` metadata.
3.  **Eliminate Direct Console/Global Usage**: All `console.*`, `window.showNotification`, and other direct notification calls will be replaced.
4.  **API Wrappers**: Utilize helpers from `static/js/utils/notifications-helpers.js` (e.g., `wrapApi`, `emitReady`) for consistent notification patterns around API calls and lifecycle events.
5.  **Ordered Refactoring**: Apply changes file by file, in the order specified by the user's checklist, ensuring the application remains functional after each step.

## Refactoring Phases

The refactoring will proceed according to the user-provided checklist, targeting four main files:

1.  `static/js/app.js`
2.  `static/js/eventHandler.js`
3.  `static/js/auth.js`
4.  `static/js/modalManager.js`

We will also refer to `static/js/utils/notifications-helpers.js` for utility functions, assuming its API includes `wrapApi()` and `emitReady()`.

```mermaid
graph TD
    A[Start Refactor] --> B(Phase 1: app.js);
    B --> C(Phase 2: eventHandler.js);
    C --> D(Phase 3: auth.js);
    D --> E(Phase 4: modalManager.js);
    E --> F[Refactor Complete];

    subgraph "Notification Flow"
        direction LR
        Module --> NotifyAPI[notify API (info, error, etc.)];
        NotifyAPI --> NotifyWithContext[notify.withContext()];
        NotifyWithContext --> ContextualNotifier;
        ContextualNotifier --> NotificationHandler[NotificationHandlerWithLog];
        NotificationHandler --> UserUI[User Interface];
        NotificationHandler --> Sentry[Sentry/Logging];
    end

    subgraph "Key Files & Dependencies"
        app_js[app.js] --> ds[DependencySystem];
        app_js --> create_notify[createNotify];
        app_js --> notification_handler[notificationHandlerWithLog];
        ds --> notify_instance["notify (instance)"];

        eventHandler_js[eventHandler.js] -.-> notify_instance;
        auth_js[auth.js] -.-> notify_instance;
        modalManager_js[modalManager.js] -.-> notify_instance;

        eventHandler_js --> auth_js;
        eventHandler_js --> modalManager_js;

        utils_notify_js[utils/notify.js] --> create_notify;
        utils_notifications_helpers_js[utils/notifications-helpers.js];
    end
```

---

### Phase 1: `static/js/app.js` Refactoring

**Goal**: Establish the central `notify` instance, replace direct console/handler calls, inject `notify` into dependent module factories, and integrate API/event notification helpers.

**Detailed Steps**:

1.  **Create and Register `notify`**:
    *   Locate the `notificationHandlerWithLog` creation (around line 377).
    *   Immediately after `DependencySystem.register('notificationHandler', notificationHandlerWithLog);` (line 390), add:
        ```javascript
        const notify = createNotify({ notificationHandler: notificationHandlerWithLog });
        DependencySystem.register('notify', notify);
        ```
    *   *Note*: The checklist mentions `notifyInstance` for the `createNotify` result, but the integration guide and common practice suggest using `notify` for the DI-registered instance. We will use `notify` for the DI registration and for injection into other modules. The existing `notifyInstance` on line 391 can be removed or aliased if it serves a different, specific purpose, but the primary DI registration should be `notify`. For this plan, we'll assume the checklist's `notifyInstance` was a temporary name and the goal is to have `notify` as the canonical DI key. We will remove the line `const notifyInstance = createNotify({ notificationHandler: notificationHandlerWithLog });` and `DependencySystem.register('notify', notifyInstance);` (lines 391-392) as `notify` is now registered above.

2.  **Create App-Specific Utility Helpers**:
    *   After `notify` is registered, define app-level contextual notifiers:
        ```javascript
        const appNotify = notify.withContext({ context: 'app', module: 'App' });
        const appDebug = APP_CONFIG.DEBUG ? appNotify.debug : () => {}; // Or a more robust no-op
        ```
    *   These will be used for notifications originating directly from `app.js` logic.

3.  **Replace Console/Handler Calls**:
    *   Search for all instances of:
        *   `notificationHandlerWithLog.*` (e.g., `notificationHandlerWithLog.debug`, `notificationHandlerWithLog.warn`, `notificationHandlerWithLog.error`, `notificationHandlerWithLog.show`)
        *   `localNotify.*` (this seems to be a variable name used in `initializeCoreSystems` and other places, e.g., line 590 `const localNotify = DependencySystem.modules.get('notify');`)
        *   `notifyInstance.*` (if any remain after step 1 adjustment)
        *   `console.*` (e.g., `console.log`, `console.warn`, `console.error`) that are intended for user/developer notifications rather than raw debugging.
    *   Replace them with `appNotify.info()`, `appNotify.warn()`, `appNotify.error()`, or `appDebug()` as appropriate, ensuring to pass the correct context options if the default `app` context isn't specific enough.
    *   Example:
        *   `notificationHandlerWithLog.debug('[App] DOM ready...', ...)` becomes `appDebug('[App] DOM ready...', ...)` or `appNotify.debug('[App] DOM ready...', { source: 'onReady', ... })`.
        *   `localNotify.error(...)` becomes `appNotify.error(...)` or a more specific contextual call if the error is from a sub-part of `app.js`.
        *   Line 271: `const notify = DependencySystem.modules.get('notify'); notify?.error?.(...)` becomes `appNotify.error(...)`.
        *   Line 309: `notificationHandlerWithLog.warn(...)` becomes `appNotify.warn(...)`.
        *   Lines 375-376, 388-389, 393-394, 403-405, 414-415, 420, 460-461 (debug logs) will become `appDebug(...)` or `appNotify.debug(...)`.
        *   Line 463: `notifyInstance.error(...)` becomes `appNotify.error(...)`.
        *   Line 471: `const notify = DependencySystem.modules.get('notify'); notify?.error?.(...)` becomes `appNotify.error(...)`.
        *   Line 476: `window.showNotification = notificationHandlerWithLog.show;` will be **removed**. Notifications should go through the `notify` instance.
        *   Line 505: `notifyInstance.debug(...)` becomes `appNotify.debug(...)`.
        *   And so on for all similar calls throughout `app.js`.

4.  **Inject `notify` into Factory Functions**:
    *   Modify the factory function calls for all modules listed in the checklist to include `notify` from `DependencySystem`.
    *   Example for `createEventHandlers`:
        ```javascript
        // Original (around line 187):
        // eventHandlers = createEventHandlers({ DependencySystem });
        // New:
        eventHandlers = createEventHandlers({ DependencySystem, notify: DependencySystem.modules.get('notify') });
        ```
    *   Apply this pattern to:
        *   `createAuthModule` (around line 615)
        *   `createProjectManager` (around line 653)
        *   `createSidebar` (around line 1100)
        *   `createChatExtensions` (around line 1028)
        *   `createChatManager` (around line 423)
        *   `createModalManager` (around line 601, though it might already get `notify` via `DependencySystem` internally, explicit injection is clearer)
        *   `createProjectModal` (around line 690)
        *   `createKnowledgeBaseComponent` (around line 1124)
        *   `createProjectDashboard` (around line 1063)
        *   `createProjectDetailsComponent` (around line 1066)
        *   `ProjectListComponent` (constructor, around line 1042)
        *   `createModelConfig` (around line 1035) - if it needs notifications.
        *   `createProjectDashboardUtils` (around line 1038) - if it needs notifications.
        *   `createSentryManager` (line 84) - already seems to take a `notification` object, ensure this is compatible or updated to use the new `notify` instance if Sentry manager itself needs to *issue* app notifications. The current `notification` object passed to it (lines 32-54) is a simple console wrapper. This might need to be `notify: DependencySystem.modules.get('notify')` if `createSentryManager` is expected to use the full notification system.
        *   `createStorageService` (line 294) - currently takes `notificationHandlerWithLog`. Change to `notify: DependencySystem.modules.get('notify')`.

5.  **Use Notification Helpers (`wrapApi`, `emitReady`)**:
    *   Import helpers: `import { wrapApi, emitReady } from './utils/notifications-helpers.js';` (or similar, based on actual file structure if `notifications-helpers.js` is not in `utils/`).
    *   Identify API calls (e.g., within `apiRequest` if it's not already handled there, or direct `fetch` calls if any). The current `createApiClient` (line 407) already takes `notificationHandler`. This needs to be updated to take `notify` and use `wrapApi` internally, or calls made *using* `apiRequest` should be wrapped.
        *   The `apiRequest` function itself (created by `globalUtils.createApiClient`) is a candidate for internal `wrapApi` usage. If `createApiClient` is refactored, ensure it uses the injected `notify` and `errorReporter`.
    *   Identify module initialization points to use `emitReady`. For example, at the end of `init()` or after major components are initialized.
        *   Example: After `appState.initialized = true;` (line 545), consider `emitReady({ notify: appNotify }, 'ApplicationCore');`

6.  **Remove `browserService` and `window` Globals**:
    *   Delete `DependencySystem.register('browserService', createBrowserService(...));` (line 80).
    *   Remove `import { createBrowserService } from './utils/browserService.js';` (line 65).
    *   Remove `window.showNotification = notificationHandlerWithLog.show;` (line 476).
    *   Remove `window.modalManager = modalManager;` (line 603). Access to `modalManager` should be via `DependencySystem`.

---

### Phase 2: `static/js/eventHandler.js` Refactoring

**Goal**: Inject `notify`, create a context-specific notifier, simplify notification calls, and remove redundant helpers.

**Detailed Steps**:

1.  **Update Factory Signature**:
    *   Modify `createEventHandlers` (line 40) to accept `notify` as a direct dependency:
        ```javascript
        export function createEventHandlers({ app, auth, projectManager, modalManager, DependencySystem, navigate, storage, notify: injectedNotify } = {}) {
        // ...
        // Adjust notify resolution:
        let notify = injectedNotify || resolveDep('notify');
        }
        ```

2.  **Bind Notifier Once**:
    *   At the top of the `createEventHandlers` function, after `notify` is resolved/validated:
        ```javascript
        const ehNotify = (notify || DependencySystem.modules.get('notify')).withContext({ context: 'eventHandler' });
        ```
    *   Ensure `notify` is properly resolved before this line. If `injectedNotify` is guaranteed by `app.js`, then `(injectedNotify).withContext(...)` is sufficient. The fallback to `DependencySystem.modules.get('notify')` is a safety net.

3.  **Simplify Warnings/Errors**:
    *   Search for all multi-level fallback notification patterns (e.g., `if (n) { n.error(...) } else if (app && app.showNotification) { app.showNotification(...) } else { console.error(...) }`).
    *   Replace these with direct calls to `ehNotify.warn()`, `ehNotify.error()`, `ehNotify.info()`.
    *   Example (lines 120-133):
        ```javascript
        // Original complex fallback
        // New:
        ehNotify.error(`Async error in ${type} event handler: ${error?.message || error}`);
        ```
    *   Apply this simplification throughout the file (e.g., lines 136-148, 153-166, 178-191, 195-207, 209-222, 243-251, 301-312, 327-336, 528-540, 560-572, 669-678, 833-840, 841-853).

4.  **Delete Helpers**:
    *   Remove the `getNotify()` function (lines 59-61). `ehNotify` should be used directly.
    *   Ensure all `console.*` fallbacks are removed as per Step 3.

5.  **Move Out Non-Core Logic**:
    *   `validatePassword` (lines 642-650): Move this function to `static/js/auth.js`.
    *   `setupModalTabs` (lines 745-818): Move this function to `static/js/modalManager.js` (to be renamed `_setupAuthTabs` and called from `init()`).

---

### Phase 3: `static/js/auth.js` Refactoring

**Goal**: Bind a context-specific notifier, replace all notification calls, integrate `passwordPolicyValidate`, and use imported `trackListener` and `setupForm`.

**Detailed Steps**:

1.  **Bind Notifier**:
    *   At the top of `createAuthModule` (after dependency validation, around line 68):
        ```javascript
        // Ensure 'notify' is the injected instance from app.js
        const authNotify = notify.withContext({ context: 'auth', module: 'Auth' });
        ```

2.  **Swap All Notification Calls**:
    *   Replace every `notify.*` call (which currently refers to the directly injected `notify` without specific context) or any fallback trees with `authNotify.*`.
    *   Examples:
        *   Line 131: `notify.error(...)` becomes `authNotify.error(...)`.
        *   Line 159: `notify.warn(...)` becomes `authNotify.warn(...)`.
        *   And so on for all ~20 calls (e.g., lines 202, 230, 254, 282, 300, 327, 371, 378, 386, 394, 404, 412, 417, 427, 443, 448, 456, 511, 530, 609, 646, 654, 675, 705).

3.  **Add `passwordPolicyValidate`**:
    *   Paste the `validatePassword` function (moved from `eventHandler.js`) into `auth.js`. Rename it to `passwordPolicyValidate`.
        ```javascript
        function passwordPolicyValidate(password) { // Renamed
          if (password && password.length >= 3) { // Or more robust rules
            return { valid: true };
          }
          return {
            valid: false,
            message: 'Password must be at least 3 characters long.' // Update message as needed
          };
        }
        ```
    *   Call `passwordPolicyValidate()` within the `registerUser` function (around line 434) and in the `registerModalForm` submit handler (around line 595, after moving `setupAuthForms` logic or using imported `setupForm`).
        ```javascript
        // Inside registerUser or form handler
        const validation = passwordPolicyValidate(password);
        if (!validation.valid) {
          authNotify.error(validation.message); // Or display in form-specific error element
          throw new Error(validation.message);
        }
        ```

4.  **Import and Use `trackListener` & `setupForm`**:
    *   Add import: `import { trackListener, setupForm } from './eventHandler.js';`
    *   Replace internal `registeredListeners.push(eventHandlers.trackListener…)` (e.g., lines 555, 635) with direct calls to the imported `trackListener`.
        *   The `registeredListeners` array in `auth.js` (line 100) should still be used to track listeners added *by* `auth.js` for its own cleanup.
    *   Refactor `setupAuthForms()` (lines 467-639):
        *   Instead of manually setting up submit handlers, use the imported `setupForm` utility from `eventHandler.js`.
        *   Example for `loginModalForm`:
            ```javascript
            // Inside setupAuthForms or a similar init function in auth.js
            const loginModalForm = domAPI.getElementById('loginModalForm');
            if (loginModalForm) {
                setupForm(loginModalForm.id, async (formData) => { // Pass form ID
                    // ... (existing submit logic for loginModalForm) ...
                    // Use authNotify for notifications
                }, { /* options for setupForm if any */ });
            }
            // Repeat for registerModalForm and other forms
            ```
        *   This centralizes form handling logic. The `submitHandler` passed to `setupForm` will contain the core logic currently in `setupAuthForms` for each form.

5.  **Clean Console Statements**:
    *   Search for any remaining `console.*` statements and remove them or replace with `authNotify.debug()` if they are for debugging purposes.

---

### Phase 4: `static/js/modalManager.js` Refactoring

**Goal**: Update constructor for `notify`, bind a contextual notifier, update `_notify` usages, use imported `trackListener`, move in `setupModalTabs`, and forward `notify` to `ProjectModal`.

**Detailed Steps**:

1.  **Update Constructor Parameter**:
    *   Modify `ModalManager` constructor (line 46) to accept `notify` directly:
        ```javascript
        constructor({
          eventHandlers,
          DependencySystem,
          modalMapping,
          showNotification, // This will be superseded by 'notify'
          domPurify,
          notify: injectedNotify // Add this
        } = {}) {
          // ...
          this.DependencySystem = DependencySystem || undefined;
          // Prioritize injectedNotify, then DS, then existing showNotification (for backward compat if needed, but aim to remove showNotification)
          this.notifyInstance = injectedNotify || this.DependencySystem?.modules?.get?.('notify') || undefined;
          this.showNotification = showNotification; // Keep for now if _notify relies on it, but phase out
          // ...
        }
        ```

2.  **Bind Notifier**:
    *   Inside the `ModalManager` constructor, after `this.notifyInstance` is set:
        ```javascript
        this.notify = (this.notifyInstance || this.DependencySystem.modules.get('notify')).withContext({ context: 'modalManager' });
        ```
    *   This creates `this.notify` which will be used for all notifications from `ModalManager`.

3.  **Update `_notify` Usages**:
    *   Modify the `_notify` helper method (lines 94-107):
        ```javascript
        _notify(level, message, debugOnly = false) {
          if (debugOnly && !this._isDebug()) {
            return;
          }
          // Use the new context-aware this.notify
          if (this.notify && typeof this.notify[level] === 'function') {
            this.notify[level](message); // Grouping and context are already part of this.notify
          }
          // The old this.showNotification fallback can be removed if this.notify is guaranteed.
        }
        ```
    *   Replace all calls like `this._notify('error', ...)` with direct calls `this.notify.error(...)`, `this.notify.warn(...)`, etc. This makes the `_notify` helper redundant.
        *   Example: Line 230 `this._notify('warn', ...)` becomes `this.notify.warn(...)`.
        *   Remove the `_notify` method itself after all its usages are replaced.

4.  **Import and Use `trackListener`**:
    *   Add import: `import { trackListener } from './eventHandler.js';`
    *   Replace calls like `this.eventHandlers.trackListener(...)` (e.g., line 216) with direct calls to the imported `trackListener(...)`.
        *   The `this._trackedEvents` array should still be used to store information for cleanup.

5.  **Move in Modal Tabs Logic**:
    *   Paste the `setupModalTabs` function (moved from `eventHandler.js`) into the `ModalManager` class.
    *   Rename it to `_setupAuthTabs()`.
    *   Call `this._setupAuthTabs()` from within the `ModalManager.init()` method (e.g., after `this.validateModalMappings`, around line 210).
        *   Inside `_setupAuthTabs`, ensure `trackListener` calls use the imported version.
        *   The logic for `loginModal._openLoginRegisterModal` (lines 795-804 in `eventHandler.js`) should be adapted. `ModalManager` can expose public methods like `openLoginModal(tab = 'login')` which then calls `this.show('login')` and internally manages which tab is active.

6.  **Forward `notify` to `ProjectModal`**:
    *   When `createProjectModal` is called (likely from `app.js`), ensure the `notify` instance is passed in its dependencies.
        ```javascript
        // In app.js or wherever createProjectModal is used:
        const projectModal = createProjectModal({
            // ... other deps ...
            notify: DependencySystem.modules.get('notify') // Pass the main notify instance
        });
        ```
    *   Inside `ProjectModal` constructor (line 446):
        ```javascript
        constructor({ projectManager, eventHandlers, showNotification, DependencySystem, notify: injectedNotify } = {}) { // Add injectedNotify
          // ...
          this.notifyInstance = injectedNotify || this.DependencySystem?.modules?.get?.('notify') || undefined; // Capture it
          this.showNotification = showNotification; // Phase out
          // ...
          // Bind its own contextual notifier:
          this.notify = (this.notifyInstance).withContext({ context: 'projectModal', module: 'ProjectModal' });
        }
        ```
    *   Replace `this._notify(...)` calls in `ProjectModal` with `this.notify.error(...)`, `this.notify.success(...)`, etc. (e.g., lines 507, 517, 583, 590, 699, 701). Then remove the `_notify` method from `ProjectModal`.

7.  **Remove Console, Globals**:
    *   Search for any remaining `console.*` statements and remove/replace them.
    *   Ensure no `window.*` properties are being set or relied upon for modal functionality (e.g., `window.modalManager` was removed in `app.js` phase).

---

This detailed plan should guide the refactoring process effectively.
