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
const sanitizer = (typeof window !== 'undefined' && window.DOMPurify) ? window.DOMPurify : undefined;
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
    notify.warn('[App] chatManager not available for navigateToConversation');
    return false;
  },
  validateUUID: (id) => isValidProjectId(id)
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
notify.info('[App] "currentUser" initially registered as null in DI.');
// ---------------------------------------------------------------------------
// 14) Main initialization function
// ---------------------------------------------------------------------------
export async function init() {
  const _trace = _dbg.start?.('App.init');
  if (_globalInitCompleted || _globalInitInProgress) {
    notify.warn('[App] Duplicate initialization attempt blocked');
    return _globalInitCompleted;
  }
  if (appState.initialized || appState.initializing) {
    notify.info('[App] Initialization attempt skipped (already done or in progress).');
    return appState.initialized;
  }

  _globalInitInProgress = true;
  appState.initializing = true;
  appState.currentPhase = 'starting_init_process';
  notify.debug('[App] START init()');

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
      notify.error('[App] Critical deps not met', { error: err });
      throw err;
    }

    // Initialize auth system
    await initializeAuthSystem();

    // Fetch current user if authenticated
    if (appState.isAuthenticated) {
      const user = await fetchCurrentUser();
      if (user) {
        currentUser = user;
        app.state.currentUser = user;
        browserAPI.setCurrentUser(user);
        notify.info(`[App] User fetched in init. app.state.currentUser updated. User ID: ${user.id}`);
        renderAuthHeader();
      }
    }

    // Initialize UI components
    await initializeUIComponents();

    // Initialize event handlers
    try {
      await eventHandlers.init();
      notify.info('EventHandlers initialized successfully');
    } catch (ehErr) {
      notify.error('[App] Error initializing eventHandlers', { error: ehErr });
    }

    // Initialize model config
    try {
      const mc = DependencySystem.modules.get('modelConfig');
      if (mc?.initializeUI) {
        mc.initializeUI();
      }
    } catch (mcErr) {
      notify.warn('[App] Error initializing modelConfig UI', { error: mcErr });
    }

    // Register app listeners
    registerAppListeners();

    // Initialize navigation service
    try {
      // First, ensure navigationService is available in DependencySystem
      const navService = DependencySystem.modules.get('navigationService');

      if (!navService) {
        notify.error('[App] NavigationService not found in DependencySystem. Re-registering...');
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
        notify.info('[App] NavigationService re-registered successfully');

        // Update local reference
        navigationService = recreatedNavService;
      } else if (navService !== navigationService) {
        // Update local reference if DI instance is different
        navigationService = navService;
        notify.info('[App] Synchronized navigationService with DependencySystem');
      }

      // Now try to initialize navigationService
      if (navigationService?.init) {
        await navigationService.init();
        notify.info('[App] NavigationService initialized successfully');

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

            notify.info('[App] Registered projectList view with NavigationService');
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

            notify.info('[App] Registered projectDetails view with NavigationService');
          }
        }
      } else {
        notify.error('[App] NavigationService does not have init method.');
      }
    } catch (navErr) {
      notify.error('[App] Error initializing NavigationService', {
        error: navErr,
        critical: true,
        extra: { phase: 'navigationService.init' }
      });

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
    notify.info('[App] Initialization complete.', { authenticated: appState.isAuthenticated });

    // Dispatch app:ready event
    if (domAPI && typeof domAPI.dispatchEvent === 'function' && typeof domAPI.getDocument === 'function') {
      domAPI.dispatchEvent(domAPI.getDocument(), new CustomEvent('app:ready', { detail: { success: true } }));
    } else {
      document.dispatchEvent(new CustomEvent('app:ready', { detail: { success: true } }));
    }

    return true;
  } catch (err) {
    notify.error(`[App] Initialization failed: ${err?.message}`, { error: err });
    handleInitError(err);

    // Dispatch app:ready event with error
    if (domAPI && typeof domAPI.dispatchEvent === 'function' && typeof domAPI.getDocument === 'function') {
      domAPI.dispatchEvent(domAPI.getDocument(), new CustomEvent('app:ready', { detail: { success: false, error: err } }));
    } else {
      document.dispatchEvent(new CustomEvent('app:ready', { detail: { success: false, error: err } }));
    }

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
    notify.debug('[App] Initializing core systems...');

    // Ensure DOM is ready
    await waitForDepsAndDom({ DependencySystem, domAPI });

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
            notify.error('[App] modalsLoaded event fired but modals failed to load', {
              error: e?.detail?.error
            });
          } else {
            notify.info('[App] modalsLoaded event fired: modals injected successfully');
          }
          res(true);
        },
        { once: true, description: 'modalsLoaded for app init', context: 'app' }
      );
    });

    if (!modalsLoadedSuccess) {
      notify.error('[App] Modal HTML failed to load. Login modal and others will not function.');
    }

    // Initialize modal manager
    if (modalManager.init) {
      try {
        await modalManager.init();
        notify.info('[App] modalManager.init() completed successfully');
      } catch (err) {
        notify.error('[App] modalManager.init() failed', { error: err });
      }
    }

    // Initialize event handlers
    if (eventHandlers?.init) {
      try {
        await eventHandlers.init();
        notify.info('[App] eventHandlers.init() completed (rebinding login delegation)');
      } catch (err) {
        notify.error('[App] eventHandlers.init() failed', { error: err });
      }
    }

    // Wait for HTML templates to be loaded before creating UI components
    notify.debug('[App] Waiting for HTML templates to be loaded before creating UI components...');
    try {
      // Check if project details template is already loaded
      const projectDetailsLoaded = domAPI.getElementById('projectDetailsView')?.querySelector('#projectTitle');
      if (!projectDetailsLoaded) {
        notify.debug('[App] Project details template not yet loaded, waiting...');
        await new Promise((resolve) => {
          const listener = () => {
            domAPI.removeEventListener(domAPI.getDocument(), 'projectDetailsTemplateLoaded', listener);
            resolve();
          };

          domAPI.addEventListener(domAPI.getDocument(), 'projectDetailsTemplateLoaded', listener);

          // Set a timeout in case the event never fires
          setTimeout(() => {
            domAPI.removeEventListener(domAPI.getDocument(), 'projectDetailsTemplateLoaded', listener);
            notify.warn('[App] Timed out waiting for project details template in initializeCoreSystems');
            resolve();
          }, 10000);
        });
      }
    } catch (err) {
      notify.error('[App] Error waiting for HTML templates in initializeCoreSystems', { error: err });
    }

    // Initialize UI components
    createAndRegisterUIComponents();

    notify.debug('[App] Core systems initialized.');
    return true;
  } catch (err) {
    maybeCapture(DependencySystem.modules.get('errorReporter'), err, {
      module: 'app',
      method: 'initializeCoreSystems'
    });
    notify.error('[App] Core systems initialization failed.', {
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
    notify.error('[App] #projectList element not found, cannot create ProjectListComponent', {
      source: 'createAndRegisterUIComponents'
    });
  }

  if (!projectDetailsElement || !projectTitleElement || !projectDescriptionElement || !backBtnElement) {
    notify.error('[App] Project details elements not found, cannot create ProjectDetailsComponent', {
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
    notify.warn('[App] Skipping ProjectDetailsComponent creation due to missing DOM elements', {
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

    notify.debug('[App CoreSys] ProjectDashboard components updated with instances from DependencySystem.', {
      detail: {
        projectDetailsFound: !!projectDetailsComponent,
        projectListFound: !!projectListComponent
      }
    });
  } else {
    notify.warn('[App CoreSys] ProjectDashboard instance or its components property not found for update.');
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
    notify.error('[App] Auth system initialization failed.', { error: err });
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
      notify.warn('[App] initializeUIComponents called again; skipping.');
      return;
    }

    notify.debug('[App] Initializing UI components...');

    // Wait for HTML templates to be loaded
    notify.debug('[App] Waiting for HTML templates to be loaded...');
    try {
      // Wait for project details template
      await new Promise((resolve) => {
        const alreadyLoaded = domAPI.getElementById('projectDetailsView')?.querySelector('#projectTitle');
        if (alreadyLoaded) {
          notify.debug('[App] Project details template already loaded');
          resolve();
          return;
        }

        const listener = (e) => {
          notify.debug('[App] Project details template loaded event received', {
            success: e.detail?.success
          });
          domAPI.removeEventListener(domAPI.getDocument(), 'projectDetailsTemplateLoaded', listener);
          resolve();
        };

        domAPI.addEventListener(domAPI.getDocument(), 'projectDetailsTemplateLoaded', listener);

        // Set a timeout in case the event never fires
        setTimeout(() => {
          domAPI.removeEventListener(domAPI.getDocument(), 'projectDetailsTemplateLoaded', listener);
          notify.warn('[App] Timed out waiting for project details template to load');
          resolve();
        }, 10000);
      });

      // Wait for modals to be loaded
      await new Promise((resolve) => {
        const alreadyLoaded = domAPI.getElementById('modalsContainer')?.querySelector('.modal');
        if (alreadyLoaded) {
          notify.debug('[App] Modals already loaded');
          resolve();
          return;
        }

        const listener = (e) => {
          notify.debug('[App] Modals loaded event received', {
            success: e.detail?.success
          });
          domAPI.removeEventListener(domAPI.getDocument(), 'modalsLoaded', listener);
          resolve();
        };

        domAPI.addEventListener(domAPI.getDocument(), 'modalsLoaded', listener);

        // Set a timeout in case the event never fires
        setTimeout(() => {
          domAPI.removeEventListener(domAPI.getDocument(), 'modalsLoaded', listener);
          notify.warn('[App] Timed out waiting for modals to load');
          resolve();
        }, 10000);
      });
    } catch (err) {
      notify.error('[App] Error waiting for HTML templates', { error: err });
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
            notify.error('[App] Failed to load conversation from uiRenderer selection.', {
              error: err,
              conversationId
            });
          }
        } else {
          notify.error('[App] chatManager not available for onConversationSelect.', {
            conversationId
          });
        }
      },
      onProjectSelect: async (projectId) => {
        const projectDashboardDep = DependencySystem.modules.get('projectDashboard');
        if (projectDashboardDep && typeof projectDashboardDep.showProjectDetails === 'function') {
          try {
            await projectDashboardDep.showProjectDetails(projectId);
          } catch (err) {
            notify.error('[App] Failed to show project details from uiRenderer selection.', {
              error: err,
              projectId
            });
          }
        } else {
          notify.error('[App] projectDashboard not available for onProjectSelect.', {
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
        notify.error('[App] Failed to load projects in UI init', { error: err });
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
    notify.error('[App] UI components initialization failed.', {
      error: err,
      module: 'app',
      source: 'initializeUIComponents'
    });
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
  app.state.currentUser = user;
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
      notify.error('[App] Failed to load projects after auth change', { error: err });
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
    notify.error('[App] Error rendering auth header.', { error: err });
  }
}

async function fetchCurrentUser() {
  try {
    const authModule = DependencySystem.modules.get('auth');
    if (!authModule) {
      notify.error('[App] Auth module not available in fetchCurrentUser.');
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

    notify.error('[App] fetchCurrentUser: Could not retrieve a valid user object with ID from auth module using any available method.');
    return null;
  } catch (error) {
    notify.error('[App] Failed to fetch current user during fetchCurrentUser execution.', { error });
    return null;
  }
}

// ---------------------------------------------------------------------------
// 21) App listeners and error handling
// ---------------------------------------------------------------------------
function registerAppListeners() {
  notify.debug('[App] Registering global application listeners...');
  DependencySystem.waitFor(['auth', 'chatManager', 'projectManager', 'eventHandlers'])
    .then(() => {
      setupChatInitializationTrigger();
    })
    .catch(err => {
      notify.error('[App] Error waiting for dependencies in registerAppListeners', { error: err });
    });
}

function setupChatInitializationTrigger() {
  const projectManager = DependencySystem.modules.get('projectManager');
  const chatManager = DependencySystem.modules.get('chatManager');
  const auth = DependencySystem.modules.get('auth');

  if (!projectManager || !chatManager || !auth) {
    notify.warn('[App] Missing dependencies for setupChatInitializationTrigger');
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
          notify.error('[App] Failed to initialize ChatManager for project', { error: err, projectId });
        }
      }
    },
    { description: 'Initialize ChatManager on projectSelected', context: 'app' }
  );
}

function handleInitError(err) {
  notify.error('[App] Initialization error', { error: err });

  // Try to show error in UI
  try {
    const errorContainer = domAPI.getElementById('appInitError');
    if (errorContainer) {
      domAPI.setTextContent(errorContainer, `Application initialization failed: ${err.message || 'Unknown error'}`);
      domAPI.removeClass(errorContainer, 'hidden');
    }
  } catch (displayErr) {
    // Last resort: console error
    console.error('[App] Failed to display initialization error', displayErr, err);
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
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM already loaded, initialize immediately
    setTimeout(init, 0);
  }
}
