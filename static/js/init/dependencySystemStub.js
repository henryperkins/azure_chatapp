/**
 * dependencySystemStub.js
 * Minimal DependencySystem stub for test environments.
 * This file is loaded only in test or fallback scenarios.
 */

(function(global) {
  if (global.DependencySystem && typeof global.DependencySystem.register === 'function') {
    // Already present, do nothing.
    return;
  }
  global.DependencySystem = {
    modules: new Map(),
    register(key, value) { this.modules.set(key, value); },
    waitForDependencies: () => Promise.resolve(),
    waitFor: () => Promise.resolve()
  };
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
