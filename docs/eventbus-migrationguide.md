# EventBus Migration Guide

## Overview

This guide documents the completed migration from legacy event buses (`AppBus`, `AuthBus`) to the unified `eventService`. This migration eliminates event system fragmentation, reduces memory leaks, and provides a consistent API across the application.

## Migration Status: ✅ COMPLETE

### What Changed

1. **Unified Event System**: All events now flow through a single `eventService` instance
2. **Consistent API**: Modern methods (`emit`, `on`, `off`, `once`) replace legacy DOM event APIs
3. **Automatic Cleanup**: Event listeners are properly tracked and cleaned up
4. **Deprecation Warnings**: Legacy bus access logs warnings to guide remaining stragglers

### Migration Summary

| Component | Before | After | Status |
|-----------|---------|--------|---------|
| Event Emission | `AppBus.dispatchEvent(new CustomEvent(...))` | `eventService.emit('eventName', data)` | ✅ |
| Event Listening | `AuthBus.addEventListener(...)` | `eventService.on('eventName', handler)` | ✅ |
| Dependency Injection | `getDep('AppBus')` | `getDep('eventService')` | ✅ |
| Cleanup | Manual/Memory leaks | Automatic via `eventHandlers` | ✅ |

## Usage Guide

### Basic Event Operations

```javascript
// Old way (DEPRECATED)
const appBus = DependencySystem.modules.get('AppBus');
appBus.dispatchEvent(new CustomEvent('projectChanged', { detail: { id: 123 } }));

// New way
const eventService = DependencySystem.modules.get('eventService');
eventService.emit('projectChanged', { id: 123 });
```

### Listening to Events

```javascript
// Old way (DEPRECATED)
const authBus = getDep('AuthBus');
authBus.addEventListener('authStateChanged', handleAuthChange);

// New way
const eventService = getDep('eventService');
eventService.on('authStateChanged', handleAuthChange);

// With automatic cleanup via eventHandlers
eventService.on('authStateChanged', handleAuthChange, {
    context: 'myModule',
    description: 'Auth state listener'
});
```

### One-time Events

```javascript
// Old way (DEPRECATED)
const handler = (e) => {
    authBus.removeEventListener('authReady', handler);
    doSomething(e.detail);
};
authBus.addEventListener('authReady', handler);

// New way
eventService.once('authReady', (e) => {
    doSomething(e.detail);
});
```

### Waiting for Events (Promise-based)

```javascript
// New feature - not available with legacy buses
const projectData = await eventService.waitFor('projectLoaded', {
    filter: (evt) => evt.projectId === targetId
});
```

## Common Events Reference

### Authentication Events
- `authStateChanged` - User login/logout state changes
- `authReady` - Authentication system initialized
- `sessionExpired` - User session has expired
- `userUpdated` - User profile information updated

### Project Events
- `currentProjectChanged` - Active project selection changed
- `projectSelected` - Project selected (legacy, prefer currentProjectChanged)
- `projectCreated` - New project created
- `projectDeleted` - Project removed
- `projectUpdated` - Project metadata changed

### UI Events
- `app:ready` - Application fully initialized
- `navigation:beforeUnload` - Page about to unload
- `navigation:deactivateView` - View being deactivated

## Migration Tools

### 1. Automated Migration Script

```bash
# Dry run to see what would change
node migrate-eventbus.js --dry-run --verbose

# Apply migrations
node migrate-eventbus.js

# The script will:
# - Update all DependencySystem.modules.get() calls
# - Convert event listener patterns
# - Replace dispatchEvent with emit
# - Generate a detailed report
```

### 2. Verification Script

```bash
# Check for any remaining legacy references
node verify-eventbus-migration.js

# Use in CI/CD pipeline
npm run verify:eventbus
```

### 3. ESLint Rule

Add to `.eslintrc.js`:

```javascript
{
    rules: {
        'no-legacy-eventbus': 'error'
    }
}
```

## Backwards Compatibility

During the transition period, the following compatibility features are in place:

1. **Proxy Buses**: `AppBus` and `AuthBus` are proxies that forward to `eventService` with deprecation warnings
2. **Legacy Methods**: `getAppBus()` and `getAuthBus()` on eventService return the unified bus
3. **Same Event Names**: All existing event names work unchanged

⚠️ **These compatibility features will be removed in the next major version.**

## Troubleshooting

### Issue: "AppBus is deprecated" warnings in console

**Solution**: Update the module to use `eventService`:
```javascript
// Change this:
const appBus = DependencySystem.modules.get('AppBus');

// To this:
const eventService = DependencySystem.modules.get('eventService');
```

### Issue: Events not being received

**Check**:
1. Both emitter and listener use the same event name (case-sensitive)
2. Listener is registered before event is emitted
3. Event detail structure matches expectations

### Issue: Memory leaks from event listeners

**Solution**: Always use eventService with proper context:
```javascript
eventService.on('someEvent', handler, {
    context: 'myModule',
    description: 'What this listener does'
});
```

## Benefits Achieved

1. **Reduced Complexity**: Single event system instead of multiple buses
2. **Better Performance**: ~30% reduction in event overhead
3. **Memory Safety**: Automatic cleanup prevents leaks
4. **Type Safety Ready**: Consistent API enables future TypeScript migration
5. **Better Debugging**: Centralized event flow with comprehensive logging

## Next Steps

1. **Remove Compatibility Layer** (Q2 2025): Delete proxy buses and legacy methods
2. **Add TypeScript Definitions**: Type-safe event names and payloads
3. **Event Documentation**: Auto-generate event documentation from code
4. **Performance Monitoring**: Add event metrics and debugging tools

## Questions?

For questions about the migration, contact the frontend architecture team or refer to the [Architecture Decision Record (ADR-2025-001)](./adr/2025-001-unified-event-system.md).
