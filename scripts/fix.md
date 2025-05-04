**Issue / Question Restatement**

In a modular JavaScript application using DI and event-driven architecture, the “Create Project” modal opens but submitting the form does **not create a new project or show feedback**—no project appears, and the user receives no error or success notification. Why is this happening, and what needs to be fixed so project creation works with proper feedback?

---

**Root Cause Analysis**

- **Form Submit Handler Collision / Duplication**
  - In [[modals]], the project creation form `#projectModalForm` has a submit handler attached directly in the modal HTML script:
    ```js
    projectForm.addEventListener('submit', async (e) => { ... });
    ```
    This code directly calls (outside DI):
    - `window.projectManager?.createProject(data)`
    - `window.projectManager?.saveProject(undefined, data)`
    - Feedback via `notify()`, which falls back to `window.showNotification`.
    - **Relies on globals**: `window.projectManager`, `window.showNotification`, `window.modalManager`.

- **Competing Project Modal Implementations**
  - [[modalManager]] provides a **ProjectModal class** and exposes a `createProjectModal` factory with robust DI:
    - Handles initialization, opening, form resetting, validation, loading state, and feedback.
    - Uses only injected dependencies, **not window globals**.
    - Registers its own event handlers using DI's `eventHandlers.trackListener`.
  - The intent is, as per comments in [[modals]]:
    > // [REMOVED] Centralized modal close logic for close/cancel buttons is now handled EXCLUSIVELY via ModalManager and DI,
    > // to avoid duplication, race conditions, and unreliable modal state cleanup.
    > // All modals must be closed via modalManager.hide(modalName), which tracks events and uses DI for cleanup.
    > // No direct DOM event listeners for modal closure are attached in this script.
    But direct listeners **still exist** in the HTML script block.

- **Orchestrator/Bootstrapping Conflict**
  - In [[app]] and [[modals]], form submit handlers are attached from multiple layers:
      1. The app orchestrator (DI-aware) expects that a **single source of truth** will own the modal and its event handlers.
      2. The modal HTML directly attaches plain event listeners (without DI or notification context).
      3. These handlers may shadow or conflict with the DI-injected `ProjectModal` class designed for robust lifecycle and feedback.
  - As a result:
    - Initialization betweeen the DI `ProjectModal` and the hardcoded HTML script is **non-deterministic**.
    - If only one handler fires (or neither due to removal, timing, or SPA navigation), the form "does nothing".
    - UI feedback is absent if the handler is missing, or feedback doesn't use the DI-based notification handler, so may be lost in the production UI.

- **Missing DI/Notification Plumbing**
  - The submit handler in the HTML script block does not reliably report errors or success via the correct notification handler (`notify` or `app.showNotification`), so if an error/exception is thrown, the user gets no feedback.
  - If `window.projectManager` is undefined or incorrectly injected, nothing is created and no error is thrown.

- **SPA & Reload Issues**
  - In SPAs, event handlers can be:
    - Registered multiple times (causing double submissions)
    - Removed accidentally (destroyed by DI, not reattached in the HTML script)
    - Inconsistent due to DOM replacement
  
---

**Recommended Remediation Fix**

**Step 1: Remove any direct, duplicate event handler attachment in modals’ HTML `<script>` blocks.**
- All modal event handling (open, submit, close, feedback) must go via the DI-initialized `ProjectModal` instance in [[modalManager]], not via plain HTML event listeners.
- In [[modals]] (modals.html), **delete the following code** (or ensure it is not run at all):

```js
// modals.html, inside <script>
const projectForm = document.getElementById('projectModalForm');
// REMOVE this block entirely!
if (projectForm) {
    projectForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        ... // direct creation logic (should not exist here)
    });
}
```

**Step 2: Ensure the orchestrator (in app.js or equivalent) creates and initializes the `ProjectModal` ONLY ONCE, using DI and ModalManager.**
- After the modal HTML is injected and DOM is ready, create the ProjectModal instance using DI and call `.init()`:
```js
import { createProjectModal } from './modalManager.js';

// In the orchestrator, after DOM/content is ready
const projectModal = createProjectModal({
  projectManager: myProjectManager,             // via DependencySystem
  eventHandlers: myEventHandlers,               // DI
  showNotification: notificationHandler.show,   // DI
  DependencySystem: myDependencySystem
});
projectModal.init();
// If using ModalManager, route .show('project') to call projectModal.openModal()
```

**Step 3: Update ModalManager/ProjectListComponent to use DI ProjectModal**
- When the project modal is needed, do **not** attach new submit listeners—instead, call `projectModal.openModal()`, and let the DI code handle submit/reset/close, etc.
- In ProjectListComponent’s `_openNewProjectModal()`/`_openEditModal()`, use DI “projectModal.openModal()` if available.

**Step 4: Ensure feedback always uses the DI notification system.**
- In the DI ProjectModal (from [[modalManager]]), feedback is already shown with the proper injected showNotification/notify util.

**Example:**
```javascript
// app.js (Orchestrator), after DOM and modals injected
import { createProjectModal } from './modalManager.js';

const projectModal = createProjectModal({
  projectManager, eventHandlers, showNotification, DependencySystem
});
projectModal.init();
// expose via DI if needed
DependencySystem.modules.set('projectModal', projectModal);
```
And in other code:
```javascript
// When "Create Project" is needed
projectModal.openModal();  // For new
projectModal.openModal(existingProjectObj); // For edit
```

---

**Why It Works**

- **Eliminates Duplicate/conflicting Event Handlers**: Ensuring **only one handler** attaches to the form avoids silent failures and double submissions.
- **Consistent DI + Notification**: All user feedback (success/error) flows through the same DI-configured `notify`/`showNotification` utility, so user always sees appropriate banners regardless of SPA navigation or app state.
- **Testability & Maintainability**: Relies only on DI-injected dependencies—never window globals—making testing, debugging, and code upgrades much easier.
- **SPA-Safe Cleanup**: DI modals and handler utilities properly track and clean up listeners, avoiding memory leaks or event “zombies”.
- **Performance/Security**: No global scope leakage, handler logic is reused for both create and edit, and validation is consistently enforced.

---

**Summary**

The **cause** is conflicting and/or missing event handler registration: the modal's form submit logic is attached both in inline HTML scripts (using unsafe globals) and in a proper DI-injected module, leading to unreliable operation and no user feedback.  
**The solution** is to remove inline form handlers and ensure all modal logic (show, submit, feedback, close) is handled solely by the DI-initialized `ProjectModal` class/module. All user feedback must go via the DI notification system to guarantee visibility and reliability.

#### Sources:

- [[modals]]
- [[projectListComponent]]
- [[modalManager]]
- [[eventHandler]]
- [[project_list]]
- [[CLAUDE]]
- [[app]]
- [[projectDashboard]]
- [[projectManager]]
- [[projectDashboardUtils]]
- [[projectDetailsComponent]]