# Notification System: Architecture, Usage, and Best Practices

This guide documents the notification banner system for the Azure Chat Application, including its features, usage patterns, configuration options, and integration points for all modules.

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

---

## Overview

The notification system provides robust, accessible, and theme-aware banners for user feedback, error handling, and operational status across desktop and mobile.

**Features include:**
- Consistent display for all modules (info, warning, error, success)
- Animation (fade-in/out, grouped pulse)
- Advanced grouping (batch related messages together)
- Per-module scoping and cross-module grouping
- Full theme (light/dark) and responsive support
- Accessibility (keyboard navigation, ARIA, focus)
- Integrated one-click copy-to-clipboard for all notifications (with inline feedback and accessibility support)
- Easy customization and extensibility

---

## Banner Display Types

### Single Notifications

- Rendered as `.alert.notification-item`
- Icon, message, dismiss (`×`) button, and new **copy button** (clipboard icon; click to copy message, icon changes to checkmark on success)
- Uses classes like `.notification-error`, `.notification-success`
- Animates with `.animate-fadeIn` and `.animate-fadeOut`

### Grouped Notifications (Accordion)

- Rendered as `.accordion-banner` using an accordion UI
- Summary view: context badge + type + count
- **Copy button** in summary row allows copying all messages in group to clipboard; the icon provides inline checkmark feedback on success
- Expand/collapse to show all messages in group (`Show Details`/`Hide Details`)
- Dismisses group as a whole (`×`)
- Groups by {type, context/module/source, time bucket}

---

## Styling, Animation, and Theming

- **Theme/color:** Uses DaisyUI/Tailwind theme colors (`--color-error`, `--color-success`, etc) in both enhanced-components and notification-accordion CSS.
- **Accent border:** Strong left border color by type for immediate recognition.
- **Animations:** Fade-in/out for both singles and groups; pulse on grouped update.
- **Responsiveness:** Max width/shrink for mobile, enforced button/tap target sizes.
- **Integration Points:** All styling centralized via `enhanced-components.css`, `notification-accordion.css`, and theme variable overrides.

---

## Notification API Usage

### Basic Example

```js
// Show an info notification
notificationHandler.show('User saved successfully', 'success', { timeout: 4000 });

// Show an error, grouped for this module
notificationHandler.show(
  'Failed to upload file',
  'error',
  { group: true, context: 'file-upload' }
);
```

### Types

Types supported: `info`, `success`, `warning`, `error`
Rendering and left-accent color are determined by type.

### Grouping Options

- Set `group: true` in the `options` parameter to enable grouping/batching.
- Grouping is based on:
  `{ type, context/module/source, 5s time bucket }`
- If no `context/module/source` is given, grouping is cross-module by type (`general` context).

### Customizing Context, Module, Source

You can scope grouping and display by providing one of these options:

- `context`: Arbitrary string (e.g. `"auth"`, `"projectManager"`, `"file-upload"`)
- `module`: Name of the subsystem or feature (e.g. `"chatManager"`, `"sidebar"`)
- `source`: More granular context (e.g. `"apiRequest"`, `"loginSubmit"`)

The notification handler determines grouping context as:
```js
const context = options.context || options.module || options.source || 'general';
```
Specify these to control grouping boundaries.

---

## Grouping Rules and Contexts

- **All modules, shared type:**
  - If no context/module/source is set (or all are the same), notifications of the same type from all modules are grouped together in a single accordion.
- **Module/feature-specific grouping:**
  - By setting a unique `context`, `module`, or `source`, grouping is *per module/feature* and type.
- **Summary:**
  - Grouping context is fully controlled by your option string; use the same string to group together, unique ones to keep groups distinct.

**Examples:**
```js
// All errors from all modules grouped together (default)
notificationHandler.show('Error in X', 'error', { group: true });

// Only errors in auth grouped
notificationHandler.show('Login failed', 'error', { group: true, context: 'auth' });

// Per-feature grouping for Project Manager
notificationHandler.show('Missing project file', 'error', { group: true, module: 'projectManager' });
```

---

## Accessibility and Responsiveness

- **ARIA roles:** All banners use proper roles (alert, region, labelledby).
- **Keyboard support:** Tab/focus states on all buttons, including copy, summary, close, and message lists.
- **Focus management:** Outlines and focus-visible for all interactive elements; supports keyboard navigation.
- **Copy button accessibility:** Copy buttons are keyboard and screenreader accessible (aria-label, focusable, feedback with icon swap).
- **Minimum tap targets:** All dismiss/toggle/copy/action buttons are at least 44x44px.
- **Mobile:** Responsive width and stacking, font sizes scale on smaller screens.

---

## Best Practices

- Use a descriptive, stable string for `context` or `module` when grouping notifications in your feature/module.
- For cross-cutting/globally relevant grouping, leave context/module/source unset or set the same value in multiple locations.
- Always provide a type (`"info"`, `"error"`, etc.) for semantic coloring and icon.
- Prefer `timeout: 0` for persistent/system alerts, otherwise use a short timeout to avoid notification clutter.
- Clean up notifications via `.clear()` if relevant (e.g. on navigation).
- For accessibility, ensure summaries and messages are concise and descriptive.

---

## Reference: Customization and CSS

- Styles are managed via DaisyUI + custom CSS in `enhanced-components.css`, `notification-accordion.css`.
- Copy button styling uses class `.notification-copy-btn` for singles and `.accordion-copy-btn` for grouped banners.
- All color variables are themeable and support both light and dark modes.
- Animations are managed via Tailwind utility classes and custom keyframes.
- You may further customize banner layout, iconography (including supplied SVGs for copy/check), or transitions through these partials.

---

## Example: Creating a Grouped Notification from a Module

```js
// In projectManager.js
export function notifyProjectLoadError(notificationHandler, projectId) {
  notificationHandler.show(
    `Could not load project with ID: ${projectId}`,
    'error',
    { group: true, context: 'projectManager' }
  );
}
```

---

## Additional Information

- **Injected notification util for all code:** `DependencySystem.modules.get('notify')`
  - This is the *only* supported way to send notifications in modules, features, and components outside of `static/js/app.js`.
  - Usage (example):
    ```js
    // In your feature or component
    export function createFeature({ notify }) {
      notify.success('Operation complete!', { context: 'feature' });
      notify.error('Something went wrong', { context: 'feature' });
    }
    ```
- **Do NOT use `notificationHandlerWithLog`**:
  - This internal-only object appears in `app.js` and must never be injected or referenced in other modules.
- **Direct handler access (low-level):** `DependencySystem.modules.get('notificationHandler')`
  - For advanced use (e.g. non-standard grouping, low-level hide, etc.), rarely needed.
- **Grouped notification helper:** Used internally by the handler as `notificationHandler.groupedHelper`
- Server-side batching/logging is automatic when using `notify` or the handler.

      "notifications": [
        {
          "message": "string",
          "type": "info|warning|error|success",
          "timestamp": 1714759832.10,
          "user": "alice"
        }
      ]
    }
    ```
  - Responds with `{ "status": "ok", "count": <number> }`

- **Single log:**
  - **POST** `/api/log_notification`
  - Body:
    ```json
    {
      "message": "string",
      "type": "info|warning|error|success",
      "timestamp": 1714759832.10,
      "user": "alice"
    }
    ```

> **Note:** The notification system behaves robustly if the logger endpoint is missing or errors—user feedback is never blocked.

### Logging Implementation Details

- Logs are appended to `notifications.txt` at the project root.
- If the log exceeds 10 MB, logs are rotated (`notifications.txt`, `notifications.txt.1`, up to 5 files).
- Every log entry is formatted:
  ```
  2025-05-04T10:48:22.123456Z [INFO] user=alice Message content here
  ```
- Log writes are file-locked (`fcntl.LOCK_EX`) for concurrency and retried; logging runs as a FastAPI background task for non-blocking API response.
- Only the last 5 log files are retained. After rotation, the new file starts with a comment header line indicating rotation.

### Troubleshooting Backend Logging

- **Banners show but no entries appear in notifications.txt:**
  - Check that your FastAPI backend is running and has write permission in the project root.
  - Log rotation may have just happened; check `.1`, `.2` etc. for older logs.
  - Confirm the `/api/log_notification_batch` endpoint is not returning errors.
  - Review backend logs for exceptions (permission errors, OS/file errors).

---

## See Also

- static/js/notification-handler.js – implementation, options, grouped helper
- static/js/handler-helper.js – grouping logic
- static/css/notification-accordion.css, static/css/enhanced-components.css – styles
- static/js/app.js – how notification handler is registered and injected
- routes/log_notification.py – backend logging (API endpoints, concurrency/rotation logic)

---

*For contributions or style overrides, see the CSS partials and review the notification API signature to ensure notification UX remains consistent site-wide.*

---

## Changelog

**2025-05-04:**
- Added documentation for backend logging endpoints, file locations, and troubleshooting.
- Clarified API contracts for `/api/log_notification_batch` and batch model shape.
- Outlined log file concurrency/rotation guarantees and backend log retention policy.

**2025-05-03:**
- Added copy-to-clipboard feature to all notification banners:
  - All single and grouped notifications now have a copy button.
  - Copy feedback is provided via inline icon state only (checkmark), not a popup.
  - Accessibility and style updated accordingly.

---

# Integration & Migration: Dependency Injection Playbook

Below is a **drop-in playbook** you can hand to *any* team-mate and apply to *every* JavaScript/TypeScript file in the repo—whether it already exists or will be written next week.
It enforces the same dependency-injection style, grouping semantics, and error-handling rules the new **notification-handler** expects, yet stays thin enough that you can copy-paste most of it verbatim.

---

## 1 One-time setup you already have

```javascript
// app.js  (early boot, already present)
import { createNotificationHandler } from './notification-handler.js';

const notificationHandler = createNotificationHandler({
  eventHandlers,
  DependencySystem,
  domAPI,
  groupWindowMs : 7000,            //  <-- tune per product
});
DependencySystem.register('notificationHandler', notificationHandler);

/* Optional but helpful façade for legacy code */
export const showNotification = notificationHandler.show;
```
```
*Nothing else in this guide will touch `app.js`.*

---

## 2 Create a wafer-thin util wrapper (recommended)

```javascript
// static/js/utils/notify.js
export function createNotify({ notificationHandler }) {
  if (!notificationHandler?.show) throw new Error('notificationHandler missing');

  /* Centralised defaults ↓ */
  const DURATION = { info:4000, success:4000, warning:6000, error:0 };

  function send(msg, type='info', opts={}) {
    return notificationHandler.show(msg, type, DURATION[type], opts);
  }

  /* Sugar helpers  –  encourage grouping */
  return {
    info   : (msg, o={}) => send(msg,'info',   o),
    success: (msg, o={}) => send(msg,'success',o),
    warn   : (msg, o={}) => send(msg,'warning',o),
    error  : (msg, o={}) => send(msg,'error',  o),

    /* Common, opinionated buckets */
    apiError : (msg, o={}) => send(msg,'error',
                     { group:true, context:'apiRequest', ...o }),
    authWarn : (msg, o={}) => send(msg,'warning',
                     { group:true, context:'auth', ...o }),
  };
}
```

Register once, right after the handler:

```javascript
DependencySystem.register(
  'notify',
  createNotify({ notificationHandler })
);
```

---

## 3 Integrating any **new module**

Below is the canonical skeleton—use it for every factory you write.

```javascript
/**
 * createAwesomeFeature.js – DI-strict module
 */
export function createAwesomeFeature({
  apiClient,
  eventHandlers,
  notify,                  // <-- inject wrapper, *never* import directly
  DependencySystem,
}) {
  if (!notify) throw new Error('notify util required');

  /* Example public method */
  async function doSomethingCool(fileId) {
    notify.info('[Awesome] Uploading…', {
      group:true, context:'awesome', module:'upload',
    });

    try {
      const res = await apiClient.post(`/files/${fileId}/process`);
