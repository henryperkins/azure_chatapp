# Project Dependencies Analysis

This document provides a comprehensive analysis of dependencies across key project modules. It aims to standardize the presentation of dependency information for clarity and easier comparison.

**Dependency Category Definitions:**

*   **Direct Dependencies (Required):** Modules or values explicitly injected or imported that are essential for the module's core functionality. The module will typically fail to initialize or operate correctly without them.
*   **Direct Dependencies (Optional):** Modules or values explicitly injected or imported that enhance functionality or provide alternatives, often with default fallbacks or graceful degradation if absent.
*   **Indirect Dependencies (Resolved via DependencySystem):** Dependencies not directly passed to the module's factory/constructor but are retrieved at runtime, usually from a central `DependencySystem` or a similar service locator.
*   **Imported Utilities/Helpers:** Specific functions or smaller pieces of code imported directly from other utility files, not typically managed by the main dependency injection system.
*   **Internal Components/State:** Significant internal constructs like event buses or state objects created and managed within the module.

## Table of Contents

*   [Core Services & Configuration](#core-services--configuration)
    *   [appConfig.js](#appconfigjs)
    *   [apiClient.js](#apiclientjs)
    *   [auth.js](#authjs)
    *   [logger.js](#loggerjs)
    *   [DependencySystem (Conceptual)](#dependencysystem-conceptual)
*   [Feature Modules](#feature-modules)
    *   [Project Management](#project-management)
        *   [projectManager.js](#projectmanagerjs)
        *   [projectDashboard.js](#projectdashboardjs)
        *   [projectListComponent.js](#projectlistcomponentjs)
        *   [projectDetailsComponent.js](#projectdetailscomponentjs)
        *   [project-details-enhancements.js](#project-details-enhancementsjs)
    *   [Chat](#chat)
        *   [chat.js (ChatManager)](#chatjs-chatmanager)
        *   [chatExtensions.js](#chatextensionsjs)
    *   [Sidebar](#sidebar)
        *   [sidebar.js](#sidebarjs)
        *   [sidebar-enhancements.js](#sidebar-enhancementsjs)
        *   [sidebarMobileDock.js](#sidebarmobiledockjs)
        *   [sidebarAuth.js](#sidebarauthjs)
    *   [Knowledge Base](#knowledge-base)
        *   [knowledgeBaseManager.js](#knowledgebasemanagerjs)
        *   [knowledgeBaseComponent.js](#knowledgebasecomponentjs)
*   [UI Components & Rendering](#ui-components--rendering)
    *   [uiRenderer.js](#uirendererjs)
    *   [modalManager.js](#modalmanagerjs)
    *   [FileUploadComponent.js](#fileuploadcomponentjs)
*   [Utility Modules & Services](#utility-modules--services)
    *   [navigationService.js](#navigationservicejs)
    *   [eventHandler.js](#eventhandlerjs)
    *   [modelConfig.js](#modelconfigjs)
    *   [projectDashboardUtils.js](#projectdashboardutilsjs)
    *   [chat-ui-utils.js](#chat-ui-utilsjs)
    *   [chatUIEnhancements.js](#chatiuienhancementsjs)
    *   [accessibility-utils.js](#accessibility-utilsjs)
*   [Initialization Modules](#initialization-modules)
    *   [init/appState.js](#initappstatejs)
    *   [init/authInit.js](#initauthinitjs)
    *   [init/coreInit.js](#initcoreinitjs)
    *   [init/errorInit.js](#initerrorinitjs)
    *   [init/serviceInit.js](#initserviceinitjs)
    *   [init/uiInit.js](#inituiinitjs)
*   [Dependency Frequency Analysis](#dependency-frequency-analysis)

---

## Core Services & Configuration

### appConfig.js

#### Direct Dependencies (Required)
1.  `DependencySystem` – Central dependency injection system.
2.  `eventHandlers` – Must expose `cleanupListeners()`.

#### Direct Dependencies (Optional)
3.  `overrides` – Partial config merged into the default `APP_CONFIG`.

*(No other external services are accessed.)*

### apiClient.js

#### Direct Dependencies (Required)
1.  `APP_CONFIG` - Application configuration.
2.  `globalUtils` - Utility functions (needs `shouldSkipDedup`, `stableStringify`, `normaliseUrl`, `isAbsoluteUrl`).
3.  `getAuthModule` - Function to retrieve the auth module.
4.  `browserService` - Browser functionality abstraction.
5.  `eventHandlers` - Event handling utilities.
6.  `logger` - Logging service.

#### Indirect Dependencies (via injected dependencies)
7.  `auth` (via `getAuthModule()`) - Used to get CSRF tokens.
8.  `AbortController` (via `browserService.getWindow()?.AbortController`) - Used for request timeouts.

### auth.js

#### Direct Dependencies (Required)
*(Module throws if any of these are missing)*
1.  `apiClient` – All authentication HTTP requests.
2.  `logger` – Diagnostic logging.
3.  `domReadinessService` – Waits for DOM and dependency readiness.
4.  `eventHandlers` – Centralised listener tracking.
5.  `domAPI` – DOM queries, cookie access, attribute/class manipulation.
6.  `sanitizer` – Sanitises user-supplied strings.
7.  `apiEndpoints` – Must expose `AUTH_CSRF`, `AUTH_LOGIN`, `AUTH_LOGOUT`, `AUTH_REGISTER`, `AUTH_VERIFY`, `AUTH_REFRESH`. (Optional: `AUTH_SETTINGS`).

#### Direct Dependencies (Optional)
8.  `DependencySystem` – Resolves additional modules (e.g., `browserService`, `appModule`, `safeHandler`).
9.  `modalManager` – Shows/hides modals. Calls skipped when absent.

#### Internal Components/State
*   `AuthBus` – Custom `EventTarget` dispatching `authStateChanged`.
*   Local reactive state (CSRF token, auth tokens, current user, etc.).

### logger.js

#### Direct Dependencies (Optional - Constructor Options for `createLogger(opts)`)
*   `endpoint` (No, default `/api/logs`): Remote log URL.
*   `enableServer` (No): Toggle remote logging.
*   `debug` (No): Enable debug-level output.
*   `context` (No): Context label in each log line.
*   `minLevel` (No): Minimum emitted level.
*   `apiClient` (Strongly recommended): Secure POSTs with CSRF handling. *Remote logging disabled if omitted.*
*   `browserService` (No): Safe `window`/`console` access.
*   `sessionIdProvider` (No): Custom session-ID injection.
*   `traceIdProvider` (No): Distributed-trace correlation.
*   `safeHandler` (No): Wraps console methods for safety.
*   `eventHandlers` (No): Cleanup of bound listeners.
*   `maxEventsPerMinute` (No, default 60): Rate limiting.

#### Internal Components/State
*   Uses `crypto.randomUUID` (with fallback).
*   Accesses `browserService.getWindow()?.console`.
*(No direct `import`/`require` statements; all environment access is through DI.)*

### DependencySystem (Conceptual)
*This is not a file but a core concept mentioned frequently.*
*   **Purpose:** Central dependency injection (DI) container or service locator.
*   **Functionality:** Allows modules to register themselves and resolve other registered modules/services, promoting loose coupling.

---

## Feature Modules

### Project Management

#### projectManager.js

#### Direct Dependencies (Required)
1.  `DependencySystem` – Central dependency injection system.
2.  `domReadinessService` – DOM readiness checking.
3.  `logger` – Logging service.
4.  `apiEndpoints` – API endpoint definitions.

#### Direct Dependencies (Optional)
5.  `timer` – Timer function (defaults to `setTimeout`).
6.  `app` – Main application module.
7.  `chatManager` – Chat management functionality.
8.  `modelConfig` – Model configuration.
9.  `listenerTracker` – Event listener tracking utility.
10. `storage` – Storage abstraction (defaults to a no-op store).
11. `apiRequest` – API request function (defaults to `app?.apiRequest`).
12. `browserService` – Browser functionality abstraction.
13. `domAPI` – DOM manipulation abstraction.

#### Indirect Dependencies (Resolved via DependencySystem)
14. `eventHandlers` - Event handling utilities.
15. `auth` - Authentication module.
16. `appModule` - Application state module.
17. `AppBus` - Application event bus.

#### projectDashboard.js

#### Direct Dependencies (Required)
1.  `DependencySystem` - Central dependency injection system.
2.  `domAPI` - DOM manipulation abstraction.
3.  `browserService` - Browser functionality abstraction.
4.  `eventHandlers` - Event handling utilities.
5.  `domReadinessService` - DOM readiness checking.
6.  `logger` - Logging service.
7.  `sanitizer` - HTML sanitization.
8.  `APP_CONFIG` - Application configuration.

#### Indirect Dependencies (Resolved via DependencySystem)
9.  `app` - Main application module.
10. `projectManager` - Project management functionality.
11. `auth` - Authentication module.
12. `navigationService` - Navigation functionality.
13. `projectListComponent` - Project list UI component.
14. `projectDetailsComponent` - Project details UI component.
15. `safeHandler` - Error handling wrapper.
16. `appModule` - Application state module.
17. `htmlTemplateLoader` - HTML template loading utility.

#### projectListComponent.js

#### Direct Dependencies (Required)
1.  `projectManager` (as `initialProjectManager`) - Project management functionality.
2.  `eventHandlers` - Event handling utilities.
3.  `modalManager` - Modal dialog management.
4.  `app` - Main application module.
5.  `router` - Routing functionality.
6.  `storage` - Storage abstraction.
7.  `sanitizer` (as `htmlSanitizer`) - HTML sanitization.
8.  `apiClient` - API client for backend requests.
9.  `domAPI` - DOM manipulation abstraction.
10. `browserService` - Browser functionality abstraction.
11. `globalUtils` - Utility functions.
12. `domReadinessService` - DOM readiness checking.
13. `APP_CONFIG` - Application configuration.
14. `logger` - Logging service.

#### Indirect Dependencies (Resolved via DependencySystem)
15. `safeHandler` - Error handling wrapper.
16. `navigationService` - Navigation functionality.
17. `appModule` - Application state module.

#### projectDetailsComponent.js

#### Direct Dependencies (Required)
1.  `domAPI` - DOM manipulation abstraction.
2.  `htmlTemplateLoader` - HTML template loading utility.
3.  `domReadinessService` - DOM readiness checking.
4.  `eventHandlers` - Event handling utilities.
5.  `navigationService` - Navigation functionality.
6.  `sanitizer` - HTML sanitization.
7.  `logger` - Logging service.

#### Direct Dependencies (Optional)
8.  `projectManager` (default: null) - Project management.
9.  `APP_CONFIG` (default: {}) - Application configuration.
10. `modalManager` (default: null) - Modal dialog management.
11. `FileUploadComponentClass` (default: null) - File upload component class.
12. `knowledgeBaseComponent` (default: null) - Knowledge base component.
13. `modelConfig` (default: null) - Model configuration.
14. `chatManager` (default: null) - Chat management.
15. `apiClient` (default: null) - API client.
16. `app` (default: null) - Main application module.
17. `DependencySystem` (default: null) - Used to resolve additional modules.

#### Indirect Dependencies (Resolved via DependencySystem)
18. `auth` - Authentication module.
19. `safeHandler` - Error handling wrapper.
20. `tokenStatsManager` - Token statistics management.
21. `projectDetailsEnhancements` - Project details UI enhancements.

#### project-details-enhancements.js

#### Direct Dependencies (Required)
1.  `domAPI` - DOM manipulation abstraction.
2.  `browserService` - Browser functionality abstraction.
3.  `eventHandlers` - Event handling utilities.
4.  `domReadinessService` - DOM readiness checking.
5.  `logger` - Logging service.
6.  `sanitizer` - HTML sanitization.
7.  `DependencySystem` - Central dependency injection system.

#### Indirect Dependencies (Resolved via DependencySystem)
8.  `safeHandler` - Error handling wrapper.
9.  `projectManager` - Project management functionality.
10. `chatUIEnhancements` - Chat UI enhancement utilities.
11. `appModule` - Application state module.

### Chat

#### chat.js (ChatManager)

#### Direct Dependencies (Required)
*(Factory throws if missing)*
1.  `apiRequest` – All REST / streaming API calls.
2.  `app` – Application context (auth, user, DI access).
3.  `isValidProjectId` – Validation helper for project IDs.
4.  `DOMPurify` – Sanitises HTML content in chat messages.
5.  `apiEndpoints` – Endpoint strings/factories for chat API URLs.
6.  `domReadinessService` – Await DOM readiness & element availability.
7.  `logger` – Logging service.
8.  `APP_CONFIG` – Global configuration.

#### Direct Dependencies (Optional)
9.  `eventHandlers` (default: Stub tracker) – Listener tracking/cleanup.
10. `modelConfig` (default: Stub) – Per-conversation model settings.
11. `projectDetailsComponent` (default: none) – Disables/enables chat UI on project changes.
12. `domAPI` (**Throws if absent**) – Core DOM manipulation.
13. `navAPI` (**Throws if absent**) – Navigation helpers.
14. `DependencySystem` (default: n/a) – Resolve missing deps & register module.
15. `clock` (default: `performance.now`) – Timing utilities.
16. `urlFactory` (default: `new URL()` helpers) – Build URLs with params.
17. `eventBusFactory` (default: `() => new EventTarget()`) – Creates `chatBus`.
18. `URLSearchParams` (default: global `URLSearchParams`) – Query-string parsing.
19. `DateCtor` (default: global `Date`) – Timestamp & ID helpers.

#### Imported Utilities/Helpers
*   `createChatUIUtils` – Injects UI helper methods.

#### Indirect Dependencies (Resolved via DependencySystem, if present)
*   `safeHandler` – Error-safe wrappers for async handlers.
*   `AppBus` – Emits project-change events.
*   `auth` – Auth state & `AuthBus`.
*   `appModule` – Canonical app state.
*   `navigationService` – Derives project ID from URL.
*   `tokenStatsManager` – Updates token usage UI.
*   `chatUIEnhancements` – Typing indicators, modals, etc.

#### Minimal Required Set
`apiRequest`, `app`, `isValidProjectId`, `DOMPurify`, `apiEndpoints`, `domReadinessService`, `logger`, `APP_CONFIG`

#### chatExtensions.js

#### Direct Dependencies (Required)
1.  `DependencySystem` - Central dependency injection system.
2.  `eventHandlers` - Event handling utilities.
3.  `chatManager` - Chat management functionality.
4.  `app` - Main application module.
5.  `domAPI` - DOM manipulation abstraction.
6.  `domReadinessService` - DOM readiness checking.
7.  `logger` - Logging service.

#### Indirect Dependencies (Resolved via DependencySystem)
8.  `appModule` (accessed via `app.DependencySystem.modules.get('appModule')`).

### Sidebar

#### sidebar.js

#### Direct Dependencies (Required)
*(Factory throws if missing)*
1.  `eventHandlers` – Centralised listener utilities.
2.  `DependencySystem` – Module registration and dependency resolution.
3.  `domAPI` – DOM abstraction layer.
4.  `uiRenderer` – Must expose `renderConversations`, `renderStarredConversations`, `renderProjects`.
5.  `storageAPI` – Persist/restore sidebar state.
6.  `projectManager` – Project data source.
7.  `viewportAPI` – Responsive viewport helpers.
8.  `accessibilityUtils` – Requires `.announce(...)`.
9.  `domReadinessService` – Guarantees DOM and module readiness.
10. `logger` – Logging service.
11. `safeHandler` – Error-safe wrapper for event callbacks.
12. `APP_CONFIG` – Application-level configuration object.

#### Direct Dependencies (Optional)
13. `modelConfig` – Renders quick-config UI; skipped with warning if absent.
14. `app` – Main application module (resolved via `DependencySystem` if not injected).
15. `projectDashboard` – Project dashboard helper (resolved via `DependencySystem` if absent).
16. `sanitizer` – HTML sanitiser; filter works without it but unsanitized.

#### Imported Utilities/Helpers
*   `safeParseJSON`, `debounce`, `createSidebarMobileDock`, `createSidebarEnhancements`, `createSidebarAuth` – Imported utility factories.

#### Indirect Dependencies (Resolved via DependencySystem)
*   `appModule` – Application state module.
*   `auth` – Authentication module.

#### sidebar-enhancements.js

#### Direct Dependencies (Required)
1.  `eventHandlers` - Event handling utilities.
2.  `DependencySystem` - Central dependency injection system.
3.  `domAPI` - DOM manipulation abstraction.

#### Direct Dependencies (Optional)
4.  `_modelConfig` - Model configuration (unused, for future use).
5.  `logger` - Logging service (for error logging).
6.  `_safeHandler` - Error handling wrapper (unused, for future use).

#### Indirect Dependencies (Resolved via DependencySystem)
7.  `sidebar` (accessed via `DependencySystem?.modules?.get('sidebar')`).

#### sidebarMobileDock.js

#### Direct Dependencies (Required)
1.  `domAPI` - DOM manipulation abstraction.
2.  `eventHandlers` - Event handling utilities.
3.  `viewportAPI` - Viewport size detection.
4.  `logger` - Logging service.
5.  `domReadinessService` - DOM readiness checking.
6.  `safeHandler` - Error handling wrapper.
7.  `onTabActivate` - Callback function for tab activation.

#### sidebarAuth.js

#### Direct Dependencies (Required)
1.  `domAPI` - DOM manipulation abstraction.
2.  `eventHandlers` - Event handling utilities.
3.  `DependencySystem` - Central dependency injection system.
4.  `logger` - Logging service.
5.  `safeHandler` - Error handling wrapper.

#### Direct Dependencies (Optional)
6.  `sanitizer` - HTML sanitization.

#### Indirect Dependencies (Resolved via DependencySystem)
7.  `auth` - Authentication module.
8.  `appModule` - Application state module.

### Knowledge Base

#### knowledgeBaseManager.js

#### Direct Dependencies (Required)
*(Factory throws if missing)*
1.  `apiRequest` – All HTTP calls for KB operations.
2.  `eventHandlers` – Listener tracking.
3.  `domAPI` – Core DOM manipulation.
4.  `logger` – Diagnostic logging.

#### Direct Dependencies (Optional / Contextual)
*   `domReadinessService` – Await DOM/app readiness.
*   `DependencySystem` (via `getDep("DependencySystem")`) – Resolve extra services (e.g., `safeHandler`).
*   `storage` (via `getDep("storage")`) – Persist local toggles.
*   `projectManager` – Project data helpers.
*   `validateUUID(id)` – ID validation helper.
*   `_getCurrentProjectId()` – Derives active project ID.
*   `uiUtils` – Formatting helpers.
*   `modalManager` – Confirmation modals.
*   `elements` – Cached DOM references.
*   `state` – Holds `knowledgeBase` object and UI state.
*   (Internal helper functions like `_setButtonLoading`, `renderKnowledgeBaseInfo`, etc.)

#### Minimal Required Set
`apiRequest`, `eventHandlers`, `domAPI`, `logger`

#### knowledgeBaseComponent.js

#### Direct Dependencies (Required)
1.  `DependencySystem` - Central dependency injection system.
2.  `sanitizer` - HTML sanitization.
3.  `app` - Main application module.
4.  `projectManager` - Project management functionality.
5.  `eventHandlers` - Event handling utilities.
6.  `uiUtils` - UI utility functions (falls back to `uiUtilsInstance`).
7.  `modalManager` - Modal dialog management.
8.  `domAPI` - DOM manipulation abstraction.
9.  `domReadinessService` - DOM readiness checking.
10. `logger` - Logging service.

#### Indirect Dependencies (Resolved via DependencySystem)
11. `apiRequest` - API request function.
12. `validateUUID` - UUID validation function.
13. `config` - Configuration settings.
14. `auth` - Authentication module.
15. `AppBus` - Application event bus.

#### Imported Utilities/Helpers
16. `createKnowledgeBaseSearchHandler` - Factory for creating search handler.
17. `createKnowledgeBaseManager` - Factory for creating KB manager.

---

## UI Components & Rendering

### uiRenderer.js

#### Direct Dependencies (Required)
1.  `domAPI` - DOM manipulation abstraction.
2.  `eventHandlers` - Event handling utilities.
3.  `apiRequest` - API request function.
4.  `apiEndpoints` - API endpoint definitions.
5.  `onConversationSelect` - Callback function for conversation selection.
6.  `onProjectSelect` - Callback function for project selection.
7.  `domReadinessService` - DOM readiness checking.
8.  `logger` - Logging service.
9.  `DependencySystem` - Central dependency injection system.

#### Indirect Dependencies (Resolved via DependencySystem)
10. `safeHandler` - Error handling wrapper.

### modalManager.js

#### Direct Imports
*   `MODAL_MAPPINGS` – Fallback mapping for modal-name ➜ element-ID lookup.

#### ModalManager – Direct Dependencies (Required)
*(Constructor/init throws if missing)*
| Dependency              | Purpose                                     |
| ----------------------- | ------------------------------------------- |
| `domAPI`                | Core DOM queries & mutations                |
| `browserService`        | Browser-specific helpers                    |
| `domReadinessService`   | Guarantees required DOM elements exist      |
| `eventHandlers`         | Listener tracking & confirm-modal callbacks |
| `modalMapping` or<br/>`MODAL_MAPPINGS` | Name→ID map for modal elements              |

#### ModalManager – Direct Dependencies (Optional)
| Dependency         | Fallback / Default                      | Notes                                                        |
| ------------------ | --------------------------------------- | ------------------------------------------------------------ |
| `DependencySystem` | *n/a*                                   | Used to resolve missing options and register the module      |
| `domPurify`        | `sanitizer` via DI or **undefined**     | HTML sanitisation for spinners / innerHTML                   |
| `logger`           | No-op logger                            | Standard `info / warn / error / debug`                       |
| `errorReporter`    | No-op reporter                          | If provided → `errorReporter.capture(err)`                   |
| `app`              | `DependencySystem.modules.get('app')` | Debug flags & state access                                   |

#### ProjectModal – Direct Dependencies (Required)
*(Factory throws if missing)*
| Dependency            | Purpose                             |
| --------------------- | ----------------------------------- |
| `projectManager`      | Save/update project data            |
| `eventHandlers`       | Event binding & cleanup             |
| `domAPI`              | DOM manipulation                    |
| `domReadinessService` | Await DOM and module readiness      |

#### ProjectModal – Direct Dependencies (Optional)
| Dependency         | Default         | Notes           |
| ------------------ | --------------- | --------------- |
| `DependencySystem` | *n/a*           | Resolve fallbacks |
| `domPurify`        | **undefined**   | Sanitise HTML   |
| `logger`           | No-op logger    |                 |
| `errorReporter`    | No-op reporter  |                 |

#### Indirect Dependencies (Resolved via DependencySystem)
*   `htmlTemplateLoader` – To fetch `/static/html/modals.html` if markup not pre-rendered.

#### Minimal Sets
*   **ModalManager:** `domAPI`, `browserService`, `domReadinessService`, `eventHandlers`, `modalMapping`/`MODAL_MAPPINGS`
*   **ProjectModal:** `projectManager`, `eventHandlers`, `domAPI`, `domReadinessService`

### FileUploadComponent.js

#### Direct Dependencies (Required)
1.  `app` - Main application module (needs `validateUUID` and `getProjectId` methods).
2.  `eventHandlers` - Event handling utilities.
3.  `projectManager` - Project management functionality (needs `uploadFileWithRetry` method).
4.  `domAPI` - DOM manipulation abstraction.
5.  `logger` - Logging service.

#### Direct Dependencies (Optional)
6.  `domReadinessService` - DOM readiness checking.
7.  `scheduler` - Timing utilities (defaults to `{ setTimeout, clearTimeout }`).
8.  `projectId` - Initial project ID.
9.  `onUploadComplete` - Callback function after uploads finish.
10. `elements` - Pre-resolved DOM element references.

#### Indirect Dependencies (Auto-resolved)
11. `logger` - Can be auto-resolved via `eventHandlers?.DependencySystem?.modules?.get?.('logger')` if not provided directly.

---

## Utility Modules & Services

### navigationService.js

#### Direct Dependencies (Required)
1.  `domAPI` - DOM manipulation abstraction.
2.  `browserService` - Browser functionality abstraction.
3.  `DependencySystem` - Central dependency injection system.
4.  `eventHandlers` - Event handling utilities.

#### Direct Dependencies (Optional)
5.  `logger` - Logging service (falls back to `DependencySystem.modules.get('logger')` or NOOP_LOGGER).

#### Indirect Dependencies (Resolved via DependencySystem)
6.  `safeHandler` - Error handling wrapper.

### eventHandler.js

#### Direct Dependencies (Required)
1.  `DependencySystem` - Central dependency injection system.
2.  `domAPI` - DOM manipulation abstraction.
3.  `browserService` - Browser functionality abstraction.
4.  `logger` - Logging service.
5.  `errorReporter` - Error reporting service.
6.  `APP_CONFIG` - Application configuration.
7.  `safeHandler` - Error handling wrapper (falls back to `DependencySystem.modules.get('safeHandler')`).

#### Direct Dependencies (Optional)
8.  `app` - Main application module.
9.  `projectManager` - Project management (can be updated via `setProjectManager`).
10. `modalManager` - Modal dialog management (falls back to `DependencySystem.modules.get('modalManager')`).
11. `navigate` - Navigation function (falls back to `app.navigate` or `browserService.setLocation`).
12. `storage` - Storage abstraction (falls back to `browserService`).
13. `domReadinessService` - DOM readiness checking (can be set; required for init).

#### Imported Utilities/Helpers
14. `debounce` - Function debouncing utility (from `globalUtils.js`).
15. `toggleElement` - Element toggling utility (from `globalUtils.js`).

#### Indirect Dependencies (Resolved via DependencySystem during init)
16. `auth` - Authentication module.

### modelConfig.js

#### Direct Dependencies (Required)
1.  `dependencySystem` - Central dependency injection system.
2.  `domReadinessService` - DOM readiness checking (with `dependenciesAndElements` method).
3.  `sanitizer` - HTML sanitization (with `sanitize` method).

#### Direct Dependencies (Optional)
4.  `eventHandler` - Event handling utilities (falls back to no-op).
5.  `storageHandler` - Storage abstraction (falls back to no-op).
6.  `scheduleTask` - Task scheduling function (falls back to `setTimeout`).
7.  `logger` - Logging service (falls back to `dependencySystem.modules.get('logger')` or no-op).

#### Indirect Dependencies (Resolved via DependencySystem)
8.  `domAPI` - DOM manipulation abstraction.
9.  `chatManager` - Chat management (for notifying about model config changes).

#### Internal Components/State
*   `busTarget` - Custom `EventTarget` for model config-related events (registered as `modelConfigBus`).
*   Various state properties for tracking model configuration.

### projectDashboardUtils.js

#### Direct Dependencies (Required)
1.  `DependencySystem` - Central dependency injection system.
2.  `eventHandlers` - Event handling utilities.
3.  `projectManager` - Project management functionality.
4.  `modalManager` - Modal dialog management.
5.  `sanitizer` - HTML sanitization.
6.  `domAPI` - DOM manipulation abstraction.

#### Direct Dependencies (Optional)
7.  `formatDate` - Date formatting utility (falls back to `DependencySystem`).
8.  `formatBytes` - Byte formatting utility (falls back to `DependencySystem`).
9.  `logger` - Logging service (falls back to `DependencySystem`).

#### Indirect Dependencies (Resolved via DependencySystem)
10. `eventBus` - Event bus for dispatching events.
11. `projectModal` - Project modal component.

### chat-ui-utils.js

#### Direct Dependencies (Required)
1.  `logger` - Logging service.
2.  `domAPI` - DOM manipulation abstraction.
3.  `DOMPurify` - HTML sanitization.
4.  `eventHandlers` - Event handling utilities.
5.  `domReadinessService` - DOM readiness checking.
6.  `DependencySystem` - Central dependency injection system.

#### Indirect Dependencies (Resolved via DependencySystem)
7.  `safeHandler` (accessed via `DependencySystem.modules.get('safeHandler')`).

### chatUIEnhancements.js

#### Direct Dependencies (Required)
1.  `domAPI` – DOM manipulation abstraction.
2.  `eventHandlers` – Event listener tracking utilities.
3.  `browserService` – Window / timers / feature detection.
4.  `domReadinessService` – Waits for DOM elements & readiness.
5.  `logger` – Structured logging.
6.  `sanitizer` – HTML & SVG sanitisation.
7.  `DependencySystem` – Module registration & resolving `safeHandler`.

#### Direct Dependencies (Optional)
8.  `chatManager` – Conversation loading / creation.
9.  `modalManager` – Modal dialogs (confirmations, errors).

#### Indirect Dependencies (Resolved via DependencySystem)
10. `safeHandler` – Error-safe wrappers for async handlers.

#### Imported Utilities/Helpers
*   `createDomWaitHelper` (from `utils/initHelpers.js`).
*   `createElement` (from `utils/globalUtils.js`).

#### Internal Components/State
*   `EventTarget` – used for the local `chatUIBus`.

### accessibility-utils.js

#### Direct Dependencies (Required)
1.  `logger` – Logging service.
2.  `domReadinessService` – DOM readiness orchestration.
3.  `domAPI` – DOM abstraction.
4.  `eventHandlers` – Centralised listener utilities.
5.  `safeHandler` – Function wrapper for safe event handling. *(Factory throws if not injected and not resolvable via `DependencySystem`)*.

#### Direct Dependencies (Optional)
6.  `DependencySystem` – Used to register utilities and as a fallback source for `safeHandler`.
7.  `createDebugTools` – Factory for debugging helpers (falls back to no-op).
8.  `errorReporter` – External error reporting interface (errors still logged locally if absent).

#### Indirect Dependencies (Resolved via DependencySystem)
9.  `sidebar` - Sidebar module.

---

## Initialization Modules

*(These modules are typically responsible for setting up and orchestrating other modules and services at application startup.)*

### init/appState.js

#### Direct Dependencies (Required)
1.  `DependencySystem` – Central DI container.
2.  `logger` – Structured logger (falls back to `browserService.getWindow().console`).

#### Indirect Dependencies (Runtime via DependencySystem)
*   `browserService` → `window.console` (optional).
*   `eventHandlers` → listener cleanup.
*   `domAPI` → DOM dispatch helpers.
*   `AppBus`.

### init/authInit.js

#### Direct Dependencies (Required)
*   `DependencySystem`, `domAPI`, `eventHandlers`, `logger`, `sanitizer`, `safeHandler`, `domReadinessService`, `APP_CONFIG`.

#### Indirect Dependencies (Runtime, typically resolved by DependencySystem for the auth module itself)
*   `auth`, `appModule`, `projectManager`, `navigationService`.

### init/coreInit.js

#### Direct Dependencies (Required at Construction)
*   `DependencySystem`, `domAPI`, `browserService`, `eventHandlers`, `sanitizer`, `APP_CONFIG`, `domReadinessService`, `createKnowledgeBaseComponent`.

#### Dependencies Validated/Used at Runtime (plus logger, factories, services)
*   `logger`, `MODAL_MAPPINGS`, `apiRequest`, `apiClientObject`, `apiEndpoints`, `app`, `uiUtils`, `navigationService`, `globalUtils`, `FileUploadComponent`, `htmlTemplateLoader`, `uiRenderer`, `accessibilityUtils`, `safeHandler`.

#### Factories Resolved from DependencySystem
*   `createModalManager`, `createAuthModule`, `createProjectManager`, `createModelConfig`, `createProjectDashboard`, `createProjectDetailsComponent`, `createProjectListComponent`, `createProjectModal`, `createSidebar`, `createChatManager`.

### init/errorInit.js

#### Direct Dependencies (Required)
*   `DependencySystem`, `browserService`, `eventHandlers`, `logger`, `safeHandler`.

#### Behavior
*   Adds global `window.error` and `unhandledrejection` listeners via `eventHandlers`.

### init/serviceInit.js

#### Direct Dependencies (Required)
*   `DependencySystem`, `domAPI`, `browserServiceInstance`, `eventHandlers`, `domReadinessService`, `sanitizer`, `APP_CONFIG`, `getSessionId`.

#### Direct Dependencies (Optional/Recommended)
*   `logger` (falls back to console/no-op).

#### Additional Factories Used
*   `uiUtils`, `globalUtils`, `createFileUploadComponent`, `createApiClient`, `createAccessibilityEnhancements`, `createNavigationService`, `createHtmlTemplateLoader`, `createUiRenderer`.

#### Services Registered (into DependencySystem)
*   `domAPI`, `browserService`, `viewportAPI`, `storage`, `eventHandlers`, `domReadinessService`, `errorReporter`, `sanitizer`, `uiUtils`, `globalUtils`, `apiEndpoints`, `apiRequest`, `apiClientObject`, `accessibilityUtils`, `navigationService`, `htmlTemplateLoader`, `uiRenderer`, `logger`.

### init/uiInit.js

#### Direct Dependencies (Required)
*   `DependencySystem`, `domAPI`, `browserService`, `eventHandlers`, `domReadinessService`, `logger`, `APP_CONFIG`, `safeHandler`, `sanitizer`, `createProjectDetailsEnhancements`, `createTokenStatsManager`, `createKnowledgeBaseComponent`, `apiRequest`, `uiUtils`.

#### Indirect Dependencies (via DependencySystem, for UI components being initialized)
*   `modalManager`, `projectDashboard`, `sidebar`, `projectListComponent`, `projectDetailsComponent`, `knowledgeBaseComponent`, `navigationService`, `tokenStatsManager`.

---

## Dependency Frequency Analysis

*(This table lists dependencies and how many modules reference them. The "Modules" column can be very dense for common dependencies.)*

| Dependency                 | Frequency | Modules (Examples, full list in original if truncated) |
| -------------------------- | --------- | ------------------------------------------------------ |
| `DependencySystem`         | 22        | Most modules except some standalone utilities/components |
| `domAPI`                   | 24        | Nearly all modules                                     |
| `eventHandlers`            | 25        | All modules                                            |
| `logger`                   | 23        | Nearly all modules                                     |
| `domReadinessService`      | 18        | projectDashboard, projectManager, auth, chat, sidebar, init/*, etc. |
| `safeHandler`              | 15        | projectDashboard, projectManager, auth, chat, sidebar, navigationService, etc. |
| `sanitizer`                | 13        | projectDashboard, projectDetails, sidebar, auth, modelConfig, etc. |
| `projectManager`           | 11        | projectDashboard, projectList, projectDetails, sidebar, knowledgeBase*, etc. |
| `browserService`           | 10        | navigationService, projectDashboard, projectManager, eventHandler, apiClient, etc. |
| `appModule`                | 10        | projectDashboard, projectManager, chatExtensions, sidebar, auth, etc. |
| `app`                      | 10        | projectDashboard, projectList, chat, knowledgeBaseComponent, modalManager, etc. |
| `auth`                     | 9         | projectDashboard, projectManager, sidebar, knowledgeBaseComponent, init/authInit, etc. |
| `APP_CONFIG`               | 8         | projectDashboard, projectList, chat, sidebar, eventHandler, apiClient, init/* |
| `modalManager`             | 6         | projectList, projectDetails, eventHandler, knowledgeBaseComponent, auth, projectDashboardUtils |
| `chatManager`              | 4         | projectDetailsComponent, projectManager, modelConfig, chatExtensions |
| `modelConfig`              | 4         | projectDetailsComponent, projectManager, chat, sidebar |
| `storage`                  | 4         | projectListComponent, projectManager, eventHandler, knowledgeBaseManager |
| `apiRequest`               | 4         | projectManager, chat, knowledgeBaseComponent, knowledgeBaseManager |
| `apiClient`                | 3         | projectListComponent, projectDetailsComponent, auth.js |
| `htmlTemplateLoader`       | 3         | projectDashboard, projectDetailsComponent, modalManager |
| `apiEndpoints`             | 3         | projectManager, chat, uiRenderer.js |
| `navigationService`        | 3         | projectDashboard, projectListComponent, projectDetailsComponent |
| `errorReporter`            | 3         | eventHandler, modalManager, accessibility-utils |
| `chatUIEnhancements`       | 2         | project-details-enhancements, chat |
| `globalUtils`              | 2         | projectListComponent, apiClient.js |
| `uiUtils`                  | 2         | knowledgeBaseComponent, knowledgeBaseManager |
| `validateUUID`             | 2         | knowledgeBaseComponent, knowledgeBaseManager |
| `viewportAPI`              | 2         | sidebar, sidebarMobileDock |
| `sidebar`                  | 2         | accessibility-utils, sidebar-enhancements |
| `tokenStatsManager`        | 1         | projectDetailsComponent |
| `knowledgeBaseComponent`   | 1         | projectDetailsComponent |
| `router`                   | 1         | projectListComponent |
| `timer`                    | 1         | projectManager |
| `AppBus`                   | 1         | projectManager |
| `listenerTracker`          | 1         | projectManager |
| `DOMPurify`                | 1         | chat-ui-utils (also chat.js) |
| `uiRenderer`               | 1         | sidebar (also init/serviceInit registers it) |
| `storageAPI`               | 1         | sidebar |
| `accessibilityUtils`       | 1         | sidebar (also init/serviceInit registers it) |
| `projectDashboard`         | 1         | sidebar |
| `config`                   | 1         | knowledgeBaseComponent |
| `domPurify`                | 1         | modalManager (distinct from DOMPurify) |
| `modalMapping`             | 1         | modalManager |
| `eventHandler`             | 1         | modelConfig (distinct from eventHandlers) |
| `storageHandler`           | 1         | modelConfig |
| `scheduleTask`             | 1         | modelConfig |
| `onConversationSelect`     | 1         | uiRenderer |
| `onProjectSelect`          | 1         | uiRenderer |
| `getAuthModule`            | 1         | apiClient |
| `overrides`                | 1         | appConfig |
| `onTabActivate`            | 1         | sidebarMobileDock |
| `createDebugTools`         | 1         | accessibility-utils |
| `eventBus`                 | 1         | projectDashboardUtils |
| `projectModal`             | 1         | projectDashboardUtils |
| `scheduler`                | 1         | FileUploadComponent |
| `projectId`                | 1         | FileUploadComponent |
| `onUploadComplete`         | 1         | FileUploadComponent |
| `elements`                 | 1         | FileUploadComponent |

*(Note: The frequency count includes direct, indirect, optional, and required mentions. `dependencySystem` in `modelConfig.js` is counted as `DependencySystem`.)*
