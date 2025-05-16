# Sidebar Recovery Plan

This document outlines the staged approach to restore full functionality of the sidebar (tabs, buttons, project / chat listings, model-configuration panel, and login state).

## Root Causes Suspected
1. Missing / late DOM elements preventing `domReadinessService` from resolving selectors.
2. Silent failures in `sidebar.init()` – errors swallowed and only `false` returned.
3. Bootstrap order problems: sidebar created before required modules or state are ready.
4. Event propagation gaps: auth / project events not reaching sidebar due to missing listeners.

## High-level Fix Strategy
```
Instrument  →  Observe  →  Patch  →  Retest
```

1. **Instrumentation** – add lightweight logging so failures surface in console / Sentry.
2. **DOM audit** – verify required sidebar elements actually exist in the base template.
3. **Bootstrap error surfacing** – throw instead of returning `false` on init error and include missing selector / dependency in message.
4. **Incremental functional fixes** – once visibility is restored, repair list rendering and auth state updates.

## Detailed Task List

### 1. Instrumentation
| Location                                   | Change |
|--------------------------------------------|--------|
| `sidebar.js → init()`                      | `logger.info` statements after each major step (findDom, bindDomEvents, restorePersistentState). |
| `app.js → initializeUIComponents()`        | Log result of `await sidebar.init()`. |
| `domReadinessService.js`                   | Enhance timeout error to include offending selector or dependency. |

### 2. DOM Verification
Ensure the following IDs are present once the initial HTML finishes loading (either in `static/html/base.html` or dynamically injected templates):
```
#mainSidebar
#navToggleBtn  #closeSidebarBtn
#pinSidebarBtn
#chatSearchInput  #sidebarProjectSearch
#recentChatsTab #starredChatsTab #projectsTab
#recentChatsSection #starredChatsSection #projectsSection
#sidebarAuthFormContainer (+ its children)
```
If any are missing, add a minimal skeleton to `base.html` so that `domReadinessService` succeeds.

### 3. Bootstrap Order Audit & Fixes
* Change `sidebar.init()` to **throw** on error – prevents silent failure.
* In `initializeUIComponents` display visible banner if sidebar fails.
* Verify DOMPurify presence earlier; already done in `app.js` lines 120-128.

### 4. Listing Functions
After sidebar is visible:
1. Add logs inside `uiRenderer.renderProjects` & `renderConversations` to confirm arrays length.
2. Confirm `projectManager.loadProjects('all')` is called post auth.

### 5. Auth Form / Global Auth
* Log AuthBus events.
* Trace `handleGlobalAuthStateChange` class toggles.

## Acceptance Criteria
- Toggle button opens sidebar.
- Tabs switch panels & ARIA attributes update.
- Projects populate after login.
- Recent / starred chats render for current project.
- Model-configuration panel opens correctly.
- Login / logout reliably updates sidebar visibility and auth form.

## Roll-back / Cleanup
All console logs added under instrumentation are wrapped with `APP_CONFIG.DEBUG` guard so they can be disabled in production builds.

## Owner
Roo – Architect / Code modes

## Timeline
1. **Instrumentation & DOM skeleton** – first commit.
2. **Error surfacing & banner** – second commit.
3. **Functional fixes** – subsequent commits until acceptance criteria met.
