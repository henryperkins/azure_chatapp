export const DEFAULT_API_ENDPOINTS = {
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

// Required endpoint keys that must be present for core functionality
const REQUIRED_ENDPOINT_KEYS = [
  'AUTH_CSRF', 'AUTH_LOGIN', 'AUTH_LOGOUT', 'AUTH_REGISTER', 'AUTH_VERIFY', 'AUTH_REFRESH'
];

export const resolveApiEndpoints = (
  cfg = {},
  { logger: injectedLogger = null, DependencySystem = null } = {},
) => {
  // If no override provided, use defaults
  if (!cfg?.API_ENDPOINTS) {
    return DEFAULT_API_ENDPOINTS;
  }

  // Merge overrides with defaults to ensure required keys are present
  const merged = { ...DEFAULT_API_ENDPOINTS, ...cfg.API_ENDPOINTS };

  // DI logger (no global console ‑ guardrail #12)
  const _logger =
    injectedLogger ||
    DependencySystem?.modules?.get?.('logger') ||
    { error: () => { }, warn: () => { }, info: () => { } };

  // Validate that all required keys are present and non-empty
  const missingKeys = [];
  const emptyKeys = [];

  for (const key of REQUIRED_ENDPOINT_KEYS) {
    if (!(key in merged)) {
      missingKeys.push(key);
    } else if (!merged[key] || typeof merged[key] !== 'string' || merged[key].trim() === '') {
      emptyKeys.push(key);
    }
  }

  if (missingKeys.length > 0 || emptyKeys.length > 0) {
    const errors = [];
    if (missingKeys.length > 0) {
      errors.push(`Missing required endpoint keys: ${missingKeys.join(', ')}`);
    }
    if (emptyKeys.length > 0) {
      errors.push(`Empty required endpoint keys: ${emptyKeys.join(', ')}`);
    }

    _logger.error?.('[apiEndpoints] Configuration validation failed', {
      context : 'apiEndpoints:resolveApiEndpoints',
      errors,
      provided: cfg?.API_ENDPOINTS,
      merged
    });

    throw new Error(`API endpoint configuration invalid: ${errors.join('; ')}`);
  }

  _logger.info?.('[apiEndpoints] Successfully resolved and validated endpoints', {
    context : 'apiEndpoints:resolveApiEndpoints',
    overrides: Object.keys(cfg?.API_ENDPOINTS ?? {}),
    total: Object.keys(merged).length,
    required: REQUIRED_ENDPOINT_KEYS.length
  });

  return merged;
};
