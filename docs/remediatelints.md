
(venv) azureuser@hpcvm:~/azure_chatapp$ node scripts/patternChecker.cjs static/js/utils/*
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                    🛡️ Frontend Guardrails: apiClient.js                     │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

Summary
┌────────────────────────────────────────────────────┼────────────┐
│ Guardrail                                          │ Violations │
├────────────────────────────────────────────────────┼────────────┤
│ Context-Rich Error Logging                         │ 1          │
│ App Readiness                                      │ 1          │
│ Notifier Factories                                 │ 5          │
└────────────────────────────────────────────────────┼────────────┘

Detailed Violations

🔒 Context-Rich Error Logging
Capture errors with `errorReporter.capture(err, { module, method, … })`, never leaking tokens or PII.

Line 104: } catch (err) {
✖ Violation: No errorReporter.capture found in catch block with required context.
💡 Pattern:
   Example:
   try {
     // ...
   } catch (err) {
     errorReporter.capture(err, {
       module: 'MyModule',
       source: 'myFunction',
       originalError: err
     });
   }

🔒 App Readiness
Wait for `DependencySystem.waitFor([...])` *or* the global `'app:ready'` event before interacting with app‑level resources.

Line 1: /**
✖ Violation: No readiness gate detected before DOM / app access.
💡 Pattern:
   Wrap main logic in DependencySystem.waitFor([...]) or app:ready.

🔒 Notifier Factories
Create module‑scoped notifiers with `notify.withContext({ module, context })`. Always include module, context, and source properties in notifications.

Line 1: /**
✖ Violation: Multiple notify calls
💡 Pattern:
   Example:
   // Create once at module level
   const moduleNotify = notify.withContext({ module: 'MyModule', context: 'operations' });

   // Then use throughout the module
   moduleNotify.info('Operation started');
   moduleNotify.success('Operation completed');

Found 4 violations of rule: contextual-notifier-factories
Line 85: if (APP_CONFIG.DEBUG) notify.debug(`[API] Dedup hit: ${key}`);
✖ Violation: notify calls should include metadata object with module and context properties.
💡 Pattern:
   Example: notify.info('Message', { module: 'MyModule', context: 'myFunction', source: 'functionName' });

Line 95: else if (APP_CONFIG.DEBUG) notify.warn(`[API] No CSRF for ${method} ${normUrl}`);
✖ Violation: notify calls should include metadata object with module and context properties.

Line 144: notify.debug("[AUTH DEBUG] /api/auth/verify response", { extra: body });
✖ Violation: notify calls should include both module and context properties.

Line 145: notify.debug("[AUTH DEBUG] /api/auth/verify headers",  { extra: headersObj });
✖ Violation: notify calls should include both module and context properties.

┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                  🛡️ Frontend Guardrails: browserService.js                  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

Summary
┌────────────────────────────────────────────────────┼────────────┐
│ Guardrail                                          │ Violations │
├────────────────────────────────────────────────────┼────────────┤
│ App Readiness                                      │ 1          │
└────────────────────────────────────────────────────┼────────────┘

Detailed Violations

🔒 App Readiness
Wait for `DependencySystem.waitFor([...])` *or* the global `'app:ready'` event before interacting with app‑level resources.

Line 1: /**
✖ Violation: No readiness gate detected before DOM / app access.
💡 Pattern:
   Wrap main logic in DependencySystem.waitFor([...]) or app:ready.

┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                      🛡️ Frontend Guardrails: domAPI.js                      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

Summary
┌────────────────────────────────────────────────────┼────────────┐
│ Guardrail                                          │ Violations │
├────────────────────────────────────────────────────┼────────────┤
│ Sanitize All User HTML                             │ 1          │
│ App Readiness                                      │ 1          │
└────────────────────────────────────────────────────┼────────────┘

Detailed Violations

🔒 Sanitize All User HTML
Always call `sanitizer.sanitize()` before inserting user content into the DOM.

Line 127: el.innerHTML = html;
✖ Violation: Setting .innerHTML without sanitizer.sanitize
💡 Pattern:
   Example:
   const safeHtml = sanitizer.sanitize(userHtml);
   el.innerHTML = safeHtml;

🔒 App Readiness
Wait for `DependencySystem.waitFor([...])` *or* the global `'app:ready'` event before interacting with app‑level resources.

Line 1: /**
✖ Violation: No readiness gate detected before DOM / app access.
💡 Pattern:
   Wrap main logic in DependencySystem.waitFor([...]) or app:ready.

┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                   🛡️ Frontend Guardrails: globalUtils.js                    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

Summary
┌────────────────────────────────────────────────────┼────────────┐
│ Guardrail                                          │ Violations │
├────────────────────────────────────────────────────┼────────────┤
│ Strict Dependency Injection                        │ 3          │
│ Context-Rich Error Logging                         │ 5          │
│ Sanitize All User HTML                             │ 1          │
│ App Readiness                                      │ 1          │
│ Notifier Factories                                 │ 5          │
└────────────────────────────────────────────────────┼────────────┘

Detailed Violations

🔒 Strict Dependency Injection
Do **not** access `window`, `document`, `console`, or any global directly. Interact with the DOM and utilities only through injected abstractions.

Found 3 violations of rule: strict-dependency-injection
Line 95: const el = document.createElement(tag);
✖ Violation: Use injected dependencies instead of document.
💡 Pattern:
   Example:
   const el = domAPI.getElementById('something');

Line 134: document.querySelectorAll(selOrEl).forEach((el) => el.classList.toggle("hidden", !show));
✖ Violation: Use injected dependencies instead of document.

Line 185: DependencySystem = window.DependencySystem,
✖ Violation: Use injected dependencies instead of window.

🔒 Context-Rich Error Logging
Capture errors with `errorReporter.capture(err, { module, method, … })`, never leaking tokens or PII.

Found 5 violations of rule: error-handling--context-rich-logging
Line 88: } catch {
✖ Violation: No errorReporter.capture found in catch block with required context.
💡 Pattern:
   Example:
   try {
     // ...
   } catch (err) {
     errorReporter.capture(err, {
       module: 'MyModule',
       source: 'myFunction',
       originalError: err
     });
   }

Line 138: } catch (e) {
✖ Violation: No errorReporter.capture found in catch block with required context.

Line 149: } catch {
✖ Violation: No errorReporter.capture found in catch block with required context.

Line 222: } catch (err) {
✖ Violation: No errorReporter.capture found in catch block with required context.

Line 242: } catch (err) {
✖ Violation: No errorReporter.capture found in catch block with required context.

🔒 Sanitize All User HTML
Always call `sanitizer.sanitize()` before inserting user content into the DOM.

Line 99: if ("innerHTML" in opts) el.innerHTML = opts.innerHTML;
✖ Violation: Setting .innerHTML without sanitizer.sanitize
💡 Pattern:
   Example:
   const safeHtml = sanitizer.sanitize(userHtml);
   el.innerHTML = safeHtml;

🔒 App Readiness
Wait for `DependencySystem.waitFor([...])` *or* the global `'app:ready'` event before interacting with app‑level resources.

Line 1: /* ---------------------------------------------------------------------------
✖ Violation: No readiness gate detected before DOM / app access.
💡 Pattern:
   Wrap main logic in DependencySystem.waitFor([...]) or app:ready.

🔒 Notifier Factories
Create module‑scoped notifiers with `notify.withContext({ module, context })`. Always include module, context, and source properties in notifications.

Line 1: /* ---------------------------------------------------------------------------
✖ Violation: Multiple notify calls
💡 Pattern:
   Example:
   // Create once at module level
   const moduleNotify = notify.withContext({ module: 'MyModule', context: 'operations' });

   // Then use throughout the module
   moduleNotify.info('Operation started');
   moduleNotify.success('Operation completed');

Found 4 violations of rule: contextual-notifier-factories
Line 194: notify.error("waitForDepsAndDom: DependencySystem missing", { source, critical: true });
✖ Violation: notify calls should include both module and context properties.
💡 Pattern:
   Example: notify.info('Message', { module: 'MyModule', context: 'myFunction', source: 'functionName' });

Line 198: notify.error("waitForDepsAndDom: DependencySystem.modules is missing or invalid", { source, critical: true });
✖ Violation: notify calls should include both module and context properties.

Line 202: notify.error('waitForDepsAndDom: domAPI.querySelector is required (no global fallback)', { source, critical: true });
✖ Violation: notify calls should include both module and context properties.

Line 219: notify.error(errorMsg, { source, timeout, missingDeps, missingDom });
✖ Violation: notify calls should include both module and context properties.

┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                🛡️ Frontend Guardrails: htmlTemplateLoader.js                │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

Summary
┌────────────────────────────────────────────────────┼────────────┐
│ Guardrail                                          │ Violations │
├────────────────────────────────────────────────────┼────────────┤
│ Sanitize All User HTML                             │ 1          │
│ App Readiness                                      │ 1          │
│ Single API Client                                  │ 1          │
└────────────────────────────────────────────────────┼────────────┘

Detailed Violations

🔒 Sanitize All User HTML
Always call `sanitizer.sanitize()` before inserting user content into the DOM.

Line 69: container.innerHTML = html;
✖ Violation: Setting .innerHTML without sanitizer.sanitize
💡 Pattern:
   Example:
   const safeHtml = sanitizer.sanitize(userHtml);
   el.innerHTML = safeHtml;

🔒 App Readiness
Wait for `DependencySystem.waitFor([...])` *or* the global `'app:ready'` event before interacting with app‑level resources.

Line 1: /**
✖ Violation: No readiness gate detected before DOM / app access.
💡 Pattern:
   Wrap main logic in DependencySystem.waitFor([...]) or app:ready.

🔒 Single API Client
Make every network request through `apiClient`; centralize headers, CSRF, and error handling.

Line 57: const resp = await fetch(url, { cache: 'no-store', signal: controller.signal });
✖ Violation: Use apiClient instead of direct fetch calls.
💡 Pattern:
   Example: apiClient.post('/api/data', payload).then(handleResponse);

┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│              🛡️ Frontend Guardrails: notifications-helpers.js               │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

Summary
┌────────────────────────────────────────────────────┼────────────┐
│ Guardrail                                          │ Violations │
├────────────────────────────────────────────────────┼────────────┤
│ Context-Rich Error Logging                         │ 3          │
│ App Readiness                                      │ 1          │
└────────────────────────────────────────────────────┼────────────┘

Detailed Violations

🔒 Context-Rich Error Logging
Capture errors with `errorReporter.capture(err, { module, method, … })`, never leaking tokens or PII.

Found 3 violations of rule: error-handling--context-rich-logging
Line 111: } catch (captureErr) {
✖ Violation: No errorReporter.capture found in catch block with required context.
💡 Pattern:
   Example:
   try {
     // ...
   } catch (err) {
     errorReporter.capture(err, {
       module: 'MyModule',
       source: 'myFunction',
       originalError: err
     });
   }

Line 135: } catch (err) {
✖ Violation: No errorReporter.capture found in catch block with required context.

Line 162: } catch (err) {
✖ Violation: No errorReporter.capture found in catch block with required context.

🔒 App Readiness
Wait for `DependencySystem.waitFor([...])` *or* the global `'app:ready'` event before interacting with app‑level resources.

Line 1: // static/js/utils/notifications-helpers.js
✖ Violation: No readiness gate detected before DOM / app access.
💡 Pattern:
   Wrap main logic in DependencySystem.waitFor([...]) or app:ready.

┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                      🛡️ Frontend Guardrails: notify.js                      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

Summary
┌────────────────────────────────────────────────────┼────────────┐
│ Guardrail                                          │ Violations │
├────────────────────────────────────────────────────┼────────────┤
│ App Readiness                                      │ 1          │
└────────────────────────────────────────────────────┼────────────┘

Detailed Violations

🔒 App Readiness
Wait for `DependencySystem.waitFor([...])` *or* the global `'app:ready'` event before interacting with app‑level resources.

Line 1: import { getSessionId } from "./session.js";
✖ Violation: No readiness gate detected before DOM / app access.
💡 Pattern:
   Wrap main logic in DependencySystem.waitFor([...]) or app:ready.

┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                  🛡️ Frontend Guardrails: remediatelints.md                  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

Summary
┌────────────────────────────────────────────────────┼────────────┐
│ Guardrail                                          │ Violations │
├────────────────────────────────────────────────────┼────────────┤
│ Other Issues                                       │ 1          │
└────────────────────────────────────────────────────┼────────────┘

Detailed Violations

🔒 Other Issues
Other issues not directly related to the 17 guardrails.

Line undefined: undefined
✖ Violation: Failed to parse file: Missing semicolon.

┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                     🛡️ Frontend Guardrails: session.js                      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

Summary
┌────────────────────────────────────────────────────┼────────────┐
│ Guardrail                                          │ Violations │
├────────────────────────────────────────────────────┼────────────┤
│ Factory Function Export                            │ 1          │
│ Strict Dependency Injection                        │ 3          │
│ App Readiness                                      │ 1          │
└────────────────────────────────────────────────────┼────────────┘

Detailed Violations

🔒 Factory Function Export
Export each module through a named factory (`createXyz`). Validate all dependencies at the top and expose a cleanup API. *No top‑level logic.*

Line 1: /**
✖ Violation: Missing "export function createXYZ
💡 Pattern:
   Example:

   export function createProjectManager(deps) {
     if (!deps.DependencySystem) throw new Error('DependencySystem required');
     return new ProjectManager(deps);
   }

🔒 Strict Dependency Injection
Do **not** access `window`, `document`, `console`, or any global directly. Interact with the DOM and utilities only through injected abstractions.

Found 3 violations of rule: strict-dependency-injection
Line 8: if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
✖ Violation: Use injected dependencies instead of window.
💡 Pattern:
   Example:
   const el = domAPI.getElementById('something');

Line 8: if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
✖ Violation: Use injected dependencies instead of window.

Line 8: if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
✖ Violation: Use injected dependencies instead of window.

🔒 App Readiness
Wait for `DependencySystem.waitFor([...])` *or* the global `'app:ready'` event before interacting with app‑level resources.

Line 1: /**
✖ Violation: No readiness gate detected before DOM / app access.
💡 Pattern:
   Wrap main logic in DependencySystem.waitFor([...]) or app:ready.

┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                  🛡️ Frontend Guardrails: storageService.js                  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

Summary
┌────────────────────────────────────────────────────┼────────────┐
│ Guardrail                                          │ Violations │
├────────────────────────────────────────────────────┼────────────┤
│ Factory Function Export                            │ 1          │
│ Context-Rich Error Logging                         │ 1          │
│ App Readiness                                      │ 1          │
│ Notifier Factories                                 │ 1          │
└────────────────────────────────────────────────────┼────────────┘

Detailed Violations

🔒 Factory Function Export
Export each module through a named factory (`createXyz`). Validate all dependencies at the top and expose a cleanup API. *No top‑level logic.*

Line 10: export function createStorageService({ browserService, APP_CONFIG, notify }) {
✖ Violation: Factory function "createStorageService" should typically return a new instance
💡 Pattern:
   Example: return new MyModule(deps);

🔒 Context-Rich Error Logging
Capture errors with `errorReporter.capture(err, { module, method, … })`, never leaking tokens or PII.

Line 14: } catch (err) {
✖ Violation: No errorReporter.capture found in catch block with required context.
💡 Pattern:
   Example:
   try {
     // ...
   } catch (err) {
     errorReporter.capture(err, {
       module: 'MyModule',
       source: 'myFunction',
       originalError: err
     });
   }

🔒 App Readiness
Wait for `DependencySystem.waitFor([...])` *or* the global `'app:ready'` event before interacting with app‑level resources.

Line 1: /**
✖ Violation: No readiness gate detected before DOM / app access.
💡 Pattern:
   Wrap main logic in DependencySystem.waitFor([...]) or app:ready.

🔒 Notifier Factories
Create module‑scoped notifiers with `notify.withContext({ module, context })`. Always include module, context, and source properties in notifications.

Line 16: notify.warn(`[storageService] ${ctx} failed`, { err });
✖ Violation: notify calls should include both module and context properties.
💡 Pattern:
   Example: notify.info('Message', { module: 'MyModule', context: 'myFunction', source: 'functionName' });

┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│            🚨 Found 43 guardrail violation(s) across 10 file(s)!             │
│                                                                              │
