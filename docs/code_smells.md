# Code Smells Detected

## 1. God / Mega Classes
- ProjectManager (~900 lines)
- ChatManager (~1 600 lines, mixes network/API/DOM/UI concerns)
- ProjectDashboard, ProjectDetailsComponent, Sidebar, EventHandler  
  → Violate the Single Responsibility Principle; hard to test and maintain.

## 2. Excessively Long Functions
- initializeUIComponents (≈340 lines)
- ChatManager.initialize (≈340 lines)
- ProjectDashboard.showProjectDetails, _setView, etc.  
  → Refactor into smaller helpers.

## 3. Constructors / factories with overly long parameter lists
E.g. `createProjectDetailsComponent`, `createSidebar`, `createChatManager`  
  → Use configuration objects or DI containers to shorten them.

## 4. Duplicated logic / UI
- `_showMessage`, `_createThinkingBlock`, “thinking/loading” indicators appear in both ChatManager and attachChatUI.
- Repeated code for tab toggling (ProjectDetails vs Sidebar).

## 5. Commented-out / dead code
- Numerous `// console.error … // Removed`
- Entire commented blocks (debug, “old way vs new way”).  
  → Remove or move to dedicated logging utilities.

## 6. Direct dependency on `globalThis.document` and `window` in modules that claim strict DI  
  → Breaks own guardrails (e.g., ProjectManager, ProjectDetailsComponent).

## 7. Silent error handling
`catch { /* silent */ }` or `// Error handled silently`  
  → Masks failures and complicates debugging.

## 8. Duplicated state and ad-hoc flags
- `currentProject` stored in multiple places (ProjectManager, app, Sidebar).
- Flags such as `_uiReadyFlag`, `_dataReadyFlag`, `_lastReadyEmittedId` proliferate.

## 9. Heavy use of undocumented, untyped custom events
Makes traceability hard (`projectDetailsReady`, `sidebarTabChanged`, etc.).

## 10. Inconsistent naming / conventions
- `normaliseUrl` vs `normalizeUrl` (two aliases)
- `ProjectDetail**s**Component` vs `projectDetails` (plural/singular)  
  → Standardize.

## 11. Blanket `try/catch` abuse
Many silent catches with comments “Removed” → hides bugs.

## 12. Mixed infrastructure and UI responsibilities
E.g. EventHandler manages collapsibles, forms, modals and navigation.

---

General Recommendations:
1. Extract smaller modules (API service, UI renderer, state manager).
2. Apply Single Responsibility and separate DOM/UI from business logic.
3. Remove dead code and silent catches; use a central logger.
4. Document and type custom events.
5. Add unit tests for isolated helpers.
