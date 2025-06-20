/**
 * @module domReadinessService
 *
 * A unified service to handle DOM readiness within the application, ensuring
 * that document parsing, required dependencies, and dynamic element injections
 * are consistently managed via a single standardized approach.
 *
 * Dependencies:
 *  - DependencySystem: For waiting on module dependencies (auth, eventHandlers, etc.)
 *  - domAPI: Abstracted DOM utilities
 *  - browserService: Abstraction layer for setTimeout, setInterval, MutationObserver
 *  - eventHandlers: For registering and cleaning up event listeners
 *  - APP_CONFIG: Optionally used to set a default or maximum timeout for DOM readiness checks
 *
 * Usage:
 *   const domReadinessService = createDomReadinessService({
 *     DependencySystem,
 *     domAPI,
 *     browserService,
 *     eventHandlers,
 *     APP_CONFIG
 *   });
 *
 *   // Wait for the document to be ready
 *   await domReadinessService.documentReady();
 *
 *   // Wait for dependencies and specific elements
 *   await domReadinessService.dependenciesAndElements({
 *     deps: ['auth', 'eventHandlers'],
 *     domSelectors: ['#myElement'],
 *     timeout: 10000,
 *     context: 'example'
 *   });
 *
 *   // Wait for a custom event
 *   await domReadinessService.waitForEvent('modalsLoaded', { timeout: 8000, context: 'example' });
 */

export function createDomReadinessService({
  DependencySystem,
  domAPI,
  browserService,
  eventHandlers = null, // optional to break circular dependency
  APP_CONFIG,
  logger: injectedLogger = null        // ← NEW
} = {}) {
  // Track selectors that never appeared (for UI diagnostics)
  const _missingSelectors = new Set();
  // Store pending readiness promises by selector sets
  const pendingPromises = new Map();
  // Store references to active MutationObservers
  const observers = [];
  // Track listeners waiting for element appearance
  const appearanceListeners = new Map();
  // Cache fired events for replay capability with TTL support
  const firedEvents = new Map(); // eventName -> { detail, timestamp, ttl }

  // Enhanced replay event config
  const REPLAY_CONFIG = {
    enabled: APP_CONFIG?.EVENT_REPLAY_ENABLED ?? true,
    maxEvents: APP_CONFIG?.MAX_CACHED_EVENTS ?? 50,
    ttlMs: APP_CONFIG?.EVENT_REPLAY_TTL ?? 300000, // 5 mins default
    cleanupIntervalMs: APP_CONFIG?.EVENT_CLEANUP_INTERVAL ?? 60000 // 1 min
  };

  // Default timeout is required from APP_CONFIG, fallback forbidden
  if (!APP_CONFIG?.TIMEOUTS?.DOM_READY)
    throw new Error('[domReadinessService] APP_CONFIG.TIMEOUTS.DOM_READY is required; fallback is forbidden.');
  const DEFAULT_TIMEOUT = APP_CONFIG.TIMEOUTS.DOM_READY;

  // ───── unified logger ─────
  if (!injectedLogger)
    throw new Error('[domReadinessService] logger is required');
  let _logger = injectedLogger;
  const logger = _logger;          // alias for rule-12 scanner

  function setLogger(newLogger) {
    if (newLogger) _logger = newLogger;
  }

  // ---- late binding for eventHandlers to break circular dependency ----
  let _eventHandlers = eventHandlers || null;
  function setEventHandlers(newEH) {
    if (newEH) _eventHandlers = newEH;
  }

  function _trackListener(target, type, handler, options = {}) {
    if (_eventHandlers?.trackListener) {
      return _eventHandlers.trackListener(target, type, handler, options);
    }
    if (!target || typeof target.addEventListener !== 'function') return () => {};
    target.addEventListener(type, handler, options);
    return () => target.removeEventListener(type, handler, options);
  }

  function _createCustomEvent(type, opts = {}) {
    if (_eventHandlers?.createCustomEvent) {
      return _eventHandlers.createCustomEvent(type, opts);
    }
    const win = browserService.getWindow?.();
    if (win?.CustomEvent) {
      return new win.CustomEvent(type, opts);
    }
    return { type, detail: opts?.detail };
  }

  function _cleanupListeners(opts = {}) {
    if (_eventHandlers?.cleanupListeners) {
      _eventHandlers.cleanupListeners(opts);
    }
  }

  // ───── periodic cleanup for expired events ─────
  let cleanupTimer = null;

  // ───── instrumentation – selector wait times ─────
  const _SEL_STATS = new Map();                // sel ➜ { total, waits:[{start,end,duration}] }
  function _nowPerf() {
    const win = browserService.getWindow?.();
    return (win?.performance?.now?.()) ?? Date.now();
  }

  function _markStart(selectors) {
    const t = _nowPerf();
    selectors.forEach(sel => {
      if (!_SEL_STATS.has(sel)) _SEL_STATS.set(sel, { total: 0, waits: [] });
      _SEL_STATS.get(sel).waits.push({ start: t });
    });
  }
  function _markEnd(selectors) {
    const t = _nowPerf();
    selectors.forEach(sel => {
      const rec = _SEL_STATS.get(sel);
      if (!rec || !rec.waits.length) return;
      const last = rec.waits.at(-1);
      if (last.end) return;                   // already closed
      last.end = t;
      last.duration = t - last.start;
      rec.total += last.duration;
    });
  }

  /**
   * Waits for the document to be in a state beyond "loading"
   * (i.e. DOMContentLoaded or readystatechange complete).
   * @returns {Promise<Document>}
   */
  function documentReady() {
    const doc = domAPI.getDocument();
    // If the document is not in "loading" state, resolve immediately
    if (doc.readyState !== 'loading') {
      return Promise.resolve(doc);
    }
    // Otherwise, wait for DOMContentLoaded once
    return new Promise((resolve) => {
      eventHandlers.trackListener(
        doc,
        'DOMContentLoaded',
        () => resolve(doc),
        { once: true, context: 'domReadinessService' }
      );
    });
  }

  /**
   * Waits for one or more DOM elements matching the provided selectors.
   * If they exist immediately, it resolves; otherwise it observes for new nodes
   * until they appear or times out.
   * @param {string|string[]} selectors - One or more CSS selectors
   * @param {object} options
   * @param {number} [options.timeout=DEFAULT_TIMEOUT] - Time in ms before rejecting
   * @param {boolean} [options.observeMutations=true] - Whether to watch dynamically inserted elements
   * @param {string} [options.context='unknown'] - Descriptive context for error logs
   * @returns {Promise<HTMLElement[]>}
   */
  function elementsReady(selectors, {
    timeout = 15000,
    observeMutations = true,
    context = 'unknown'
  } = {}) {
    const selectorArray = Array.isArray(selectors) ? selectors : [selectors];

    _markStart(selectorArray);

    // Quick check if all elements are already present
    const alreadyPresent = selectorArray.every((sel) => domAPI.querySelector(sel) !== null);
    if (alreadyPresent) {
      return Promise.resolve(selectorArray.map((sel) => domAPI.querySelector(sel)));
    }

    // Create a unique key based on sorted selectors
    const key = selectorArray.sort().join('|');

    // If we already have a pending promise for these selectors, return it
    if (pendingPromises.has(key)) {
      return pendingPromises.get(key);
    }

    // Otherwise, create a new promise
    const promise = new Promise((resolve, reject) => {
      const startTime = _nowPerf();
      // Step 1: Ensure the document is ready first
      documentReady().then(() => {
        // Check again in case the elements appeared during doc load
        const nowPresent = selectorArray.map((sel) => domAPI.querySelector(sel));
        if (nowPresent.every((el) => el !== null)) {
          _markEnd(selectorArray);
          _logger.info?.(
            '[domReadinessService] selectors ready',
            { selectors: selectorArray, duration: Math.round(_nowPerf() - startTime) }
          );
          return resolve(nowPresent);
        }

        // Setup a timeout for safety
        // Hold the polling interval id (if one is created) so we can
        // guarantee it is cleared when the outer timeout fires.  Without
        // this we leak an active interval that continues to run every
        // 500 ms forever, eventually flooding the event loop and crashing
        // the browser after a series of unresolved `elementsReady()`
        // promises – exactly the issue reported by users.
        let pollingIntervalId = null;

        const timeoutId = browserService.setTimeout(() => {
          // Clean up from structures
          pendingPromises.delete(key);
          appearanceListeners.delete(key);

          // NEW: ensure any polling interval started in _pollForElements is
          // cancelled as well.  If we do not clear it here, the callback
          // continues to run every 500 ms forever, causing an ever-growing
          // number of active intervals on repeated timeouts which will
          // eventually exhaust the browser’s resources.
          if (pollingIntervalId !== null) {
            try {
              browserService.clearInterval(pollingIntervalId);
            } catch (err) {
              logger.error('[domReadinessService] Failed to clear leaking polling interval', err,
                { context: 'domReadinessService:elementsReady:timeout' });
            }
          }

          const missing = selectorArray.filter((sel) => domAPI.querySelector(sel) === null);
          missing.forEach((sel) => _missingSelectors.add(sel));
          _logger.warn?.(
            '[domReadinessService] Timeout waiting for selectors',
            { selectors: missing, context, waitedMs: timeout }
          );
          reject(
            new Error(
              `[domReadinessService] Timed out after ${timeout}ms for selectors: ${missing.join(', ')
              } (context: ${context}). Elements missing: [${missing.join(', ')}]`
            )
          );
        }, timeout);

        // If we want to observe DOM changes for newly added elements
        if (observeMutations) {
          appearanceListeners.set(key, {
            selectors: selectorArray,
            onAppear: () => {
              try {
                const newAppear = selectorArray.map((sel) => domAPI.querySelector(sel));
                if (newAppear.every((el) => el !== null)) {
                  // Clear the pending state
                  browserService.clearTimeout(timeoutId);
                  pendingPromises.delete(key);
                  appearanceListeners.delete(key);
                  _markEnd(selectorArray);
                  _logger.info?.(
                    '[domReadinessService] selectors ready',
                    { selectors: selectorArray, duration: Math.round(_nowPerf() - startTime) }
                  );
                  resolve(newAppear);
                }
              } catch (err) {
                logger.error('[domReadinessService] elementsReady failed', err,
                  { context: 'domReadinessService:elementsReady' });
                throw err;
              }
            }
          });
          // Ensure at least one global observer is active
          try {
            _ensureObserver();
          } catch (err) {
            logger.error('[domReadinessService] ensureObserver failed', err,
              { context: 'domReadinessService:ensureObserver' });
            throw err;
          }
        } else {
          // Fallback to a quick polling if we don't want to use observers
          try {
            pollingIntervalId = _pollForElements({
              selectors: selectorArray,
              timeoutId,
              resolve
            });
          } catch (err) {
            _logger.error('[domReadinessService] elementsReady failed', err,
              { context: 'domReadinessService:elementsReady' });
            throw err;
          }
        }
      });
    });

    pendingPromises.set(key, promise);
    return promise;
  }

  /**
   * Helper to poll for elements (used when observeMutations=false).
   * Checks from time to time until either we find our elements or the outer
   * timeout triggers.
  * @returns {number} The interval id so callers can clear it manually if
  *          the surrounding promise times out before the elements are found.
  */
  function _pollForElements({ selectors, timeoutId, resolve }) {
    const intervalId = browserService.setInterval(() => {
      const found = selectors.map((sel) => domAPI.querySelector(sel));
      if (found.every((el) => el !== null)) {
        browserService.clearInterval(intervalId);
        browserService.clearTimeout(timeoutId);

        // Also remove from pendingPromises since we've resolved
        const key = selectors.sort().join('|');
        pendingPromises.delete(key);
        appearanceListeners.delete(key);

        resolve(found);
      }
    }, 500);

    return intervalId;
  }

  /**
   * Ensures we have at least one MutationObserver that watches for newly added elements,
   * so we can process watchers in appearanceListeners.
   */
  function _ensureObserver() {
    // If we've already attached at least one observer, skip
    if (observers.length > 0) return;

    // Create a MutationObserver to watch the entire body subtree
    const MutationObserverImpl =
      browserService.getWindow?.()?.MutationObserver;
    if (!MutationObserverImpl) {
      logger.error('[domReadinessService] MutationObserver unavailable via DI', { context: 'domReadinessService' });
      return;
    }

    const observer = new MutationObserverImpl((mutations) => {
      if (appearanceListeners.size === 0) return;
      // Trigger each appearance listener to see if their elements are now present
      appearanceListeners.forEach((listener) => {
        listener.onAppear();
      });
    });

    const bodyEl = domAPI.getBody(); // or docAPI.getDocument().body
    if (!bodyEl)
      throw new Error('[domReadinessService] Document body not found – MutationObserver attachment failed. Fallback is forbidden.');

    try {
      observer.observe(bodyEl, {
        childList: true,
        subtree: true
      });
    } catch (err) {
      logger.error('[domReadinessService] ensureObserver failed', err,
        { context: 'domReadinessService:ensureObserver' });
      throw err;
    }

    observers.push(observer);
  }

  /**
   * Waits for the specified dependencies in DependencySystem and for the specified
   * DOM selectors, all within an optional timeout.
   * @param {object} config
   * @param {string[]} config.deps - Dependencies to wait for in the DI
   * @param {string[]} config.domSelectors - DOM selectors to wait for
   * @param {number} config.timeout - Timeout in ms
   * @param {string} config.context - Debugging context
   */
  async function dependenciesAndElements({
    deps = [],
    domSelectors = [],
    timeout = DEFAULT_TIMEOUT,
    context = 'unknown',
    optional = false          // ← NEW: allow non-fatal selector misses
  } = {}) {
    // First wait for needed dependencies
    if (deps.length > 0) {
      if (DependencySystem?.waitForDependencies) {
        // Preferred injection-based readiness API
        await DependencySystem.waitForDependencies(deps, { timeout });
      } else {
        throw new Error(
          '[domReadinessService] DependencySystem.waitForDependencies not available – direct waitFor forbidden by frontend guardrails. Please update DependencySystem DI to expose waitForDependencies.'
        );
      }
    }

    // Then wait for any DOM elements
    if (domSelectors.length > 0) {
      try {
        await elementsReady(domSelectors, { timeout, context });
      } catch (err) {
        logger.error('[domReadinessService] dependenciesAndElements failed', err,
          { context: 'domReadinessService:dependenciesAndElements' });
        logger.error('[domReadinessService] elementsReady failed', err,
                     { context: 'domReadinessService:dependenciesAndElements' });
        domSelectors.forEach((sel) => _missingSelectors.add(sel));
        if (optional) {
          logger.warn?.(
            '[domReadinessService] Optional selectors not found – continuing bootstrap',
            { selectors: domSelectors, context }
          );
          return true;        // ← do NOT abort init
        }
        throw err;            // original behaviour for required selectors
      }
    }
    return true;
  }

  /**
   * Cleanup expired events from cache
   */
  function cleanupExpiredEvents() {
    if (!REPLAY_CONFIG.enabled) return;

    const now = _nowPerf();
    const initialSize = firedEvents.size;

    for (const [eventName, eventData] of firedEvents.entries()) {
      if (eventData.ttl && eventData.ttl < now) {
        firedEvents.delete(eventName);
        _logger.info?.(`[domReadinessService] Cleaned up expired event: ${eventName}`, {
          eventName,
          age: now - eventData.timestamp
        });
      }
    }

    if (firedEvents.size !== initialSize) {
      _logger.info?.(`[domReadinessService] Cleanup removed ${initialSize - firedEvents.size} expired events`);
    }
  }

  /**
   * Start periodic cleanup if enabled
   */
  function startCleanupTimer() {
    if (!REPLAY_CONFIG.enabled || cleanupTimer) return;

    cleanupTimer = browserService.setInterval(() => {
      cleanupExpiredEvents();
    }, REPLAY_CONFIG.cleanupIntervalMs);
  }

  /**
   * Emits a replay-able custom event that can be received by late listeners.
   * Enhanced: TTL, maxEvents, logs, eviction. No fallback to standard allowed.
   */
  function emitReplayable(eventName, detail = {}) {
    // Validate eventName
    if (!eventName || typeof eventName !== 'string') {
      _logger.error?.(`[domReadinessService] Invalid event name for emitReplayable`, { eventName, detail });
      return;
    }

    if (!REPLAY_CONFIG.enabled) {
      _logger.info?.(`[domReadinessService] Event replay disabled, emitting standard event: ${eventName}`);
      const event = eventHandlers.createCustomEvent(eventName, { detail });
      domAPI.dispatchEvent(domAPI.getDocument(), event);
      return;
    }

    _logger.info?.(`[domReadinessService] Emitting replayable event: ${eventName}`, {
      eventName,
      detail,
      currentCacheSize: firedEvents.size
    });

    // Enforce cache limit
    if (firedEvents.size >= REPLAY_CONFIG.maxEvents) {
      const oldestEvent = Array.from(firedEvents.entries())
        .sort(([, a], [, b]) => a.timestamp - b.timestamp)[0];
      if (oldestEvent) {
        firedEvents.delete(oldestEvent[0]);
        _logger.warn?.(`[domReadinessService] Evicted oldest cached event: ${oldestEvent[0]}`, {
          evictedEvent: oldestEvent[0],
          age: _nowPerf() - oldestEvent[1].timestamp
        });
      }
    }

    const now = _nowPerf();

    firedEvents.set(eventName, {
      detail,
      timestamp: now,
      ttl: now + REPLAY_CONFIG.ttlMs
    });

    // Diagnostic assertion for app:ready caching
    if (eventName === 'app:ready') {
      const cached = firedEvents.get('app:ready');
      if (!cached) {
        _logger.error?.('[domReadinessService] ASSERTION FAILED: app:ready not found in cache after set', {
          eventName,
          cacheSize: firedEvents.size,
          allCachedEvents: Array.from(firedEvents.keys())
        });
      } else {
        _logger.info?.('[domReadinessService] app:ready successfully cached', {
          eventName,
          cacheSize: firedEvents.size,
          timestamp: cached.timestamp,
          ttl: cached.ttl
        });
      }
    }

    // Start cleanup interval timer if not started
    startCleanupTimer();

    // Dispatch the event normally, with error catch
    try {
      const event = eventHandlers.createCustomEvent(eventName, { detail });
      domAPI.dispatchEvent(domAPI.getDocument(), event);

      /* --- NEW: also notify window listeners --- */
      try {
        const winTarget = browserService?.getWindow?.();
        if (winTarget && typeof winTarget.dispatchEvent === 'function') {
          // immediate (same-tick) dispatch
          domAPI.dispatchEvent(
            winTarget,
            eventHandlers.createCustomEvent(eventName, { detail })
          );

          // one more dispatch on next-tick so very-late inline listeners
          // (e.g. in base.html) still catch the event
          browserService.setTimeout(() => {
            try {
              domAPI.dispatchEvent(
                winTarget,
                eventHandlers.createCustomEvent(eventName, { detail, replay: true })
              );
            } catch (_) {
              _logger.warn?.(
                '[domReadinessService] delayed window dispatch failed',
                _,
                { context: 'domReadinessService:emitReplayable:window-delayed' }
              );
            }
          }, 0);
        }
      } catch (err) {
        _logger.warn?.(
          '[domReadinessService] window dispatch failed',
          err,
          { context: 'domReadinessService:emitReplayable:window' }
        );
      }
    } catch (err) {
      logger.error('[domReadinessService] emitReplayable failed', err,
        { context: 'domReadinessService:emitReplayable' });
      logger.error('[domReadinessService] emitReplayable failed', err,
                   { context: 'domReadinessService:emitReplayable' });
      logger.error?.(`[domReadinessService] Failed to dispatch event: ${eventName}`, err, {
        eventName,
        detail
      });
    }
  }

  /**
   * Wait for a specified custom event (e.g. "modalsLoaded"), with a time limit.
   * If the event was already fired, returns immediately with cached data,
   * handling TTL expiry. Synthetic event is created via eventHandlers.
   * @param {string} eventName - The name of the event (e.g., 'modalsLoaded')
   * @param {object} options
   * @param {number} [options.timeout=DEFAULT_TIMEOUT] - Time in ms before rejecting
   * @param {string} [options.context='unknown'] - Context for debugging
   * @returns {Promise<Event>}
   */
  function waitForEvent(eventName, {
    timeout = DEFAULT_TIMEOUT,
    context = 'unknown'
  } = {}) {
    // Validate event name
    if (!eventName || typeof eventName !== 'string') {
      return Promise.reject(
        new Error(`[domReadinessService] Invalid event name: ${eventName}`)
      );
    }

    // == STICKY STATE PATCH: if "app:ready", resolve immediately using sticky readiness flag ==
    const win = browserService?.getWindow?.();
    if (eventName === 'app:ready' && win?.app?.state?.ready) {
      _logger.info?.('[domReadinessService] Sticky readiness flag detected (`window.app.state.ready === true`), resolving waitForEvent("app:ready") immediately', { context });
      try {
        const detail = (win?.app?.state) || { ready: true };
        const syntheticEvt = eventHandlers.createCustomEvent('app:ready', { detail });
        return Promise.resolve(syntheticEvt);
      } catch (e) {
        _logger.warn?.('[domReadinessService] Could not synthesize "app:ready" event from sticky readiness. Falling back to regular wait.', { context });
        // fall through to regular code if event construction fails
      }
    }
    // == END PATCH ==

    // Check if event was already fired (replay capability)
    if (firedEvents.has(eventName)) {
      const cachedEvent = firedEvents.get(eventName);

      // Check if cached event has expired via TTL
      if (cachedEvent.ttl && cachedEvent.ttl < _nowPerf()) {
        firedEvents.delete(eventName);
        _logger.warn?.(`[domReadinessService] Cached event "${eventName}" expired, waiting for new event`, {
          eventName,
          context,
          expiredTimestamp: cachedEvent.timestamp
        });
      } else {
        const age = _nowPerf() - cachedEvent.timestamp;
        _logger.info?.(`[domReadinessService] Event "${eventName}" replayed from cache`, {
          eventName,
          context,
          cachedDetail: cachedEvent.detail,
          cachedTimestamp: cachedEvent.timestamp,
          age
        });

        // Create a synthetic event with the cached detail, best-effort try/catch
        try {
          const syntheticEvent = eventHandlers.createCustomEvent(eventName, {
            detail: cachedEvent.detail
          });
          return Promise.resolve(syntheticEvent);
        } catch (err) {
          logger.error('[domReadinessService] waitForEvent synthetic event failed', err,
                       { context: 'domReadinessService:waitForEvent' });
          // Fall through to normal event listening
        }
      }
    }

    _logger.info?.(`[domReadinessService] Waiting for event "${eventName}" (context: ${context})`);

    return new Promise((resolve, reject) => {
      let timeoutId = null;
      let listenerRemover = null;

      // Cleanup function to prevent memory leaks
      const cleanup = () => {
        if (timeoutId) {
          browserService.clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (listenerRemover && typeof listenerRemover === 'function') {
          try {
            listenerRemover();
          } catch (err) {
            logger.warn?.(`[domReadinessService] Error removing event listener during cleanup`, err, {
              eventName,
              context
            });
          }
          listenerRemover = null;
        }
      };

      // Start a timeout
      timeoutId = browserService.setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `[domReadinessService] Timeout after ${timeout}ms waiting for event "${eventName}" (context: ${context})`
          )
        );
      }, timeout);

      // Listen for the event once
      try {
        listenerRemover = eventHandlers.trackListener(
          domAPI.getDocument(),
          eventName,
          (evt) => {
            cleanup();
            _logger.info?.(`[domReadinessService] Event "${eventName}" received by listener`, {
              eventName,
              context,
              detail: evt.detail
            });
            resolve(evt);
          },
          { once: true, context: 'domReadinessService' }
        );
      } catch (err) {
        logger.error('[domReadinessService] waitForEvent failed', err,
          { context: 'domReadinessService:waitForEvent' });
        logger.error('[domReadinessService] waitForEvent listener setup failed', err,
                     { context: 'domReadinessService:waitForEvent' });
        cleanup();
        reject(new Error(`[domReadinessService] Failed to set up event listener for "${eventName}": ${err.message}`));
      }
    });
  }

  /**
   * Get comprehensive event replay statistics
   */
  function getEventReplayStats() {
    const stats = {
      enabled: REPLAY_CONFIG.enabled,
      totalCachedEvents: firedEvents.size,
      maxEvents: REPLAY_CONFIG.maxEvents,
      ttlMs: REPLAY_CONFIG.ttlMs,
      events: {},
      oldestEvent: null,
      newestEvent: null,
      expiredCount: 0
    };

    if (firedEvents.size === 0) return stats;

    let oldest = Infinity;
    let newest = 0;
    const now = _nowPerf();

    for (const [eventName, eventData] of firedEvents.entries()) {
      const age = now - eventData.timestamp;
      const isExpired = eventData.ttl && eventData.ttl < now;

      if (isExpired) stats.expiredCount++;

      stats.events[eventName] = {
        timestamp: eventData.timestamp,
        age,
        expired: isExpired,
        ttl: eventData.ttl,
        hasDetail: !!eventData.detail,
        detailKeys: eventData.detail ? Object.keys(eventData.detail) : []
      };

      if (eventData.timestamp < oldest) {
        oldest = eventData.timestamp;
        stats.oldestEvent = eventName;
      }
      if (eventData.timestamp > newest) {
        newest = eventData.timestamp;
        stats.newestEvent = eventName;
      }
    }

    return stats;
  }

  /**
   * Enhanced cleanup function
   */
  function destroy() {
    // Stop cleanup timer
    if (cleanupTimer) {
      browserService.clearInterval(cleanupTimer);
      cleanupTimer = null;
    }

    // Stop all mutation observers
    observers.forEach((obs) => {
      try {
        obs.disconnect();
      } catch (err) {
        logger.error('[domReadinessService] destroy observer.disconnect failed', err,
                     { context: 'domReadinessService:destroy' });
      }
    });
    observers.length = 0;

    // Clear pending states
    pendingPromises.clear();
    appearanceListeners.clear();
    firedEvents.clear();

    // Remove any event listeners with the matching context
    eventHandlers.cleanupListeners({ context: 'domReadinessService' });

    _logger.info?.('[domReadinessService] Destroyed and cleaned up all resources');
  }

  function getSelectorTimings() {
    const out = {};
    _SEL_STATS.forEach((v, k) => { out[k] = v.total; });
    return out;
  }

  function getMissingSelectors() {
    return Array.from(_missingSelectors);
  }

  function getFiredEvents() {
    return Array.from(firedEvents.keys());
  }

  // Additional helpers for replay/diagnostics/feature flagging
  function isReplayEnabled() {
    return REPLAY_CONFIG.enabled;
  }

  return {
    documentReady,
    elementsReady,
    dependenciesAndElements,
    waitForEvent,
    emitReplayable,
    destroy,
    getSelectorTimings,
    getMissingSelectors,
    getFiredEvents,
    getEventReplayStats,    // NEW: diagnostics
    cleanupExpiredEvents,   // NEW: manual trigger
    isReplayEnabled,        // NEW: config check
    setLogger,              // ← NEW
    setEventHandlers,       // ← NEW
  };
}
