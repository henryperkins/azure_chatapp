/**
 * apiEndpoints.js – Provides canonical API endpoint resolution via guarded factory.
 */

export function createApiEndpoints({ logger, DependencySystem, config } = {}) {
  // Dependency validation per code guardrails
  if (!logger) throw new Error('[apiEndpoints] Missing logger dependency');
  if (typeof logger.error !== "function" || typeof logger.info !== "function")
    throw new Error('[apiEndpoints] logger must provide .error and .info methods');

  // Defaults
  const DEFAULT_API_ENDPOINTS = {
    PROJECTS: '/api/projects/',
    AUTH_CSRF: '/api/auth/csrf',
    AUTH_LOGIN: '/api/auth/login',
    AUTH_LOGOUT: '/api/auth/logout',
    AUTH_REGISTER: '/api/auth/register',
    AUTH_VERIFY: '/api/auth/verify',
    AUTH_REFRESH: '/api/auth/refresh',
    CONVERSATIONS: (pid) => `/api/projects/${pid}/conversations`,
    CONVERSATION: (pid, cid) => `/api/projects/${pid}/conversations/${cid}`,
    MESSAGES: (pid, cid) => `/api/projects/${pid}/conversations/${cid}/messages`
  };

  const REQUIRED_ENDPOINT_KEYS = [
    'AUTH_CSRF', 'AUTH_LOGIN', 'AUTH_LOGOUT', 'AUTH_REGISTER', 'AUTH_VERIFY', 'AUTH_REFRESH'
  ];

  // Allow passing custom overrides via config
  const userCfg = config || {};
  let endpoints = { ...DEFAULT_API_ENDPOINTS };

  if (userCfg.API_ENDPOINTS && typeof userCfg.API_ENDPOINTS === 'object') {
    endpoints = { ...DEFAULT_API_ENDPOINTS, ...userCfg.API_ENDPOINTS };
  }

  // Validation
  const missingKeys = [];
  const emptyKeys = [];
  for (const key of REQUIRED_ENDPOINT_KEYS) {
    if (!(key in endpoints)) {
      missingKeys.push(key);
    } else if (!endpoints[key] || typeof endpoints[key] !== 'string' || endpoints[key].trim() === '') {
      emptyKeys.push(key);
    }
  }

  if (missingKeys.length > 0 || emptyKeys.length > 0) {
    const errors = [];
    if (missingKeys.length > 0)
      errors.push(`Missing required endpoint keys: ${missingKeys.join(', ')}`);
    if (emptyKeys.length > 0)
      errors.push(`Empty required endpoint keys: ${emptyKeys.join(', ')}`);

    logger.error('[apiEndpoints] Configuration validation failed', {
      context : 'apiEndpoints:resolveApiEndpoints',
      errors,
      provided: userCfg?.API_ENDPOINTS,
      merged: endpoints
    });

    throw new Error(`API endpoint configuration invalid: ${errors.join('; ')}`);
  }

  logger.info('[apiEndpoints] Successfully resolved and validated endpoints', {
    context : 'apiEndpoints:resolveApiEndpoints',
    overrides: Object.keys(userCfg?.API_ENDPOINTS ?? {}),
    total: Object.keys(endpoints).length,
    required: REQUIRED_ENDPOINT_KEYS.length
  });

  // Resolve endpoints logic (legacy API if callers expect)
  function resolveApiEndpoints(cfg = {}) {
    // Accepts partial config for overrides if needed outside the factory
    const result = { ...endpoints };
    if (cfg && cfg.API_ENDPOINTS)
      Object.assign(result, cfg.API_ENDPOINTS);
    // NOTE: callers should rerun validation if using this method externally
    return result;
  }

  // Cleanup API
  function cleanup() {
    // Nothing to clean up in stateless endpoints, present for API uniformity
  }

  // Return the canonical endpoints and API as factory output
  return {
    endpoints,
    resolveApiEndpoints,
    cleanup
  };
}
