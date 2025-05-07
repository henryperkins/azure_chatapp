/**
 * authRequester.js
 *
 * Composes authenticated requests (with CSRF) using injected apiRequest.
 * This is an initial stub scaffold—full logic will be implemented in
 * later milestones once CSRF manager is completed.
 */

import { validateDeps } from './validateDeps.js';

/**
 * Factory: createAuthRequester
 *
 * @param {Object} deps
 * @param {Function} deps.apiRequest   - Injected HTTP helper.
 * @param {Object}   deps.csrfManager  - Instance returned from createCsrfManager.
 * @param {Object}   deps.authNotify   - Notify helper scoped for auth.
 */
export function createAuthRequester(deps = {}) {
  validateDeps('createAuthRequester', deps, [
    'apiRequest',
    'csrfManager',
    'authNotify',
  ]);

  /**
   * Perform an HTTP call with automatic CSRF header for state-changing requests.
   *
   * @param {string} endpoint
   * @param {string} method
   * @param {Object|null} body
   * @param {Object} extraOpts       - Additional fetch options (headers/override).
   * @returns {Promise<any>}
   */
  async function request(endpoint, method = 'GET', body = null, extraOpts = {}) {
    /* eslint-disable no-console -- placeholder */
    console.warn('[createAuthRequester] request() stub called');
    /* eslint-enable no-console */

    const options = {
      method: method.toUpperCase(),
      credentials: 'include',
      headers: { Accept: 'application/json', ...(extraOpts.headers || {}) },
      ...extraOpts,
    };

    if (body) {
      options.body = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
    }

    // TODO: attach CSRF when implemented
    return deps.apiRequest(endpoint, options);
  }

  return { request };
}
