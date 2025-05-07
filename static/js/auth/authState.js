/**
 * authState.js
 *
 * Centralised state container + EventTarget for auth status.
 * Public API:
 *   - isAuthenticated()
 *   - getUsername()
 *   - setAuth(authenticated, username, source)
 *   - addEventListener / removeEventListener (delegated)
 *   - cleanup() – removes all listeners
 */

import { validateDeps } from './validateDeps.js';

/**
 * Factory: createAuthState
 *
 * @param {Object} deps
 * @param {Object} deps.authNotify - notify helper for event logs
 */
export function createAuthState(deps = {}) {
  validateDeps('createAuthState', deps, ['authNotify']);

  const { authNotify } = deps;

  let bus = new EventTarget();
  let _authenticated = false;
  let _username = null;

  function isAuthenticated() {
    return _authenticated;
  }
  function getUsername() {
    return _username;
  }

  /**
   * Update auth state & broadcast change if necessary.
   * @param {boolean} authenticated
   * @param {string|null} username
   * @param {string} source
   */
  function setAuth(authenticated, username = null, source = 'unknown') {
    const changed =
      authenticated !== _authenticated || username !== _username;

    _authenticated = !!authenticated;
    _username = username;

    if (changed) {
      authNotify.info(
        `[AuthState] changed (source=${source}) auth=${authenticated} user=${username}`,
        { group: true, source: 'authState.setAuth' }
      );
      bus.dispatchEvent(
        new CustomEvent('authStateChanged', {
          detail: {
            authenticated: _authenticated,
            username: _username,
            timestamp: Date.now(),
            source,
          },
        })
      );
    }
  }

  function cleanup() {
    // Replace bus with a fresh EventTarget to drop listeners.
    authNotify.info('[AuthState] cleanup()', { group: true, source: 'authState.cleanup' });
    bus = new EventTarget();
  }

  return {
    isAuthenticated,
    getUsername,
    setAuth,
    addEventListener: (...args) => bus.addEventListener(...args),
    removeEventListener: (...args) => bus.removeEventListener(...args),
    cleanup,
  };
}
