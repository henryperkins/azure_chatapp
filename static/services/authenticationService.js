/**
 * Centralised Authentication State Service
 * ---------------------------------------
 *
 * This ultra-thin service exposes *read-only* helpers that always source
 * authentication status from the canonical `appModule.state` object.  By doing
 * so, it eliminates the historical drift where various components queried
 * authentication in different ways (direct cookies, local caches, delegated
 * auth module, etc.).  All UI components should depend on this service rather
 * than accessing `DependencySystem.modules.get('appModule').state` directly.
 *
 * The service intentionally contains **no local state** – it is nothing more
 * than a façade over `appModule.state`.  This guarantees a single source of
 * truth and avoids accidental desynchronisation.
 *
 * Guard-rails compliance:
 *   • No top-level side-effects – everything happens inside the factory.
 *   • All dependencies are explicit parameters of the factory.
 *   • A `cleanup()` method is supplied even though no listeners are attached;
 *     this maintains a consistent interface across services.
 */

export function createAuthenticationService({ DependencySystem, logger, appModule }) {
  if (!DependencySystem) {
    throw new Error('[authenticationService] Missing required DependencySystem');
  }

  // Fallback for backward-compatibility – resolve appModule via DI if caller
  // did not supply it explicitly.
  if (!appModule) {
    appModule = DependencySystem.modules?.get('appModule');
  }

  if (!appModule || !appModule.state) {
    throw new Error('[authenticationService] appModule with state not available – DI order incorrect');
  }

  const MODULE = 'authenticationService';

  function _getState() {
    return appModule.state;
  }

  const api = {
    /* ------------------------------------------------------------- */
    /* Public helpers                                               */
    /* ------------------------------------------------------------- */

    isAuthenticated() {
      return Boolean(_getState().isAuthenticated);
    },

    getCurrentUser() {
      return _getState().currentUser || null;
    },

    getAuthState() {
      const s = _getState();
      return {
        isAuthenticated: Boolean(s.isAuthenticated),
        user: s.currentUser || null
      };
    },

    /* ------------------------------------------------------------- */
    /* No-op cleanup – kept for interface consistency                */
    /* ------------------------------------------------------------- */
    cleanup() {
      // No listeners to detach – placeholder for future extension.
      if (logger?.debug) {
        logger.debug(`[${MODULE}] cleanup() called – nothing to clean`, {
          context: MODULE
        });
      }
    }
  };

  return api;
}
