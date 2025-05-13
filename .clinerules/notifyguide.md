# Notification System Usage Guide

The application uses a comprehensive notification system for user feedback and logging. Follow these guidelines for proper usage:

## 1. Notification Creation

**Always use the injected `notify` utility:**
```javascript
// Basic usage
notify.info('Operation completed');
notify.success('Item saved successfully');
notify.warn('Connection unstable');
notify.error('Failed to load data');

// With metadata (preferred)
notify.info('Operation completed', {
  module: 'MyModule',
  context: 'saveOperation',
  source: 'saveHandler'
});
```

## 2. Contextual Notifiers (Recommended)

**Create module-scoped notifiers with `withContext`:**
```javascript
// Create once at module level
const moduleNotify = notify.withContext({
  module: 'MyModule',
  context: 'operations'
});

// Then use throughout the module
moduleNotify.info('Operation started');
moduleNotify.success('Operation completed');

// Add additional context when needed
moduleNotify.error('Operation failed', {
  source: 'saveHandler',
  originalError: err,
  extra: { itemId: '123' }
});
```

## 3. API Error Handling

**Use specialized methods for API errors:**
```javascript
// For API errors
notify.apiError('Failed to fetch data', {
  endpoint: '/api/data',
  responseDetail: response,
  originalError: err
});

// Or with contextual notifier
const apiNotify = notify.withContext({ module: 'api', context: 'dataFetch' });
apiNotify.error('API request failed', {
  endpoint: '/api/data',
  originalError: err
});
```

## 4. Debug & Tracing

**Use debug tools for performance monitoring:**
```javascript
const dbg = createDebugTools({ notify });
const traceId = dbg.start('fetchOperation');
// ... operations
dbg.stop(traceId, 'fetchOperation completed');
```

## 5. Error Reporting

**Capture errors with context for monitoring:**
```javascript
try {
  // operations
} catch (err) {
  notify.error('Operation failed', {
    module: 'MyModule',
    context: 'dataProcess',
    originalError: err
  });

  // Also send to error monitoring
  errorReporter.capture(err, {
    module: 'MyModule',
    method: 'processData',
    extra: { itemId: '123' }
  });
}
```

## 6. Safe API Wrapping

**Use the wrapApi helper for consistent API error handling:**
```javascript
import { wrapApi } from './utils/notifications-helpers.js';

// In your module
const result = await wrapApi(
  apiClient.get,
  { notify, errorReporter },
  '/api/data',
  { params: { id: '123' } }
);
```

## 7. Safe Function Invocation

**Use safeInvoker for event handlers:**
```javascript
import { safeInvoker } from './utils/notifications-helpers.js';

const safeHandler = safeInvoker(
  originalHandler,
  { notify, errorReporter },
  { module: 'MyModule', context: 'clickHandler' }
);

// Then use safeHandler instead of originalHandler
```

## Architecture Overview

The notification system consists of several components:

1. **notify.js** - Core notification utility that provides methods like `info`, `success`, `warn`, `error`, and the important `withContext` method for creating contextual notifiers.

2. **notification-handler.js** - Handles the UI aspect of notifications, creating and managing notification banners in the DOM.

3. **log_notification.py** - Backend route that receives notification events from the frontend and logs them appropriately.

4. **notifications-helpers.js** - Provides utility functions for debugging, error capturing, and API wrapping.

## Best Practices

1. **Always include context metadata** - Include `module`, `context`, and `source` properties in notifications to enable proper categorization and troubleshooting.

2. **Use contextual notifiers** - Create module-scoped notifiers with `withContext` at the module level to ensure consistent metadata.

3. **Include original errors** - When catching errors, include the original error object in the `originalError` property to preserve stack traces.

4. **Group related notifications** - Use the `group: true` property for related notifications to prevent UI clutter.

5. **Use specialized methods** - Use specialized methods like `apiError` and `authWarn` for common scenarios.

6. **Leverage helper utilities** - Use the provided helper utilities like `wrapApi` and `safeInvoker` for consistent error handling.

7. **Clean up properly** - Ensure all notification-related resources are properly cleaned up when modules are destroyed.
