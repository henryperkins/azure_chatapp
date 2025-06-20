/**
 * Application-wide configuration object.
 * Exported as APP_CONFIG for use throughout the app.
 */
import { SELECTORS } from "./utils/selectorConstants.js";

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
    PROJECT_LIST_VIEW: SELECTORS.projectListView
  },
  TIMEOUTS: {
    // Allow slower devices / large bundles to resolve required selectors,
    // especially before authInit kicks in.
    DEPENDENCY_WAIT: 12000,     // generic waitFor timeout (was 5000 – too aggressive)
    STARTUP_ABORT: 30000,       // whole-app bootstrap max (was 12000)
    // DOM readiness often takes longer in low-spec devices or when the network
    // is slow to fetch templates. Increase to 20 s to avoid premature
    // bootstrap failures (authInit waiting for `app:ready`).
    DOM_READY      : 20000,
    APP_READY_WAIT : 30000,     // optional – used by authInit
    API_REQUEST: 30000 // Increased API timeout to 30 seconds
  },
  PERFORMANCE_THRESHOLDS: {
    INIT_WARN: 3000
  },
  API_ENDPOINTS: {
    AUTH_CSRF   : () => '/api/auth/csrf',
    AUTH_LOGIN  : () => '/api/auth/login',
    AUTH_LOGOUT : () => '/api/auth/logout',
    AUTH_REGISTER: () => '/api/auth/register',
    AUTH_VERIFY : () => '/api/auth/verify',
    AUTH_REFRESH: () => '/api/auth/refresh',
    AUTH_SETTINGS: () => '/api/auth/settings',
    USER_PROFILE: () => '/api/user/me',
    USER_PROJECTS: () => '/api/user/projects',
    USER_STARRED_CONVERSATIONS: () => '/api/preferences/starred',
    USER_UPDATE_PREFERENCES: () => '/api/user/preferences',
    // Project endpoints
    PROJECTS: () => '/api/projects/',
    PROJECT_DETAIL: (id) => `/api/projects/${id}/`,
    PROJECT_CONVERSATIONS_URL_TEMPLATE: (id) => `/api/projects/${id}/conversations`,
    PROJECT_FILES: (id) => `/api/projects/${id}/files/`,
    PROJECT_ARTIFACTS: (id) => `/api/projects/${id}/artifacts/`,
    // Conversation endpoints  
    CONVERSATIONS: (projectId) => `/api/projects/${projectId}/conversations`,
    CONVERSATION_DETAIL: (projectId, conversationId) => `/api/projects/${projectId}/conversations/${conversationId}`,
    // Knowledge base endpoints
    KB_LIST_URL_TEMPLATE: (id) => `/api/projects/${id}/knowledge-bases/`,
    KB_DETAIL_URL_TEMPLATE: (id, kb_id) => `/api/projects/${id}/knowledge-bases/${kb_id}/`,
    // File endpoints
    FILE_DETAIL: (id, file_id) => `/api/projects/${id}/files/${file_id}/`,
    FILE_DOWNLOAD: (id, file_id) => `/api/projects/${id}/files/${file_id}/download/`,
    ARTIFACT_DOWNLOAD: (id, artifact_id) => `/api/projects/${id}/artifacts/${artifact_id}/download/`,

    // Chat / Token estimation – new dynamic helper (Gap #4 remediation)
    ESTIMATE_TOKENS: (projectId, conversationId) =>
      `/api/projects/${projectId}/conversations/${conversationId}/estimate-tokens`
  },
  LOGGING: {
    BACKEND_ENABLED: true,
    CONSOLE_ENABLED: true,
    SENTRY_ENABLED: true,
    MIN_LEVEL: 'debug'  // Set to 'debug' for maximum visibility
  },
  DEBUG_UI: false,          // enables unresolved-selector report

  // --------------------------------------------------------------
  // Feature flags (toggle remediation plan rollout — see docs)
  // --------------------------------------------------------------
  FEATURE_FLAGS: {
    CHAT_ENH_FIXES: true
  }
};

/* Guard-rail factory export */
export function createAppConfig({ overrides = {}, DependencySystem, eventHandlers } = {}) {
  if (!DependencySystem) throw new Error('[appConfig] Missing DependencySystem');
  if (!eventHandlers?.cleanupListeners) throw new Error('[appConfig] Missing eventHandlers');
  const cfg = { ...APP_CONFIG, ...overrides };
  return {
    APP_CONFIG: cfg,
    cleanup() {
      eventHandlers.cleanupListeners({ context: 'appConfig' });
    }
  };
}
