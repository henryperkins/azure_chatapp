# Code Generation Guardrails

## 🚨 CRITICAL RULES
1. **NO NEW MODULES** - Work within existing module structure only
2. **Modules < 600 lines** - Split if approaching limit
3. **Single Source of Truth** - No duplicate implementations

## Frontend Architecture

### Core Patterns (MANDATORY)
```javascript
// Every module exports via factory
export function createModuleName(dependencies) {
  // Validate deps
  if (!dependencies.required) throw new Error('Missing dependency');

  // Module code here

  return {
    // Public API
    cleanup() { /* cleanup logic */ }
  };
}
```

### Dependency Injection Rules
- **NEVER** access globals directly: `window`, `document`, `console`
- **ALWAYS** use injected abstractions: `domAPI`, `apiClient`, `logger`
- **ONLY** exception: Critical system errors when DI unavailable

### DOM Readiness (MANDATORY)
```javascript
// ✅ CORRECT - Only way to handle DOM readiness
await this.domReadinessService.waitForEvent('app:ready');
await this.domReadinessService.dependenciesAndElements(['#myElement']);

// ❌ FORBIDDEN
// Custom promises, timeouts, manual listeners, DependencySystem.waitFor()
```

### Event Handling
```javascript
// Always track with context
eventHandlers.trackListener(element, 'click', handler, { context: 'ModuleName' });
// Cleanup by context
eventHandlers.cleanupListeners({ context: 'ModuleName' });
```

## Authentication (BREAKING CHANGE Dec 2024)

### ✅ NEW Pattern (ONLY)
```javascript
// Read state - SINGLE source
const { isAuthenticated, currentUser } = appModule.state;

// Listen for changes
auth.AuthBus.addEventListener('authStateChanged', (event) => {
  const { authenticated, user } = event.detail;
});
```

### ❌ ELIMINATED Patterns
- Local `authState` variables
- `auth.isAuthenticated()` fallbacks
- Module-level `setAuthState()` methods

## Canonical Implementations (USE THESE)

| Feature | Location | Access |
|---------|----------|---------|
| SafeHandler | `app.js` | `DependencySystem.modules.get('safeHandler')` |
| Logger Factory | `logger.js` | `createLogger({ context, debug, minLevel, sessionIdProvider, traceIdProvider })` |
| Project State | `appModule.state` | `.currentProjectId`, `.currentProject` |
| Form Handlers | `auth.js` | `createAuthFormHandler()` |
| URL Parsing | `navigationService` | `.navigateTo()`, `.parseURL()` |
| Error Objects | Standard | `{ status, data, message }` |
| Chat Init | `chatManager.js` | Via AppBus/AuthBus events |

## Security Requirements
- **Sanitize ALL user HTML**: `sanitizer.sanitize(userContent)`
- **CSRF Protection**: Always include tokens
- **No localStorage/sessionStorage** in artifacts (use React state)

## Backend (Python/FastAPI)

### Structure
- Routes: Thin controllers, delegate to services
- Services: All business logic, domain exceptions
- Database: Async SQLAlchemy only, queries in services
- Response: Specific Pydantic models, never `dict`/`Any`

### Key Rules
- No DB queries in route handlers
- No `HTTPException` in services
- Structured JSON logging only
- Explicit DI everywhere

## Red Flags to Avoid
- Direct console.* calls (use logger)
- Business logic in routes
- Duplicate implementations
- Silent failures
- Mutable module-level state
- Generic response types
- Synchronous operations in async code

## Logging Patterns (MANDATORY)

### ✅ Logger Factory Creation (app.js only)
```javascript
// Correct logger factory creation - no authModule parameter
import { createLogger } from './logger.js';
const logger = createLogger({
  context: 'App',
  debug: APP_CONFIG.DEBUG,
  minLevel: 'info',
  enableServer: false, // Disabled until auth completes
  sessionIdProvider: () => getSessionId(),
  traceIdProvider: () => DependencySystem?.modules?.get?.('traceId')
});

// After auth initialization - enable remote logging
logger.setServerLoggingEnabled(true);
```

### ✅ Logger Usage in Modules
```javascript
// Logger is DI-injected, never access directly
export function createMyModule({ logger, apiClient, domAPI }) {
  const context = 'MyModule';

  // Always use context parameter for module identification
  logger.info(context, 'Module initialized', { timestamp: Date.now() });
  logger.error(context, 'Operation failed', error, { userId: user.id });

  // Runtime controls (app.js only)
  logger.setServerLoggingEnabled(true);  // Enable remote logging after auth
  logger.setMinLevel('warn');            // Set minimum log level
}
```

### ❌ Logger Anti-Patterns
- Direct console.* calls (use injected logger)
- Accessing logger via DependencySystem.modules.get() in modules
- Missing context parameter in log calls
- Calling setAuthModule() (method removed - uses appModule.state automatically)
- Including authModule parameter in createLogger() factory

## Quick Reference
```javascript
// Module template
export function createMyModule({ logger, apiClient, domAPI, navigationService, domReadinessService, eventHandlers, sanitizer }) {
  // Validate all deps

  await domReadinessService.waitForEvent('app:ready');

  // Use canonical implementations
  const safeHandler = DependencySystem.modules.get('safeHandler');
  const { isAuthenticated } = appModule.state;

  // Track all listeners
  eventHandlers.trackListener(el, 'click', handler, { context: 'MyModule' });

  return {
    cleanup() {
      eventHandlers.cleanupListeners({ context: 'MyModule' });
    }
  };
}
```
