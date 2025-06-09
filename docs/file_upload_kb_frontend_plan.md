# File-Upload & Knowledge-Base – Front-End Remediation Road-Map (2025)

This document provides an implementation-ready, week-by-week plan for closing
all gaps and guard-rail violations in the **File Upload** and **Knowledge Base**
UI flow.  Each week lists tasks, concrete file targets, acceptance tests, and
roll-back considerations.

---

## Week 1  — Dependency-Injection Compliance & Foundations

### Objectives

1. Eradicate all illegal direct imports of internal modules (2025 guard-rail).
2. Ensure every KB-related factory is retrievable through
   `DependencySystem.modules.get()`.
3. Guarantee *deterministic cleanup* for knowledge-base modules.
4. Preserve existing ChatManager contract (no breaking changes in its selector usage, DI requirements or AppBus event expectations).
5. Ensure authentication flow is respected: components must disable or teardown when `appModule.state.isAuthenticated === false` and re-enable after login via **AuthBus** events.

### Task-table

| # | Work Item | Target Files | Notes |
|---|-----------|--------------|-------|
|1|**Register factories at boot**|`static/js/init/appInitializer.js`|Add `<DependencySystem>.register('KBManagerFactory', createKnowledgeBaseManager)` and same for search-handler. Only root modules may import factories directly.|
|2|**Refactor knowledgeBaseComponent**|`static/js/knowledgeBaseComponent.js`|Remove `import {createKnowledgeBaseManager/SearchHandler}` lines; replace with look-ups via `getDep('KBManagerFactory')`, `getDep('KBSearchHandlerFactory')`. Throw descriptive error if not present.|
|3|**Refactor FileUploadComponent (prep)**|`static/js/FileUploadComponent.js`|Audit for implicit global look-ups (logger auto-resolve); replace with explicit DI or remove hack. **Subscribe to `auth.AuthBus` → `authStateChanged`; disable inputs when logged out, re-enable on login. Also call `destroy()` on `navigationService.deactivateView` or `AppBus.currentProjectChanged`.**|
|4|**AuthBus integration – KnowledgeBaseComponent**|`static/js/knowledgeBaseComponent.js`|Listen to `auth.AuthBus` `authStateChanged`; destroy/hide KB UI when logged out, automatically re-initialize on login if project still selected. Also respond to `AppBus.currentProjectChanged`; close open modals via `modalManager.closeModal('*')`.|
|5|**navigationService lifecycle hooks**|`static/js/navigationService.js`, UI components|Emit `deactivateView` event; FileUploadComponent, KnowledgeBaseComponent, ChatManager, PollingService listen and call `destroy()`. Adds view-lifecycle coherence and prevents hidden listener leaks.|
|6|**Selector-constants hardening**|`static/js/utils/selectorConstants.js`|1) Convert maps to `Object.freeze` (immutable). 2) Remove duplicated strings – derive `ELEMENT_SELECTORS` groups from the canonical `SELECTORS` with a `pickKeys()` helper. 3) Normalise to ID-only (no leading `#`) and export `getSel(id)` utility. 4) Delete unused `createSelectorConstants()` stub or make it tree-shakeable. **Must include all selectors consumed by ChatManager & ChatUIEnhancements – run `grep -R \"#chat\"` to verify**.|
|7|**ChatManager regression audit**|`static/js/chat.js` (+ spec)|Create Jest smoke-test booting ChatManager with stubbed DependencySystem after selector/auth/navigation changes. Ensure `.initialize()` resolves, AppBus events emit, UI updates on `authStateChanged` & project switch.|
|8|**Robust cleanup**|`static/js/knowledgeBaseManager.js`|Add public `cleanup()` that clears timers via `browserService.clearInterval`, cleans listeners, closes modals. Triggered by view deactivation & project change.|
|9|**Unit tests**|`tests/frontend/di-contracts.test.js`, `tests/frontend/selector-constants.test.js`, `tests/frontend/chatmanager-regression.test.js`, `tests/frontend/auth-compliance.test.js`, `tests/frontend/view-lifecycle-leak.test.js`|• DI-contract tests. <br>• Selector-constants integrity. <br>• ChatManager regression. <br>• Auth compliance. <br>• View lifecycle/leak test asserts listener & timer cleanup after navigation.|

### Acceptance Criteria

* `npm run lint` shows **zero** violations of
  “no-imports-outside-bootstrap” custom ESLint rule.
* Jest DI-contract tests green.
* Selector-constants test proves immutability & referential integrity.
* ChatManager regression test passes (initialisation, AppBus & auth interaction unchanged).
* Auth compliance test passes – UI components disable on logout and recover on login.
* Memory profiler shows no stray listeners after `.destroy()`.

### Roll-back Plan

* All edits are additive; revert single PR if smoke tests fail.

---

## Week 2  — Upload-to-KB Toggle & Base Telemetry

### Objectives

1. Give users control over whether an uploaded file is indexed.
2. Plumb `index_kb` flag front-to-back.
3. Start normalising module-scope logging contexts.
4. Provide telemetry & events required by **ChatManager** for dynamic KB awareness.

### Task-table

| # | Work Item | Target Files | Notes |
|---|-----------|--------------|-------|
|1|**UI control**|`static/html/file-upload-component.html`|Insert checkbox + label *“Index in Knowledge Base”* (checked by default). Assign id `indexKbCheckbox`.|
|2|**Component wiring**|`static/js/FileUploadComponent.js`|Capture new element, pass `index_kb` boolean to projectManager via upload options. **On successful batch upload emit `AppBus.dispatchEvent('knowledgebase:filesUploaded', {count})` so ChatManager (and other listeners) can react.**|
|3|**projectManager signature**|`static/js/projectManager.js`|Change `uploadFileWithRetry(projectId, {file}, …)` → `{ file, index_kb=true }`; append value to `FormData` as string. **On server-acknowledged enqueue fire `AppBus.dispatchEvent('knowledgebase:fileQueued',{jobId, fileName})`**|
|4|**Back-end contract sanity (FastAPI)**|`routes/projects/files.py` (handled by separate backend sprint) – ensure `index_kb` read from form-data as bool.|
|5|**Filename UX / ARIA**|`static/js/FileUploadComponent.js`|• Tooltip via `setCustomValidity` for illegal names. <br>• `dragZone` gains `role`, `tabindex`, `aria-busy`.|
|6|**Smoke tests**|`tests/frontend/upload-toggle.test.js`|Simulate upload with checkbox off ➜ expect request body `index_kb" : "false"` via fetch-mock.|

### Acceptance Criteria

* File uploads with toggle **off** are stored but **not** queued for KB
  processing (validated by backend integration test).
* Accessibility scan shows no new issues (axe-core zero violations for
  drag-zone element).
* `knowledgebase:filesUploaded` and `knowledgebase:fileQueued` events observed on `AppBus` after uploads.
* ChatManager continues to allow/deny Send based solely on auth state – verified by auth-compliance test.

---

## Week 3  — Observability & KB Health UX

### Objectives

1. Provide real-time feedback for background file-processing jobs.
2. Expose Knowledge-Base readiness to end-users.
3. Emit structured AppBus analytics.

### Task-table

| # | Work Item | Target Files | Notes |
|---|-----------|--------------|-------|
|1|**PollingService factory**|`static/js/pollingService.js` (*new*)|DI factory: `startJob(jobId)`, `stopJob(jobId)`, emits EventTarget `update` {status, progress}.|
|2|**DI registration**|`appInitializer.js`|`DependencySystem.register('PollingServiceFactory', createPollingService)`.
|3|**KnowledgeBaseReadinessService registration**|`appInitializer.js` (*new*)|Register `createKnowledgeBaseReadinessService` so headerBar and ChatManager can inject it.|
|4|**Header badge logout handling**|`static/js/headerBar.js`|Subscribe to `auth.AuthBus` and hide `kbHealthBadge` on logout to prevent stale state.|
|5|**FileUploadComponent integration**|`static/js/FileUploadComponent.js`|After successful upload, read `job_id` from server response (API already returns). Start polling; update per-file UI badges.|
|6|**UI elements**|`file-upload-component.html`|Add small spinner / status badge placeholder next to each file row.|
|7|**KB health badge**|`static/html/header.html` and `static/js/headerBar.js`|Add hidden `<span id="kbHealthBadge" class="badge badge-xs hidden"></span>`; update via KnowledgeBaseReadinessService when AppBus `currentProjectChanged` fires; hide badge on logout.|
|8|**ChatManager KB-sync**|`static/js/chat.js`|Subscribe to new events `knowledgebase:filesUploaded` & `knowledgebase:ready`; on receipt, refresh suggestions / disable send when KB busy.|
|9|**Analytics events**|`knowledgeBaseSearchHandler.js`, `knowledgeBaseManager.js`|`AppBus.dispatchEvent('knowledgebase:search', {query,…})`, similar for `fileDelete`.|
|10|**Tests**|`tests/frontend/kb-health-badge.test.js`, `tests/frontend/chatmanager-kb-sync.test.js`|• Mock readiness endpoint; expect badge class change.<br>• Verify ChatManager receives `knowledgebase:filesUploaded` and calls `refreshKnowledgeContext()` (spy). |

### Acceptance Criteria

* Within 10 seconds of successful indexing job completion the per-file badge
  turns green without manual page refresh.
* Badge in header turns red when health endpoint returns unavailable.
* AppBus events appear in analytics spy.
* ChatManager receives KB events and updates its UI/state without error (verified by chatmanager-kb-sync test).
* Header badge hides on logout and re-appears on login.

---

## Week 4  — Security, ESLint, Polish *(optional / buffer)*

### Objectives

1. Harden code further and bake rules into CI.

### Tasks

* Add custom ESLint rule `module-tag-match` – enforces identical string for
  `MODULE` and logger contexts.
* Add custom ESLint rule `no-raw-selectors` – forbids hard-coding `#fooBar` strings outside `selectorConstants.js` (enforced via regex or AST rule).
* Add `eslint-plugin-security` & `eslint-plugin-jsx-a11y` to `.eslintrc` &
  pre-commit.
* Audit new PollingService for memory leaks; ensure `.cleanup()` stops timers.
* Add Jest "listener-leak" test harness (shared util) for future modules; fails build if `eventHandlers.getActiveListenerCount()` > 0 after cleanup.

---

## Global Timeline

| Week | Theme | PRs | Review Owner |
|------|-------|-----|--------------|
|1|DI compliance|#1234|Core Frontend Lead|
|2|Toggle & ARIA|#1240|UX Engineer|
|3|Observability|#1248, #1250|Platform Team|
|4|Polish / Buffer|#–|–|

---

### Risk Register & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
|Checkbox flag not honoured by legacy API version|Files silently un-indexed|Feature flag `FILE_UPLOAD_KB_TOGGLE` guards new logic; default on only when API ≥ v2 detected|
|PollingService leaks timers|Memory bloat on long sessions|Expose `cleanup()`; KnowledgeBaseComponent & FileUploadComponent call it on page change / destroy|
|Badge causes layout shift|Minor UX|Reserve badge space with invisible element from start|
|ChatManager not updated for new KB events|Contextual answers stale / console errors|Include regression tests; all KB-related events have versioned payload schema; maintain backward compatibility for at least one minor release|
|AuthBus events missed by components|Users see stale UI or JS errors after logout/login|Auth-compliance unit tests; central listener tracker ensures each module cleans up on logout; acceptance criteria enforce behaviour|
|Missing CSRF token on uploads|Server rejects requests|Ensure `apiRequest` automatically attaches CSRF header; add integration test for upload route.|
|Role-gated KB upload|Unauthorized users can trigger indexing or see hidden UI|Backend confirms permissions; FileUploadComponent hides upload/index controls based on `appModule.state.userRole`; add Cypress E2E test.|

---

### Done-Definition (per sprint)

* All acceptance criteria satisfied.
* Unit / integration tests written & passed.
* Pre-commit & CI pipelines green.
* Changelog entry added under **Enhancements**.
