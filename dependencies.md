# Project Dependencies Analysis

This document provides a comprehensive analysis of dependencies across key project modules.

## Table of Contents
- [projectDashboard.js](#projectdashboardjs)
- [projectListComponent.js](#projectlistcomponentjs)
- [projectDetailsComponent.js](#projectdetailscomponentjs)
- [projectManager.js](#projectmanagerjs)
- [project-details-enhancements.js](#project-details-enhancementsjs)
- [chat.js](#chatjs)
- [chatExtensions.js](#chatextensionsjs)
- [chat-ui-utils.js](#chat-ui-utilsjs)
- [sidebar.js](#sidebarjs)
- [sidebar-enhancements.js](#sidebar-enhancementsjs)
- [navigationService.js](#navigationservicejs)
- [eventHandler.js](#eventhandlerjs)
- [knowledgeBaseComponent.js](#knowledgebasecomponentjs)
- [modalManager.js](#modalmanagerjs)
- [auth.js](#authjs)
- [modelConfig.js](#modelconfigjs)
- [uiRenderer.js](#uirendererjs)
- [projectDashboardUtils.js](#projectdashboardutilsjs)
- [apiClient.js](#apiclientjs)
- [appConfig.js](#appconfigjs)
- [sidebarMobileDock.js](#sidebarmobiledockjs)
- [sidebarAuth.js](#sidebarauthjs)
- [accessibility-utils.js](#accessibility-utilsjs)
- [FileUploadComponent.js](#fileuploadcomponentjs)
- [Dependency Frequency Analysis](#dependency-frequency-analysis)

## projectDashboard.js

### Direct Dependencies (required)
1. `DependencySystem` - Central dependency injection system
2. `domAPI` - DOM manipulation abstraction
3. `browserService` - Browser functionality abstraction
4. `eventHandlers` - Event handling utilities
5. `domReadinessService` - DOM readiness checking
6. `logger` - Logging service
7. `sanitizer` - HTML sanitization
8. `APP_CONFIG` - Application configuration

### Indirect Dependencies (retrieved via DependencySystem)
9. `app` - Main application module
10. `projectManager` - Project management functionality
11. `auth` - Authentication module
12. `navigationService` - Navigation functionality
13. `projectListComponent` - Project list UI component
14. `projectDetailsComponent` - Project details UI component
15. `safeHandler` - Error handling wrapper
16. `appModule` - Application state module
17. `htmlTemplateLoader` - HTML template loading utility

## projectListComponent.js

### Direct Dependencies (required)
1. `projectManager` (as `initialProjectManager`) - Project management functionality
2. `eventHandlers` - Event handling utilities
3. `modalManager` - Modal dialog management
4. `app` - Main application module
5. `router` - Routing functionality
6. `storage` - Storage abstraction
7. `sanitizer` (as `htmlSanitizer`) - HTML sanitization
8. `apiClient` - API client for backend requests
9. `domAPI` - DOM manipulation abstraction
10. `browserService` - Browser functionality abstraction
11. `globalUtils` - Utility functions
12. `domReadinessService` - DOM readiness checking
13. `APP_CONFIG` - Application configuration
14. `logger` - Logging service

### Indirect Dependencies (retrieved via DependencySystem)
15. `safeHandler` - Error handling wrapper
16. `navigationService` - Navigation functionality
17. `appModule` - Application state module

## projectDetailsComponent.js

### Direct Dependencies (required)
1. `domAPI` - DOM manipulation abstraction
2. `htmlTemplateLoader` - HTML template loading utility
3. `domReadinessService` - DOM readiness checking
4. `eventHandlers` - Event handling utilities
5. `navigationService` - Navigation functionality
6. `sanitizer` - HTML sanitization
7. `logger` - Logging service
8. `projectManager` - Project management functionality
9. `APP_CONFIG` - Application configuration
10. `DependencySystem` - Central dependency injection system

### Direct Dependencies (optional with defaults)
11. `modalManager` (default: null) - Modal dialog management
12. `FileUploadComponentClass` (default: null) - File upload component class
13. `knowledgeBaseComponent` (default: null) - Knowledge base component
14. `modelConfig` (default: null) - Model configuration
15. `chatManager` (default: null) - Chat management functionality
16. `apiClient` (default: null) - API client for backend requests
17. `app` (default: null, fallback to DI) - Main application module

### Indirect Dependencies (retrieved via DependencySystem)
18. `auth` - Authentication module
19. `safeHandler` - Error handling wrapper
20. `tokenStatsManager` - Token statistics management
21. `projectDetailsEnhancements` - Project details UI enhancements

## projectManager.js

### Direct Dependencies (required in factory function)
1. `DependencySystem` - Central dependency injection system
2. `domReadinessService` - DOM readiness checking
3. `logger` - Logging service
4. `timer` - Timer function (usually setTimeout)

### Required in ProjectManager constructor
5. `apiEndpoints` - API endpoint definitions

### Optional in ProjectManager constructor (with fallbacks to DependencySystem)
6. `app` - Main application module
7. `chatManager` - Chat management functionality
8. `modelConfig` - Model configuration
9. `listenerTracker` - Event listener tracking utility
10. `storage` - Storage abstraction
11. `apiRequest` - API request function
12. `browserService` - Browser functionality abstraction
13. `domAPI` - DOM manipulation abstraction

### Indirect Dependencies (retrieved via DependencySystem)
14. `eventHandlers` - Event handling utilities
15. `auth` - Authentication module
16. `appModule` - Application state module
17. `AppBus` - Application event bus

## project-details-enhancements.js

### Direct Dependencies (required)
1. `domAPI` - DOM manipulation abstraction
2. `browserService` - Browser functionality abstraction
3. `eventHandlers` - Event handling utilities
4. `domReadinessService` - DOM readiness checking
5. `logger` - Logging service
6. `sanitizer` - HTML sanitization
7. `DependencySystem` - Central dependency injection system

### Indirect Dependencies (retrieved via DependencySystem)
8. `safeHandler` - Error handling wrapper
9. `projectManager` - Project management functionality
10. `chatUIEnhancements` - Chat UI enhancement utilities
11. `appModule` - Application state module

## chat.js

### Direct Dependencies (required)
1. `apiRequest` - API request function
2. `app` - Main application module
3. `eventHandlers` - Event handling utilities
4. `modelConfig` - Model configuration
5. `projectDetailsComponent` - Project details UI component
6. `isValidProjectId` - Function to validate project IDs
7. `domAPI` - DOM manipulation abstraction
8. `navAPI` - Navigation API
9. `DOMPurify` - HTML sanitization
10. `apiEndpoints` - API endpoint definitions
11. `domReadinessService` - DOM readiness checking
12. `logger` - Logging service
13. `DependencySystem` - Central dependency injection system
14. `APP_CONFIG` - Application configuration

### Optional Dependencies with Defaults
15. `clock` - Performance timing utility
16. `urlFactory` - URL creation utility
17. `eventBusFactory` - Event bus creation utility
18. `URLSearchParams` - URL search params constructor
19. `DateCtor` - Date constructor

### Indirect Dependencies (retrieved via DependencySystem)
20. `safeHandler` - Error handling wrapper
21. `tokenStatsManager` - Token statistics management
22. `appModule` - Application state module
23. `chatUIEnhancements` - Chat UI enhancement utilities

### Internal Dependencies (imported directly)
24. `createChatUIUtils` - Chat UI utilities factory

## chatExtensions.js

### Direct Dependencies (required)
1. `DependencySystem` - Central dependency injection system
2. `eventHandlers` - Event handling utilities
3. `chatManager` - Chat management functionality
4. `app` - Main application module
5. `domAPI` - DOM manipulation abstraction
6. `domReadinessService` - DOM readiness checking
7. `logger` - Logging service

### Indirect Dependencies (retrieved via DependencySystem)
8. `appModule` - Application state module (accessed via `app.DependencySystem.modules.get('appModule')`)

## chat-ui-utils.js

### Direct Dependencies (required)
1. `logger` - Logging service
2. `domAPI` - DOM manipulation abstraction
3. `DOMPurify` - HTML sanitization
4. `eventHandlers` - Event handling utilities
5. `domReadinessService` - DOM readiness checking
6. `DependencySystem` - Central dependency injection system

### Indirect Dependencies (retrieved via DependencySystem)
7. `safeHandler` - Error handling wrapper (accessed via `DependencySystem.modules.get('safeHandler')`)

## sidebar.js

### Direct Dependencies (required)
1. `eventHandlers` - Event handling utilities
2. `DependencySystem` - Central dependency injection system
3. `domAPI` - DOM manipulation abstraction
4. `uiRenderer` - UI rendering utilities
5. `storageAPI` - Storage abstraction
6. `projectManager` - Project management functionality
7. `viewportAPI` - Viewport size detection
8. `accessibilityUtils` - Accessibility utilities
9. `sanitizer` - HTML sanitization
10. `domReadinessService` - DOM readiness checking
11. `logger` - Logging service
12. `safeHandler` - Error handling wrapper
13. `APP_CONFIG` - Application configuration

### Direct Dependencies (optional with fallbacks)
14. `modelConfig` - Model configuration
15. `app` - Main application module (falls back to DependencySystem)
16. `projectDashboard` - Project dashboard component (falls back to DependencySystem)

### Imported Dependencies
17. `safeParseJSON` - Safe JSON parsing utility
18. `debounce` - Function debouncing utility
19. `createSidebarMobileDock` - Sidebar mobile dock factory
20. `createSidebarEnhancements` - Sidebar enhancements factory
21. `createSidebarAuth` - Sidebar authentication factory

### Indirect Dependencies (retrieved via DependencySystem)
22. `appModule` - Application state module
23. `auth` - Authentication module

## sidebar-enhancements.js

### Direct Dependencies (required)
1. `eventHandlers` - Event handling utilities
2. `DependencySystem` - Central dependency injection system
3. `domAPI` - DOM manipulation abstraction

### Direct Dependencies (optional)
4. `_modelConfig` - Model configuration (unused parameter, kept for future use)
5. `logger` - Logging service (optional, used for error logging)
6. `_safeHandler` - Error handling wrapper (unused parameter, kept for future use)

### Indirect Dependencies (retrieved via DependencySystem)
7. `sidebar` - Sidebar module (accessed via `DependencySystem?.modules?.get('sidebar')`)

## navigationService.js

### Direct Dependencies (required)
1. `domAPI` - DOM manipulation abstraction
2. `browserService` - Browser functionality abstraction
3. `DependencySystem` - Central dependency injection system
4. `eventHandlers` - Event handling utilities

### Direct Dependencies (optional with fallbacks)
5. `logger` - Logging service (falls back to DependencySystem.modules.get('logger') or NOOP_LOGGER)

### Indirect Dependencies (retrieved via DependencySystem)
6. `safeHandler` - Error handling wrapper

## eventHandler.js

### Direct Dependencies (required)
1. `DependencySystem` - Central dependency injection system
2. `domAPI` - DOM manipulation abstraction
3. `browserService` - Browser functionality abstraction
4. `logger` - Logging service
5. `errorReporter` - Error reporting service
6. `APP_CONFIG` - Application configuration
7. `safeHandler` - Error handling wrapper (falls back to DependencySystem.modules.get('safeHandler'))

### Direct Dependencies (optional with fallbacks)
8. `app` - Main application module
9. `projectManager` - Project management functionality (can be updated via setProjectManager)
10. `modalManager` - Modal dialog management (falls back to DependencySystem.modules.get('modalManager'))
11. `navigate` - Navigation function (falls back to app.navigate or browserService.setLocation)
12. `storage` - Storage abstraction (falls back to browserService)
13. `domReadinessService` - DOM readiness checking (can be set via setDomReadinessService, required for init)

### Imported Dependencies
14. `debounce` - Function debouncing utility from globalUtils.js
15. `toggleElement` - Element toggling utility from globalUtils.js

### Indirect Dependencies (retrieved via DependencySystem during init)
16. `auth` - Authentication module

## knowledgeBaseComponent.js

### Direct Dependencies (required)
1. `DependencySystem` - Central dependency injection system
2. `sanitizer` - HTML sanitization
3. `app` - Main application module
4. `projectManager` - Project management functionality
5. `eventHandlers` - Event handling utilities
6. `uiUtils` - UI utility functions (falls back to uiUtilsInstance)
7. `modalManager` - Modal dialog management
8. `domAPI` - DOM manipulation abstraction
9. `domReadinessService` - DOM readiness checking
10. `logger` - Logging service

### Indirect Dependencies (retrieved via DependencySystem)
11. `apiRequest` - API request function
12. `validateUUID` - UUID validation function
13. `config` - Configuration settings
14. `auth` - Authentication module
15. `AppBus` - Application event bus

### Imported Dependencies
16. `createKnowledgeBaseSearchHandler` - Factory for creating search handler
17. `createKnowledgeBaseManager` - Factory for creating KB manager

## modalManager.js

### Direct Dependencies (required for ModalManager)
1. `domAPI` - DOM manipulation abstraction
2. `browserService` - Browser functionality abstraction
3. `domReadinessService` - DOM readiness checking

### Direct Dependencies (optional with fallbacks for ModalManager)
4. `eventHandlers` - Event handling utilities (falls back to DependencySystem)
5. `DependencySystem` - Central dependency injection system
6. `modalMapping` - Modal mapping configuration (falls back to MODAL_MAPPINGS)
7. `domPurify` - HTML sanitization (falls back to sanitizer)
8. `logger` - Logging service (falls back to no-op implementation)
9. `errorReporter` - Error reporting service (falls back to no-op implementation)

### Direct Dependencies (required for ProjectModal)
10. `projectManager` - Project management functionality

### Indirect Dependencies (retrieved via DependencySystem)
11. `app` - Main application module
12. `htmlTemplateLoader` - HTML template loading utility

### Imported Dependencies
13. `MODAL_MAPPINGS` - Default modal mappings from modalConstants.js

## auth.js

### Direct Dependencies (required)
1. `apiClient` - API client for backend requests
2. `logger` - Logging service
3. `domReadinessService` - DOM readiness checking
4. `eventHandlers` - Event handling utilities
5. `domAPI` - DOM manipulation abstraction
6. `sanitizer` - HTML sanitization
7. `apiEndpoints` - API endpoint definitions (with specific required endpoints)

### Direct Dependencies (optional)
8. `DependencySystem` - Central dependency injection system
9. `modalManager` - Modal dialog management

### Indirect Dependencies (retrieved via DependencySystem)
10. `safeHandler` - Error handling wrapper
11. `appModule` - Application state module (with setAuthState method)
12. `browserService` - Browser functionality abstraction (with setTimeout, setInterval, clearInterval, FormData)

### Internal Components/State
The AuthModule also creates and uses:
- `AuthBus` - Custom EventTarget for auth-related events
- Various state properties for tracking authentication state, tokens, and CSRF tokens

## modelConfig.js

### Direct Dependencies (required)
1. `dependencySystem` - Central dependency injection system
2. `domReadinessService` - DOM readiness checking (with dependenciesAndElements method)
3. `sanitizer` - HTML sanitization (with sanitize method)

### Direct Dependencies (optional with fallbacks)
4. `eventHandler` - Event handling utilities (falls back to no-op implementation)
5. `storageHandler` - Storage abstraction (falls back to no-op implementation)
6. `scheduleTask` - Task scheduling function (falls back to setTimeout)
7. `logger` - Logging service (falls back to dependencySystem.modules.get('logger') or no-op implementation)

### Indirect Dependencies (retrieved via DependencySystem)
8. `domAPI` - DOM manipulation abstraction
9. `chatManager` - Chat management functionality (for notifying about model config changes)

### Internal Components/State
The ModelConfig module also creates and uses:
- `busTarget` - Custom EventTarget for model config-related events (registered as 'modelConfigBus')
- Various state properties for tracking model configuration

## uiRenderer.js

### Direct Dependencies (required)
1. `domAPI` - DOM manipulation abstraction
2. `eventHandlers` - Event handling utilities
3. `apiRequest` - API request function
4. `apiEndpoints` - API endpoint definitions
5. `onConversationSelect` - Callback function for conversation selection
6. `onProjectSelect` - Callback function for project selection
7. `domReadinessService` - DOM readiness checking
8. `logger` - Logging service
9. `DependencySystem` - Central dependency injection system

### Indirect Dependencies (retrieved via DependencySystem)
10. `safeHandler` - Error handling wrapper

## projectDashboardUtils.js

### Direct Dependencies (required)
1. `DependencySystem` - Central dependency injection system
2. `eventHandlers` - Event handling utilities
3. `projectManager` - Project management functionality
4. `modalManager` - Modal dialog management
5. `sanitizer` - HTML sanitization
6. `domAPI` - DOM manipulation abstraction

### Direct Dependencies (optional with fallbacks)
7. `formatDate` - Date formatting utility (falls back to DependencySystem)
8. `formatBytes` - Byte formatting utility (falls back to DependencySystem)
9. `logger` - Logging service (falls back to DependencySystem)

### Indirect Dependencies (retrieved via DependencySystem)
10. `eventBus` - Event bus for dispatching events
11. `projectModal` - Project modal component

## apiClient.js

### Direct Dependencies (required)
1. `APP_CONFIG` - Application configuration
2. `globalUtils` - Utility functions (specifically needs `shouldSkipDedup`, `stableStringify`, `normaliseUrl`, and `isAbsoluteUrl`)
3. `getAuthModule` - Function to retrieve the auth module
4. `browserService` - Browser functionality abstraction
5. `eventHandlers` - Event handling utilities
6. `logger` - Logging service

### Indirect Dependencies (accessed via injected dependencies)
7. Auth module (via `getAuthModule()`) - Used to get CSRF tokens
8. AbortController (via `browserService.getWindow()?.AbortController`) - Used for request timeouts

## appConfig.js

### Direct Dependencies (required)
1. `DependencySystem` - Central dependency injection system
2. `eventHandlers` - Event handling utilities

### Direct Dependencies (optional)
3. `overrides` - Optional configuration overrides

## sidebarMobileDock.js

### Direct Dependencies (required)
1. `domAPI` - DOM manipulation abstraction
2. `eventHandlers` - Event handling utilities
3. `viewportAPI` - Viewport size detection
4. `logger` - Logging service
5. `domReadinessService` - DOM readiness checking
6. `safeHandler` - Error handling wrapper
7. `onTabActivate` - Callback function for tab activation

## sidebarAuth.js

### Direct Dependencies (required)
1. `domAPI` - DOM manipulation abstraction
2. `eventHandlers` - Event handling utilities
3. `DependencySystem` - Central dependency injection system
4. `logger` - Logging service
5. `safeHandler` - Error handling wrapper

### Direct Dependencies (optional)
6. `sanitizer` - HTML sanitization

### Indirect Dependencies (retrieved via DependencySystem)
7. `auth` - Authentication module
8. `appModule` - Application state module

## accessibility-utils.js

### Direct Dependencies (required)
1. `domAPI` - DOM manipulation abstraction
2. `eventHandlers` - Event handling utilities
3. `logger` - Logging service
4. `domReadinessService` - DOM readiness checking
5. `safeHandler` - Error handling wrapper

### Direct Dependencies (optional)
6. `DependencySystem` - Central dependency injection system
7. `createDebugTools` - Debug tools factory
8. `errorReporter` - Error reporting service

### Indirect Dependencies (retrieved via DependencySystem)
9. `sidebar` - Sidebar module

## FileUploadComponent.js

### Direct Dependencies (required)
1. `app` - Main application module (needs `validateUUID` and `getProjectId` methods)
2. `eventHandlers` - Event handling utilities
3. `projectManager` - Project management functionality (needs `uploadFileWithRetry` method)
4. `domAPI` - DOM manipulation abstraction
5. `logger` - Logging service

### Direct Dependencies (optional)
6. `domReadinessService` - DOM readiness checking (optional)
7. `scheduler` - Timing utilities (optional, defaults to `{ setTimeout, clearTimeout }`)
8. `projectId` - Initial project ID (optional parameter)
9. `onUploadComplete` - Callback function after uploads finish (optional)
10. `elements` - Pre-resolved DOM element references (optional)

### Indirect Dependencies (auto-resolved)
11. `logger` - Can be auto-resolved via `eventHandlers?.DependencySystem?.modules?.get?.('logger')` if not provided directly

## Dependency Frequency Analysis

| Dependency | Frequency | Modules |
|------------|-----------|---------|
| `DependencySystem` | 22 | All modules except sidebarMobileDock.js, FileUploadComponent.js |
| `domAPI` | 23 | All modules except appConfig.js |
| `domReadinessService` | 19 | All modules except navigationService, appConfig.js, apiClient.js, projectDashboardUtils.js, sidebar-enhancements.js |
| `eventHandlers` | 24 | All modules |
| `logger` | 23 | All modules except appConfig.js |
| `browserService` | 10 | navigationService, projectDashboard, projectListComponent, projectDetailsComponent, projectManager, sidebar, eventHandler, apiClient.js, uiRenderer.js, project-details-enhancements |
| `sanitizer` | 13 | projectDashboard, projectListComponent, projectDetailsComponent, project-details-enhancements, sidebar, knowledgeBaseComponent, uiRenderer.js, auth.js, modelConfig.js, projectDashboardUtils.js, sidebarAuth.js, accessibility-utils.js |
| `projectManager` | 10 | projectDashboard, projectListComponent, projectDetailsComponent, project-details-enhancements, sidebar, knowledgeBaseComponent, modalManager, projectDashboardUtils.js, FileUploadComponent.js |
| `appModule` | 11 | projectDashboard, projectListComponent, projectDetailsComponent, projectManager, chat.js, chatExtensions.js, sidebar, eventHandler, auth.js, sidebarAuth.js |
| `APP_CONFIG` | 9 | projectDashboard, projectListComponent, projectDetailsComponent, projectManager, chat.js, sidebar, eventHandler, apiClient.js, appConfig.js |
| `safeHandler` | 16 | projectDashboard, projectListComponent, projectDetailsComponent, projectManager, chat.js, chat-ui-utils.js, sidebar, navigationService, eventHandler, auth.js, uiRenderer.js, project-details-enhancements, sidebarMobileDock.js, sidebarAuth.js, accessibility-utils.js |
| `app` | 11 | projectDashboard, projectListComponent, projectDetailsComponent, projectManager, chat.js, chatExtensions.js, sidebar, eventHandler, knowledgeBaseComponent, modalManager, FileUploadComponent.js |
| `navigationService` | 3 | projectDashboard, projectListComponent, projectDetailsComponent |
| `auth` | 9 | projectDashboard, projectListComponent, projectDetailsComponent, projectManager, chat.js, sidebar, eventHandler, knowledgeBaseComponent, sidebarAuth.js |
| `chatManager` | 4 | projectDetailsComponent, projectManager, modelConfig.js, chatExtensions.js |
| `modelConfig` | 5 | projectDetailsComponent, projectManager, chat.js, sidebar, auth.js |
| `apiClient` | 3 | projectListComponent, projectDetailsComponent, auth.js |
| `modalManager` | 6 | projectListComponent, projectDetailsComponent, eventHandler, knowledgeBaseComponent, auth.js, projectDashboardUtils.js |
| `htmlTemplateLoader` | 3 | projectDashboard, projectDetailsComponent, modalManager |
| `storage` | 3 | projectListComponent, projectManager, eventHandler |
| `apiEndpoints` | 4 | projectManager, chat.js, uiRenderer.js, auth.js |
| `chatUIEnhancements` | 2 | project-details-enhancements, chat.js |
| `tokenStatsManager` | 2 | projectDetailsComponent, chat.js |
| `projectDetailsEnhancements` | 1 | projectDetailsComponent |
| `FileUploadComponentClass` | 1 | projectDetailsComponent |
| `knowledgeBaseComponent` | 1 | projectDetailsComponent |
| `router` | 1 | projectListComponent |
| `globalUtils` | 2 | projectListComponent, apiClient.js |
| `timer` | 1 | projectManager |
| `apiRequest` | 4 | projectManager, chat.js, knowledgeBaseComponent, uiRenderer.js |
| `AppBus` | 2 | projectManager, knowledgeBaseComponent |
| `listenerTracker` | 1 | projectManager |
| `projectDetailsComponent` | 1 | chat.js |
| `isValidProjectId` | 1 | chat.js |
| `navAPI` | 1 | chat.js |
| `DOMPurify` | 2 | chat.js, chat-ui-utils.js |
| `uiRenderer` | 1 | sidebar |
| `storageAPI` | 1 | sidebar |
| `viewportAPI` | 2 | sidebar, sidebarMobileDock.js |
| `accessibilityUtils` | 1 | sidebar |
| `projectDashboard` | 1 | sidebar |
| `errorReporter` | 3 | eventHandler, modalManager, accessibility-utils.js |
| `uiUtils` | 1 | knowledgeBaseComponent |
| `validateUUID` | 1 | knowledgeBaseComponent |
| `config` | 1 | knowledgeBaseComponent |
| `domPurify` | 1 | modalManager |
| `modalMapping` | 1 | modalManager |
| `dependencySystem` | 1 | modelConfig.js |
| `eventHandler` | 1 | modelConfig.js |
| `storageHandler` | 1 | modelConfig.js |
| `scheduleTask` | 1 | modelConfig.js |
| `onConversationSelect` | 1 | uiRenderer.js |
| `onProjectSelect` | 1 | uiRenderer.js |
| `formatDate` | 2 | projectDashboardUtils.js, projectListComponent |
| `formatBytes` | 2 | projectDashboardUtils.js, projectListComponent |
| `getAuthModule` | 1 | apiClient.js |
| `overrides` | 1 | appConfig.js |
| `onTabActivate` | 1 | sidebarMobileDock.js |
| `createDebugTools` | 1 | accessibility-utils.js |
| `eventBus` | 1 | projectDashboardUtils.js |
| `projectModal` | 1 | projectDashboardUtils.js |
| `sidebar` | 2 | accessibility-utils.js, sidebar-enhancements.js |
| `scheduler` | 1 | FileUploadComponent.js |
| `projectId` | 1 | FileUploadComponent.js |
| `onUploadComplete` | 1 | FileUploadComponent.js |
| `elements` | 1 | FileUploadComponent.js |
