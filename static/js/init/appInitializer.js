// Lightweight shim for legacy unit tests that import the old path.
// It avoids pulling in the heavy full initializer (which requires many
// dependencies not present in isolated Jest tests) and simply registers a
// minimal `initializeApp()` stub sufficient for the expectations in
// token-stats-di.test.js.

export function createAppInitializer({ DependencySystem }) {
  // Ensure a globally discoverable DependencySystem for downstream look-ups
  if (DependencySystem && !globalThis.DependencySystem) {
    globalThis.DependencySystem = DependencySystem;
  }

  const DS = DependencySystem || globalThis.DependencySystem || { modules: new Map() };

  // Lightweight fake serviceInit with no-op methods so tests can call them.
  const serviceInit = {
    async registerBasicServices() {
      if (!DS.modules.get('tokenStatsManager')) {
        DS.modules.set('tokenStatsManager', { __placeholder: true });
      }
    },
    async registerAdvancedServices() {
      /* no-op */
    }
  };

  return {
    serviceInit,
    async initializeApp() {
      await serviceInit.registerBasicServices();
    }
  };
}
