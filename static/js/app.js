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
import { createDebugTools } from './utils/notifications-helpers.js';
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

import { safeInvoker, maybeCapture } from './utils/notifications-helpers.js';

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
    const map = { pdf:'📄', doc:'📄', docx:'📄', csv:'🗒️', json:'🗒️', png:'🖼️', jpg:'🖼️', jpeg:'🖼️' };
    return map[(type||'').toLowerCase()] ?? '📄';
  }
};

// ---------------------------------------------------------------------------
// 1) Create base services: browserAPI, domAPI
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
// 3) Register base services in DependencySystem
// ---------------------------------------------------------------------------
DependencySystem.register('domAPI', domAPI);
DependencySystem.register('browserAPI', browserAPI);
DependencySystem.register('browserService', browserServiceInstance);
DependencySystem.register('storage', browserServiceInstance);
DependencySystem.register('uiUtils', uiUtils);

// Register globalUtils
const globalUtils = {
    waitForDepsAndDom,
    isValidProjectId,
    isAbsoluteUrl,
    normaliseUrl,
    shouldSkipDedup,
    stableStringify
};
DependencySystem.register('globalUtils', globalUtils);

// Register sanitizer (DOMPurify)
const sanitizer = browserAPI.getWindow()?.DOMPurify;
if (!sanitizer) {
    throw new Error('[App] DOMPurify sanitizer not found. Please ensure DOMPurify is loaded before app.js.');
}
DependencySystem.register('sanitizer', sanitizer);
DependencySystem.register('domPurify', sanitizer); // legacy alias

// Make the file-uploader class available to DI-consumers (ProjectDetailsComponent, etc.)
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
  MESSAGES: (projectId, conversationId) => `/api/projects/${projectId}/conversations/${conversationId}/messages`,
};
DependencySystem.register('apiEndpoints', apiEndpoints);

// ---------------------------------------------------------------------------
// 4) Create notification handler first (needed by other services)
// ---------------------------------------------------------------------------
const notificationHandler = createNotificationHandler({
  DependencySystem,
  domAPI
});
DependencySystem.register('notificationHandler', notificationHandler);

// ---------------------------------------------------------------------------
// 5) Create real notify instance (needed by almost everything)
// ---------------------------------------------------------------------------
const notify = createNotify({
  notificationHandler,
  DependencySystem
});
DependencySystem.register('notify', notify);
// STEP 5: Create module-scoped notifier for App
const appNotify = notify.withContext({ module: 'App', context: 'bootstrap' });

// Register logger that uses notify
const loggerInstance = {
  debug: (...args) => notify.debug(...args),
  info: (...args) => notify.info(...args),
  warn: (...args) => notify.warn(...args),
  error: (...args) => notify.error(...args)
};
DependencySystem.register('logger', loggerInstance);

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
DependencySystem.register('sentryManager', sentryManager);
DependencySystem.register('errorReporter', sentryManager);
sentryManager.initialize();
// Create a local alias so linting rules can detect the symbol
const errorReporter = sentryManager;

// ---------------------------------------------------------------------------
// 7) Create debug tools
// ---------------------------------------------------------------------------
const debugTools = createDebugTools({ notify });
DependencySystem.register('debugTools', debugTools);
const _dbg = debugTools;

// ---------------------------------------------------------------------------
// 8) Create event handlers (needed by many components)
// ---------------------------------------------------------------------------
const eventHandlers = createEventHandlers({
  DependencySystem,
  domAPI,
  browserService: browserServiceInstance,
  notify,
  errorReporter: sentryManager,
  APP_CONFIG
});
DependencySystem.register('eventHandlers', eventHandlers);

// ---------------------------------------------------------------------------
// 9) Create accessibility utils (depends on eventHandlers)
// ---------------------------------------------------------------------------
const accessibilityUtils = createAccessibilityEnhancements({
  domAPI,
  eventHandlers,
  notify,
  errorReporter: sentryManager
});
DependencySystem.register('accessibilityUtils', accessibilityUtils);
accessibilityUtils.init?.();

 // ---------------------------------------------------------------------------
 // 10) Create navigation service (depends on eventHandlers)
 // ---------------------------------------------------------------------------
let navigationService = createNavigationService({
  domAPI,
  browserService: browserServiceInstance,
  DependencySystem,
  notify,
  eventHandlers,
  errorReporter: sentryManager
});
DependencySystem.register('navigationService', navigationService);

// ---------------------------------------------------------------------------
// 11) Create HTML template loader
// ---------------------------------------------------------------------------
const htmlTemplateLoader = createHtmlTemplateLoader({
  DependencySystem,
  domAPI,
  notify
});
DependencySystem.register('htmlTemplateLoader', htmlTemplateLoader);

// Load HTML templates immediately to ensure they're available for components
(async function loadTemplates() {
  try {
    // Create proper cancellation signals for each template load
    const projectListSignal = new AbortController();
    const projectDetailsSignal = new AbortController();
    const modalsSignal = new AbortController();

    // Set safety timeouts
    const projectListTimeout = setTimeout(() => {
      projectListSignal.abort();
      notify.warn('[App] Timeout loading project_list.html, aborting fetch');
    }, 20000);
    const projectDetailsTimeout = setTimeout(() => {
      projectDetailsSignal.abort();
      notify.warn('[App] Timeout loading project_details.html, aborting fetch');
    }, 20000);
    const modalsTimeout = setTimeout(() => {
      modalsSignal.abort();
      notify.warn('[App] Timeout loading modals.html, aborting fetch');
    }, 20000);

    // --- Load project list template first ---
    try {
      await htmlTemplateLoader.loadTemplate({
        url: '/static/html/project_list.html',
        containerSelector: '#projectListView',
        eventName: 'projectListHtmlLoaded',
        timeout: 20000
      });
      notify.info('[App] Project list template loaded successfully');
    } catch (listErr) {
      notify.error('[App] Failed to load project list template', {
        error: listErr,
        critical: true
      });
      // Dispatch event anyway to prevent UI from hanging
      domAPI.dispatchEvent(
        domAPI.getDocument(),
        new CustomEvent('projectListHtmlLoaded', {
          detail: { success: false, error: listErr }
        })
      );
    } finally {
      clearTimeout(projectListTimeout);
    }

    // --- Load project details template ---
    try {
      await htmlTemplateLoader.loadTemplate({
        url: '/static/html/project_details.html',
        containerSelector: '#projectDetailsView',
        eventName: 'projectDetailsTemplateLoaded',
        timeout: 20000
      });
      notify.info('[App] Project details template loaded successfully');
    } catch (detailsErr) {
      notify.error('[App] Failed to load project details template', {
        error: detailsErr,
        critical: true
      });
      // Dispatch event anyway to prevent UI from hanging
      domAPI.dispatchEvent(
        domAPI.getDocument(),
        new CustomEvent('projectDetailsTemplateLoaded', {
          detail: { success: false, error: detailsErr }
        })
      );
    } finally {
      clearTimeout(projectDetailsTimeout);
    }

    // --- Load modals template ---
    try {
      await htmlTemplateLoader.loadTemplate({
        url: '/static/html/modals.html',
        containerSelector: '#modalsContainer',
        eventName: 'modalsLoaded',
        timeout: 20000
      });
      notify.info('[App] Modals template loaded successfully');
    } catch (modalsErr) {
      notify.error('[App] Failed to load modals template', {
        error: modalsErr,
        critical: true
      });
      // Dispatch event anyway to prevent UI from hanging
      domAPI.dispatchEvent(
        domAPI.getDocument(),
        new CustomEvent('modalsLoaded', {
          detail: { success: false, error: modalsErr }
        })
      );
    } finally {
      clearTimeout(modalsTimeout);
    }
  } catch (err) {
    notify.error('[App] Failed to load HTML templates', { error: err });
  }
})();

// ---------------------------------------------------------------------------
// 12) Create API client
// ---------------------------------------------------------------------------
const apiRequest = createApiClient({
  APP_CONFIG,
  globalUtils: { shouldSkipDedup, stableStringify, normaliseUrl, isAbsoluteUrl },
  notify,
  errorReporter: sentryManager,
  getAuthModule: () => DependencySystem.modules.get('auth'),
  browserService: browserServiceInstance
});
DependencySystem.register('apiRequest', apiRequest);

// ---------------------------------------------------------------------------
// 13) Create app object and state
// ---------------------------------------------------------------------------
let currentUser = null;
const appState = {
  initialized: false,
  initializing: false,
  isAuthenticated: false,
  currentPhase: 'idle'
};

// Global flags preventing re-init
let _globalInitCompleted = false;
let _globalInitInProgress = false;

// The main app object
const app = {
  getProjectId: () => {
    const { search } = browserAPI.getLocation();
    return new URLSearchParams(search).get('project');
  },
  navigateToConversation: async (chatId) => {
    const chatMgr = DependencySystem.modules.get('chatManager');
    if (chatMgr?.loadConversation) return chatMgr.loadConversation(chatId);
    appNotify.warn('chatManager not available for navigateToConversation', { source: 'app.navigateToConversation' });
    return false;
  },
  validateUUID: (id) => isValidProjectId(id),
  setCurrentUser: (user) => { app.state.currentUser = user; }
};

// Make the DependencySystem accessible to all components that receive `app`
app.DependencySystem = DependencySystem;

// Attach apiRequest directly to app before creating ProjectManager
app.apiRequest = apiRequest;

// Expose the central state so other modules can consult `app.state.isAuthenticated`
app.state = appState;

// Register the app object
DependencySystem.register('app', app);

// Register currentUser initially as null
DependencySystem.register('currentUser', null);
appNotify.info('"currentUser" initially registered as null in DI.', { source: 'bootstrap' });
// ---------------------------------------------------------------------------
// 14) Main initialization function
// ---------------------------------------------------------------------------
export async function init() {
  const _trace = _dbg.start?.('App.init');
  if (_globalInitCompleted || _globalInitInProgress) {
    appNotify.warn('Duplicate initialization attempt blocked', { source: 'init.duplicateCheck' });
    return _globalInitCompleted;
  }
  if (appState.initialized || appState.initializing) {
    appNotify.info('Initialization attempt skipped (already done or in progress).', { source: 'init.alreadyDone' });
    return appState.initialized;
  }

  _globalInitInProgress = true;
  appState.initializing = true;
  appState.currentPhase = 'starting_init_process';
  appNotify.debug('START init()', { source: 'init.start' });

  // Show loading spinner
  toggleLoadingSpinner(true);

  try {
    // Initialize core systems in the correct order
    await initializeCoreSystems();

    // Wait for critical dependencies
    try {
      await DependencySystem.waitFor(
        ['auth', 'eventHandlers', 'notificationHandler', 'modalManager'],
        null,
        APP_CONFIG.TIMEOUTS?.DEPENDENCY_WAIT
      );
    } catch (err) {
      appNotify.error('Critical deps not met', { error: err, source: 'init.waitForDeps' });
      maybeCapture(errorReporter, err, { module: 'App', method: 'init', source: 'waitForDeps' });
      throw err;
    }

    // Initialize auth system
    await initializeAuthSystem();

    // Fetch current user if authenticated
    if (appState.isAuthenticated) {
      const user = await fetchCurrentUser();
      if (user) {
        currentUser = user;
        app.setCurrentUser(user);
        browserAPI.setCurrentUser(user);
        appNotify.info(`User fetched in init. app.state.currentUser updated. User ID: ${user.id}`, { source: 'init.fetchCurrentUser' });
        renderAuthHeader();
      }
    }

    // Initialize UI components
    await initializeUIComponents();

    // Initialize event handlers
    try {
      await eventHandlers.init();
      appNotify.info('EventHandlers initialized successfully', { source: 'init.eventHandlers' });
    } catch (ehErr) {
      appNotify.error('Error initializing eventHandlers', { error: ehErr, source: 'init.eventHandlers' });
      maybeCapture(errorReporter, ehErr, { module: 'App', method: 'init', source: 'eventHandlers' });
    }

    // Initialize model config
    try {
      const mc = DependencySystem.modules.get('modelConfig');
      if (mc?.initializeUI) {
        mc.initializeUI();
      }
    } catch (mcErr) {
      appNotify.warn('Error initializing modelConfig UI', { error: mcErr, source: 'init.modelConfig' });
      maybeCapture(errorReporter, mcErr, { module: 'App', method: 'init', source: 'modelConfig' });
    }

    // Register app listeners
    registerAppListeners();

    // Initialize navigation service
    try {
      // First, ensure navigationService is available in DependencySystem
      const navService = DependencySystem.modules.get('navigationService');

      if (!navService) {
        appNotify.error('NavigationService not found in DependencySystem. Re-registering...', { source: 'init.navigationService' });
        // Try to re-create and register it if missing
        const recreatedNavService = createNavigationService({
          domAPI,
          browserService: browserServiceInstance,
          DependencySystem,
          notify,
          eventHandlers,
          errorReporter: sentryManager
        });

        DependencySystem.register('navigationService', recreatedNavService);
        appNotify.info('NavigationService re-registered successfully', { source: 'init.navigationService' });

        // Update local reference
        navigationService = recreatedNavService;
      } else if (navService !== navigationService) {
        // Update local reference if DI instance is different
        navigationService = navService;
        appNotify.info('Synchronized navigationService with DependencySystem', { source: 'init.navigationService' });
      }

      // Now try to initialize navigationService
      if (navigationService?.init) {
        await navigationService.init();
        appNotify.info('NavigationService initialized successfully', { source: 'init.navigationService' });

        // Register default views if they haven't been registered yet
        const projectDashboard = DependencySystem.modules.get('projectDashboard');
        if (projectDashboard?.components) {
          const projectList = projectDashboard.components.projectList;
          const projectDetails = projectDashboard.components.projectDetails;

          if (projectList && !navigationService.getCurrentView()) {
            navigationService.registerView('projectList', {
              show: async () => {
                // Call showProjectList on the projectDashboard instance
                if (projectDashboard.showProjectList) {
                  await projectDashboard.showProjectList();
                  return true;
                }
                return false;
              },
              hide: async () => {
                // Call hide on the ProjectListComponent instance
                if (projectDashboard.components.projectList?.hide) {
                  await projectDashboard.components.projectList.hide();
                  return true;
                }
                return false;
              }
            });

            appNotify.info('Registered projectList view with NavigationService', { source: 'init.navigationService' });
          }

          if (projectDetails && !navigationService.getCurrentView()) {
            navigationService.registerView('projectDetails', {
              show: async (params) => {
                if (projectDetails.showProjectDetails) {
                  await projectDetails.showProjectDetails(params.projectId);
                  return true;
                }
                return false;
              },
              hide: async () => {
                if (projectDetails.hideProjectDetails) {
                  await projectDetails.hideProjectDetails();
                  return true;
                }
                return false;
              }
            });

            appNotify.info('Registered projectDetails view with NavigationService', { source: 'init.navigationService' });
          }
        }
      } else {
        appNotify.error('NavigationService does not have init method.', { source: 'init.navigationService' });
      }
    } catch (navErr) {
      appNotify.error('Error initializing NavigationService', {
        error: navErr,
        critical: true,
        extra: { phase: 'navigationService.init' },
        source: 'init.navigationService'
      });
      maybeCapture(errorReporter, navErr, { module: 'App', method: 'init', source: 'navigationService' });

      if (errorReporter?.capture) {
        errorReporter.capture(navErr, {
          module: 'App',
          method: 'init',
          extra: { component: 'NavigationService' }
        });
      }
    }

    // Mark app as initialized
    appState.initialized = true;
    _globalInitCompleted = true;
    appNotify.info('Initialization complete.', { authenticated: appState.isAuthenticated, source: 'init.complete' });

    // Backend event logging
    const backendLogger = DependencySystem.modules.get('backendLogger');
    backendLogger?.log?.({
      level: 'info',
      module: 'App',
      message: 'initialized'
    });

    // Dispatch app:ready event
    AppBus.dispatchEvent(new CustomEvent('app:ready', { detail: { success: true } }));

    return true;
  } catch (err) {
    appNotify.error(`Initialization failed: ${err?.message}`, { error: err, source: 'init.catch' });
    maybeCapture(errorReporter, err, { module: 'App', method: 'init', source: 'catch' });
    handleInitError(err);

    // Dispatch app:ready event with error
    AppBus.dispatchEvent(new CustomEvent('app:ready', { detail: { success: false, error: err } }));

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
  const _t = _dbg.start?.('initializeCoreSystems');
  try {
    appNotify.debug('Initializing core systems...', { source: 'initializeCoreSystems' });

    // Ensure the DOM and the early-boot services we have so far are ready.
    await waitForDepsAndDom({
      DependencySystem,
      domAPI,
      deps: ['domAPI', 'notify'],   // modules that exist at this moment
      domSelectors: ['body']        // keep body-ready check
    });

    // Create and initialize modal manager
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

    // Create and initialize auth module
    const authModule = createAuthModule({
      DependencySystem,
      apiClient: apiRequest,
      notify,
      eventHandlers,
      domAPI,
      sanitizer: DependencySystem.modules.get('sanitizer'),
      modalManager,
      apiEndpoints: DependencySystem.modules.get('apiEndpoints')
    });
    DependencySystem.register('auth', authModule);

    // Create model config
    const modelConfigInstance = createModelConfig({
      DependencySystem,
      notify
    });
    DependencySystem.register('modelConfig', modelConfigInstance);

    // Create chat manager
    const chatManager = createOrGetChatManager();

    // Create project manager
    const projectManager = await createProjectManager({
      DependencySystem,
      chatManager,
      app,
      modelConfig: modelConfigInstance,
      notify,
      debugTools,
      apiRequest,
      apiEndpoints: DependencySystem.modules.get('apiEndpoints'),
      storage: DependencySystem.modules.get('storage'),
      listenerTracker: {
        add: (element, type, handler, description) =>
          eventHandlers.trackListener(element, type, handler, {
            description,
            context: 'projectManager'
          }),
        remove: () => eventHandlers.cleanupListeners({ context: 'projectManager' })
      },
      domAPI // ← add domAPI to ProjectManager
    });
    // DependencySystem.register('projectManager', projectManager);   // <--REMOVED, already registered in createProjectManager

    // Sync projectManager with eventHandlers
    eventHandlers.setProjectManager?.(projectManager);

    // Create project dashboard
    const projectDashboard = createProjectDashboard(DependencySystem);
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
            appNotify.error('modalsLoaded event fired but modals failed to load', {
              error: e?.detail?.error,
              source: 'initializeCoreSystems.modalsLoaded'
            });
            maybeCapture(errorReporter, e?.detail?.error, { module: 'App', method: 'initializeCoreSystems', source: 'modalsLoaded' });
          } else {
            appNotify.info('modalsLoaded event fired: modals injected successfully', { source: 'initializeCoreSystems.modalsLoaded' });
          }
          res(true);
        },
        { once: true, description: 'modalsLoaded for app init', context: 'app' }
      );
    });

    if (!modalsLoadedSuccess) {
      appNotify.error('Modal HTML failed to load. Login modal and others will not function.', { source: 'initializeCoreSystems.modalsLoaded' });
    }

    // Initialize modal manager
    if (modalManager.init) {
      try {
        await modalManager.init();
        appNotify.info('modalManager.init() completed successfully', { source: 'initializeCoreSystems.modalManager' });
      } catch (err) {
        appNotify.error('modalManager.init() failed', { error: err, source: 'initializeCoreSystems.modalManager' });
        maybeCapture(errorReporter, err, { module: 'App', method: 'initializeCoreSystems', source: 'modalManager' });
      }
    }

    // Initialize event handlers
    if (eventHandlers?.init) {
      try {
        await eventHandlers.init();
        appNotify.info('eventHandlers.init() completed (rebinding login delegation)', { source: 'initializeCoreSystems.eventHandlers' });
      } catch (err) {
        appNotify.error('eventHandlers.init() failed', { error: err, source: 'initializeCoreSystems.eventHandlers' });
        maybeCapture(errorReporter, err, { module: 'App', method: 'initializeCoreSystems', source: 'eventHandlers' });
      }
    }

    // Wait for HTML templates to be loaded before creating UI components
    appNotify.debug('Waiting for HTML templates to be loaded before creating UI components...', { source: 'initializeCoreSystems.templates' });
    try {
      // Check if project details template is already loaded
      const projectDetailsLoaded = domAPI.getElementById('projectDetailsView')?.querySelector('#projectTitle');
      if (!projectDetailsLoaded) {
        appNotify.debug('Project details template not yet loaded, waiting...', { source: 'initializeCoreSystems.templates' });
        await new Promise((resolve) => {
          const listener = () => {
            domAPI.removeEventListener(domAPI.getDocument(), 'projectDetailsTemplateLoaded', listener);
            resolve();
          };

          domAPI.addEventListener(domAPI.getDocument(), 'projectDetailsTemplateLoaded', listener);

          // Set a timeout in case the event never fires
          setTimeout(() => {
            domAPI.removeEventListener(domAPI.getDocument(), 'projectDetailsTemplateLoaded', listener);
            appNotify.warn('Timed out waiting for project details template in initializeCoreSystems', { source: 'initializeCoreSystems.templates' });
            resolve();
          }, 10000);
        });
      }
    } catch (err) {
      appNotify.error('Error waiting for HTML templates in initializeCoreSystems', { error: err, source: 'initializeCoreSystems.templates' });
      maybeCapture(errorReporter, err, { module: 'App', method: 'initializeCoreSystems', source: 'templates' });
    }

    // Initialize UI components
    createAndRegisterUIComponents();

    appNotify.debug('Core systems initialized.', { source: 'initializeCoreSystems.complete' });
    return true;
  } catch (err) {
    maybeCapture(DependencySystem.modules.get('errorReporter'), err, {
      module: 'app',
      method: 'initializeCoreSystems'
    });
    appNotify.error('Core systems initialization failed.', {
      error: err,
      module: 'app',
      source: 'initializeCoreSystems'
    });
    throw err;
  } finally {
    _dbg.stop?.(_t, 'initializeCoreSystems');
  }
}
// ---------------------------------------------------------------------------
// 16) Create and register UI components
// ---------------------------------------------------------------------------
function createAndRegisterUIComponents() {
  // Check if required DOM elements exist before creating components
  const projectListElement = domAPI.getElementById('projectList');
  const projectDetailsElement = domAPI.getElementById('projectDetailsView');
  const projectTitleElement = domAPI.getElementById('projectTitle');
  const projectDescriptionElement = domAPI.getElementById('projectDescription');
  const backBtnElement = domAPI.getElementById('backToProjectsBtn');

  if (!projectListElement) {
    appNotify.error('#projectList element not found, cannot create ProjectListComponent', {
      source: 'createAndRegisterUIComponents'
    });
  }

  if (!projectDetailsElement || !projectTitleElement || !projectDescriptionElement || !backBtnElement) {
    appNotify.error('Project details elements not found, cannot create ProjectDetailsComponent', {
      source: 'createAndRegisterUIComponents',
      detail: {
        projectDetailsFound: !!projectDetailsElement,
        projectTitleFound: !!projectTitleElement,
        projectDescriptionFound: !!projectDescriptionElement,
        backBtnFound: !!backBtnElement
      }
    });
  }

  // Create project list component if DOM element exists
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

  // Create knowledge base component
  const knowledgeBaseComponentInstance = createKnowledgeBaseComponent({
    DependencySystem,
    apiRequest,
    auth: DependencySystem.modules.get('auth'),
    projectManager: DependencySystem.modules.get('projectManager'),
    uiUtils,
    sanitizer: DependencySystem.modules.get('sanitizer')
  });
  DependencySystem.register('knowledgeBaseComponent', knowledgeBaseComponentInstance);

  // Create project details component if DOM elements exist
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
      errorReporter: DependencySystem.modules.get('errorReporter'),
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
      source: 'createAndRegisterUIComponents'
    });
  }

  // Update ProjectDashboard's component references
  const projectDashboardInstance = DependencySystem.modules.get('projectDashboard');
  if (projectDashboardInstance?.components) {
    // Get components from DependencySystem
    const projectDetailsComponent = DependencySystem.modules.get('projectDetailsComponent');
    const projectListComponent = DependencySystem.modules.get('projectListComponent');

    // Update dashboard components if they exist
    if (projectDetailsComponent) {
      projectDashboardInstance.components.projectDetails = projectDetailsComponent;
    }

    if (projectListComponent) {
      projectDashboardInstance.components.projectList = projectListComponent;
    }

    appNotify.debug('ProjectDashboard components updated with instances from DependencySystem.', {
      detail: {
        projectDetailsFound: !!projectDetailsComponent,
        projectListFound: !!projectListComponent
      },
      source: 'createAndRegisterUIComponents'
    });
  } else {
    appNotify.warn('ProjectDashboard instance or its components property not found for update.', { source: 'createAndRegisterUIComponents' });
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
    // Initialize auth module
    await auth.init();
    appState.isAuthenticated = auth.isAuthenticated();

    // ProjectDashboard listens to the `authStateChanged` event and
    // self-initialises when the user becomes authenticated – no manual
    // call needed here to avoid duplicate initialisation.

    // Register auth event listeners
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
    appNotify.error('Auth system initialization failed.', { error: err, source: 'initializeAuthSystem' });
    maybeCapture(errorReporter, err, { module: 'App', method: 'initializeAuthSystem', source: 'initializeAuthSystem' });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 18) UI components initialization
// ---------------------------------------------------------------------------
async function initializeUIComponents() {
  const _t = _dbg.start?.('initializeUIComponents');

  try {
    if (_uiInitialized) {
      appNotify.warn('initializeUIComponents called again; skipping.', { source: 'initializeUIComponents' });
      return;
    }

    appNotify.debug('Initializing UI components...', { source: 'initializeUIComponents' });

    // Wait for HTML templates to be loaded
    appNotify.debug('Waiting for HTML templates to be loaded...', { source: 'initializeUIComponents' });
    try {
      // Wait for project details template
      await new Promise((resolve) => {
        const alreadyLoaded = domAPI.getElementById('projectDetailsView')?.querySelector('#projectTitle');
        if (alreadyLoaded) {
          appNotify.debug('Project details template already loaded', { source: 'initializeUIComponents' });
          resolve();
          return;
        }

        const listener = (e) => {
          appNotify.debug('Project details template loaded event received', {
            success: e.detail?.success,
            source: 'initializeUIComponents'
          });
          domAPI.removeEventListener(domAPI.getDocument(), 'projectDetailsTemplateLoaded', listener);
          resolve();
        };

        domAPI.addEventListener(domAPI.getDocument(), 'projectDetailsTemplateLoaded', listener);

        // Set a timeout in case the event never fires
        setTimeout(() => {
          domAPI.removeEventListener(domAPI.getDocument(), 'projectDetailsTemplateLoaded', listener);
          appNotify.warn('Timed out waiting for project details template to load', { source: 'initializeUIComponents' });
          resolve();
        }, 10000);
      });

      // Wait for modals to be loaded
      await new Promise((resolve) => {
        const alreadyLoaded = domAPI.getElementById('modalsContainer')?.querySelector('.modal');
        if (alreadyLoaded) {
          appNotify.debug('Modals already loaded', { source: 'initializeUIComponents' });
          resolve();
          return;
        }

        const listener = (e) => {
          appNotify.debug('Modals loaded event received', {
            success: e.detail?.success,
            source: 'initializeUIComponents'
          });
          domAPI.removeEventListener(domAPI.getDocument(), 'modalsLoaded', listener);
          resolve();
        };

        domAPI.addEventListener(domAPI.getDocument(), 'modalsLoaded', listener);

        // Set a timeout in case the event never fires
        setTimeout(() => {
          domAPI.removeEventListener(domAPI.getDocument(), 'modalsLoaded', listener);
          appNotify.warn('Timed out waiting for modals to load', { source: 'initializeUIComponents' });
          resolve();
        }, 10000);
      });
    } catch (err) {
      appNotify.error('Error waiting for HTML templates', { error: err, source: 'initializeUIComponents' });
      maybeCapture(errorReporter, err, { module: 'App', method: 'initializeUIComponents', source: 'initializeUIComponents' });
    }

    // Ensure DOM elements exist
    await waitForDepsAndDom({
      DependencySystem,
      domAPI,
      domSelectors: ['#projectList', '#projectDetailsView', '#projectTitle', '#projectDescription', '#backToProjectsBtn']
    });

    // Create chat extensions
    const chatExtensionsInstance = createChatExtensions({
      DependencySystem,
      eventHandlers,
      notificationHandler: notify
    });
    DependencySystem.register('chatExtensions', chatExtensionsInstance);

    // Create project dashboard utils
    const projectDashboardUtilsInstance = createProjectDashboardUtils({
      DependencySystem
    });
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
        if (chatManager && typeof chatManager.loadConversation === 'function') {
          try {
            await chatManager.loadConversation(conversationId);
          } catch (err) {
            appNotify.error('Failed to load conversation from uiRenderer selection.', {
              error: err,
              conversationId,
              source: 'initializeUIComponents.uiRenderer.onConversationSelect'
            });
            maybeCapture(errorReporter, err, { module: 'App', method: 'initializeUIComponents', source: 'uiRenderer.onConversationSelect' });
          }
        } else {
          appNotify.error('chatManager not available for onConversationSelect.', {
            conversationId,
            source: 'initializeUIComponents.uiRenderer.onConversationSelect'
          });
        }
      },
      onProjectSelect: async (projectId) => {
        const projectDashboardDep = DependencySystem.modules.get('projectDashboard');
        if (projectDashboardDep && typeof projectDashboardDep.showProjectDetails === 'function') {
          try {
            await projectDashboardDep.showProjectDetails(projectId);
          } catch (err) {
            appNotify.error('Failed to show project details from uiRenderer selection.', {
              error: err,
              projectId,
              source: 'initializeUIComponents.uiRenderer.onProjectSelect'
            });
            maybeCapture(errorReporter, err, { module: 'App', method: 'initializeUIComponents', source: 'uiRenderer.onProjectSelect' });
          }
        } else {
          appNotify.error('projectDashboard not available for onProjectSelect.', {
            projectId,
            source: 'initializeUIComponents.uiRenderer.onProjectSelect'
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
        uiRenderer: DependencySystem.modules.get('uiRenderer'),
        notify,
        storageAPI: DependencySystem.modules.get('storage'),
        domAPI,
        viewportAPI: { getInnerWidth: () => browserAPI.getInnerWidth() },
        accessibilityUtils: DependencySystem.modules.get('accessibilityUtils')
      });
      DependencySystem.register('sidebar', sidebarInstance);
    }

    // Initialize components
    await safeInit(sidebarInstance, 'Sidebar', 'init');
    await safeInit(chatExtensionsInstance, 'ChatExtensions', 'init');
    await safeInit(DependencySystem.modules.get('knowledgeBaseComponent'), 'KnowledgeBase', 'initialize');
    // Initialization of ProjectList and ProjectDetails moved to ProjectDashboard after template loading

    // Load projects if authenticated (ProjectList will handle rendering when initialized by Dashboard)
    if (appState.isAuthenticated) {
      const pm = DependencySystem.modules.get('projectManager');
      pm?.loadProjects?.('all').catch(err => {
        appNotify.error('Failed to load projects in UI init', { error: err, source: 'initializeUIComponents' });
        maybeCapture(errorReporter, err, { module: 'App', method: 'initializeUIComponents', source: 'initializeUIComponents' });
      });
    }

    // Call external enhancements
    const w = browserAPI.getWindow();
    w.initAccessibilityEnhancements?.({ domAPI, notify });
    w.initSidebarEnhancements?.({ domAPI, notify, eventHandlers });

    _uiInitialized = true;
    notify.debug('[App] UI components initialized.');
    return true;
  } catch (err) {
    maybeCapture(DependencySystem.modules.get('errorReporter'), err, {
      module: 'app',
      method: 'initializeUIComponents'
    });
    appNotify.error('UI components initialization failed.', {
      error: err,
      module: 'app',
      source: 'initializeUIComponents'
    });
    maybeCapture(errorReporter, err, { module: 'App', method: 'initializeUIComponents', source: 'initializeUIComponents' });
    throw err;
  } finally {
    _dbg.stop?.(_t, 'initializeUIComponents');
  }
}

// ---------------------------------------------------------------------------
// 19) Helper functions
// ---------------------------------------------------------------------------
let _uiInitialized = false;

async function safeInit(instance, name, methodName) {
  if (!instance) {
    notify.warn(`[App] ${name} instance not found for ${methodName}`);
    return false;
  }

  if (typeof instance[methodName] !== 'function') {
    notify.debug(`[App] ${name} has no ${methodName} method`);
    return false;
  }

  try {
    await instance[methodName]();
    notify.debug(`[App] ${name}.${methodName}() completed successfully`);
    return true;
  } catch (err) {
    notify.error(`[App] ${name}.${methodName}() failed`, { error: err });
    return false;
  }
}
// ---------------------------------------------------------------------------
// 20) Auth state management
// ---------------------------------------------------------------------------
function handleAuthStateChange(event) {
  const detail = event?.detail || {};
  const isAuthenticated = !!detail.authenticated;
  const user = detail.user || null;

  notify.debug(`[App] Auth state changed: ${isAuthenticated ? 'authenticated' : 'not authenticated'}`, {
    source: 'handleAuthStateChange',
    extra: { user, eventSource: detail.source }
  });

  appState.isAuthenticated = isAuthenticated;
  app.setCurrentUser(user);
  currentUser = user;

  renderAuthHeader();

  // Update chat manager if available
  const chatManager = DependencySystem.modules.get('chatManager');
  if (chatManager && typeof chatManager.setAuthState === 'function') {
    chatManager.setAuthState(isAuthenticated);
  }

  // Update project manager if available
  const projectManager = DependencySystem.modules.get('projectManager');
  if (projectManager && typeof projectManager.setAuthState === 'function') {
    projectManager.setAuthState(isAuthenticated);
  }

  // If authenticated, load projects
  if (isAuthenticated && projectManager && typeof projectManager.loadProjects === 'function') {
    projectManager.loadProjects('all').catch(err => {
      appNotify.error('Failed to load projects after auth change', { error: err, source: 'handleAuthStateChange' });
      maybeCapture(errorReporter, err, { module: 'App', method: 'handleAuthStateChange', source: 'handleAuthStateChange' });
    });
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
      isAuth,
      authBtnExists: !!authBtn,
      authBtnHidden: authBtn ? authBtn.classList.contains('hidden') : 'n/a'
    });

    if (isAuth) {
      if (authBtn) domAPI.addClass(authBtn, 'hidden');
      if (userMenu) domAPI.removeClass(userMenu, 'hidden');
    } else {
      if (authBtn) domAPI.removeClass(authBtn, 'hidden');
      if (userMenu) domAPI.addClass(userMenu, 'hidden');
      // Clean up any previous login form
      const orphan = domAPI.getElementById('headerLoginForm');
      if (orphan) orphan.remove();
    }

    // Update user initials and details if logged in
    if (isAuth && userMenu && userInitialsEl) {
      let initials = '?';
      if (user.name) {
        initials = user.name.trim().split(/\s+/).map(p => p[0]).join('').toUpperCase();
      } else if (user.username) {
        initials = user.username.trim().slice(0, 2).toUpperCase();
      }
      domAPI.setTextContent(userInitialsEl, initials);
    }

    // Auth status text
    if (authStatus) {
      domAPI.setTextContent(authStatus, isAuth ?
        (user?.username ? `Signed in as ${user.username}` : 'Authenticated') :
        'Not Authenticated'
      );
    }

    // User status text
    if (userStatus) {
      domAPI.setTextContent(userStatus, isAuth && user?.username ?
        `Hello, ${user.name ?? user.username}` : 'Offline'
      );
    }

    // Logout button
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
    appNotify.error('Error rendering auth header.', { error: err, source: 'renderAuthHeader' });
    maybeCapture(errorReporter, err, { module: 'App', method: 'renderAuthHeader', source: 'renderAuthHeader' });
  }
}

async function fetchCurrentUser() {
  try {
    const authModule = DependencySystem.modules.get('auth');
    if (!authModule) {
      appNotify.error('Auth module not available in fetchCurrentUser.', { source: 'fetchCurrentUser' });
      return null;
    }

    // Priority 1: Use dedicated async fetchCurrentUser
    if (authModule.fetchCurrentUser && typeof authModule.fetchCurrentUser === 'function') {
      const userObj = await authModule.fetchCurrentUser();
      if (userObj && typeof userObj === 'object' && userObj.id) {
        notify.debug('[App] fetchCurrentUser: Successfully fetched user object via authModule.fetchCurrentUser.', { userObj });
        return userObj;
      }
      notify.warn('[App] fetchCurrentUser (from authModule.fetchCurrentUser) did not return a valid user object with ID.', { userObj });
    }

    // Priority 2: Fallback to getCurrentUserObject
    if (authModule.getCurrentUserObject && typeof authModule.getCurrentUserObject === 'function') {
      const userObjFromGetter = authModule.getCurrentUserObject();
      if (userObjFromGetter && typeof userObjFromGetter === 'object' && userObjFromGetter.id) {
        notify.debug('[App] fetchCurrentUser: Successfully fetched user object via authModule.getCurrentUserObject.', { userObjFromGetter });
        return userObjFromGetter;
      }
      notify.warn('[App] fetchCurrentUser (from authModule.getCurrentUserObject) did not return a valid user object with ID.', { userObjFromGetter });
    }

    // Priority 3: Check getCurrentUserAsync
    if (authModule.getCurrentUserAsync && typeof authModule.getCurrentUserAsync === 'function') {
      const userObjAsync = await authModule.getCurrentUserAsync();
      if (userObjAsync && typeof userObjAsync === 'object' && userObjAsync.id) {
        notify.debug('[App] fetchCurrentUser: Successfully fetched user object via authModule.getCurrentUserAsync.', { userObjAsync });
        return userObjAsync;
      }
      notify.warn('[App] fetchCurrentUser (from authModule.getCurrentUserAsync) did not return a valid user object with ID.', { userObjAsync });
    }

    appNotify.error('fetchCurrentUser: Could not retrieve a valid user object with ID from auth module using any available method.', { source: 'fetchCurrentUser' });
    return null;
  } catch (error) {
    appNotify.error('Failed to fetch current user during fetchCurrentUser execution.', { error, source: 'fetchCurrentUser' });
    maybeCapture(errorReporter, error, { module: 'App', method: 'fetchCurrentUser', source: 'fetchCurrentUser' });
    return null;
  }
}

// ---------------------------------------------------------------------------
// 21) App listeners and error handling
// ---------------------------------------------------------------------------
function registerAppListeners() {
  appNotify.debug('Registering global application listeners...', { source: 'registerAppListeners' });
  DependencySystem.waitFor(['auth', 'chatManager', 'projectManager', 'eventHandlers'])
    .then(() => {
      setupChatInitializationTrigger();
    })
    .catch(err => {
      appNotify.error('Error waiting for dependencies in registerAppListeners', { error: err, source: 'registerAppListeners' });
      maybeCapture(errorReporter, err, { module: 'App', method: 'registerAppListeners', source: 'registerAppListeners' });
    });
}

function setupChatInitializationTrigger() {
  const projectManager = DependencySystem.modules.get('projectManager');
  const chatManager = DependencySystem.modules.get('chatManager');
  const auth = DependencySystem.modules.get('auth');

  if (!projectManager || !chatManager || !auth) {
    appNotify.warn('Missing dependencies for setupChatInitializationTrigger', { source: 'setupChatInitializationTrigger' });
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
          notify.debug('[App] ChatManager initialized for project', { projectId });
        } catch (err) {
          appNotify.error('Failed to initialize ChatManager for project', { error: err, projectId, source: 'setupChatInitializationTrigger' });
          maybeCapture(errorReporter, err, { module: 'App', method: 'setupChatInitializationTrigger', source: 'setupChatInitializationTrigger' });
        }
      }
    },
    { description: 'Initialize ChatManager on projectSelected', context: 'app' }
  );
}

function handleInitError(err) {
  appNotify.error('Initialization error', { error: err, source: 'handleInitError' });

  // Try to show error in UI
  try {
    const errorContainer = domAPI.getElementById('appInitError');
    if (errorContainer) {
      domAPI.setTextContent(errorContainer, `Application initialization failed: ${err.message || 'Unknown error'}`);
      domAPI.removeClass(errorContainer, 'hidden');
    }
  } catch (displayErr) {
    appNotify.error('Failed to display initialization error', {
      source : 'handleInitError',
      error  : displayErr,
      extra  : { originalError: err }
    });
    maybeCapture(errorReporter, displayErr, {
      module: 'App', method: 'handleInitError', source: 'displayFail'
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
// 22) Chat manager creation
// ---------------------------------------------------------------------------
function createOrGetChatManager() {
  let cm = DependencySystem.modules.get('chatManager');
  if (cm) return cm;

  const authModule = DependencySystem.modules.get('auth');

  cm = createChatManager({
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
    isAuthenticated: () => authModule?.isAuthenticated?.() || false,
    DOMPurify: DependencySystem.modules.get('sanitizer'),
    apiEndpoints: DependencySystem.modules.get('apiEndpoints'),
    notificationHandler: notify,
    notify,
    errorReporter: DependencySystem.modules.get('errorReporter')
  });

  DependencySystem.register('chatManager', cm);
  return cm;
}

// Initialize the application
if (typeof window !== 'undefined') {
  // Wait for DOM to be ready
  const doc = browserAPI.getDocument();
  if (doc.readyState === 'loading') {
    eventHandlers.trackListener(
      doc, 'DOMContentLoaded', init,
      { context: 'app-bootstrap', description: 'DOMContentLoaded init' }
    );
  } else {
    // DOM already loaded, initialize immediately
    setTimeout(init, 0);
  }
}
