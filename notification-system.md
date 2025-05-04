Below is a **single, comprehensive reference document** that merges the complete [Notification System: Architecture, Usage, and Best Practices](#) guide with the **Integration & Migration: Dependency Injection Playbook**. This unified doc illustrates:

1. How the notification system works (types, grouping, styling, etc.).
2. How to integrate and migrate modules using strictly injected dependencies.
3. Best practices for consistent usage in your codebase.

By following this single guide, teams can ensure both **notification** and **dependency injection** patterns remain unified and maintainable across the entire application.

---

# Azure Chat App Notification System & DI Playbook

---

## Table of Contents

1. [Overview](#overview)
2. [Banner Display Types](#banner-display-types)
   - [Single Notifications](#single-notifications)
   - [Grouped Notifications](#grouped-notifications)
3. [Styling, Animation, and Theming](#styling-animation-and-theming)
4. [Notification API Usage](#notification-api-usage)
   - [Basic Example](#basic-example)
   - [Types](#types)
   - [Grouping Options](#grouping-options)
   - [Customizing Context, Module, Source](#customizing-context-module-source)
5. [Grouping Rules and Contexts](#grouping-rules-and-contexts)
6. [Accessibility and Responsiveness](#accessibility-and-responsiveness)
7. [Best Practices](#best-practices)
8. [Reference: Customization and CSS](#reference-customization-and-css)
9. [Notification Logging & Backend Integration](#notification-logging--backend-integration)
10. [Integration & Migration: DI Playbook](#integration--migration-di-playbook)

---

## 1. Overview

The notification system provides robust, accessible, and theme-aware banners for user feedback, error handling, and operational status across desktop and mobile in the Azure Chat Application.

**Features include:**
- Consistent display for all modules (info, warning, error, success)
- Animation (fade-in/out, grouped pulse)
- Advanced grouping (batch related messages together)
- Per-module scoping and cross-module grouping
- Theme (light/dark) and responsive support
- Accessibility (keyboard navigation, ARIA, focus)
- Integrated one-click **copy-to-clipboard** for all notifications
- Easy customization and extensibility

All notifications remain strictly client-side. As of 2025-05-04, there is **no automated backend logging** of notification banners.

---

## 2. Banner Display Types

### Single Notifications

- Rendered as `.alert.notification-item`.
- Each Banner:
  - Icon (e.g. info, error),
  - Main message text,
  - Dismiss button (`×`),
  - **Copy button** (clipboard icon) to copy the message text; icon changes to a checkmark upon success.
- Colors are controlled by classes like `.notification-error`, `.notification-success`.
- Animations: `.animate-fadeIn` and `.animate-fadeOut`.

### Grouped Notifications

- Rendered with an **accordion-like** UI, typically as `.accordion-banner`.
- A “summary row” indicates:
  - The context or feature name,
  - The message “type” (info, error, etc.),
  - A count of how many messages are batched together.
- The summary row itself has:
  - A copy button to copy **all** messages in the group, with inline success icon swap,
  - Expand/collapse controls (e.g. “Show Details” / “Hide Details”),
  - A dismiss button that closes the entire group.
- Grouping is based on type + context/module/source + time bucket (e.g. 5-7 seconds).
- Animations: same fade plus a quick “pulse” if additional messages arrive while the group is expanded.

---

## 3. Styling, Animation, and Theming

- **Theme Colors:** We use DaisyUI/Tailwind theme tokens (e.g. `--color-error`, `--color-success`) in `enhanced-components.css`.
- **Accent Border:** A distinct left border or top border by notification type.
- **Responsiveness:** Banners scale for mobile. Dismiss/copy/toggle buttons are at least 44px.
- **Animations:** Tailwind-based fade-in/fade-out plus pulses for group expansions.
- **Legacy note:** `notification-accordion.css` can be removed without affecting modern banners.

---

## 4. Notification API Usage

Below is the standard interface (you may see it as `notificationHandler.show(...)` or via an injected `notify` wrapper):

### Basic Example

```js
// Show an info notification (non-grouped)
notify.info('User saved successfully', { timeout: 4000 });

// Show an error, grouped for the "file-upload" context
notify.error('Failed to upload file', {
  group: true,
  context: 'file-upload'
});
```

### Types

Supported string types:
- `"info"`
- `"success"`
- `"warning"`
- `"error"`

The UI uses color-coded icons and backgrounds for each.

### Grouping Options

Set `group: true` in the options to batch messages together. Batching merges:
```js
{
  type:     [info|warning|...],
  context:  (or module/source),
  timeBucket: e.g. 5s or 7s
}
```

If **none** of `context`, `module`, or `source` is provided, notifications of the same type are grouped under a default “general” label.

### Customizing Context, Module, Source

When you pass `context`, `module`, or `source` in the `options`, you control how those notifications are grouped. The library uses:

```js
const groupKey = options.context || options.module || options.source || 'general';
```

**Examples:**

```js
// All errors from all modules are grouped together (default)
notify.error('Error in X', { group: true });

// Only errors in "auth" grouped
notify.error('Login failed', { group: true, context: 'auth' });

// Per-feature grouping
notify.error('Missing project file', { group: true, module: 'projectManager' });
```

---

## 5. Grouping Rules and Contexts

- **All modules, same type**: If you do not set a context, all e.g. `"error"` notifications from different modules get batched in one group labeled “Error (general)”.
- **Module/feature grouping**: Setting `context: 'someFeature'` ensures separate grouping from other features.

---

## 6. Accessibility and Responsiveness

- **ARIA roles**: Banners have `[role="alert"]` with proper labeling.
- **Keyboard**: All actions (dismiss, copy, expand) are keyed to tab-stops, with focus indicators.
- **Focus**: Minimal shift, but focus remains on the last triggered element unless the app chooses to move it.
- **Copy button accessibility**: Each notification line or group has a copy button with an `aria-label="Copy message"`. On success, icon toggles visually.

---

## 7. Best Practices

- Always specify a type (`"error"`, `"info"`, etc.) so the user sees appropriate color and icon.
- For ephemeral messages, set `timeout` to a few seconds. For important system alerts, use `timeout: 0`.
- Use meaningful `context` or `module` to isolate or unify related notifications (e.g. `'auth'` for all login-related warnings).
- Use a single or minimal set of `context` strings for easy grouping, rather than dozens of unique ones.
- Avoid spamming repeated messages (e.g. gracefully handle errors in a single place).

---

## 8. Reference: Customization and CSS

- **Primary styles**: `enhanced-components.css` (Tailwind + DaisyUI).
- **Copy button classes**:
  - `.notification-copy-btn` for single banners,
  - `.accordion-copy-btn` for group summary row.
- **Animation**: Utility classes (like `animate-fadeIn`).
- **Deprecated**: `notification-accordion.css` is no longer used for the current system.

---

## 9. Notification Logging & Backend Integration

> **As of 2025-05-04**, the current notification system is purely on the frontend. It does **not** automatically post to any backend endpoints or log files.
>
> The existing FastAPI `log_notification` endpoints remain for possible future usage or batch logging but are not employed by the current code.

---

## 10. Integration & Migration: DI Playbook

This playbook ensures new and existing modules integrate notifications **and** all other dependencies (like `apiClient`, `eventHandlers`, etc.) through **strict dependency injection**. It also shows how to unify them with the notification system described above.

### 10.1 One-time Setup (Already in `app.js`)

Below is an example typical of your `app.js` or main entry file:

```js
// app.js (early boot)
import { createNotificationHandler } from './notification-handler.js';

const notificationHandler = createNotificationHandler({
  eventHandlers,
  DependencySystem,
  domAPI,
  groupWindowMs: 7000, // how long to batch messages
});
DependencySystem.register('notificationHandler', notificationHandler);

/* Optional facade for older code */
export const showNotification = notificationHandler.show;
```

You might also have a specialized `notify` wrapper:

```js
// static/js/utils/notify.js
export function createNotify({ notificationHandler }) {
  if (!notificationHandler?.show) throw new Error('notificationHandler missing');

  const DURATION = { info:4000, success:4000, warning:6000, error:0 };

  function send(msg, type='info', opts={}) {
    // The library’s .show() might accept (msg, type, timeout, options).
    return notificationHandler.show(msg, type, DURATION[type], opts);
  }

  return {
    info   : (msg, o={}) => send(msg, 'info',    o),
    success: (msg, o={}) => send(msg, 'success', o),
    warn   : (msg, o={}) => send(msg, 'warning', o),
    error  : (msg, o={}) => send(msg, 'error',   o),

    // Some opinionated group-labeled helpers
    apiError: (msg, o={}) =>
      send(msg, 'error', { group:true, context:'apiRequest', ...o }),
    authWarn: (msg, o={}) =>
      send(msg, 'warning', { group:true, context:'auth', ...o })
  };
}

// After you've created it:
DependencySystem.register(
  'notify',
  createNotify({ notificationHandler })
);
```

Now any module that needs to show a notification can do so by injecting `notify`.

---

### 10.2 A Canonical “Factory” Module Example

Below is a minimal template for any new or refactored feature module, ensuring no global references (like `window.*` or `console.*`) and using the final `notify` from DI.

```js
/**
 * createAwesomeFeature.js – DI-strict example
 */
export function createAwesomeFeature({
  apiClient,
  eventHandlers,
  notify,          // inject from DI, do NOT import globally
  DependencySystem
}) {
  if (!notify) throw new Error('notify utility required');

  async function doSomethingCool(fileId) {
    // Show a grouped info notification under "awesome"
    notify.info('[Awesome] Starting process...', { group:true, context:'awesome' });

    try {
      const res = await apiClient.post(`/files/${fileId}/process`);
      notify.success('File processed successfully!', { group:true, context:'awesome' });
      return res;
    } catch (err) {
      notify.error('File processing failed!', { group:true, context:'awesome' });
      // Rethrow or handle as needed
      throw err;
    }
  }

  // Return any public methods
  return { doSomethingCool };
}
```

**Key takeaways for strict DI:**
- **Never** import or reference `window.*`, `document.*`, or a globally-scoped `console.*` to show user feedback.
- Instead, rely on **injected** `notify`, `domAPI`, `eventHandlers`, etc.
- Thoroughly check for existence of required dependencies.

---

### 10.3 Example: Migrating an Existing Module

When refactoring an older file that used to do `console.log` or `alert` calls:

1. **Remove** all direct `alert` or `console` calls.
2. **Add** `notify` as a constructor/`createX` param.
3. **Replace** references to `console` with the appropriate `notify.info`, `notify.warn`, `notify.error`, etc.
4. **Add** grouping contexts if relevant (e.g. `context: 'myModuleName'`).

---

### 10.4 Ensuring Cleanup & Mockability

- For modules that attach `eventHandlers.trackListener`, remember to expose a `destroy()` or `cleanup()` method to remove them if your SPA or tests re-instantiate modules.
- This pattern is particularly important for code using `setInterval` or references to a real DOM in tests.
- Mocks of `notify` can be used in unit tests to assert that certain warnings or errors are shown.

---

## Conclusion

By adhering to this combined **Notification System** architecture (sections 1-9) and the **Strict Dependency Injection Playbook** (section 10), your application:

- Presents consistent, accessible banners for errors and status messages.
- Ensures no leaky global references or ad-hoc user notifications.
- Can easily group messages by module or context and avoid spamming repeated alerts.
- Maintains testability by injecting all external dependencies, including the notification subsystem.

Continue to check the references in your code for any direct `console.*` or `window.*` usage and convert them to injected dependencies plus the `notify` utility. This will keep the user experience unified, themed, and fully maintainable.
