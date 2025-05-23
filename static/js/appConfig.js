/**
 * Application-wide configuration object.
 * Exported as APP_CONFIG for use throughout the app.
 */
export const APP_CONFIG = {
  DEBUG: true,
  VERBOSE_LOGGING: true, // Add this to enable verbose logging
  LOG_TO_CONSOLE: true,  // Add this to ensure console logging
  // Mantener vacío para usar la misma URL de origen que la página
  BASE_API_URL: '',
  SELECTORS: {
    APP_LOADING_SPINNER: '#appLoadingSpinner',
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
    AUTH_SETTINGS: '/api/auth/settings',
    USER_PROFILE: '/api/user/me',
    USER_PROJECTS: '/api/user/projects',
    USER_STARRED_CONVERSATIONS: '/api/preferences/starred',
    USER_UPDATE_PREFERENCES: '/api/user/preferences'
  },
  LOGGING: {
    BACKEND_ENABLED: true,
    CONSOLE_ENABLED: true,
    SENTRY_ENABLED: true,
    MIN_LEVEL: 'debug'  // Set to 'debug' for maximum visibility
  },
  DEBUG_UI: false,          // enables unresolved-selector report
};
