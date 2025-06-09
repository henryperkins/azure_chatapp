/**
 * tokenStatsManagerProxy.js – Lightweight buffering proxy to bridge the gap
 * between ChatManager initialisation and the asynchronous registration of the
 * real tokenStatsManager instance.  Supports a *subset* of the public API
 * required by ChatManager (currently `setInputTokenCount`).  All calls made
 * before the real manager becomes available are queued and flushed once the
 * real instance is registered.
 *
 * Size: < 50 LOC to comply with remediation guidance.
 */

export function createTokenStatsManagerProxy({ DependencySystem, logger } = {}) {
  if (!DependencySystem) throw new Error('[tokenStatsManagerProxy] Missing DependencySystem');
  if (!logger) throw new Error('[tokenStatsManagerProxy] Missing logger');

  const callQueue = [];
  let realManager = null;

  function _flushQueue() {
    if (!realManager) return;
    while (callQueue.length) {
      const { method, args } = callQueue.shift();
      if (typeof realManager[method] === 'function') {
        try {
          realManager[method](...args);
        } catch (err) {
          logger.error('[tokenStatsManagerProxy] Failed to replay buffered call', err, {
            context: 'tokenStatsManagerProxy', method
          });
        }
      }
    }
  }

  function setRealManager(instance) {
    if (realManager) return; // Prevent re-binding (avoids memory build-up)
    realManager = instance;
    _flushQueue();
  }

  // Universal proxy handler – buffer calls until ready
  const proxyTarget = {};
  const proxy = new Proxy(proxyTarget, {
    get(_obj, prop) {
      if (prop === 'setRealManager') return setRealManager;
      if (prop === '__isProxy') return true;
      return (...args) => {
        if (realManager && typeof realManager[prop] === 'function') {
          return realManager[prop](...args);
        }
        callQueue.push({ method: prop, args });
        return undefined;
      };
    }
  });

  return proxy;
}

export default createTokenStatsManagerProxy;
