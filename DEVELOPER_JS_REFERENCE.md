# JavaScript Developer Reference

This document provides a comprehensive overview of the JavaScript architecture, modules, and developer guidelines for this project. Use it as a reference for onboarding, maintenance, and extension.

---

## Table of Contents

- [1. Overview](#1-overview)
- [2. Module-by-Module Summary](#2-module-by-module-summary)
- [3. Architectural Notes](#3-architectural-notes)
- [4. Usage Pattern](#4-usage-pattern)
- [5. Adding or Extending Modules](#5-adding-or-extending-modules)
- [6. Debugging](#6-debugging)
- [7. Conclusion](#7-conclusion)

---

## 1. Overview

All JavaScript in this project is written for strict modularity and testability.  
**Dependency Injection (DI)** is used throughout: no direct global/window/document access except for initial bootstrapping.  
All event handling, notification, and DOM access is performed via injected utilities.

---

## 2. Module-by-Module Summary

### `app.js`
- **Purpose:** Main orchestrator. Wires up all modules, manages DependencySystem, initializes DI, and coordinates app lifecycle.
- **Exports:** `init()`
- **Notes:** Registers all modules, handles navigation, error reporting, and state.

### `appConfig.js`
- **Purpose:** Centralized application configuration.
- **Exports:** `APP_CONFIG`

### `auth.js`
- **Purpose:** Centralized authentication (login, logout, register, session, CSRF).
- **Exports:** `createAuthModule({ ... })`
- **API:** `init`, `login`, `logout`, `register`, `verifyAuthState`, `getCSRFTokenAsync`, `isAuthenticated`, `AuthBus`, etc.
- **DI:** Requires `apiRequest`, `notify`, `eventHandlers`, `domAPI`, `sanitizer`, `modalManager`, `apiEndpoints`.

### `chat.js`
- **Purpose:** Chat/conversation manager for project-based chat UI.
- **Exports:** `createChatManager({ ... })`
- **API:** `initialize`, `sendMessage`, `createNewConversation`, `deleteConversation`, `setImage`, `updateModelConfig`, `cleanup`
- **DI:** Requires `apiRequest`, `app`, `eventHandlers`, `modelConfig`, `projectDetailsComponent`, `isValidProjectId`, `isAuthenticated`, `domAPI`, `navAPI`, `DOMPurify`, `notificationHandler`, `notify`, `errorReporter`, `apiEndpoints`.

### `chatExtensions.js`
- **Purpose:** Modular chat UI enhancements (e.g., chat title editing).
- **Exports:** `createChatExtensions({ ... })`
- **API:** `{ init }`
- **DI:** Requires `DependencySystem`, `eventHandlers`, `chatManager`, `auth`, `app`, `notify`, `domAPI`.

### `eventHandler.js`
- **Purpose:** Centralized event handler utility. Tracks, manages, and cleans up all event listeners.
- **Exports:** `createEventHandlers({ ... })`
- **API:** `trackListener`, `cleanupListeners`, `delegate`, `debounce`, `toggleVisible`, `setupCollapsible`, `setupModal`, `setupForm`, `init`, etc.
- **DI:** Requires `DependencySystem`, `domAPI`, `browserService`, `notify`.

### `FileUploadComponent.js`
- **Purpose:** Handles file upload UI and logic for projects.
- **Exports:** `FileUploadComponent` (class), `createFileUploadComponent(opts)`
- **DI:** Requires `app`, `eventHandlers`, `projectManager`, `notify`, `domAPI`.

### `formatting.js`
- **Purpose:** Core text formatting utilities (HTML escaping, code block formatting).
- **Exports:** `formatText(content)`

### `knowledgeBaseComponent.js`
- **Purpose:** Knowledge base UI and logic for project semantic search, file processing, and result display.
- **Exports:** `createKnowledgeBaseComponent(options)`
- **DI:** Requires `DependencySystem`, `app`, `projectManager`, `eventHandlers`, `uiUtils`, `sanitizer`, etc.

### `kb-result-handlers.js`
- **Purpose:** Clipboard copy, result display, and metadata enrichment for KB result modal.
- **Exports:** `createKbResultHandlers({ ... })`
- **API:** `{ init }`
- **DI:** Requires `eventHandlers`, `notify`, `DOMPurify`, `domAPI`.

### `modelConfig.js`
- **Purpose:** Model configuration management (model selection, max tokens, vision, etc.).
- **Exports:** `createModelConfig({ ... })`
- **API:** `getConfig`, `updateConfig`, `getModelOptions`, `onConfigChange`, `initializeUI`, `renderQuickConfig`, `cleanup`
- **DI:** Requires `dependencySystem`, `eventHandler`, `notificationHandler`, `storageHandler`, `sanitizer`, `scheduleTask`.

### `modalConstants.js`
- **Purpose:** Centralized mapping of modal logical keys to DOM element IDs.
- **Exports:** `MODAL_MAPPINGS`

### `modalManager.js`
- **Purpose:** Manages all application modals (show/hide, scroll lock, event cleanup).
- **Exports:** `createModalManager({ ... })`, `createProjectModal({ ... })`
- **DI:** Requires `eventHandlers`, `domAPI`, `browserService`, `DependencySystem`, `modalMapping`, `notify`, `domPurify`.

### `notification-handler.js`
- **Purpose:** Minimal notification/banner system for user/system feedback.
- **Exports:** `createNotificationHandler({ ... })`
- **DI:** Requires `DependencySystem`, `domAPI`.

### `notify.js`
- **Purpose:** Context-aware notification utility, wraps notificationHandler for grouping/context.
- **Exports:** `createNotify({ notificationHandler })`

### `projectDashboard.js`
- **Purpose:** Coordinates project dashboard UI, state, and event handling.
- **Exports:** `createProjectDashboard(dependencySystem)`

### `projectDashboardUtils.js`
- **Purpose:** Centralized utility functions for the project dashboard (UI helpers, event listeners).
- **Exports:** `createProjectDashboardUtils(options)`

### `projectDetailsComponent.js`
- **Purpose:** Project details UI component (tabs, files, conversations, artifacts, etc.).
- **Exports:** `ProjectDetailsComponent` (class), `createProjectDetailsComponent(opts)`

### `projectListComponent.js`
- **Purpose:** Project list UI component (rendering, filtering, actions).
- **Exports:** `ProjectListComponent` (class)

### `projectManager.js`
- **Purpose:** Project data manager (CRUD, files, conversations, artifacts, etc.).
- **Exports:** `createProjectManager(deps)`, `isValidProjectId`, `extractResourceList`, `normalizeProjectResponse`, `retryWithBackoff`

### `sentry-init.js`
- **Purpose:** Sentry error monitoring initialization and teardown.
- **Exports:** `createSentryManager(deps)`

### `sidebar-enhancements.js`
- **Purpose:** Sidebar UI enhancements (toggle migration, manage projects link).
- **Exports:** `createSidebarEnhancements({ ... })`

### `sidebar.js`
- **Purpose:** Sidebar UI logic (toggle, pin, tab switching, state persistence).
- **Exports:** `createSidebar({ ... })`

### `theme-toggle.js`
- **Purpose:** Theme management (light/dark), icon updates, and system preference sync.
- **Exports:** `createThemeManager(deps)`

### `utils/browserService.js`
- **Purpose:** Browser-level helpers (URL, storage, timing, fetch, etc.).
- **Exports:** `createBrowserService({ windowObject })`

### `utils/domAPI.js`
- **Purpose:** Abstracted DOM helpers for strict DI and testability.
- **Exports:** `createDomAPI({ documentObject, windowObject })`

### `utils/globalUtils.js`
- **Purpose:** Unified utilities: browserAPI, storageService, apiClient, debounce, URL helpers, formatting, etc.
- **Exports:** `createBrowserAPI`, `createStorageService`, `createApiClient`, `debounce`, `normaliseUrl`, `isAbsoluteUrl`, `shouldSkipDedup`, `stableStringify`, `safeParseJSON`, `createElement`, `toggleElement`, `formatNumber`, `formatDate`, `formatBytes`, `fileIcon`, `waitForDepsAndDom`, `fetchData`, `setGlobalUtilsNotifier`

### `utils/notifications-helpers.js`
- **Purpose:** Notification and error observability helpers (wrapApi, safeInvoker, emitReady).
- **Exports:** `wrapApi`, `safeInvoker`, `emitReady`, `maybeCapture`, `getApiNotify`, `computeGroupKey`

### `utils/notify.js`
- **Purpose:** Contextual notification API, wraps notificationHandler.
- **Exports:** `createNotify({ notificationHandler })`

---

## 3. Architectural Notes

- **Dependency Injection (DI):**  
  All modules are constructed with explicit dependencies. No direct global/window/document usage except in initial bootstrapping or as a fallback.

- **Event Handling:**  
  All event listeners are registered via DI eventHandlers (`trackListener`, `cleanupListeners`, `delegate`). This ensures teardown safety and avoids leaks.

- **Notification System:**  
  All user/system feedback is routed through a DI notification handler (`notify`). No direct `console.log` or `alert` for user feedback.

- **Sanitization:**  
  All innerHTML assignments are sanitized via a DI sanitizer (DOMPurify).

- **Teardown/Cleanup:**  
  All modules support cleanup/teardown for SPA or dynamic reload scenarios.

- **No Side Effects on Import:**  
  Modules do not run code on import; initialization is explicit.

- **Strict Modularity:**  
  No global state leakage. All state is internal, closure-bound, or managed via DependencySystem.

---

## 4. Usage Pattern

1. **Bootstrap:**  
   `app.js` initializes all modules, registers them with DependencySystem, and calls `init()` on DOM ready.

2. **Module Consumption:**  
   Modules are always imported and constructed via their factory functions, with all dependencies passed explicitly.

3. **Event/Notification:**  
   All UI and system events are handled via DI eventHandlers and notify utilities.

4. **UI/DOM:**  
   All DOM access is via DI domAPI or browserService abstractions.

---

## 5. Adding or Extending Modules

- **Create a factory function** that accepts all dependencies as parameters.
- **Register the module** with DependencySystem in `app.js`.
- **Use DI for all event, notification, and DOM access.**
- **Document the module** with JSDoc and update this documentation.

---

## 6. Debugging

- **All notifications** include context, module, and source for traceability.
- **Sentry** is integrated for error reporting.
- **All event listeners** are teardown-safe and tracked.

---

## 7. Conclusion

This codebase is designed for maintainability, testability, and modularity.  
Always use DI, never use globals, and follow the established patterns for event handling, notification, and DOM access.

**For more details, see the JSDoc comments at the top of each file.**  
If you need API details for a specific module, see the file or ask for that module’s API documentation.

---
