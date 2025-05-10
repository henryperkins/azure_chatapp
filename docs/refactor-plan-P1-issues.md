# Plan: P1 Refactoring - Readiness, Event Handling, and ChatManager Guards

This document outlines the plan to address the P1 critical issues identified in the architectural analysis.

**1. Goal:**
Address the P1 critical issues identified in the architectural analysis to improve application stability, reduce memory leaks, and prevent UI errors. The P1 recommendations are:

*   **P1-A: Consolidate global navigation & readiness:**
    *   Emit a single `app:ready` custom event after `app.init()` then make other modules await it via `waitForDepsAndDom`.
    *   Remove duplicated ready events.
*   **P1-B: Refactor eventHandler so `cleanupListeners({context})` is mandatory** for modules that bind; expose helper in DependencySystem and enforce in lint rule to avoid leaks.
*   **P1-C: Guard chatManager against duplicated DOM IDs:**
    *   Validate selectors during `_setupUIElements`, throw with notify.error if not unique; add unit tests.

**2. P1-A: Consolidate Global Navigation & Readiness Events**

**Objective:** Standardize on a single `app:ready` event dispatched by `app.js` upon successful initialization. Other modules will await this event or use `DependencySystem.waitFor` for their dependencies.

**Files to Modify & Actions:**

*   **`static/js/app.js`**:
    *   **Action:** In the `init` function, change the custom event name from `appInitialized` to `app:ready` when dispatching upon successful or failed initialization.
    *   **Verification:** Ensure this event is dispatched reliably.

  *   **`static/js/eventHandler.js`**:
    *   **Action:** Remove the dispatch of `eventhandler:initialized`. Its readiness can be inferred by its successful registration in `DependencySystem` and the subsequent `app:ready` event.
    *   **Verification:** Ensure no other module critically depends on `eventhandler:initialized` directly. If they do, they should be updated to wait for `eventHandlers` via `DependencySystem.waitFor` and then `app:ready`.

   *   **`static/js/utils/htmlTemplateLoader.js`**:
    *   **Action:** The `projectDetailsHtmlLoaded` event is specific to the loading of a template. This might be okay to keep if `projectDashboard` or other components specifically need to react *only* to this template being ready before `app:ready`. For now, it will be left as is, but noted for potential future consolidation.
    *   **Analysis:** The architectural analysis states `projectDashboard _initializeComponents wait` for `projectDetailsHtmlLoaded`. This seems like a valid specific dependency.

 *   **`static/js/projectManager.js`**:
      *   **Action:**
        *   `projectManagerReady`: This event should be removed. Modules depending on `projectManager` should use `DependencySystem.waitFor('projectManager')` and then await `app:ready`.
        *   `project...Loaded` events (e.g., `projectLoaded`, `projectFilesLoaded`): These are data-specific events and are likely fine as they signal the availability of specific data sets, not general module readiness.
    *   **Verification:** Search codebase for listeners to `projectManagerReady` and update them.

*   **Other Modules (e.g., `projectDashboard.js`, `projectDetailsComponent.js`, etc.)**:
    *   **Action:** Review how these modules determine readiness or wait for dependencies. They should primarily use `DependencySystem.waitFor(['dep1', 'dep2'])` and then, if needed for overall app readiness, listen for `app:ready`.
    *   **Verification:** Ensure their initialization sequences align with the new `app:ready` event.

**3. P1-B: Refactor eventHandler for Mandatory Contextual Cleanup**

**Objective:** Modify `eventHandler.js` to associate a `context` (module identifier) with each tracked listener and provide a way to clean up listeners for a specific context, preventing leaks.

**Files to Modify & Actions:**

*   **`static/js/eventHandler.js`**:
    *   **Action for `trackListener`**:
        *   Modify the `options` parameter to accept/expect a `context` string (e.g., module name).
        *   If `context` is not provided, log a warning. Default to a generic context like `'unknown_context'`.
        *   Store this `context` alongside the `wrappedHandler` and `options` in the `trackedListeners` Map.
    *   **Action for `cleanupListeners`**:
        *   Modify to accept an optional `options` object, which can contain a `context` string.
        *   If `context` is provided, iterate through `trackedListeners` and remove only those listeners matching the given `context`.
        *   If `context` is *not* provided, maintain current behavior or adapt (e.g., clean only 'unknown_context' listeners).
    *   **New Function (optional): `cleanupListenersByContext(context)`**.

*   **`static/js/app.js` (for `DependencySystem`)**:
    *   **Action:** Expose a helper function, e.g., `DependencySystem.cleanupModuleListeners(moduleContextString)`, which calls `eventHandlers.cleanupListeners({ context: moduleContextString })`.

*   **All modules using `trackListener`**:
    (e.g., `app.js`, `chat.js`, `projectManager.js`, `projectDetailsComponent.js`, `projectDashboard.js`, `sidebar.js`, `auth.js`, `modalManager.js`, `chatExtensions.js`, `knowledgeBaseComponent.js`)
    *   **Action:**
        *   Pass a `context` option in `trackListener` calls (e.g., `{ context: 'chatManager' }`).
        *   In module teardown logic, call `eventHandlers.cleanupListeners({ context: 'moduleName' })` or the new `DependencySystem` helper.
    *   **Specific attention to `chatExtensions.js`**: Add a cleanup function.

**4. P1-C: Guard chatManager Against Duplicated DOM IDs**

**Objective:** Prevent UI errors in `chatManager` by validating that the DOM selectors provided during initialization point to unique elements.

**Files to Modify & Actions:**

*   **`static/js/chat.js` (`chatManager`)**:
    *   **Action:** In `_setupUIElements` (or equivalent):
        *   For each critical unique selector, after querying, check if `domAPI.querySelectorAll(selector).length > 1`.
        *   If duplicated, use `notify.error` and potentially throw an error to halt chat instance initialization.
    *   **Verification:** Confirm selectors passed to `chatManager.initialize` are correctly processed.

**5. General Process for Each P1 Task:**
    1.  Read relevant file(s).
    2.  Analyze current implementation.
    3.  Plan specific code modifications.
    4.  Implement changes using `replace_in_file`.
    5.  (Conceptually) Verify changes.
