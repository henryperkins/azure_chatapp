/**
 * Application-wide configuration object.
 * Exported as APP_CONFIG for use throughout the app.
 */
export const APP_CONFIG = {
  DEBUG: true,
  // Mantener vacío para usar la misma URL de origen que la página
  BASE_API_URL: '',
  SELECTORS: {
    APP_LOADING_SPINNER: '#appLoading',
    APP_FATAL_ERROR: '#appFatalError',
    LOGIN_REQUIRED_MESSAGE: '#loginRequiredMessage',
    AUTH_BUTTON: '#authButton',
    AUTH_STATUS_SPAN: '#authStatusSpan',
    USER_STATUS_SPAN: '#userStatusSpan',
    USER_MENU: '#userMenu',
    PROJECT_DETAILS_VIEW: '#projectDetailsView',
    PROJECT_LIST_VIEW: '#projectListView'
  },
  TIMEOUTS: {
    DEPENDENCY_WAIT: 5000,      // generic waitFor timeout (hardened, was 15000)
    STARTUP_ABORT: 12000,       // whole-app bootstrap max
    API_REQUEST: 30000 // Increased API timeout to 30 seconds
  },
  PERFORMANCE_THRESHOLDS: {
    INIT_WARN: 3000
  },
  API_ENDPOINTS: {
    AUTH_CSRF: '/api/auth/csrf',
    AUTH_LOGIN: '/api/auth/login',
    AUTH_LOGOUT: '/api/auth/logout',
    AUTH_REGISTER: '/api/auth/register',
    AUTH_VERIFY: '/api/auth/verify',
    AUTH_REFRESH: '/api/auth/refresh',

    // --- ADDED CHAT/CONVERSATION ENDPOINTS ---
    // List/create conversations for a project
    CONVERSATIONS: (projectId) => `/api/projects/${encodeURIComponent(projectId)}/conversations`,
    // Get/update/delete a specific conversation
    CONVERSATION: (projectId, conversationId) => `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}`,
    // List/post messages for a conversation
    MESSAGES: (projectId, conversationId) => `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/messages`
  }
};
