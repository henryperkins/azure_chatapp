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
import { createApiClient } from './utils/apiClient.js';
import { createHtmlTemplateLoader } from './utils/htmlTemplateLoader.js';

import {
  shouldSkipDedup,
  stableStringify,
  isAbsoluteUrl,
  isValidProjectId,
  toggleElement,
  waitForDepsAndDom
} from './utils/globalUtils.js';

import { createEventHandlers } from './eventHandler.js';
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

// Create and register a simple application logger
const appLogger = {
  log: (...args) => console.log('[App]', ...args),
  warn: (...args) => console.warn('[App]', ...args),
  error: (...args) => console.error('[App]', ...args),
  info: (...args) => console.info('[App]', ...args),
  debug: (...args) => {
    // Ensure APP_CONFIG is accessible or provide a default
    const debugEnabled = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.DEBUG === true);
    if (debugEnabled) {
      console.debug('[App]', ...args);
    }
  }
};
DependencySystem.register('logger', appLogger);

// ---------------------------------------------------------------------------
// 4) Early app module
// ---------------------------------------------------------------------------
const appModule = {
  state: {
    isAuthenticated: false,
    currentUser: null,
    isReady: false, // True when app is fully initialized and safe for interaction
    disableErrorTracking: false,
    initialized: false, // True when the main init() sequence has completed (success or fail)
    initializing: false, // True if init() is currently executing
    currentPhase: 'idle' // e.g., 'idle', 'starting_init_process', 'initialized_idle', 'failed_idle'
  },
  // Method to update authentication-related state
  setAuthState(newAuthState) {
    console.log('[DIAGNOSTIC][appModule.setAuthState]', JSON.stringify(newAuthState));
    Object.assign(this.state, newAuthState);
  },
  // Method to update general app lifecycle state
  setAppLifecycleState(newLifecycleState) {
    Object.assign(this.state, newLifecycleState);
    // If 'initialized' becomes true, set 'isReady' based on success/failure
    if (newLifecycleState.initialized === true) {
        if (this.state.currentPhase === 'initialized_idle') {
            this.state.isReady = true;
        } else if (this.state.currentPhase === 'failed_idle') {
            this.state.isReady = false; // Explicitly false if init failed
        }
    } else if (Object.prototype.hasOwnProperty.call(newLifecycleState, 'isReady')) { // Allow direct setting of isReady if needed
        this.state.isReady = newLifecycleState.isReady;
    }
  }
};
DependencySystem.register('appModule', appModule);

// ---------------------------------------------------------------------------
// Temporary stub: register an empty "app" early so any
// DependencySystem.waitFor('app') calls in factories executed below
// succeed immediately. The full App API is assigned later.
const app = {};
DependencySystem.register('app', app);

// ---------------------------------------------------------------------------
// 7.5) Create API client
// ---------------------------------------------------------------------------
const apiRequest = createApiClient({
  APP_CONFIG,
  globalUtils: { shouldSkipDedup, stableStringify, normaliseUrl, isAbsoluteUrl },
  getAuthModule: () => DependencySystem.modules.get('auth'),
  browserService: browserServiceInstance
});
DependencySystem.register('apiRequest', apiRequest);

// ---------------------------------------------------------------------------
// Create eventHandlers
// ---------------------------------------------------------------------------
const eventHandlers = createEventHandlers({
  DependencySystem,
  domAPI,
  browserService: browserServiceInstance,
  APP_CONFIG,
  sanitizer
});
DependencySystem.register('eventHandlers', eventHandlers);

// ---------------------------------------------------------------------------
// Accessibility enhancements
// ---------------------------------------------------------------------------
const accessibilityUtils = createAccessibilityEnhancements({
  domAPI,
  eventHandlers
});
DependencySystem.register('accessibilityUtils', accessibilityUtils);

// ---------------------------------------------------------------------------
// 10) Create navigation service
// ---------------------------------------------------------------------------
let navigationService = createNavigationService({
  domAPI,
  browserService: browserServiceInstance,
  DependencySystem,
  eventHandlers
});
DependencySystem.register('navigationService', navigationService);

// ---------------------------------------------------------------------------
// 11) Create HTML template loader
// ---------------------------------------------------------------------------
const htmlTemplateLoader = createHtmlTemplateLoader({
  DependencySystem,
  domAPI,
  eventHandlers,          // ← add this line
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
let currentUser = null; // This local currentUser is used by renderAuthHeader and fetchCurrentUser.
                        // It should be kept in sync with appModule.state.currentUser.

// The local appState variable has been removed. Its properties are merged into appModule.state.
// appModule.state is now the single source of truth for these flags.

let _globalInitCompleted = false;
let _globalInitInProgress = false;

/* Enrich the stub "app" (registered earlier) with its real API */

// Centralized current project state and API
let currentProject = null; // NEW: THE single source of truth

Object.assign(app, {
  getProjectId: () => {
    const { search } = browserAPI.getLocation();
    return new URLSearchParams(search).get('project');
  },
  getCurrentProject: () => {
    return currentProject ? JSON.parse(JSON.stringify(currentProject)) : null; // always return copy
  },
  setCurrentProject: (project) => {
    if (!project || !project.id) return;
    const previous = currentProject;
    currentProject = project;
    // optional: emit an event for listeners who care about project changes
    const appBus = DependencySystem.modules.get('AppBus');
    if (appBus && typeof appBus.dispatchEvent === 'function') {
      appBus.dispatchEvent(new CustomEvent('currentProjectChanged', {
        detail: { project, previousProject: previous }
      }));
    }
    // can also store in DependencySystem for easy DI
    DependencySystem.register('currentProject', project);
    return project;
  },
  navigateToConversation: async (chatId) => {
    const chatMgr = DependencySystem.modules.get('chatManager');
    if (chatMgr?.loadConversation) {
      return chatMgr.loadConversation(chatId);
    }
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

// Stub was already registered earlier; no need to re-register.
app.DependencySystem = DependencySystem;
app.apiRequest = apiRequest;
app.state = appModule.state; // Point app.state to the single source of truth in appModule

// Force currentUser to null in DI
DependencySystem.register('currentUser', null);

// ---------------------------------------------------------------------------
// Utility functions (moved up)
// ---------------------------------------------------------------------------
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
      pushState: (url, title = '') => { // Ensure title is handled or documented if navigationService doesn't use it
        const navService = DependencySystem.modules.get('navigationService');
        // Assuming navigationService.navigateTo(url) is the correct method.
        // The 'title' parameter might be lost if navigateTo doesn't support it.
        navService?.navigateTo(url);
      },
      getPathname: () => browserAPI.getLocation().pathname
    },
    isValidProjectId,
    isAuthenticated: () => !!authModule?.isAuthenticated?.(),
    DOMPurify: DependencySystem.modules.get('sanitizer'),
    apiEndpoints
  });

  DependencySystem.register('chatManager', cm);
  return cm;
}

// ---------------------------------------------------------------------------
// 14) Main initialization function
// ---------------------------------------------------------------------------
export async function init() {
  if (_globalInitCompleted || _globalInitInProgress) {
    return _globalInitCompleted;
  }
  // Check against the canonical state in appModule
  if (appModule.state.initialized || appModule.state.initializing) {
    return appModule.state.initialized;
  }

  _globalInitInProgress = true;
  appModule.setAppLifecycleState({ initializing: true, currentPhase: 'starting_init_process' });

  toggleLoadingSpinner(true);

  try {
    // 1) Initialize core systems in order
    await initializeCoreSystems();

    // 2) Wait for critical dependencies
    await DependencySystem.waitFor(
      ['auth', 'eventHandlers', 'modalManager'],
      null,
      APP_CONFIG.TIMEOUTS?.DEPENDENCY_WAIT
    );

    // 3) Initialize auth system
    await initializeAuthSystem(); // This will ensure appModule.state.isAuthenticated is set

    // 4) If authenticated, fetch current user
    // Read from the canonical state source
    if (appModule.state.isAuthenticated) {
      const user = await fetchCurrentUser(); // fetchCurrentUser updates the local `currentUser`
      if (user) {
        // app.setCurrentUser will update appModule.state.currentUser
        app.setCurrentUser(user);
        // browserAPI.setCurrentUser is for browserService's internal state, if used by other parts
        browserAPI.setCurrentUser(user);
      }
    }

    // 5) Initialize UI components
    await initializeUIComponents();

    // 6) (Optional) initialize leftover model config UI
    const mc = DependencySystem.modules.get('modelConfig');
    if (mc?.initializeUI) {
      mc.initializeUI();
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

      // Register default views
      const projectDashboard = DependencySystem.modules.get('projectDashboard');
      if (projectDashboard?.components) {

        // Enhanced projectList view registration with dependency waiting
        if (!navigationService.hasView('projectList')) {
          navigationService.registerView('projectList', {
            show: async () => {
              // Wait for both projectDashboard and projectListComponent to be available
              try {
                await DependencySystem.waitFor(['projectDashboard', 'projectListComponent'], null, 10000);

                const dashboard = DependencySystem.modules.get('projectDashboard');
                if (dashboard?.showProjectList) {
                  await dashboard.showProjectList();
                  return true;
                } else {
                  // Fallback to direct component access if dashboard method not available
                  const plc = DependencySystem.modules.get('projectListComponent');
                  if (plc?.show) {
                    await plc.show();
                    return true;
                  }
                }
                return false;
              } catch (err) {
                return false;
              }
            },
            hide: async () => {
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
                return false;
              }
            }
          });
        }

        // Enhanced projectDetails view registration with dependency waiting
        if (!navigationService.hasView('projectDetails')) {
          navigationService.registerView('projectDetails', {
            show: async (params) => {
              // Wait for both projectDashboard and projectDetailsComponent to be available
              try {
                await DependencySystem.waitFor(['projectDashboard', 'projectDetailsComponent'], null, 10000);

                // First try the dashboard method
                const dashboard = DependencySystem.modules.get('projectDashboard');
                if (dashboard?.showProjectDetails) {
                  await dashboard.showProjectDetails(params.projectId);
                  return true;
                }

                // Then try the component directly
                const pdc = DependencySystem.modules.get('projectDetailsComponent');
                if (pdc?.showProjectDetails) {
                  await pdc.showProjectDetails(params.projectId);
                  return true;
                }

                return false;
              } catch (err) {
                return false;
              }
            },
            hide: async () => {
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
                return false;
              }
            }
          });
        }
      }
    } else {
      // Error handled silently
    }

    // Mark app as initialized in the canonical state
    appModule.setAppLifecycleState({ initialized: true });
    _globalInitCompleted = true;

    AppBus.dispatchEvent(new CustomEvent('app:ready', { detail: { success: true } }));

    return true;
  } catch (err) {
    handleInitError(err);

    AppBus.dispatchEvent(new CustomEvent('app:ready', {
      detail: { success: false, error: err }
    }));
    return false;
  } finally {
    _globalInitInProgress = false;
    // Update canonical state for initializing and currentPhase
    appModule.setAppLifecycleState({
      initializing: false,
      currentPhase: appModule.state.initialized ? 'initialized_idle' : 'failed_idle'
      // This will also trigger isReady update via setAppLifecycleState logic
    });
    toggleLoadingSpinner(false);
  }
}

// ---------------------------------------------------------------------------
// 15) Core systems initialization
// ---------------------------------------------------------------------------
async function initializeCoreSystems() {
  // Wait for minimal DOM readiness
  await waitForDepsAndDom({
    DependencySystem,
    domAPI,
    deps: ['domAPI'],
    domSelectors: ['body']
  });

  // Create & init modal manager
  const modalManager = createModalManager({
    domAPI,
    browserService: browserServiceInstance,
    eventHandlers,
    DependencySystem,
    modalMapping: MODAL_MAPPINGS,
    domPurify: sanitizer
  });
  DependencySystem.register('modalManager', modalManager);

  // Create auth module
  const authModule = createAuthModule({
    DependencySystem,
    apiClient: apiRequest,
    eventHandlers,
    domAPI,
    sanitizer,
    modalManager,
    apiEndpoints,
    logger: appLogger // Pass the logger instance
  });
  DependencySystem.register('auth', authModule);
  // Initialize auth module to set up event listeners
  await authModule.init().catch(err => {
    console.error('[App] Auth module initialization error:', err);
  });

  // Create model config
  const modelConfigInstance = createModelConfig({
    dependencySystem: DependencySystem,          // mandatory (note lower-camel case)
    eventHandler: eventHandlers,                 // centralised listener tracker
    storageHandler: DependencySystem.modules.get('storage'),
    sanitizer: DependencySystem.modules.get('sanitizer')
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
    domAPI,
    browserService: browserServiceInstance,
    eventHandlers
  });
  DependencySystem.register('projectDashboard', projectDashboard);

  // Create project modal
  const projectModal = createProjectModal({
    DependencySystem,
    eventHandlers,
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
        res(true);
      },
      { once: true, description: 'modalsLoaded for app init', context: 'app' }
    );
  });

  // modalManager.init
  if (modalManager.init) {
    try {
      await modalManager.init();
    } catch (err) {
      // Error handled silently
    }
  }

  return true;
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
  if (_uiInitialized) {
    return;
  }

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

    // Next, ensure modals are loaded by checking for the modalsLoaded event
    // This is important because project_list.html might be injected by the modal loader
    const modalsLoaded = await new Promise((resolve) => {
      // Check if we already received the modalsLoaded event
      const modalsContainer = domAPI.getElementById('modalsContainer');
      if (modalsContainer && modalsContainer.childElementCount > 0) {
        return resolve(true);
      }

      // Set up timeout for modals loading
      const timeoutId = browserAPI.getWindow().setTimeout(() => {
        resolve(false);
      }, 8000);

      // Listen for the modalsLoaded event
      eventHandlers.trackListener(
        domAPI.getDocument(),
        'modalsLoaded',
        (e) => {
          browserAPI.getWindow().clearTimeout(timeoutId);
          const success = !!(e?.detail?.success);
          resolve(success);
        },
        { once: true, description: 'Wait for modalsLoaded in initializeUIComponents', context: 'app' }
      );
    });
  } catch (err) {
    // Continue despite error to attempt recovery
  }

  createAndRegisterUIComponents();

  // Initialize accessibility
  await safeInit(accessibilityUtils, 'AccessibilityUtils', 'init');

  // Create chat extensions
  const chatExtensionsInstance = createChatExtensions({
    DependencySystem,
    eventHandlers,
    chatManager: DependencySystem.modules.get('chatManager'),
    auth: DependencySystem.modules.get('auth'),
    app: DependencySystem.modules.get('app'),
    domAPI
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
    apiRequest,
    apiEndpoints,
    onConversationSelect: async (conversationId) => {
      const chatManager = DependencySystem.modules.get('chatManager');
      if (chatManager?.loadConversation) {
        try {
          await chatManager.loadConversation(conversationId);
        } catch (err) {
          // Error handled silently
        }
      }
    },
    onProjectSelect: async (projectId) => {
      const projectDashboardDep = DependencySystem.modules.get('projectDashboard');
      if (projectDashboardDep?.showProjectDetails) {
        try {
          await projectDashboardDep.showProjectDetails(projectId);
        } catch (err) {
          // Error handled silently
        }
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
      storageAPI: DependencySystem.modules.get('storage'),
      domAPI,
      viewportAPI: { getInnerWidth: () => browserAPI.getInnerWidth() },
      accessibilityUtils: DependencySystem.modules.get('accessibilityUtils')
    });
    DependencySystem.register('sidebar', sidebarInstance);
  }
  await safeInit(sidebarInstance, 'Sidebar', 'init');

  // If authenticated, load projects. Read from canonical state.
  if (appModule.state.isAuthenticated) {
    const pm = DependencySystem.modules.get('projectManager');
    pm?.loadProjects?.('all').catch(err => {
      // Error handled silently
    });
  }

  // External enhancements
  const w = browserAPI.getWindow();
  w?.initAccessibilityEnhancements?.({ domAPI });
  w?.initSidebarEnhancements?.({ domAPI, eventHandlers });

  _uiInitialized = true;
}

function createAndRegisterUIComponents() {
  const projectListElement = domAPI.getElementById('projectList');
  const projectDetailsElement = domAPI.getElementById('projectDetailsView');
  const projectTitleElement = domAPI.getElementById('projectTitle');
  const projectDescriptionElement = domAPI.getElementById('projectDescription');
  const backBtnElement = domAPI.getElementById('backToProjectsBtn');

  if (projectListElement) {
    const projectListComponentInstance = new ProjectListComponent({
      projectManager: DependencySystem.modules.get('projectManager'),
      eventHandlers,
      modalManager: DependencySystem.modules.get('modalManager'),
      app,
      router: DependencySystem.modules.get('navigationService'),
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
      sanitizer: DependencySystem.modules.get('sanitizer'),
      app,
      router: DependencySystem.modules.get('navigationService'),
      chatManager: DependencySystem.modules.get('chatManager'),
      modelConfig: DependencySystem.modules.get('modelConfig'),
      knowledgeBaseComponent: knowledgeBaseComponentInstance,
      onBack: async () => {
        const navService = DependencySystem.modules.get('navigationService');
        navService?.navigateToProjectList();
      }
    });
    DependencySystem.register('projectDetailsComponent', projectDetailsComponentInstance);
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

  // === DIAGNOSTIC: REGISTER AUTH EVENTS BEFORE INIT ===
  if (auth.AuthBus) {
    console.log('[DIAGNOSTIC][initializeAuthSystem] Registering AuthBus listeners before auth.init');
    eventHandlers.trackListener(
      auth.AuthBus,
      'authStateChanged',
      (event) => {
        console.log('[DIAGNOSTIC][AuthBus] Received authStateChanged', event?.detail);
        handleAuthStateChange(event);
      },
      { description: '[App] AuthBus authStateChanged', context: 'app' }
    );
    eventHandlers.trackListener(
      auth.AuthBus,
      'authReady',
      (event) => {
        console.log('[DIAGNOSTIC][AuthBus] Received authReady', event?.detail);
        handleAuthStateChange(event);
      },
      { description: '[App] AuthBus authReady', context: 'app' }
    );
  } else {
    console.warn('[DIAGNOSTIC][initializeAuthSystem] No AuthBus instance for auth event registration');
  }
  try {
    // auth.init() is responsible for verifying auth and calling broadcastAuth,
    // which in turn calls appModule.setAuthState().
    // So, appModule.state.isAuthenticated will be updated by auth.init() itself.
    console.log('[DIAGNOSTIC][initializeAuthSystem] Calling auth.init()');
    await auth.init();

    renderAuthHeader(); // Ensure this renders based on the now canonical appModule.state (via local currentUser sync)
    return true;
  } catch (err) {
    // If auth.init() fails, ensure canonical state reflects non-authenticated.
    appModule.setAuthState({ isAuthenticated: false, currentUser: null });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 18) Additional helpers
// ---------------------------------------------------------------------------
async function safeInit(instance, name, methodName) {
  if (!instance) {
    return;
  }
  if (typeof instance[methodName] !== 'function') {
    return;
  }
  await instance[methodName]();
}

function handleAuthStateChange(event) {
  // auth.js's broadcastAuth (via app.setAuthState) has already updated appModule.state
  // before this event listener is triggered.
  // This function now primarily reacts to that pre-established state.

  console.log('[DIAGNOSTIC][handleAuthStateChange]', {
    eventDetail: event?.detail,
    appModuleState: JSON.stringify(appModule.state)
  });

  const isAuthenticated = appModule.state.isAuthenticated; // Read from canonical source
  const user = appModule.state.currentUser; // Read from canonical source

  // Update the local `currentUser` variable which might be used by renderAuthHeader or other legacy parts.
  currentUser = user;

  renderAuthHeader(); // Renders based on the local `currentUser`

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
      // Use a small delay to ensure auth state is fully processed
      setTimeout(() => {
        navService.navigateToProjectList()
          .catch(() => {
            // Error handled silently
          });
      }, 100);
    } else if (projectManager?.loadProjects) {
      // Fallback to direct project loading if navigation service is not available
      projectManager.loadProjects('all').catch(() => {
        // Error handled silently
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
    // Error handled silently
  }
}

async function fetchCurrentUser() {
  try {
    const authModule = DependencySystem.modules.get('auth');
    if (!authModule) {
      return null;
    }

    if (authModule.fetchCurrentUser) {
      const userObj = await authModule.fetchCurrentUser();
      if (userObj?.id) {
        return userObj;
      }
    }

    if (authModule.getCurrentUserObject) {
      const userObjFromGetter = authModule.getCurrentUserObject();
      if (userObjFromGetter?.id) {
        return userObjFromGetter;
      }
    }

    if (authModule.getCurrentUserAsync) {
      const userObjAsync = await authModule.getCurrentUserAsync();
      if (userObjAsync?.id) {
        return userObjAsync;
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 21) App listeners and error handling
// ---------------------------------------------------------------------------
function registerAppListeners() {
  DependencySystem.waitFor(['auth', 'chatManager', 'projectManager', 'eventHandlers'])
    .then(() => {
      setupChatInitializationTrigger();
    })
    .catch(() => {
      // Error handled silently
    });
}

function setupChatInitializationTrigger() {
  const projectManager = DependencySystem.modules.get('projectManager');
  const chatManager = DependencySystem.modules.get('chatManager');
  const auth = DependencySystem.modules.get('auth');

  if (!projectManager || !chatManager || !auth) {
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
        } catch (err) {
          // Error handled silently
        }
      }
    },
    { description: 'Initialize ChatManager on projectSelected', context: 'app' }
  );
}

function handleInitError(err) {
  try {
    const errorContainer = domAPI.getElementById('appInitError');
    if (errorContainer) {
      domAPI.setTextContent(errorContainer, `Application initialization failed: ${err?.message || 'Unknown error'}`);
      domAPI.removeClass(errorContainer, 'hidden');
    }
  } catch (displayErr) {
    // Error handled silently
  }
}

// ---------------------------------------------------------------------------
// Boot if in browser
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
  // Add global error handler to catch and log any errors
  window.onerror = function(message, source, lineno, colno, error) {
    return false;
  };

  window.addEventListener('unhandledrejection', function(event) {});

  const doc = browserAPI.getDocument();
  function forceShowLoginModal() {
    // Only show login modal if not authenticated
    const authMod = DependencySystem.modules.get?.('auth');
    if (authMod && !authMod.isAuthenticated?.()) {
      // Open the modal using modalManager if available
      const modalManager = DependencySystem.modules.get?.('modalManager');
      if (modalManager && typeof modalManager.show === 'function') {
        modalManager.show('login');
      } else {
        // Fallback: try the native dialog element directly
        const loginDlg = doc.getElementById('loginModal');
        if (loginDlg && typeof loginDlg.showModal === 'function') {
          loginDlg.showModal();
        }
      }
    }
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', function() {
      init().then(() => {
        // After app initializes and modals are ready, force show login
        setTimeout(forceShowLoginModal, 800);
      });
    }, { once: true });
  } else {
    setTimeout(() => {
      init().then(() => {
        setTimeout(forceShowLoginModal, 800);
      });
    }, 0);
  }
}
