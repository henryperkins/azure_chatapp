Below is a **single, comprehensive reference document** that merges the complete [Notification System: Architecture, Usage, and Best Practices](#) guide with the **Integration & Migration: Dependency Injection Playbook**. This unified doc illustrates:

1. How the notification system works (types, grouping, styling, context, logs).
2. How to integrate and migrate modules using strictly injected dependencies.
3. Best practices for consistent usage and observability.

By following this guide, teams ensure both **notification** and **dependency injection** patterns remain unified across the application—with robust cross-layer tracing.

---

# Azure Chat App Notification System & DI Playbook

---

## Table of Contents

1. [Overview](#overview)
2. [Contextual Notification Payload, Grouping & Logging](#contextual-notification-payload-grouping--logging)
3. [Banner Display Types](#banner-display-types)
4. [Styling, Animation, and Theming](#styling-animation-and-theming)
5. [Notification API Usage](#notification-api-usage)
6. [Grouping Rules and Contexts](#grouping-rules-and-contexts)
7. [Accessibility and Responsiveness](#accessibility-and-responsiveness)
8. [Best Practices](#best-practices)
9. [Reference: Customization and CSS](#reference-customization-and-css)
10. [Notification Logging, Backend & Sentry Integration](#notification-logging-backend--sentry-integration)
11. [DI Playbook & Migration](#di-playbook--migration)

---

## 1. Overview

The notification system provides robust, accessible, theme-aware banners for feedback, error handling, and status across desktop and mobile in Azure Chat Application.

- **Consistent UI** for all modules (info/warning/error/success)
- Animation/grouping, context, and module-level scoping
- Theme (light/dark) and responsive support
- Accessibility (ARIA, keyboard)
- One-click copy of all notifications and group metadata
- DI + Sentry integration for E2E traceability
- **Context-rich logging to backend and Sentry**

---

## 2. Contextual Notification Payload, Grouping & Logging (2025-05 upgrade)

All notifications—UI and log—now accept a canonical, structured payload for correlation, deduplication, log search, and distributed tracing.

**Canonical Notification Payload (frontend & backend):**
```jsonc
{
  "id": "error|UserProfileService|getUserProfile|...:1714851230.231",
  "message": "Failed to fetch user profile data.",
  "type": "error",
  "timestamp": 1714851230.231,
  "user": "john.doe",
  "groupKey": "error|UserProfileService|getUserProfile|fetchProfile",
  "context": "fetchProfile",
  "module": "UserProfileService",
  "source": "getUserProfile",
  "traceId": "3de2e8890c737762c19ea119e882b6b2",
  "transactionId": "a89b4f03-5cd8-4a3e-bdf9-65d9a7f9872e",
  "extra": { "apiUri": "/user/profile", "attempt": 3 }
}
```
- **id**: Unique or deterministic for dedup/tracing
- **groupKey**: `type|module|source|context` (matches UI, logs, Sentry)
- **traceId/transactionId**: For distributed trace E2E
- **context/module/source**: For precise grouping/investigation
- **extra**: Any free-form metadata

**DI Requirement:**
- All modules and utilities must use DI for notification utilities, Sentry, and context/session information.

---

## 3. Banner Display Types

- **Single Notifications**: Icon, message, dismiss/copy, color-coded.
- **Grouped (Accordion) Notifications**: Summary row + count, copy-all, expand to see message list + group metadata, copy metadata.

---

## 4. Styling, Animation, and Theming

- DaisyUI/Tailwind theme tokens in enhanced-components.css
- Accent borders, responsive sizing, accessible controls

---

## 5. Notification API Usage

**Examples:**
```js
// Info banner (one-off)
notify.info('User saved.', { timeout: 4000 });

// Error, grouped for upload (context/module/source/traceId preferred)
notify.error('Failed to upload file', {
  context: 'file-upload',
  module: 'FileUploadComponent',
  source: 'handleUpload',
  traceId: currentTraceId,
  transactionId: DependencySystem.generateTransactionId(),
  extra: { fileName: 'x.docx', reason: 'quota' }
});
```

**Grouping Controls:**
- Use `group: true`/`group: false` to force grouped/individual display.
- All grouping now uses deterministic groupKey for consistency.

---

## 6. Grouping Rules and Contexts

- **groupKey** (preferred): Use all of type, module, source, and context if possible.
- **Legacy fallback**: If not set, UI infers key as in previous versions.

---

## 7. Accessibility and Responsiveness

- Proper ARIA roles.
- Tab-indexed buttons, visible focus.
- Copy-all and "Copy Group Metadata" button in accordion details.

---

## 8. Best Practices

- Always supply as much context (module/source/context) as possible.
- Use deterministic groupKey helpers/utils (see `createNotify`).
- Propagate transactionId/traceId through API requests, responses, and logs.
- Always inject dependencies (no globals).
- Use copyable group metadata for help tickets or Sentry searches.

---

## 9. Reference: Customization and CSS

- Styles: `enhanced-components.css`
- Button classes for single and group banners.
- Animation via Tailwind utilities.

---

## 10. Notification Logging, Backend & Sentry Integration

- **Every notification** is POSTed to `/api/log_notification`, where a structured log entry is written with all context fields.
- **Sentry Mirroring**: All log events mirrored as Sentry breadcrumbs; errors/warnings as Sentry events.
- **Distributed Trace IDs**: Automatically extracted and attached via FastAPI and Sentry utilities.

**Example log entry (text file):**
```
2025-05-05T12:34:50.125Z [ERROR] user=jane (id=a89... groupKey=error|FileUploadComponent|handleUpload traceId=3de2... transactionId=a89b... context=file-upload module=FileUploadComponent source=handleUpload) Failed to upload file: quota exceeded
```

---

## 11. DI Playbook & Migration

See prior playbook for complete factory/module examples, pattern for injecting notify/Sentry/context, and guidelines for strict cleanup and testability.

---

**Summary:**
The notification system is now a fully context-rich, end-to-end observable architecture, supporting deterministic grouping, distributed tracing, backend/Sentry mirroring, and strict DI for maintainability and test coverage.
