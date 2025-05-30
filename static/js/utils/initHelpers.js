/**
 * @module InitHelpers
 * Shared initialization utilities to eliminate duplication across init modules
 */

/**
 * Safely invokes an asynchronous initialization method on a given instance, logging warnings or errors as needed.
 *
 * Attempts to call the specified method on the provided instance. Logs a warning if the instance or method is missing, and logs and rethrows any errors encountered during execution.
 *
 * @param {object} instance - The object containing the initialization method.
 * @param {string} name - The name of the instance, used for logging context.
 * @param {string} methodName - The name of the method to invoke.
 * @param {object} logger - Logger instance for logging
 * @returns {Promise<boolean>} Resolves to `true` if initialization succeeds or the method returns `undefined`; otherwise, resolves to the boolean value of the method's result. Returns `false` if the instance or method is missing.
 *
 * @throws {Error} If the initialization method throws an error during execution.
 */
export async function safeInit(instance, name, methodName, logger) {
  if (!logger || typeof logger.error !== 'function')
    throw new Error('[safeInit] logger is required');
  if (!instance) {
    logger?.warn(`[safeInit] Instance ${name} is null/undefined. Cannot call ${methodName}.`, { context: `initHelpers:safeInit:${name}` });
    return false;
  }
  if (typeof instance[methodName] !== 'function') {
    logger?.warn(`[safeInit] Method ${methodName} not found on ${name}.`, { context: `initHelpers:safeInit:${name}` });
    return false;
  }
  try {
    const result = await instance[methodName]();
    return result === undefined ? true : !!result;
  } catch (err) {
    logger.error(`[safeInit] Error during ${name}.${methodName}()`, err, { context: `initHelpers:safeInit:${name}:${methodName}` });
    throw err;
  }
}

/**
 * Creates a standardized DOM readiness helper with common patterns
 * @param {object} domReadinessService - The DOM readiness service
 * @param {object} logger - Logger instance
 * @returns {function} Helper function for waiting on dependencies and elements
 */
export function createDomWaitHelper(domReadinessService, logger) {
  return async function waitForDependenciesAndElements({
    deps = [],
    domSelectors = [],
    timeout = 10000,
    context = 'unknown'
  } = {}) {
    try {
      await domReadinessService.dependenciesAndElements({
        deps,
        domSelectors,
        timeout,
        context
      });
      return true;
    } catch (err) {
      logger.error('[domWaitHelper] Failed to wait for dependencies/elements', err, { 
        context, 
        deps, 
        domSelectors, 
        timeout 
      });
      throw err;
    }
  };
}

/**
 * Creates a standardized timeout wrapper for async operations
 * @param {object} browserService - Browser service for setTimeout
 * @param {object} logger - Logger instance
 * @returns {function} Helper function for wrapping operations with timeout
 */
export function createTimeoutWrapper(browserService, logger) {
  return function withTimeout(operation, timeoutMs, operationName = 'operation') {
    return Promise.race([
      operation,
      new Promise((_, reject) =>
        browserService.getWindow().setTimeout(
          () => reject(new Error(`Timeout in ${operationName} after ${timeoutMs}ms`)),
          timeoutMs
        )
      )
    ]);
  };
}

/**
 * Factory function to create init helpers with injected dependencies
 * @param {object} dependencies - Required dependencies
 * @param {object} dependencies.domReadinessService - DOM readiness service
 * @param {object} dependencies.browserService - Browser service
 * @param {object} dependencies.logger - Logger instance
 * @returns {object} Collection of helper functions
 */
export function createInitHelpers({ domReadinessService, browserService, logger }) {
  if (!domReadinessService || !browserService || !logger) {
    throw new Error('[initHelpers] Missing required dependencies: domReadinessService, browserService, logger');
  }

  const domWaitHelper = createDomWaitHelper(domReadinessService, logger);
  const timeoutWrapper = createTimeoutWrapper(browserService, logger);

  return {
    safeInit: (instance, name, methodName) => safeInit(instance, name, methodName, logger),
    waitForDependenciesAndElements: domWaitHelper,
    withTimeout: timeoutWrapper,
    cleanup () {}
  };
}
