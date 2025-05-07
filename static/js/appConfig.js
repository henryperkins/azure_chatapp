/**
 * Application-wide configuration object.
 * Exported as APP_CONFIG for use throughout the app.
 */
export const APP_CONFIG = {
  DEBUG: true,
  BASE_API_URL: 'http://localhost:8000', // Explicitly set API base URL
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
    API_REQUEST: 10000 // Added a default API timeout, was missing in globalUtils for timer
  },
  PERFORMANCE_THRESHOLDS: {
    INIT_WARN: 3000
  },
  API_ENDPOINTS: {
    // Example: CURRENT_USER: '/api/v1/users/me'
    // Relative paths here will be prefixed by BASE_API_URL
  }
};
