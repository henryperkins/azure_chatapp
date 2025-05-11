# Diagnostic Report — Project List Sync Error
_Date logged: 2025-05-11 18:57:54 (UTC)_

---

## 1. Failure Description (Concise)
The Project List fails to finish its “projectsLoaded” sync cycle.  A JavaScript error bubbles up from the HTML-sanitisation routine, interrupting rendering and repeatedly triggering re-renders.

---

## 2. Fault Origin
* **Component:** `static/js/projectListComponent.js`
* **Primary Function:** `_safeSetInnerHTML (line ≈285)`
* **Supporting Library:** `DOMPurify` (`static/js/vendor/dompurify.es.js`, `_initDocument` @ 921)
* **Triggering Listener:** `trackListener` wrapper for “projectsLoaded” event.

---

## 3. Most Probable Root Cause
`DOMPurify.sanitize` throws inside `_initDocument`, indicating that the HTML string passed from `_safeSetInnerHTML` contains markup or characters that violate the configured DOMPurify policy (e.g., unexpected `<script>`/event handlers or malformed HTML).
**Evidence from stack trace:**
```
_initDocument → DOMPurify.sanitize
 ↳ _safeSetInnerHTML (projectListComponent.js:285)
```
Immediately followed by repeated `renderProjects → show` sequences, implying the error aborts rendering mid-stream, causing the component to re-emit “projectsLoaded” and retrigger itself.

---

## 4. Indicators of Cascading / Repetitive Calls
The tail of the trace shows:
```
renderProjects/show sequence repeats multiple times
```
This suggests a retry loop or event rebroadcast that amplifies the failure, potentially spamming the notification system and degrading performance.

---

## 5. Prioritised Corrective Actions

| Priority | Action | Justification |
|----------|--------|---------------|
| P0 | **Reproduce & sanitise input**: Log or snapshot the exact HTML passed to `_safeSetInnerHTML`; verify with DOMPurify’s `isValid` or try/catch to surface bad markup. | Identifies offending data; prevents hard crash. |
| P1 | **Harden `_safeSetInnerHTML`**: Wrap `DOMPurify.sanitize` in a try/catch; on failure, fall back to plain-text insertion and emit a single error notification. | Stops user-visible breakage and infinite loop. |
| P1 | **Guard render loop**: Debounce “projectsLoaded” or add a `hasRendered` flag to `renderProjects` to avoid repeated calls on failure. | Eliminates cascading performance hit. |
| P2 | **Review DOMPurify config**: Ensure allowed tag/attribute lists match incoming project data (e.g., `<span>` with data-attrs). | Prevents future sanitiser mismatches. |
| P3 | **Add unit tests** for project HTML sanitisation and render cycle limits. | Regression safety. |

---

## 6. Plain-Language Summary (Non-Technical)
While loading the list of projects, the system tries to clean (sanitize) each project’s description before showing it on screen.  One description contains unexpected formatting, so the cleaning tool crashes, and the list keeps trying—and failing—to reload.  Fixing the cleaning rules and adding a safety catch will stop the crash and keep the project list visible.
