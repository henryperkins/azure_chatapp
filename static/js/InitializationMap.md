# Initialization & Dependency Map for static/js

This document outlines the key initialization flow and module interdependencies in the JavaScript files under the <code>static/js</code> directory. It also highlights where dependencies are injected via the project’s &ldquo;DependencySystem&rdquo; and references to <code>domAPI</code>, <code>browserAPI</code>, <code>notify</code>, etc. No circular dependencies appear to exist in the current structure.

---

## 1. Top-Level Entry: <code>app.js</code>

• Main entry point.
• Imports:
  - <code>appConfig.js</code> (config constants)
  - <code>utils/domAPI.js</code> (as <code>createDomAPI</code>)
  - <code>utils/globalUtils.js</code> (as <code>createBrowserAPI</code>)
  - <code>utils/notify.js</code> (via <code>createNotificationHandler</code> or through DI)
  - <code>eventHandler.js</code> & others (some references are indirect via <code>DependencySystem</code>)

• Injects or registers with <code>DependencySystem</code>:
  - <code>browserAPI</code> (from <code>createBrowserAPI</code>)
  - <code>domAPI</code> (from <code>createDomAPI</code>)
  - <code>notify</code> (notification utility)
  - <code>eventHandlers</code> (setup for orchestration, using <code>eventHandler.js</code>)
  - <code>notificationHandler</code> (wraps user notifications in a container)

• Then sets up:
  - <code>modalManager</code> (for modals)
  - <code>auth</code> (authentication forms)
  - <code>sidebar</code> and <code>sidebar-enhancements</code> (user interface toggles and layout)
  - <code>sentry-init</code> (error reporting & instrumentation)

**Notes**
- The big picture: <code>app.js</code> is the &ldquo;orchestrator&rdquo; that obtains the references from each module&rsquo;s factory or from <code>DependencySystem</code>—then initializes features in a sequence.
- No sign of a feedback loop from these modules back into <code>app.js</code>.

---

## 2. <code>domAPI.js</code>

• Exports <code>createDomAPI</code>, which wraps all DOM access in a single object: <code>getElementById</code>, <code>createElement</code>, <code>dispatchEvent</code>, etc.
• Consumes references to <code>documentObject</code> & <code>windowObject</code> from the caller.
• Many modules rely on <code>domAPI</code> for strictly injected DOM operations, in line with the project’s policy to avoid global <code>document</code> usage.

---

## 3. <code>eventHandler.js</code>

• Factory style: receives <code>DependencySystem</code>, <code>domAPI</code>, <code>browserService</code>, optional <code>notify</code>.
• Simplifies setting up or tearing down event listeners (<code>trackListener</code>), form handling, collapsible UI panels, delegated click handlers, etc.
• Typically runs after <code>domAPI</code> is in place.

---

## 4. Notification Modules

### <code>notification-handler.js</code>
• Creates a container for user notifications or system banners.
• Depends on <code>domAPI</code> to create and place banners in the DOM.
• <code>notify</code> references can also come from <code>utils/notify.js</code> or <code>createNotificationHandler</code>.

### <code>utils/notify.js</code>
• Core utility that surfaces <code>notify.info</code>, <code>notify.error</code>, etc., often enhanced by “context” usage.
• Consumed by <code>app.js</code>, <code>eventHandler.js</code>, <code>auth.js</code>, and more.

---

## 5. <code>auth.js</code>

• Manages login forms, password submission, register flow.
• Requires <code>domAPI</code>, <code>eventHandlers</code>, <code>sanitizer</code>, and <code>notify</code>.
• Checks or sets authenticated state, triggers <code>authStateChanged</code> events.

---

## 6. <code>sidebar.js</code> & <code>sidebar-enhancements.js</code>

• Modules for toggling the sidebar UI, pinning/unpinning, migrating legacy toggles, etc.
• Depend on <code>domAPI</code> (for IDs, class manipulation) and may call <code>eventHandlers</code> or <code>DependencySystem</code> for broader features.
• <code>sidebar-enhancements.js</code> is a factory (<code>createSidebarEnhancements</code>) that needs <code>eventHandlers</code> and <code>domAPI</code>.

---

## 7. <code>chat.js</code>, <code>chatExtensions.js</code>

• Chat UI modules that manipulate conversation flow, message containers, model config changes.
• Heavy usage of <code>domAPI</code> to create elements for chat messages, toggles for &ldquo;thinking&rdquo; blocks.
• Accepts optional <code>DependencySystem</code>, <code>notify</code>, <code>DOMPurify</code> for sanitizing chat reponses.

---

## 8. <code>modalManager.js</code>

• A structured approach to controlling modals (open, close, body scroll lock, etc.).
• Requires <code>domAPI</code>, <code>browserService</code>, optional <code>eventHandlers</code>, <code>notify</code>.
• Deployed by <code>app.js</code>, <code>eventHandler.js</code>, and other features that need custom modals.

---

## 9. Other Modules

- <code>FileUploadComponent.js</code>
  • Depends on <code>domAPI</code>, <code>notify</code>, <code>projectManager</code>.
- <code>projectDashboardUtils.js</code>, <code>projectDetailsComponent.js</code>
  • Both rely on <code>domAPI</code>, <code>sanitizer</code>, optionally <code>notify</code>, to build out or refresh project UI.

---

## 10. Checking for Circular Dependencies

• The top-level <code>app.js</code> registers and initializes modules in a forward-only manner.
• <code>domAPI</code> is an infrastructure layer consumed by nearly all modules. <code>domAPI.js</code> does not import from others, so it does not form a cycle.
• <code>eventHandler.js</code> might appear to reference some modules that <code>app.js</code> references too, but usage flows through the <code>DependencySystem</code>.
• No modules re-import <code>app.js</code>, so the main entry point does not create a cycle.

**Conclusion**: No direct cycles or re-entrant references are present based on module injection scanning.

---

## Final Notes
• The project’s factory pattern (e.g. <code>createSomething</code>) and <code>DependencySystem</code> usage keep modules relatively decoupled.
• <code>domAPI</code> is the most commonly injected dependency, ensuring testability/test harness support for DOM operations.
• This map is derived from scanning import references and code constants under <code>static/js</code>. Adjust as modules evolve or new scripts are added.
