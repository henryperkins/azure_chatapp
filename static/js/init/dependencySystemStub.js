/*
 * dependencySystemStub.js
 * ------------------------------------------------------------------
 * Lightweight global DependencySystem available **before** app.js is
 * executed.  This was previously inlined in static/html/base.html which
 * forced us to include `'unsafe-inline'` in the CSP.  Providing the code
 * as an external ES module lets us drop the inline-script exception while
 * keeping identical behaviour.
 */

 
const DependencySystem = {
  modules: new Map(),
  states: new Map(),
  waiters: new Map(),
  _pendingCleanups: [],

  async register(name, instance, dependencies = []) {
    if (this.modules.has(name)) {
      throw new Error(`[DependencySystem] Duplicate module: '${name}'`);
    }

    if (dependencies.length > 0) {
      await this.waitFor(dependencies);
    }

    this.modules.set(name, instance);

    // Flush deferred cleanup requests once eventHandlers loaded
    if (name === 'eventHandlers' && this._pendingCleanups.length && instance?.cleanupListeners) {
      this._pendingCleanups.forEach((ctx) => instance.cleanupListeners({ context: ctx }));
      this._pendingCleanups.length = 0;
    }

    this.states.set(name, 'loaded');
    this._notifyWaiters(name);
    return instance;
  },

  _notifyWaiters(name) {
    if (!this.waiters.has(name)) return;
    this.waiters.get(name).forEach((callback) => {
      try {
        callback(this.modules.get(name));
      } catch (error) {
        const logger = this.modules?.get?.('logger');
        if (logger?.error) {
          logger.error(`[DependencySystem] Error in waiter callback for ${name}:`, error, {
            context: 'DependencySystemStub:_notifyWaiters'
          });
        } else if (typeof console !== 'undefined' && console.error) {
          console.error(`[DependencySystem] Error in waiter callback for ${name}:`, error);
        }
      }
    });
    this.waiters.delete(name);
  },

  waitFor(names, callback, timeout = 5000) {
    const nameArray = Array.isArray(names) ? names : [names];

    if (nameArray.every((n) => this.modules.has(n))) {
      const mods = nameArray.map((n) => this.modules.get(n));
      if (callback) callback(...mods);
      return Promise.resolve(mods);
    }

    return new Promise((resolve, reject) => {
      const missing = nameArray.filter((n) => !this.modules.has(n));
      let resolved = false;

      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error(`[DependencySystem] Timeout – missing: ${missing.join(', ')}`));
        }
      }, timeout);

      missing.forEach((name) => {
        if (!this.waiters.has(name)) this.waiters.set(name, []);
        this.waiters.get(name).push(() => {
          if (nameArray.every((n) => this.modules.has(n)) && !resolved) {
            clearTimeout(timeoutId);
            resolved = true;
            const mods = nameArray.map((n) => this.modules.get(n));
            if (callback) callback(...mods);
            resolve(mods);
          }
        });
      });
    });
  },

  // Alias expected by domReadinessService
  waitForDependencies(deps = [], { timeout = 5000 } = {}) {
    return this.waitFor(deps, null, timeout);
  },

  get(name) {
    return this.modules.get(name);
  },

  getCurrentTraceIds() {
    const id = `trace-${Date.now()}-${Math.floor(Math.random() * 1e5)}`;
    return { traceId: id, parentId: id };
  },

  generateTransactionId() {
    return `txn-${Date.now()}-${Math.floor(Math.random() * 1e5)}`;
  },

  cleanupModuleListeners(context) {
    const eh = this.modules.get('eventHandlers');
    if (eh?.cleanupListeners) {
      eh.cleanupListeners({ context });
    } else if (context) {
      this._pendingCleanups.push(context);
    }
  },
};

// Expose globally so all existing code continues to work.
// Note: This is acceptable in bootstrap code that establishes the DI system
if (typeof window !== 'undefined') {
  window.DependencySystem = DependencySystem;
}

export default DependencySystem;
