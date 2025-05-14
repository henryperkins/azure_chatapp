/**
 * app.js – Main application orchestration.
 *
 * ╔════════════════ WARNING: BOOTSTRAP EXCEPTION ════════════════╗
 * ║ This is the ONLY JS/TS module permitted to contain          ║
 * ║ top-level code, side effects, and initialization logic.     ║
 * ║ ALL other modules MUST export factories with no import-time ║
 * ║ effects, per .clinerules/custominstructions.md.             ║
 * ║ This exception is intentional for app.js as Root Orchestrator║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Coordinates module wiring, initialization phases, and DI usage.
 */

import { APP_CONFIG } from './appConfig.js';
import { createDomAPI } from './utils/domAPI.js';
import { createBrowserService, normaliseUrl } from './utils/browserService.js';
import { createDebugTools, safeInvoker, maybeCapture } from './utils/notifications-helpers.js';
import { createApiClient } from './utils/apiClient.js';
import { createNotify } from './utils/notify.js';
import { createHtmlTemplateLoader } from './utils/htmlTemplateLoader.js';
import { createSentryManager } from './sentry-init.js';

import {
  shouldSkipDedup,
  stableStringify,
  isAbsoluteUrl,
  isValidProjectId,
  toggleElement,
  waitForDepsAndDom
} from './utils/globalUtils.js';

import { createEventHandlers } from './eventHandler.js';
import { createNotificationHandler } from './notification-handler.js';
import { createAuthModule } from './auth.js';
import { createChatManager } from './chat.js';
import { createProjectManager } from './projectManager.js';
import { createProjectModal, createModalManager } from './modalManager.js';
import { createChatExtensions } from './chatExtensions.js';
import { createModelConfig } from './modelConfig.js';
import { createProjectDashboardUtils } from './projectDashboardUtils.js';
import { createProjectDashboard } from './projectDashboard.js';
import { ProjectListComponent } from './projectListComponent.js';
import { createProjectDetailsComponent } from './projectDetailsComponent.js';
import { createSidebar } from './sidebar.js';
import { createUiRenderer } from './uiRenderer.js';
import { createKnowledgeBaseComponent } from './knowledgeBaseComponent.js';
import { createAccessibilityEnhancements } from './accessibility-utils.js';
import { createNavigationService } from './navigationService.js';

import MODAL_MAPPINGS from './modalConstants.js';
import { FileUploadComponent } from './FileUploadComponent.js';

// ---------------------------------------------------------------------------
// UI helpers for KnowledgeBaseComponent
// ---------------------------------------------------------------------------
const uiUtils = {
  formatBytes: (b = 0, dp = 1) => {
    if (b === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(dp)) + ' ' + sizes[i];
  },
  formatDate: (d) => {
    const date = d instanceof Date ? d : new Date(d);
    return isNaN(date) ? '' : date.toLocaleString();
  },
  fileIcon: (type = '') => {
    const map = {
      pdf: '📄',
      doc: '📄',
      docx: '📄',
      csv: '🗒️',
      json: '🗒️',
      png: '🖼️',
      jpg: '🖼️',
      jpeg: '🖼️'
    };
    return map[(type || '').toLowerCase()] ?? '📄';
  }
};

// ---------------------------------------------------------------------------
// 1) Create base services
// ---------------------------------------------------------------------------
const browserServiceInstance = createBrowserService({
  windowObject: (typeof window !== 'undefined') ? window : undefined
});
const browserAPI = browserServiceInstance;

const domAPI = createDomAPI({
  documentObject: browserAPI.getDocument(),
  windowObject: browserAPI.getWindow(),
  debug: APP_CONFIG.DEBUG === true
});

// ---------------------------------------------------------------------------
// 2) Initialize DependencySystem
// ---------------------------------------------------------------------------
const DependencySystem = browserAPI.getDependencySystem();
if (!DependencySystem?.modules?.get) {
  throw new Error('[App] DependencySystem not present – bootstrap aborted');
}

// Dedicated App Event Bus
const AppBus = new EventTarget();
DependencySystem.register('AppBus', AppBus);

// ---------------------------------------------------------------------------
// 3) Register base services
// ---------------------------------------------------------------------------
DependencySystem.register('domAPI', domAPI);
DependencySystem.register('browserAPI', browserAPI);
DependencySystem.register('browserService', browserServiceInstance);
DependencySystem.register('storage', browserServiceInstance);
DependencySystem.register('uiUtils', uiUtils);

const globalUtils = {
  waitForDepsAndDom,
  isValidProjectId,
  isAbsoluteUrl,
  normaliseUrl,
  shouldSkipDedup,
  stableStringify
};
DependencySystem.register('globalUtils', globalUtils);

const sanitizer = browserAPI.getWindow()?.DOMPurify;
if (!sanitizer) {
  throw new Error(
    '[App] DOMPurify not found – aborting bootstrap for security reasons. ' +
    'Load it with SRI before app.js'
  );
}
DependencySystem.register('sanitizer', sanitizer);
DependencySystem.register('domPurify', sanitizer); // legacy alias

DependencySystem.register('FileUploadComponent', FileUploadComponent);

// Register apiEndpoints
const apiEndpoints = APP_CONFIG?.API_ENDPOINTS || {
  PROJECTS: '/api/projects/',
  AUTH_CSRF: '/api/auth/csrf',
  AUTH_LOGIN: '/api/auth/login',
  AUTH_LOGOUT: '/api/auth/logout',
  AUTH_REGISTER: '/api/auth/register',
  AUTH_VERIFY: '/api/auth/verify',
  AUTH_REFRESH: '/api/auth/refresh',
  CONVOS: '/api/projects/{id}/conversations',
  PROJECT_CONVERSATIONS_URL_TEMPLATE: '/api/projects/{id}/conversations',
  CONVERSATIONS: (projectId) => `/api/projects/${projectId}/conversations`,
  CONVERSATION: (projectId, conversationId) => `/api/projects/${projectId}/conversations/${conversationId}`,
  MESSAGES: (projectId, conversationId) => `/api/projects/${projectId}/conversations/${conversationId}/messages`
};
DependencySystem.register('apiEndpoints', apiEndpoints);

// ---------------------------------------------------------------------------
// 4) Early app module
// ---------------------------------------------------------------------------
const appModule = {
  state: {
    isAuthenticated: false,
    currentUser: null,
    isReady: false,
    disableErrorTracking: false
  },
  // Instead of direct mutation, do a single method to modify state
  setAuthState(authState) {
    Object.assign(this.state, authState);
  }
};
DependencySystem.register('appModule', appModule);

// ---------------------------------------------------------------------------
// Temporary stub: register an empty “app” early so any
// DependencySystem.waitFor('app') calls in factories executed below
// succeed immediately. The full App API is assigned later (~line 324).
const app = {};
DependencySystem.register('app', app);

// ---------------------------------------------------------------------------
// NotificationHandler -> real `notify`
// ---------------------------------------------------------------------------
// Create notification handler with forced logging
console.log('[APP] Creating notification handler...');
const notificationHandler = createNotificationHandler({
  DependencySystem,
  domAPI,
  sanitizer: DependencySystem.modules.get('sanitizer'),
  logToConsole: true, // Force console logging
  verboseLogging: true // Force verbose logging
});

// Register notification handler
console.log('[APP] Registering notification handler...');
DependencySystem.register('notificationHandler', notificationHandler);

// Initialize notification handler
console.log('[APP] Initializing notification handler...');
try {
  await notificationHandler.init();
  console.log('[APP] Notification handler initialized successfully');
} catch (error) {
  console.error('[APP] Error initializing notification handler:', error);
}

// Create notify system
console.log('[APP] Creating notify system...');
const notify = createNotify({
  notificationHandler,
  DependencySystem
});

// Register notify system
console.log('[APP] Registering notify system...');
DependencySystem.register('notify', notify);

// Test notification
console.log('[APP] Testing notification system...');
try {
  notify.info('Notification system initialized', {
    module: 'App',
    context: 'bootstrap',
    source: 'notificationSetup'
  });
  console.log('[APP] Test notification sent successfully');
} catch (error) {
  console.error('[APP] Error sending test notification:', error);
}

const appNotify = notify.withContext({ module: 'App', context: 'bootstrap' });

// ---------------------------------------------------------------------------
// 6) Create error reporter (Sentry)
// ---------------------------------------------------------------------------
const sentryConfig = {
  dsn: 'https://b03711f63d1160f48dcaeda3edae14ac@o4508070823395328.ingest.us.sentry.io/4509138383863808',
  environment: 'production',
  release: 'frontend-app@1.0.0',
  sampleRates: { traces: 1.0, replaysSession: 0.0, replaysOnError: 1.0 }
};
const sentryEnv = {};
const sentryNamespace = browserAPI.getWindow()?.Sentry ? browserAPI.getWindow() : { Sentry: undefined };

const sentryManager = createSentryManager({
  config: sentryConfig,
  env: sentryEnv,
  domAPI,
  storage: browserServiceInstance,
  notification: notify,
  navigator: browserAPI.getWindow()?.navigator,
  window: browserAPI.getWindow(),
  document: browserAPI.getDocument(),
  sentryNamespace
});
await sentryManager.initialize();

DependencySystem.register('sentryManager', sentryManager);
DependencySystem.register('errorReporter', sentryManager);
const errorReporter = sentryManager;

// ---------------------------------------------------------------------------
// 7) Debug tools
// ---------------------------------------------------------------------------
const debugTools = createDebugTools({ notify });
DependencySystem.register('debugTools', debugTools);
const _dbg = debugTools;

// ---------------------------------------------------------------------------
// 7.5) Create API client & backend logger
// ---------------------------------------------------------------------------
const apiRequest = createApiClient({
  APP_CONFIG,
  globalUtils: { shouldSkipDedup, stableStringify, normaliseUrl, isAbsoluteUrl },
  notify,
  errorReporter,
  getAuthModule: () => DependencySystem.modules.get('auth'),
  browserService: browserServiceInstance
});
DependencySystem.register('apiRequest', apiRequest);

import { createBackendLogger } from './utils/backendLogger.js';
const backendLogger = createBackendLogger({
  apiClient: apiRequest,
  notify,
  errorReporter,
  DependencySystem
});
DependencySystem.register('backendLogger', backendLogger);

// Immediately log that app.js has loaded
try {
  backendLogger.log({
    level: 'info',
    module: 'App',
    message: 'app.js loaded at import'
  });

  // Add additional debug logs to verify notification system is working
  notify.info('app.js loaded at import', {
    module: 'App',
    context: '',
    source: ''
  });

  // Force console logging for debugging
  console.log('[DEBUG] app.js loaded - notification system test');
  console.log('[DEBUG] notificationHandler initialized:', !!notificationHandler);
  console.log('[DEBUG] notify initialized:', !!notify);
  console.log('[DEBUG] backendLogger initialized:', !!backendLogger);
} catch (err) {
  console.error('[CRITICAL] Failed to log app.js loaded:', err);
}

// ---------------------------------------------------------------------------
// Create eventHandlers
// ---------------------------------------------------------------------------
const eventHandlers = createEventHandlers({
  DependencySystem,
  domAPI,
  browserService: browserServiceInstance,
  notify,
  errorReporter,
  backendLogger,
  APP_CONFIG,
  sanitizer
});
DependencySystem.register('eventHandlers', eventHandlers);

// ---------------------------------------------------------------------------
// Accessibility enhancements
// ---------------------------------------------------------------------------
const accessibilityUtils = createAccessibilityEnhancements({
  domAPI,
  eventHandlers,
  notify,
  errorReporter
});
DependencySystem.register('accessibilityUtils', accessibilityUtils);

// ---------------------------------------------------------------------------
// 10) Create navigation service
// ---------------------------------------------------------------------------
let navigationService = createNavigationService({
  domAPI,
  browserService: browserServiceInstance,
  DependencySystem,
  notify,
  eventHandlers,
  errorReporter
});
DependencySystem.register('navigationService', navigationService);

// ---------------------------------------------------------------------------
// 11) Create HTML template loader
// ---------------------------------------------------------------------------
const htmlTemplateLoader = createHtmlTemplateLoader({
  DependencySystem,
  domAPI,
  notify,
  apiClient: {                      // HtmlTemplateLoader expects an object with .fetch()
    fetch: (...args) => apiRequest(...args)
  },
  timerAPI: {
    setTimeout : (...args) => browserAPI.getWindow().setTimeout(...args),
    clearTimeout: (...args) => browserAPI.getWindow().clearTimeout(...args)
  }
});
DependencySystem.register('htmlTemplateLoader', htmlTemplateLoader);

// ---------------------------------------------------------------------------
// 12) app object & top-level state
// ---------------------------------------------------------------------------
let currentUser = null;
const appState = {
  initialized: false,
  initializing: false,
  isAuthenticated: false,
  currentPhase: 'idle'
};

let _globalInitCompleted = false;
let _globalInitInProgress = false;

/* Enrich the stub “app” (registered at line 179) with its real API */
Object.assign(app, {
  getProjectId: () => {
    const { search } = browserAPI.getLocation();
    return new URLSearchParams(search).get('project');
  },
  navigateToConversation: async (chatId) => {
    const chatMgr = DependencySystem.modules.get('chatManager');
    if (chatMgr?.loadConversation) {
      return chatMgr.loadConversation(chatId);
    }
    appNotify.warn('chatManager not available for navigateToConversation', {
      module: 'App',
      context: 'navigateToConversation',
      source: 'appObject'
    });
    return false;
  },
  validateUUID: (id) => isValidProjectId(id),

  // Instead of directly mutating app.state, call the "auth" setter in appModule
  setCurrentUser: (user) => {
    const appModuleRef = DependencySystem.modules.get('appModule');
    appModuleRef?.setAuthState({
      currentUser: user // do not mutate app.state directly
    });
  }
});

// Stub was already registered at line 180; no need to re-register.
app.DependencySystem = DependencySystem;
app.apiRequest = apiRequest;
app.state = appState;

// Force currentUser to null in DI
DependencySystem.register('currentUser', null);
appNotify.info('"currentUser" initially registered as null in DI.', {
  module: 'App', context: 'bootstrap', source: 'appObject'
});

// ---------------------------------------------------------------------------
// 14) Main initialization function
// ---------------------------------------------------------------------------
export async function init() {
  const _trace = _dbg.start?.('App.init');
  if (_globalInitCompleted || _globalInitInProgress) {
    appNotify.warn('Duplicate initialization attempt blocked', {
      module: 'App',
      context: 'init',
      source: 'init.duplicateCheck'
    });
    return _globalInitCompleted;
  }
  if (appState.initialized || appState.initializing) {
    appNotify.info('Initialization attempt skipped (already done or in progress).', {
      module: 'App',
      context: 'init',
      source: 'init.alreadyDone'
    });
    return appState.initialized;
  }

  _globalInitInProgress = true;
  appState.initializing = true;
  appState.currentPhase = 'starting_init_process';

  appNotify.debug('START init()', {
    module: 'App', context: 'init', source: 'init.start'
  });

  toggleLoadingSpinner(true);

  try {
    // 1) Initialize core systems in order
    await initializeCoreSystems();

    // 2) Wait for critical dependencies
    try {
      await DependencySystem.waitFor(
        ['auth', 'eventHandlers', 'notificationHandler', 'modalManager'],
        null,
        APP_CONFIG.TIMEOUTS?.DEPENDENCY_WAIT
      );
    } catch (err) {
      appNotify.error('Critical deps not met', {
        module: 'App',
        context: 'init.waitForDeps',
        source: 'init.waitForDeps',
        error: err
      });
      maybeCapture(errorReporter, err, {
        module: 'App',
        method: 'init',
        source: 'waitForDeps'
      });
      throw err;
    }

    // 3) Initialize auth system
    await initializeAuthSystem();

    // 4) If authenticated, fetch current user
    if (appState.isAuthenticated) {
      const user = await fetchCurrentUser();
      if (user) {
        currentUser = user;
        app.setCurrentUser(user);
        browserAPI.setCurrentUser(user);
        appNotify.info(`User fetched in init. ID: ${user.id}`, {
          module: 'App',
          context: 'init',
          source: 'init.fetchCurrentUser'
        });
      }
    }

    // 5) Initialize UI components
    await initializeUIComponents();

    // 6) (Optional) initialize leftover model config UI
    try {
      const mc = DependencySystem.modules.get('modelConfig');
      if (mc?.initializeUI) {
        mc.initializeUI();
      }
    } catch (mcErr) {
      appNotify.warn('Error initializing modelConfig UI', {
        module: 'App',
        context: 'init.modelConfig',
        source: 'init.modelConfig',
        error: mcErr
      });
      maybeCapture(errorReporter, mcErr, {
        module: 'App',
        method: 'init',
        source: 'modelConfig'
      });
    }

    // 7) Register app-level listeners
    registerAppListeners();

    // 8) Initialize navigation service
    const navService = DependencySystem.modules.get('navigationService');
    if (!navService) {
      throw new Error('[App] NavigationService missing from DI. Aborting initialization.');
    }
    navigationService = navService;

    if (navigationService?.init) {
      await navigationService.init();
      appNotify.info('NavigationService initialized', {
        module: 'App',
        context: 'init.navigationService',
        source: 'navigationService'
      });

      // Register default views
      const projectDashboard = DependencySystem.modules.get('projectDashboard');
      if (projectDashboard?.components) {

        // Enhanced projectList view registration with dependency waiting
        if (!navigationService.hasView('projectList')) {
          navigationService.registerView('projectList', {
            show: async () => {
              appNotify.info('NavigationService: showing projectList view', {
                module: 'App',
                context: 'navigationService.projectList.show',
                source: 'navigationService'
              });

              // Wait for both projectDashboard and projectListComponent to be available
              try {
                await DependencySystem.waitFor(['projectDashboard', 'projectListComponent'], null, 10000);

                const dashboard = DependencySystem.modules.get('projectDashboard');
                if (dashboard?.showProjectList) {
                  appNotify.info('Showing project list via projectDashboard.showProjectList', {
                    module: 'App',
                    context: 'navigationService.projectList.show',
                    source: 'navigationService'
                  });
                  await dashboard.showProjectList();
                  return true;
                } else {
                  // Fallback to direct component access if dashboard method not available
                  const plc = DependencySystem.modules.get('projectListComponent');
                  if (plc?.show) {
                    appNotify.info('Showing project list via direct projectListComponent.show', {
                      module: 'App',
                      context: 'navigationService.projectList.show',
                      source: 'navigationService'
                    });
                    await plc.show();
                    return true;
                  }
                }

                appNotify.error('Failed to show project list: methods not available', {
                  module: 'App',
                  context: 'navigationService.projectList.show',
                  source: 'navigationService'
                });
                return false;
              } catch (err) {
                appNotify.error('Error waiting for dependencies in projectList view show handler', {
                  module: 'App',
                  context: 'navigationService.projectList.show',
                  source: 'navigationService',
                  error: err
                });
                maybeCapture(errorReporter, err, {
                  module: 'App',
                  method: 'navigationService.projectList.show',
                  source: 'waitForDeps'
                });
                return false;
              }
            },
            hide: async () => {
              appNotify.info('NavigationService: hiding projectList view', {
                module: 'App',
                context: 'navigationService.projectList.hide',
                source: 'navigationService'
              });

              try {
                // Try dashboard method first
                const dashboard = DependencySystem.modules.get('projectDashboard');
                if (dashboard?.components?.projectList?.hide) {
                  await dashboard.components.projectList.hide();
                  return true;
                }

                // Fallback to direct component access
                const plc = DependencySystem.modules.get('projectListComponent');
                if (plc?.hide) {
                  await plc.hide();
                  return true;
                }

                return false;
              } catch (err) {
                appNotify.warn('Error hiding project list view', {
                  module: 'App',
                  context: 'navigationService.projectList.hide',
                  source: 'navigationService',
                  error: err
                });
                return false;
              }
            }
          });
          appNotify.info('Registered enhanced projectList view with NavigationService', {
            module: 'App',
            context: 'init.navigationService',
            source: 'init.navigationService'
          });
        }

        // Enhanced projectDetails view registration with dependency waiting
        if (!navigationService.hasView('projectDetails')) {
          navigationService.registerView('projectDetails', {
            show: async (params) => {
              appNotify.info('NavigationService: showing projectDetails view', {
                module: 'App',
                context: 'navigationService.projectDetails.show',
                source: 'navigationService',
                params
              });

              // Wait for both projectDashboard and projectDetailsComponent to be available
              try {
                await DependencySystem.waitFor(['projectDashboard', 'projectDetailsComponent'], null, 10000);

                // First try the dashboard method
                const dashboard = DependencySystem.modules.get('projectDashboard');
                if (dashboard?.showProjectDetails) {
                  appNotify.info('Showing project details via projectDashboard.showProjectDetails', {
                    module: 'App',
                    context: 'navigationService.projectDetails.show',
                    source: 'navigationService',
                    projectId: params.projectId
                  });
                  await dashboard.showProjectDetails(params.projectId);
                  return true;
                }

                // Then try the component directly
                const pdc = DependencySystem.modules.get('projectDetailsComponent');
                if (pdc?.showProjectDetails) {
                  appNotify.info('Showing project details via direct projectDetailsComponent.showProjectDetails', {
                    module: 'App',
                    context: 'navigationService.projectDetails.show',
                    source: 'navigationService',
                    projectId: params.projectId
                  });
                  await pdc.showProjectDetails(params.projectId);
                  return true;
                }

                appNotify.error('Failed to show project details: methods not available', {
                  module: 'App',
                  context: 'navigationService.projectDetails.show',
                  source: 'navigationService',
                  projectId: params.projectId
                });
                return false;
              } catch (err) {
                appNotify.error('Error waiting for dependencies in projectDetails view show handler', {
                  module: 'App',
                  context: 'navigationService.projectDetails.show',
                  source: 'navigationService',
                  projectId: params.projectId,
                  error: err
                });
                maybeCapture(errorReporter, err, {
                  module: 'App',
                  method: 'navigationService.projectDetails.show',
                  source: 'waitForDeps'
                });
                return false;
              }
            },
            hide: async () => {
              appNotify.info('NavigationService: hiding projectDetails view', {
                module: 'App',
                context: 'navigationService.projectDetails.hide',
                source: 'navigationService'
              });

              try {
                // Try dashboard method first
                const dashboard = DependencySystem.modules.get('projectDashboard');
                if (dashboard?.components?.projectDetails?.hideProjectDetails) {
                  await dashboard.components.projectDetails.hideProjectDetails();
                  return true;
                }

                // Fallback to direct component access
                const pdc = DependencySystem.modules.get('projectDetailsComponent');
                if (pdc?.hideProjectDetails) {
                  await pdc.hideProjectDetails();
                  return true;
                }

                return false;
              } catch (err) {
                appNotify.warn('Error hiding project details view', {
                  module: 'App',
                  context: 'navigationService.projectDetails.hide',
                  source: 'navigationService',
                  error: err
                });
                return false;
              }
            }
          });
          appNotify.info('Registered enhanced projectDetails view with NavigationService', {
            module: 'App',
            context: 'init.navigationService',
            source: 'init.navigationService'
          });
        }
      }
    } else {
      appNotify.error('NavigationService lacks .init() method.', {
        module: 'App',
        context: 'init.navigationService',
        source: 'navigationService'
      });
    }

    // Mark app as initialized
    appState.initialized = true;
    _globalInitCompleted = true;
    appNotify.info('Initialization complete.', {
      module: 'App',
      context: 'init.complete',
      source: 'init.complete',
      authenticated: appState.isAuthenticated
    });

    // Log event
    backendLogger.log({
      level: 'info',
      module: 'App',
      message: 'App initialization completed'
    });

    AppBus.dispatchEvent(new CustomEvent('app:ready', { detail: { success: true } }));

    return true;
  } catch (err) {
    appNotify.error(`Initialization failed: ${err?.message}`, {
      module: 'App',
      context: 'init.catch',
      source: 'init.catch',
      error: err
    });
    maybeCapture(errorReporter, err, {
      module: 'App',
      method: 'init',
      source: 'catch'
    });
    handleInitError(err);

    AppBus.dispatchEvent(new CustomEvent('app:ready', {
      detail: { success: false, error: err }
    }));
    return false;
  } finally {
    _globalInitInProgress = false;
    appState.initializing = false;
    toggleLoadingSpinner(false);
    appState.currentPhase = appState.initialized ? 'initialized_idle' : 'failed_idle';
    _dbg.stop?.(_trace, 'App.init');
  }
}

// ---------------------------------------------------------------------------
// 15) Core systems initialization
// ---------------------------------------------------------------------------
async function initializeCoreSystems() {
  // Store initialization start time for duration calculation
  const initStartTime = Date.now();

  // Generate a unique trace ID for this initialization
  const traceId = `core-init-${initStartTime}`;
  const transactionId = `core-txn-${initStartTime}`;

  // Start performance trace if debug tools available
  const _t = _dbg.start?.('initializeCoreSystems');

  try {
    appNotify.info('Initializing core systems...', {
      module: 'App',
      context: 'initializeCoreSystems',
      source: 'initializeCoreSystems.start',
      timestamp: initStartTime,
      traceId,
      transactionId
    });

    // Log initialization attempt to backend
    if (backendLogger && typeof backendLogger.log === 'function') {
      backendLogger.log({
        level: 'info',
        module: 'App',
        message: 'core_systems_initialization_started',
        metadata: {
          timestamp: initStartTime,
          traceId,
          transactionId
        }
      });
    }

    // Wait for minimal DOM readiness
    await waitForDepsAndDom({
      DependencySystem,
      domAPI,
      deps: ['domAPI', 'notify'],
      domSelectors: ['body']
    });

    // Create & init modal manager
    const modalManager = createModalManager({
      domAPI,
      browserService: browserServiceInstance,
      eventHandlers,
      DependencySystem,
      modalMapping: MODAL_MAPPINGS,
      notify,
      domPurify: sanitizer
    });
    DependencySystem.register('modalManager', modalManager);

    // Create auth module
    const authModule = createAuthModule({
      DependencySystem,
      apiClient: apiRequest,
      notify,
      eventHandlers,
      domAPI,
      sanitizer,
      modalManager,
      apiEndpoints
    });
    DependencySystem.register('auth', authModule);

    // Create model config
    const modelConfigInstance = createModelConfig({
      dependencySystem: DependencySystem,          // mandatory (note lower-camel case)
      notificationHandler,                         // full handler object (notify/warn/error)
      eventHandler: eventHandlers,                 // centralised listener tracker
      storageHandler: DependencySystem.modules.get('storage'),
      sanitizer: DependencySystem.modules.get('sanitizer'),
      errorReporter,                               // error reporting / Sentry
      backendLogger                                // optional but recommended
    });
    DependencySystem.register('modelConfig', modelConfigInstance);

    // Create or retrieve chatManager
    const chatManager = createOrGetChatManager();

    // Create projectManager
    const projectManager = await createProjectManager({
      DependencySystem,
      chatManager,
      app,
      modelConfig: modelConfigInstance,
      notify,
      debugTools,
      apiRequest,
      apiEndpoints,
      storage: DependencySystem.modules.get('storage'),
      listenerTracker: {
        add: (el, type, handler, description) =>
          eventHandlers.trackListener(el, type, handler, {
            description,
            context: 'projectManager'
          }),
        remove: () => eventHandlers.cleanupListeners({ context: 'projectManager' })
      },
      domAPI
    });
    eventHandlers.setProjectManager?.(projectManager);

    // Initialize eventHandlers now that its downstream deps exist
    if (eventHandlers?.init) {
      await eventHandlers.init();
    }

    // Create project dashboard with strict dependency injection
    const projectDashboard = createProjectDashboard({
      dependencySystem: DependencySystem,
      notificationHandler,
      domAPI,
      browserService: browserServiceInstance,
      eventHandlers,
      errorReporter
    });
    DependencySystem.register('projectDashboard', projectDashboard);

    // Create project modal
    const projectModal = createProjectModal({
      DependencySystem,
      eventHandlers,
      notify,
      domAPI,
      browserService: browserServiceInstance,
      domPurify: sanitizer
    });
    DependencySystem.register('projectModal', projectModal);

    // Wait for modals to load
    let modalsLoadedSuccess = false;
    await new Promise((res) => {
      eventHandlers.trackListener(
        domAPI.getDocument(),
        'modalsLoaded',
        (e) => {
          modalsLoadedSuccess = !!(e?.detail?.success);
          if (!modalsLoadedSuccess) {
            appNotify.error('modalsLoaded event fired but modals failed.', {
              module: 'App',
              context: 'initializeCoreSystems',
              source: 'modalsLoaded',
              error: e?.detail?.error
            });
            maybeCapture(errorReporter, e?.detail?.error, {
              module: 'App',
              method: 'initializeCoreSystems',
              source: 'modalsLoaded'
            });
          } else {
            appNotify.info('modalsLoaded: injected successfully', {
              module: 'App',
              context: 'initializeCoreSystems',
              source: 'modalsLoaded'
            });
          }
          res(true);
        },
        { once: true, description: 'modalsLoaded for app init', context: 'app' }
      );
    });

    if (!modalsLoadedSuccess) {
      appNotify.error('Modal HTML failed to load; login modal, etc. broken.', {
        module: 'App',
        context: 'initializeCoreSystems',
        source: 'modalsLoaded'
      });
    }

    // modalManager.init
    if (modalManager.init) {
      try {
        await modalManager.init();
        appNotify.info('modalManager.init() completed', {
          module: 'App',
          context: 'initializeCoreSystems',
          source: 'modalManager'
        });
      } catch (err) {
        appNotify.error('modalManager.init() failed', {
          module: 'App',
          context: 'initializeCoreSystems',
          source: 'modalManager',
          error: err
        });
        maybeCapture(errorReporter, err, {
          module: 'App',
          method: 'initializeCoreSystems',
          source: 'modalManager'
        });
      }
    }

    // Calculate initialization duration
    const initEndTime = Date.now();
    const initDuration = initEndTime - initStartTime;

    appNotify.info('Core systems initialized successfully', {
      module: 'App',
      context: 'initializeCoreSystems',
      source: 'initializeCoreSystems.complete',
      duration: initDuration,
      timestamp: initEndTime,
      traceId,
      transactionId
    });

    // Log to backend
    if (backendLogger && typeof backendLogger.log === 'function') {
      backendLogger.log({
        level: 'info',
        module: 'App',
        message: 'core_systems_initialization_complete',
        metadata: {
          timestamp: initEndTime,
          duration: initDuration,
          traceId,
          transactionId,
          componentsStatus: {
            auth: !!DependencySystem.modules.get('auth'),
            projectManager: !!DependencySystem.modules.get('projectManager'),
            projectDashboard: !!DependencySystem.modules.get('projectDashboard'),
            modalManager: !!DependencySystem.modules.get('modalManager')
          }
        }
      });
    }

    return true;
  } catch (err) {
    // Calculate initialization duration even for failed attempts
    const initEndTime = Date.now();
    const initDuration = initEndTime - initStartTime;

    // Capture error with detailed context
    maybeCapture(errorReporter, err, {
      module: 'App',
      method: 'initializeCoreSystems',
      source: 'initializeCoreSystems',
      traceId,
      transactionId,
      duration: initDuration
    });

    // Log detailed error information
    appNotify.error('Core systems initialization failed', {
      module: 'App',
      context: 'initializeCoreSystems',
      source: 'initializeCoreSystems.catch',
      error: err,
      errorMessage: err?.message,
      errorStack: err?.stack,
      traceId,
      transactionId,
      duration: initDuration
    });

    // Log to backend
    if (backendLogger && typeof backendLogger.log === 'function') {
      backendLogger.log({
        level: 'error',
        module: 'App',
        message: 'core_systems_initialization_failed',
        metadata: {
          timestamp: initEndTime,
          duration: initDuration,
          traceId,
          transactionId,
          error: err?.message,
          componentsStatus: {
            auth: !!DependencySystem.modules.get('auth'),
            projectManager: !!DependencySystem.modules.get('projectManager'),
            projectDashboard: !!DependencySystem.modules.get('projectDashboard'),
            modalManager: !!DependencySystem.modules.get('modalManager')
          }
        }
      });
    }

    throw err;
  } finally {
    // Always stop the trace in finally block to ensure it's stopped
    _dbg.stop?.(_t, 'initializeCoreSystems');
  }
}

// ---------------------------------------------------------------------------
// 16) Moved UI creation to the UI init phase
// ---------------------------------------------------------------------------
let _uiInitialized = false;
if (import.meta?.hot) {
  import.meta.hot.dispose(() => {
    _uiInitialized = false;
  });
}

async function initializeUIComponents() {
  const _t = _dbg.start?.('initializeUIComponents');
  try {
    if (_uiInitialized) {
      appNotify.warn('initializeUIComponents called again; skipping.', {
        module: 'App',
        context: 'initializeUIComponents',
        source: 'ui.alreadyInitialized'
      });
      return;
    }

    appNotify.debug('Initializing UI components...', {
      module: 'App',
      context: 'initializeUIComponents',
      source: 'ui.start'
    });

    // Wait for relevant DOM elements and ensure modals are loaded
    try {
      // First, wait for critical DOM elements
      await waitForDepsAndDom({
        DependencySystem,
        domAPI,
        domSelectors: [
          '#projectList',
          '#projectListView',
          '#projectDetailsView',
          '#projectTitle',
          '#projectDescription',
          '#backToProjectsBtn',
          '#projectFilterTabs',
          '#projectCardsPanel'
        ],
        timeout: 10000 // Increased timeout for reliability
      });

      appNotify.info('Critical DOM elements for UI components are ready', {
        module: 'App',
        context: 'initializeUIComponents',
        source: 'ui.waitForDom'
      });

      // Next, ensure modals are loaded by checking for the modalsLoaded event
      // This is important because project_list.html might be injected by the modal loader
      const modalsLoaded = await new Promise((resolve) => {
        // Check if we already received the modalsLoaded event
        const modalsContainer = domAPI.getElementById('modalsContainer');
        if (modalsContainer && modalsContainer.childElementCount > 0) {
          appNotify.info('Modals already loaded before waiting', {
            module: 'App',
            context: 'initializeUIComponents',
            source: 'ui.waitForModals'
          });
          return resolve(true);
        }

        // Set up timeout for modals loading
        const timeoutId = browserAPI.getWindow().setTimeout(() => {
          appNotify.warn('Timeout waiting for modalsLoaded event', {
            module: 'App',
            context: 'initializeUIComponents',
            source: 'ui.waitForModals'
          });
          resolve(false);
        }, 8000);

        // Listen for the modalsLoaded event
        eventHandlers.trackListener(
          domAPI.getDocument(),
          'modalsLoaded',
          (e) => {
            browserAPI.getWindow().clearTimeout(timeoutId);
            const success = !!(e?.detail?.success);
            appNotify.info(`modalsLoaded event received, success: ${success}`, {
              module: 'App',
              context: 'initializeUIComponents',
              source: 'ui.waitForModals'
            });
            resolve(success);
          },
          { once: true, description: 'Wait for modalsLoaded in initializeUIComponents', context: 'app' }
        );
      });

      if (!modalsLoaded) {
        appNotify.warn('Proceeding with UI initialization despite modals not loading', {
          module: 'App',
          context: 'initializeUIComponents',
          source: 'ui.waitForModals'
        });
      }
    } catch (err) {
      appNotify.error('Error waiting for DOM elements or modals', {
        module: 'App',
        context: 'initializeUIComponents',
        source: 'ui.waitForDom',
        error: err
      });
      maybeCapture(errorReporter, err, {
        module: 'App',
        method: 'initializeUIComponents',
        source: 'waitForDom'
      });
      // Continue despite error to attempt recovery
    }

    createAndRegisterUIComponents();

    // Initialize accessibility
    await safeInit(accessibilityUtils, 'AccessibilityUtils', 'init');

    // Create chat extensions
    const chatExtensionsInstance = createChatExtensions({
      DependencySystem,
      eventHandlers,
      notify
    });
    DependencySystem.register('chatExtensions', chatExtensionsInstance);
    await safeInit(chatExtensionsInstance, 'ChatExtensions', 'init');

    // Create project dashboard utils
    const projectDashboardUtilsInstance = createProjectDashboardUtils({ DependencySystem });
    DependencySystem.register('projectDashboardUtils', projectDashboardUtilsInstance);

    // Create UI renderer
    const uiRendererInstance = createUiRenderer({
      domAPI,
      eventHandlers,
      notify,
      apiRequest,
      apiEndpoints,
      onConversationSelect: async (conversationId) => {
        const chatManager = DependencySystem.modules.get('chatManager');
        if (chatManager?.loadConversation) {
          try {
            await chatManager.loadConversation(conversationId);
          } catch (err) {
            appNotify.error('Failed to load conversation from uiRenderer selection.', {
              module: 'App',
              context: 'initializeUIComponents',
              source: 'uiRenderer.onConversationSelect',
              conversationId,
              error: err
            });
            maybeCapture(errorReporter, err, {
              module: 'App',
              method: 'initializeUIComponents',
              source: 'uiRenderer.onConversationSelect'
            });
          }
        } else {
          appNotify.error('chatManager not available for onConversationSelect.', {
            module: 'App',
            context: 'initializeUIComponents',
            source: 'uiRenderer.onConversationSelect',
            conversationId
          });
        }
      },
      onProjectSelect: async (projectId) => {
        const projectDashboardDep = DependencySystem.modules.get('projectDashboard');
        if (projectDashboardDep?.showProjectDetails) {
          try {
            await projectDashboardDep.showProjectDetails(projectId);
          } catch (err) {
            appNotify.error('Failed to show project details from uiRenderer selection.', {
              module: 'App',
              context: 'initializeUIComponents',
              source: 'uiRenderer.onProjectSelect',
              projectId,
              error: err
            });
            maybeCapture(errorReporter, err, {
              module: 'App',
              method: 'initializeUIComponents',
              source: 'uiRenderer.onProjectSelect'
            });
          }
        } else {
          appNotify.error('projectDashboard not available for onProjectSelect.', {
            module: 'App',
            context: 'initializeUIComponents',
            source: 'uiRenderer.onProjectSelect',
            projectId
          });
        }
      }
    });
    DependencySystem.register('uiRenderer', uiRendererInstance);

    // Create sidebar
    let sidebarInstance = DependencySystem.modules.get('sidebar');
    if (!sidebarInstance) {
      sidebarInstance = createSidebar({
        DependencySystem,
        eventHandlers,
        app,
        projectDashboard: DependencySystem.modules.get('projectDashboard'),
        projectManager: DependencySystem.modules.get('projectManager'),
        uiRenderer: uiRendererInstance,
        notify,
        storageAPI: DependencySystem.modules.get('storage'),
        domAPI,
        viewportAPI: { getInnerWidth: () => browserAPI.getInnerWidth() },
        accessibilityUtils: DependencySystem.modules.get('accessibilityUtils')
      });
      DependencySystem.register('sidebar', sidebarInstance);
    }
    await safeInit(sidebarInstance, 'Sidebar', 'init');

    // If authenticated, load projects
    if (appState.isAuthenticated) {
      const pm = DependencySystem.modules.get('projectManager');
      pm?.loadProjects?.('all').catch(err => {
        appNotify.error('Failed to load projects in UI init', {
          module: 'App',
          context: 'initializeUIComponents',
          source: 'ui.loadProjects',
          error: err
        });
        maybeCapture(errorReporter, err, {
          module: 'App',
          method: 'initializeUIComponents',
          source: 'initializeUIComponents'
        });
      });
    }

    // External enhancements
    const w = browserAPI.getWindow();
    w?.initAccessibilityEnhancements?.({ domAPI, notify });
    w?.initSidebarEnhancements?.({ domAPI, notify, eventHandlers });

    _uiInitialized = true;
    notify.debug('[App] UI components initialized.', {
      module: 'App',
      context: 'initializeUIComponents',
      source: 'ui.complete'
    });
  } catch (err) {
    maybeCapture(errorReporter, err, {
      module: 'App',
      method: 'initializeUIComponents',
      source: 'ui.catch'
    });
    appNotify.error('UI components initialization failed.', {
      module: 'App',
      context: 'initializeUIComponents',
      source: 'ui.catch',
      error: err
    });
    throw err;
  } finally {
    _dbg.stop?.(_t, 'initializeUIComponents');
  }
}

function createAndRegisterUIComponents() {
  const projectListElement = domAPI.getElementById('projectList');
  const projectDetailsElement = domAPI.getElementById('projectDetailsView');
  const projectTitleElement = domAPI.getElementById('projectTitle');
  const projectDescriptionElement = domAPI.getElementById('projectDescription');
  const backBtnElement = domAPI.getElementById('backToProjectsBtn');

  if (!projectListElement) {
    appNotify.error('#projectList element not found, cannot create ProjectListComponent', {
      module: 'App',
      context: 'createUiComponents',
      source: 'createAndRegisterUIComponents'
    });
  }

  if (!projectDetailsElement || !projectTitleElement || !projectDescriptionElement || !backBtnElement) {
    appNotify.error('Project details elements not found, cannot create ProjectDetailsComponent', {
      module: 'App',
      context: 'createUiComponents',
      source: 'createAndRegisterUIComponents',
      detail: {
        projectDetailsFound: !!projectDetailsElement,
        projectTitleFound: !!projectTitleElement,
        projectDescriptionFound: !!projectDescriptionElement,
        backBtnFound: !!backBtnElement
      }
    });
  }

  if (projectListElement) {
    const projectListComponentInstance = new ProjectListComponent({
      projectManager: DependencySystem.modules.get('projectManager'),
      eventHandlers,
      modalManager: DependencySystem.modules.get('modalManager'),
      app,
      router: DependencySystem.modules.get('navigationService'),
      notify,
      storage: DependencySystem.modules.get('storage'),
      sanitizer: DependencySystem.modules.get('sanitizer'),
      domAPI,
      browserService: browserServiceInstance,
      globalUtils: DependencySystem.modules.get('globalUtils')
    });
    DependencySystem.register('projectListComponent', projectListComponentInstance);
  }

  const knowledgeBaseComponentInstance = createKnowledgeBaseComponent({
    DependencySystem,
    apiRequest,
    auth: DependencySystem.modules.get('auth'),
    projectManager: DependencySystem.modules.get('projectManager'),
    uiUtils,
    sanitizer: DependencySystem.modules.get('sanitizer')
  });
  DependencySystem.register('knowledgeBaseComponent', knowledgeBaseComponentInstance);

  if (projectDetailsElement && projectTitleElement && projectDescriptionElement && backBtnElement) {
    const projectDetailsComponentInstance = createProjectDetailsComponent({
      projectManager: DependencySystem.modules.get('projectManager'),
      eventHandlers,
      modalManager: DependencySystem.modules.get('modalManager'),
      FileUploadComponentClass: DependencySystem.modules.get('FileUploadComponent'),
      domAPI,
      notify,
      sanitizer: DependencySystem.modules.get('sanitizer'),
      app,
      router: DependencySystem.modules.get('navigationService'),
      errorReporter,
      chatManager: DependencySystem.modules.get('chatManager'),
      modelConfig: DependencySystem.modules.get('modelConfig'),
      knowledgeBaseComponent: knowledgeBaseComponentInstance,
      onBack: async () => {
        const navService = DependencySystem.modules.get('navigationService');
        navService?.navigateToProjectList();
      }
    });
    DependencySystem.register('projectDetailsComponent', projectDetailsComponentInstance);
  } else {
    appNotify.warn('Skipping ProjectDetailsComponent creation due to missing DOM elements', {
      module: 'App',
      context: 'createUiComponents',
      source: 'createAndRegisterUIComponents'
    });
  }

  // Update ProjectDashboard references
  const projectDashboardInstance = DependencySystem.modules.get('projectDashboard');
  if (projectDashboardInstance?.components) {
    const projectDetailsComponent = DependencySystem.modules.get('projectDetailsComponent');
    const projectListComponent = DependencySystem.modules.get('projectListComponent');

    if (projectDetailsComponent) {
      projectDashboardInstance.components.projectDetails = projectDetailsComponent;
    }
    if (projectListComponent) {
      projectDashboardInstance.components.projectList = projectListComponent;
    }

    appNotify.debug('ProjectDashboard components updated', {
      module: 'App',
      context: 'createUiComponents',
      source: 'createAndRegisterUIComponents',
      detail: {
        projectDetailsFound: !!projectDetailsComponent,
        projectListFound: !!projectListComponent
      }
    });
  } else {
    appNotify.warn('ProjectDashboard instance not found for updating components', {
      module: 'App',
      context: 'createUiComponents',
      source: 'createAndRegisterUIComponents'
    });
  }
}

// ---------------------------------------------------------------------------
// 17) Auth system initialization
// ---------------------------------------------------------------------------
async function initializeAuthSystem() {
  const auth = DependencySystem.modules.get('auth');
  if (!auth?.init) {
    throw new Error('[App] Auth module is missing or invalid.');
  }

  try {
    await auth.init();
    appState.isAuthenticated = auth.isAuthenticated();

    // Use appModule to also store it in appModule.state
    const appModuleRef = DependencySystem.modules.get('appModule');
    appModuleRef?.setAuthState({ isAuthenticated: appState.isAuthenticated });

    // Register auth events
    if (auth.AuthBus) {
      eventHandlers.trackListener(
        auth.AuthBus,
        'authStateChanged',
        handleAuthStateChange,
        { description: '[App] AuthBus authStateChanged', context: 'app' }
      );
      eventHandlers.trackListener(
        auth.AuthBus,
        'authReady',
        handleAuthStateChange,
        { description: '[App] AuthBus authReady', context: 'app' }
      );
    }

    renderAuthHeader();
    return true;
  } catch (err) {
    appState.isAuthenticated = false;
    // Also reflect in appModule
    const appModuleRef = DependencySystem.modules.get('appModule');
    appModuleRef?.setAuthState({ isAuthenticated: false });

    appNotify.error('Auth system initialization failed.', {
      module: 'App',
      context: 'initializeAuthSystem',
      source: 'authInit',
      error: err
    });
    maybeCapture(errorReporter, err, {
      module: 'App',
      method: 'initializeAuthSystem',
      source: 'initializeAuthSystem'
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 18) Additional helpers
// ---------------------------------------------------------------------------
async function safeInit(instance, name, methodName) {
  if (!instance) {
    appNotify.warn(`[App] ${name} instance not found for ${methodName}`, {
      module: 'App',
      context: 'safeInit',
      source: `safeInit-${name}-notFound`
    });
    return;
  }
  if (typeof instance[methodName] !== 'function') {
    appNotify.debug(`[App] ${name} has no ${methodName} method`, {
      module: 'App',
      context: 'safeInit',
      source: `safeInit-${name}-noMethod`
    });
    return;
  }
  await instance[methodName]();
  appNotify.debug(`[App] ${name}.${methodName}() completed successfully`, {
    module: 'App',
    context: 'safeInit',
    source: `safeInit-${name}-success`
  });
}

function handleAuthStateChange(event) {
  const detail = event?.detail || {};
  const isAuthenticated = !!detail.authenticated;
  const user = detail.user || null;

  notify.debug(`[App] Auth state changed: ${isAuthenticated}`, {
    module: 'App',
    context: 'authStateChanged',
    source: 'handleAuthStateChange',
    extra: { user, eventSource: detail.source }
  });

  // Update top-level appState
  appState.isAuthenticated = isAuthenticated;

  // Also reflect in appModule
  const appModuleRef = DependencySystem.modules.get('appModule');
  appModuleRef?.setAuthState({ isAuthenticated, currentUser: user });

  currentUser = user;
  renderAuthHeader();

  const chatManager = DependencySystem.modules.get('chatManager');
  if (chatManager?.setAuthState) {
    chatManager.setAuthState(isAuthenticated);
  }
  const projectManager = DependencySystem.modules.get('projectManager');
  if (projectManager?.setAuthState) {
    projectManager.setAuthState(isAuthenticated);
  }

  if (isAuthenticated) {
    // Navigate to project list view after authentication
    const navService = DependencySystem.modules.get('navigationService');
    if (navService?.navigateToProjectList) {
      appNotify.info('Navigating to project list after authentication', {
        module: 'App',
        context: 'authStateChanged',
        source: 'handleAuthStateChange'
      });

      // Use a small delay to ensure auth state is fully processed
      setTimeout(() => {
        navService.navigateToProjectList()
          .then(success => {
            appNotify.info(`Navigation to project list ${success ? 'succeeded' : 'failed'}`, {
              module: 'App',
              context: 'authStateChanged',
              source: 'handleAuthStateChange'
            });
          })
          .catch(err => {
            appNotify.error('Error navigating to project list after auth change', {
              module: 'App',
              context: 'authStateChanged',
              source: 'handleAuthStateChange',
              error: err
            });
            maybeCapture(errorReporter, err, {
              module: 'App',
              method: 'handleAuthStateChange',
              source: 'navigateToProjectList'
            });
          });
      }, 100);
    } else if (projectManager?.loadProjects) {
      // Fallback to direct project loading if navigation service is not available
      appNotify.info('Loading projects directly after authentication (navigationService not available)', {
        module: 'App',
        context: 'authStateChanged',
        source: 'handleAuthStateChange'
      });

      projectManager.loadProjects('all').catch(err => {
        appNotify.error('Failed to load projects after auth change', {
          module: 'App',
          context: 'authStateChanged',
          source: 'handleAuthStateChange',
          error: err
        });
        maybeCapture(errorReporter, err, {
          module: 'App',
          method: 'handleAuthStateChange',
          source: 'loadProjects'
        });
      });
    } else {
      appNotify.warn('Cannot load projects after auth change - no navigation service or project manager available', {
        module: 'App',
        context: 'authStateChanged',
        source: 'handleAuthStateChange'
      });
    }
  }
}

function renderAuthHeader() {
  try {
    const authMod = DependencySystem.modules.get('auth');
    const isAuth = authMod?.isAuthenticated?.();
    const user = currentUser || { username: authMod?.getCurrentUser?.() };

    const authBtn = domAPI.getElementById('authButton');
    const userMenu = domAPI.getElementById('userMenu');
    const logoutBtn = domAPI.getElementById('logoutBtn');
    const userInitialsEl = domAPI.getElementById('userInitials');
    const authStatus = domAPI.getElementById('authStatus');
    const userStatus = domAPI.getElementById('userStatus');

    notify.debug('[App] renderAuthHeader invoked', {
      module: 'App',
      context: 'renderAuthHeader',
      source: 'renderAuthHeader',
      isAuth,
      authBtnExists: !!authBtn
    });

    if (isAuth) {
      if (authBtn) domAPI.addClass(authBtn, 'hidden');
      if (userMenu) domAPI.removeClass(userMenu, 'hidden');
    } else {
      if (authBtn) domAPI.removeClass(authBtn, 'hidden');
      if (userMenu) domAPI.addClass(userMenu, 'hidden');
      const orphan = domAPI.getElementById('headerLoginForm');
      if (orphan) orphan.remove();
    }

    if (isAuth && userMenu && userInitialsEl) {
      let initials = '?';
      if (user?.name) {
        initials = user.name.trim().split(/\s+/).map(p => p[0]).join('').toUpperCase();
      } else if (user?.username) {
        initials = user.username.trim().slice(0, 2).toUpperCase();
      }
      domAPI.setTextContent(userInitialsEl, initials);
    }

    if (authStatus) {
      domAPI.setTextContent(authStatus, isAuth
        ? (user?.username ? `Signed in as ${user.username}` : 'Authenticated')
        : 'Not Authenticated'
      );
    }

    if (userStatus) {
      domAPI.setTextContent(userStatus, isAuth && user?.username
        ? `Hello, ${user.name ?? user.username}`
        : 'Offline'
      );
    }

    if (logoutBtn) {
      eventHandlers.trackListener(
        logoutBtn,
        'click',
        (e) => {
          domAPI.preventDefault(e);
          authMod?.logout?.();
        },
        { description: 'Auth logout button', context: 'app' }
      );
    }
  } catch (err) {
    appNotify.error('Error rendering auth header.', {
      module: 'App',
      context: 'renderAuthHeader',
      source: 'renderAuthHeader',
      error: err
    });
    maybeCapture(errorReporter, err, {
      module: 'App',
      method: 'renderAuthHeader',
      source: 'renderAuthHeader'
    });
  }
}

async function fetchCurrentUser() {
  try {
    const authModule = DependencySystem.modules.get('auth');
    if (!authModule) {
      appNotify.error('Auth module not available in fetchCurrentUser.', {
        module: 'App',
        context: 'fetchCurrentUser',
        source: 'fetchCurrentUser'
      });
      return null;
    }

    if (authModule.fetchCurrentUser) {
      const userObj = await authModule.fetchCurrentUser();
      if (userObj?.id) {
        notify.debug('Fetched user via authModule.fetchCurrentUser', {
          module: 'App',
          context: 'fetchCurrentUser',
          source: 'fetchCurrentUser'
        });
        return userObj;
      }
      notify.warn('No valid ID from fetchCurrentUser', {
        module: 'App',
        context: 'fetchCurrentUser',
        source: 'fetchCurrentUser'
      });
    }

    if (authModule.getCurrentUserObject) {
      const userObjFromGetter = authModule.getCurrentUserObject();
      if (userObjFromGetter?.id) {
        notify.debug('Fetched user via authModule.getCurrentUserObject', {
          module: 'App',
          context: 'fetchCurrentUser',
          source: 'fetchCurrentUser'
        });
        return userObjFromGetter;
      }
      notify.warn('No valid ID from getCurrentUserObject', {
        module: 'App',
        context: 'fetchCurrentUser',
        source: 'fetchCurrentUser'
      });
    }

    if (authModule.getCurrentUserAsync) {
      const userObjAsync = await authModule.getCurrentUserAsync();
      if (userObjAsync?.id) {
        notify.debug('Fetched user via authModule.getCurrentUserAsync', {
          module: 'App',
          context: 'fetchCurrentUser',
          source: 'fetchCurrentUser'
        });
        return userObjAsync;
      }
      notify.warn('No valid ID from getCurrentUserAsync', {
        module: 'App',
        context: 'fetchCurrentUser',
        source: 'fetchCurrentUser'
      });
    }

    appNotify.error('No valid user object found via any auth method.', {
      module: 'App',
      context: 'fetchCurrentUser',
      source: 'fetchCurrentUser'
    });
    return null;
  } catch (error) {
    appNotify.error('Failed to fetch current user.', {
      module: 'App',
      context: 'fetchCurrentUser',
      source: 'fetchCurrentUser',
      error
    });
    maybeCapture(errorReporter, error, {
      module: 'App',
      method: 'fetchCurrentUser',
      source: 'fetchCurrentUser'
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// 21) App listeners and error handling
// ---------------------------------------------------------------------------
function registerAppListeners() {
  appNotify.debug('Registering global application listeners...', {
    module: 'App',
    context: 'registerAppListeners',
    source: 'registerAppListeners'
  });
  DependencySystem.waitFor(['auth', 'chatManager', 'projectManager', 'eventHandlers'])
    .then(() => {
      setupChatInitializationTrigger();
    })
    .catch(err => {
      appNotify.error('Error waiting for deps in registerAppListeners', {
        module: 'App',
        context: 'registerAppListeners',
        source: 'registerAppListeners',
        error: err
      });
      maybeCapture(errorReporter, err, {
        module: 'App',
        method: 'registerAppListeners',
        source: 'registerAppListeners'
      });
    });
}

function setupChatInitializationTrigger() {
  const projectManager = DependencySystem.modules.get('projectManager');
  const chatManager = DependencySystem.modules.get('chatManager');
  const auth = DependencySystem.modules.get('auth');

  if (!projectManager || !chatManager || !auth) {
    appNotify.warn('Missing dependencies for setupChatInitializationTrigger', {
      module: 'App',
      context: 'registerAppListeners',
      source: 'setupChatInitializationTrigger'
    });
    return;
  }

  eventHandlers.trackListener(
    domAPI.getDocument(),
    'projectSelected',
    async (e) => {
      const projectId = e?.detail?.projectId;
      if (!projectId) return;

      if (auth.isAuthenticated() && chatManager?.initialize) {
        try {
          await chatManager.initialize({ projectId });
          notify.debug('[App] ChatManager initialized for project', {
            module: 'App',
            context: 'setupChatInitializationTrigger',
            source: 'chatInitialization',
            projectId
          });
        } catch (err) {
          appNotify.error('Failed to initialize ChatManager for project', {
            module: 'App',
            context: 'setupChatInitializationTrigger',
            source: 'chatInitialization',
            projectId,
            error: err
          });
          maybeCapture(errorReporter, err, {
            module: 'App',
            method: 'setupChatInitializationTrigger',
            source: 'setupChatInitializationTrigger'
          });
        }
      }
    },
    { description: 'Initialize ChatManager on projectSelected', context: 'app' }
  );
}

function handleInitError(err) {
  appNotify.error('Initialization error', {
    module: 'App',
    context: 'init',
    source: 'handleInitError',
    error: err
  });
  try {
    const errorContainer = domAPI.getElementById('appInitError');
    if (errorContainer) {
      domAPI.setTextContent(errorContainer, `Application initialization failed: ${err?.message || 'Unknown error'}`);
      domAPI.removeClass(errorContainer, 'hidden');
    }
  } catch (displayErr) {
    appNotify.error('Failed to display init error', {
      module: 'App',
      context: 'init',
      source: 'handleInitError',
      error: displayErr,
      extra: { originalError: err }
    });
    maybeCapture(errorReporter, displayErr, {
      module: 'App',
      method: 'handleInitError',
      source: 'displayFail'
    });
  }
}

function toggleLoadingSpinner(show) {
  const spinner = domAPI.getElementById('appLoadingSpinner');
  if (spinner) {
    if (show) {
      domAPI.removeClass(spinner, 'hidden');
    } else {
      domAPI.addClass(spinner, 'hidden');
    }
  }
}

// ---------------------------------------------------------------------------
// 22) Chat manager creation (single instance check)
// ---------------------------------------------------------------------------
function createOrGetChatManager() {
  const existing = DependencySystem.modules.get('chatManager');
  if (existing) return existing;

  const authModule = DependencySystem.modules.get('auth');

  const cm = createChatManager({
    DependencySystem,
    apiRequest,
    auth: authModule,
    eventHandlers,
    modelConfig: DependencySystem.modules.get('modelConfig'),
    projectDetailsComponent: DependencySystem.modules.get('projectDetailsComponent'),
    app,
    domAPI,
    navAPI: {
      getSearch: () => browserAPI.getLocation().search,
      getHref: () => browserAPI.getLocation().href,
      pushState: (url, title = '') => browserAPI.getHistory().pushState({}, title, url),
      getPathname: () => browserAPI.getLocation().pathname
    },
    isValidProjectId,
    isAuthenticated: () => !!authModule?.isAuthenticated?.(),
    DOMPurify: DependencySystem.modules.get('sanitizer'),
    apiEndpoints,
    notificationHandler: notify,
    notify,
    errorReporter
  });

  DependencySystem.register('chatManager', cm);
  return cm;
}

// ---------------------------------------------------------------------------
// Boot if in browser
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
  // Add global error handler to catch and log any errors
  window.onerror = function(message, source, lineno, colno, error) {
    console.error('[GLOBAL ERROR]', message, 'at', source, lineno, colno, error);

    // Try to use notification system if available
    try {
      if (notify) {
        notify.error('Uncaught error: ' + message, {
          module: 'App',
          context: 'globalErrorHandler',
          source: source,
          originalError: error
        });
      }
    } catch (notifyError) {
      console.error('[NOTIFICATION ERROR]', notifyError);
    }

    return false; // Let default error handling continue
  };

  // Add unhandled promise rejection handler
  window.addEventListener('unhandledrejection', function(event) {
    console.error('[UNHANDLED PROMISE REJECTION]', event.reason);

    // Try to use notification system if available
    try {
      if (notify) {
        notify.error('Unhandled promise rejection', {
          module: 'App',
          context: 'unhandledRejection',
          source: 'window',
          originalError: event.reason
        });
      }
    } catch (notifyError) {
      console.error('[NOTIFICATION ERROR]', notifyError);
    }
  });

  console.log('[APP] Starting initialization...');

  const doc = browserAPI.getDocument();
  if (doc.readyState === 'loading') {
    // Use plain addEventListener so we don't rely on eventHandlers before init
    console.log('[APP] Document still loading, waiting for DOMContentLoaded');
    doc.addEventListener('DOMContentLoaded', function() {
      console.log('[APP] DOMContentLoaded fired, calling init()');
      init();
    }, { once: true });
  } else {
    console.log('[APP] Document already loaded, calling init() immediately');
    setTimeout(init, 0);
  }
}
