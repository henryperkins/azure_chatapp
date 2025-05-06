/**
 * Application-wide configuration object.
 * Exported as APP_CONFIG for use throughout the app.
 */
export const APP_CONFIG = {
  DEBUG: true,
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
    DEPENDENCY_WAIT: 15000
  },
  PERFORMANCE_THRESHOLDS: {
    INIT_WARN: 3000
  },
  API_ENDPOINTS: {
    // Example: CURRENT_USER: '/api/v1/users/me'
  }
};
