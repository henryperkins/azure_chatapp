/**
 * csrfManager.js
 *
 * Fetches & caches CSRF tokens.
 * NOTE: Full implementation will arrive in later milestones – this is a
 * scaffold so that other modules can import without breaking.
 */

import { validateDeps } from './validateDeps.js';

/**
 * Factory: createCsrfManager
 *
 * @param {Object} deps
 * @param {Function} deps.apiRequest  - Injected HTTP helper.
 * @param {Object}   deps.authNotify  - Notify helper scoped w/ context.
 * @param {Object}   deps.apiEndpoints - Endpoint map containing AUTH_CSRF.
 */
export function createCsrfManager(deps = {}) {
  validateDeps('createCsrfManager', deps, [
    'apiRequest',
    'authNotify',
    'apiEndpoints',
  ]);

  // Internal cache
  let token = '';
  let promise = null;

  /**
   * @returns {Promise<string|null>} CSRF token or null on failure.
   */
  async function getToken() {
    /* eslint-disable no-console -- placeholder until full impl */
    console.warn('[createCsrfManager] getToken() called – stub implementation');
    /* eslint-enable no-console */
    if (token) return token;
    if (promise) return promise;

    promise = Promise.resolve(null).finally(() => {
      promise = null;
    });
    return promise;
  }

  return {
    getToken,
    /* For future: invalidate(), refresh(), etc. */
  };
}
