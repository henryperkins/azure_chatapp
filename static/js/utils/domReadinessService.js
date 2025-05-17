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
  eventHandlers,
  APP_CONFIG
} = {}) {
  // Track selectors that never appeared (for UI diagnostics)
  const _missingSelectors = new Set();
  // Store pending readiness promises by selector sets
  const pendingPromises = new Map();
  // Store references to active MutationObservers
  const observers = [];
  // Track listeners waiting for element appearance
  const appearanceListeners = new Map();

  // Default timeout from APP_CONFIG or fallback
  const DEFAULT_TIMEOUT = APP_CONFIG?.TIMEOUTS?.DOM_READY ?? 10000;

  // ───── instrumentation – selector wait times ─────
  const _SEL_STATS = new Map();                // sel ➜ { total, waits:[{start,end,duration}] }
  const _nowPerf   = () =>
    (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();

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
      last.end      = t;
      last.duration = t - last.start;
      rec.total    += last.duration;
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
    timeout = DEFAULT_TIMEOUT,
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
          const logger = DependencySystem?.modules?.get?.('logger') || {};
          logger.info?.(`[domReadinessService] selectors [${selectorArray.join(', ')}] ready in ${Math.round(_nowPerf()-startTime)} ms`);
          return resolve(nowPresent);
        }

        // Setup a timeout for safety
        const timeoutId = browserService.setTimeout(() => {
          // Clean up from structures
          pendingPromises.delete(key);
          appearanceListeners.delete(key);

          const missing = selectorArray.filter((sel) => domAPI.querySelector(sel) === null);
          missing.forEach((sel) => _missingSelectors.add(sel));
          const logger = DependencySystem?.modules?.get?.('logger') || {};
          logger.error?.(`[domReadinessService] TIMEOUT – missing selectors: ${missing.join(', ')} (context: ${context})`);
          reject(
            new Error(
              `[domReadinessService] Timed out after ${timeout}ms for selectors: ${
                missing.join(', ')
              } (context: ${context}). Elements missing: [${missing.join(', ')}]`
            )
          );
        }, timeout);

        // If we want to observe DOM changes for newly added elements
        if (observeMutations) {
          appearanceListeners.set(key, {
            selectors: selectorArray,
            onAppear: () => {
              const newAppear = selectorArray.map((sel) => domAPI.querySelector(sel));
              if (newAppear.every((el) => el !== null)) {
                // Clear the pending state
                browserService.clearTimeout(timeoutId);
                pendingPromises.delete(key);
                appearanceListeners.delete(key);
                _markEnd(selectorArray);
                const logger = DependencySystem?.modules?.get?.('logger') || {};
                logger.info?.(`[domReadinessService] selectors [${selectorArray.join(', ')}] ready in ${Math.round(_nowPerf()-startTime)} ms`);
                resolve(newAppear);
              }
            }
          });
          // Ensure at least one global observer is active
          _ensureObserver();
        } else {
          // Fallback to a quick polling if we don't want to use observers
          _pollForElements({
            selectors: selectorArray,
            timeoutId,
            resolve
          });
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
    }, 100);
  }

  /**
   * Ensures we have at least one MutationObserver that watches for newly added elements,
   * so we can process watchers in appearanceListeners.
   */
  function _ensureObserver() {
    // If we've already attached at least one observer, skip
    if (observers.length > 0) return;

    // Create a MutationObserver to watch the entire body subtree
    const observer = new browserService.MutationObserver((mutations) => {
      if (appearanceListeners.size === 0) return;
      // Trigger each appearance listener to see if their elements are now present
      appearanceListeners.forEach((listener) => {
        listener.onAppear();
      });
    });

    const bodyEl = domAPI.getBody(); // or docAPI.getDocument().body
    if (!bodyEl) return; // fallback if somehow no body

    observer.observe(bodyEl, {
      childList: true,
      subtree: true
    });

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
    context = 'unknown'
  } = {}) {
    // First wait for needed dependencies
    if (deps.length > 0) {
      await DependencySystem.waitFor(deps, null, timeout);
    }

    // Then wait for any DOM elements
    if (domSelectors.length > 0) {
      try {
        await elementsReady(domSelectors, { timeout, context });
      } catch (err) {
        domSelectors.forEach((sel) => _missingSelectors.add(sel));
        throw err;
      }
    }
    return true;
  }

  /**
   * Wait for a specified custom event (e.g. "modalsLoaded"), with a time limit.
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
    return new Promise((resolve, reject) => {
      // Start a timeout
      const timeoutId = browserService.setTimeout(() => {
        reject(
          new Error(
            `[domReadinessService] Timeout after ${timeout}ms waiting for event "${eventName}" (context: ${context})`
          )
        );
      }, timeout);

      // Listen for the event once
      eventHandlers.trackListener(
        domAPI.getDocument(),
        eventName,
        (evt) => {
          browserService.clearTimeout(timeoutId);
          resolve(evt);
        },
        { once: true, context: 'domReadinessService' }
      );
    });
  }

  /**
   * Cleanup function to stop all observers and clear stored promises.
   * Call this if you need to completely remove references (e.g., if reloading).
   */
  function destroy() {
    // Stop all mutation observers
    observers.forEach((obs) => obs.disconnect());
    observers.length = 0;

    // Clear pending states
    pendingPromises.clear();
    appearanceListeners.clear();

    // Remove any event listeners with the matching context
    eventHandlers.cleanupListeners({ context: 'domReadinessService' });
  }

  function getSelectorTimings() {
    const out = {};
    _SEL_STATS.forEach((v, k) => { out[k] = v.total; });
    return out;
  }

  function getMissingSelectors() {
    return Array.from(_missingSelectors);
  }

  return {
    documentReady,
    elementsReady,
    dependenciesAndElements,
    waitForEvent,
    destroy,
    getSelectorTimings,            // ← new
    getMissingSelectors      // NEW
  };
}
