### 🔍 Guard-rails Compliance Check

- [ ] No module except **appModule** tracks initialization state internally  
      _(e.g. `initialized`, `initializing`, `isReady`, `ready`, etc.)_
- [ ] All module methods are stateless **and** idempotent
- [ ] All initialization sequencing is managed **only** inside  
      `static/js/app.js` / `static/js/init/appInitializer.js`
- [ ] Every source file exports **only** a factory function (pure DI);  
      no top-level logic / side-effects
- [ ] All `cleanup()` implementations exist, are idempotent, and call  
      `eventHandlers.cleanupListeners({ context })`

> Merge **only** when every item above is checked ✔
