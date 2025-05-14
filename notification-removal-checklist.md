# Module-by-Module Notification Removal Checklist

Follow this checklist for each JavaScript module to systematically remove all notification, logging, debugging, and error reporting code while preserving business logic.

## 1. Imports and Requires
- [ ] Remove imports from notification modules:
  ```javascript
  // Remove these imports
  import { createNotify } from './utils/notify.js';
  import { createNotificationHandler } from './notification-handler.js';
  import { createDebugTools, maybeCapture, safeInvoker, wrapApi, logEventToServer } from './utils/notifications-helpers.js';
  import { createBackendLogger } from './utils/backendLogger.js';
  import { createSentryManager } from './sentry-init.js';
  ```
- [ ] Remove any other imports that exclusively reference notification utilities

## 2. Factory Function Parameters
- [ ] Remove notification parameters from factory functions:
  ```javascript
  // BEFORE
  export function createSomeModule({
    domAPI,
    notify,              // REMOVE
    notificationHandler, // REMOVE
    errorReporter,       // REMOVE
    backendLogger,       // REMOVE
    debugTools,          // REMOVE
    /* other params */
  }) {
    // Module body
  }

  // AFTER
  export function createSomeModule({
    domAPI,
    /* other params */
  }) {
    // Module body
  }
  ```

## 3. Dependency Validation
- [ ] Remove notification dependency validation:
  ```javascript
  // Remove dependency validation like:
  if (!notify) throw new Error('notify is required');
  if (!errorReporter) throw new Error('errorReporter is required');
  ```

## 4. Contextual Notifiers
- [ ] Remove creation of contextual notifiers:
  ```javascript
  // Remove lines like:
  const moduleNotify = notify.withContext({ module: 'SomeModule', context: 'core' });
  const errorNotify = notify.withContext({ module: 'SomeModule', context: 'errors' });
  ```

## 5. Notification Calls
- [ ] Remove all notify calls:
  ```javascript
  // Remove all calls like:
  notify.info('Something happened');
  notify.success('Operation completed', { source: 'function' });
  notify.error('Operation failed', { originalError: err });
  notify.debug('Debug info', { extra: data });
  notify.warn('Warning message');

  // Also remove contextual notify calls:
  moduleNotify.info('Module initialized');
  errorNotify.error('Error occurred', { source: 'function' });

  // Remove specialized notify calls:
  notify.apiError('API failed', { endpoint: '/api/data' });
  notify.authWarn('Authentication warning');
  ```

## 6. Error Reporting
- [ ] Remove error reporter calls:
  ```javascript
  // Remove calls like:
  errorReporter.capture(err, { module: 'SomeModule', method: 'someFunction' });
  maybeCapture(errorReporter, err, { context: 'operation' });
  ```

## 7. Backend Logging
- [ ] Remove backend logger calls:
  ```javascript
  // Remove calls like:
  backendLogger.log({ level: 'info', module: 'SomeModule', message: 'Event occurred' });
  backendLogger.logBatch(logEntries);
  ```

## 8. Debug Tools
- [ ] Remove debug/trace tool usage:
  ```javascript
  // Remove calls like:
  const _trace = debugTools.start('operation');
  debugTools.stop(_trace, 'operation');
  ```

## 9. Try/Catch Simplification
- [ ] Simplify try/catch blocks that only exist for logging:
  ```javascript
  // BEFORE
  try {
    // Business logic
    notify.info('Operation completed');
  } catch (err) {
    notify.error('Operation failed', { originalError: err });
    errorReporter.capture(err, { method: 'doSomething' });
    throw err; // If business logic needs the error re-thrown
  }

  // AFTER - if error handling is needed:
  try {
    // Business logic
  } catch (err) {
    throw err; // Only keep if business logic needs it
  }

  // OR - if try/catch only existed for logging:
  // Business logic without try/catch
  ```

## 10. API Wrappers
- [ ] Replace notification-aware API wrappers:
  ```javascript
  // BEFORE
  const result = await wrapApi(
    apiClient.get,
    { notify, errorReporter },
    '/api/data'
  );

  // AFTER
  const result = await apiClient.get('/api/data');
  ```

## 11. Safe Handlers
- [ ] Replace notification-aware event handlers:
  ```javascript
  // BEFORE
  const safeHandler = safeInvoker(
    originalHandler,
    { notify, errorReporter },
    { module: 'Module', context: 'handler' }
  );
  element.addEventListener('click', safeHandler);

  // AFTER
  element.addEventListener('click', originalHandler);
  ```

## 12. Dependency System Registration/Waiting
- [ ] Remove notification dependencies from DependencySystem:
  ```javascript
  // Remove registrations:
  DependencySystem.register('notify', notify);
  DependencySystem.register('notificationHandler', notificationHandler);
  DependencySystem.register('errorReporter', errorReporter);
  DependencySystem.register('backendLogger', backendLogger);
  DependencySystem.register('debugTools', debugTools);

  // Remove from waitFor calls:
  await DependencySystem.waitFor(['auth', 'notify', 'errorReporter']);
  // Change to:
  await DependencySystem.waitFor(['auth']);
  ```

## 13. Inline Console Fallbacks
- [ ] Remove any console fallbacks that were for notification systems:
  ```javascript
  // Remove fallbacks like:
  notify = notify || {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error
  };
  ```

## 14. Event Listeners
- [ ] Remove any event listeners that only exist for logging/reporting:
  ```javascript
  // Remove any event listeners that only log events:
  eventHandlers.trackListener(
    document,
    'appEvent',
    (e) => notify.info('App event occurred', { event: e }),
    { context: 'logging' }
  );
  ```

## 15. Context/Cleanup References
- [ ] Remove any references to notification contexts:
  ```javascript
  // Remove code like:
  eventHandlers.cleanupListeners({ context: 'notifications' });
  ```

## 16. Optional Clean-up
- [ ] If a module becomes empty or trivial after removing notification code, consider if it should be removed entirely
- [ ] If a parameter is passed only for notification and is no longer used anywhere, remove it from all call sites

## Final Verification
- [ ] Ensure all business logic continues to work properly
- [ ] Verify all UI elements display and function correctly
- [ ] Check for any remaining references to removed notification systems
