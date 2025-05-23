export const DEFAULT_API_ENDPOINTS = {
  PROJECTS      : '/api/projects/',
  AUTH_CSRF     : '/api/auth/csrf',
  AUTH_LOGIN    : '/api/auth/login',
  AUTH_LOGOUT   : '/api/auth/logout',
  AUTH_REGISTER : '/api/auth/register',
  AUTH_VERIFY   : '/api/auth/verify',
  AUTH_REFRESH  : '/api/auth/refresh',
  CONVOS        : '/api/projects/{id}/conversations',   // ← keep ONE
  CONVERSATIONS : (pid)                => `/api/projects/${pid}/conversations`,
  CONVERSATION  : (pid, cid)           => `/api/projects/${pid}/conversations/${cid}`,
  MESSAGES      : (pid, cid)           => `/api/projects/${pid}/conversations/${cid}/messages`
};

export const resolveApiEndpoints = (cfg) =>
  cfg?.API_ENDPOINTS || DEFAULT_API_ENDPOINTS;
