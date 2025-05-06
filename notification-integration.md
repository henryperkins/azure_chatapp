To integrate the codebase so all modules and features properly utilize the notification system's powerful capabilities, follow these steps:

1. __Centralize Notification Dependency Injection:__

   - Always inject `notify` (created via `createNotify`) into each subsystem/module that may need notification functionality.
   - Do __not__ use direct imports of notification helpers or globals; follow the factory/DI patterns described in `.clinerules/custominstructions.md`.
   - Pass `notify` as part of the `deps` object when creating components, services, or event handlers.

2. __Use the Canonical Notification API:__

   - In every feature or module, issue notifications via the structured `notify` API:

     ```js
     // In your factory/component function:
     function someAction(deps) {
       // ... business logic ...
       deps.notify.info('Process started', { context: 'someFeature', module: 'SomeComponent', source: 'someAction' });
     }
     ```

   - For repeated calls in the same context, use `notify.withContext({ context, module, source })` to generate a helper with pre-filled metadata:

     ```js
     const featureNotify = notify.withContext({ context: 'projects', module: 'ProjectManager' });
     featureNotify.success('Project loaded');
     ```

3. __Respect Notification Grouping and Metadata:__

   - For grouped/traceable system events, always supply as much context as possible (`context`, `module`, `source`).
   - For error or API notifications, use `notify.apiError()` or add `{ group: true }` options so UI grouping and backend logging work as designed.

4. __Wrap APIs and Callbacks with Helpers:__

   - Use utilities from `notifications-helpers.js` (`wrapApi`, `safeInvoker`, `emitReady`) to wrap asynchronous code, callbacks, and lifecycle events:

     ```js
     import { wrapApi, safeInvoker, emitReady } from './utils/notifications-helpers';

     // Wrap API call
     await wrapApi(fetchProjects, { notify, errorReporter }, '/api/projects', {}, 'projectManager');

     // Emit initialization
     emitReady({ notify }, 'ProjectManager');
     ```

5. __Surface Domain Errors and User Feedback:__

   - For all error handling, issue notifications with precise context, and ensure errors are also captured by errorReporter/Sentry if available:

     ```js
     try {
       await criticalStep();
     } catch (err) {
       notify.error('Could not complete critical step', {
         group: true,
         context: 'projects',
         module: 'ProjectManager',
         source: 'criticalStep',
         extra: { reason: err?.message }
       });
       errorReporter?.capture(err, { module: 'ProjectManager', method: 'criticalStep' });
     }
     ```

6. __Remove Direct `console.log`/`alert` Usage:__

   - Replace any legacy `alert` or `console.log/info/warn/error` with proper notification calls, ensuring auditability and maintainability.

7.
Role Definition (each role has its own "Role Defition" system-instruction: Code, Architect, Ask, Debug and Orchestrator), Mode-Specific Custom Instructions (Optional), Custom Instructions for All Modes
