# appInitializer.js Analysis and Rewrite Plan

## Current Architecture Analysis

### Overview
The current `appInitializer.js` is a **~2 700-line** monolith that orchestrates 30 + JavaScript modules with complex dependency chains and strict initialization sequencing.

### Current Implementation Issues
1. **Monolithic Size** – exceeds the 1 000-line guard-rail.
2. **Complex Boot Order** – multi-phase bootstrap with intricate dependency juggling.
3. **Circular Dependencies** – resolved today via late setter injection.
4. **Mixed Concerns** – DI wiring, module registration, and business logic live together.

### High-level Module Map
Core infra: `logger.js`, `safeHandler.js`, `logDeliveryService.js`  
Utilities: `browserService.js`, `domAPI.js`, `domReadinessService.js`, `apiClient.js`, `apiEndpoints.js`  
Config: `appConfig.js`, `modalConstants.js`  
Application modules: `eventHandler.js`, `auth.js`, `modalManager.js`, `projectManager.js`, `chat.js`  
Feature clusters: Auth, Modal, Chat, Project, Knowledge-base

> All modules follow the factory pattern with strict DI validation and required `cleanup()`.

### Existing Bootstrap Phases
0. **Prerequisites** – browserService, DOMPurify, CustomEvent polyfill.  
1. **Core Infrastructure** – domAPI, eventHandlers, logger, safeHandler.  
2. **Readiness & Event** – domReadinessService, eventService.  
3. **App Services** – apiClient, apiEndpoints, globalUtils.  
4. **Feature Modules** – auth, modal, project, chat, KB.

## Proposed Rewrite Strategy

### Goals
• Split into ≤1 000-line modules.  
• Preserve strict DI & guard-rails.  
• Improve readability, testability, and circular-dep handling.

### New File Layout
```
static/js/init/
├── appInitializer.js        # orchestrator (<1 000 LoC)
├── coreBootstrap.js         # phase-1 infra
├── serviceRegistration.js   # phase-2 services
├── moduleInitialization.js  # phase-3 feature modules
└── dependencyResolver.js    # graph utils / late binding helpers
```

### Orchestrator Skeleton
```javascript
export function createAppInitializer(opts = {}) {
  const core  = createCoreBootstrap(opts);
  const svc   = createServiceRegistration(opts);
  const mods  = createModuleInitialization(opts);
  const graph = createDependencyResolver(opts);

  return {
    async initializeApp() {
      await core.initializeCore();
      await svc.registerServices();
      await mods.initializeModules();
      graph.validateDependencies();
    },
    cleanup() {
      mods.cleanup();
      svc.cleanup();
      core.cleanup();
    }
  };
}
```

### Validation Checklist
1. Unit-test each phase.  
2. `npm run lint && npx jest` passes.  
3. Manual smoke test: no console errors, `window.app.state.ready === true`.

---
This document will track progress and decisions throughout the refactor.
