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

/* Enrich the stub "app" (registered earlier) with its real API */
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
app.state = appState;

// Force currentUser to null in DI
DependencySystem.register('currentUser', null);

// ---------------------------------------------------------------------------
// 14) Main initialization function
// ---------------------------------------------------------------------------
export async function init() {
  if (_globalInitCompleted || _globalInitInProgress) {
    return _globalInitCompleted;
  }
  if (appState.initialized || appState.initializing) {
    return appState.initialized;
  }

  _globalInitInProgress = true;
  appState.initializing = true;
  appState.currentPhase = 'starting_init_process';

  toggleLoadingSpinner(true);

  try {
    // 1) Initialize core systems in order
    await initializeCoreSystems();

    // 2) Wait for critical dependencies
    try {
      await DependencySystem.waitFor(
        ['auth', 'eventHandlers', 'modalManager'],
        null,
        APP_CONFIG.TIMEOUTS?.DEPENDENCY_WAIT
      );
    } catch (err) {
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
      // Error handled silently
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

    // Mark app as initialized
    appState.initialized = true;
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
    appState.initializing = false;
    toggleLoadingSpinner(false);
    appState.currentPhase = appState.initialized ? 'initialized_idle' : 'failed_idle';
  }
}

// ---------------------------------------------------------------------------
// 15) Core systems initialization
// ---------------------------------------------------------------------------
async function initializeCoreSystems() {
  try {
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
      apiEndpoints
    });
    DependencySystem.register('auth', authModule);

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
  } catch (err) {
    throw err;
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
  try {
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
      eventHandlers
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

    // If authenticated, load projects
    if (appState.isAuthenticated) {
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
  } catch (err) {
    throw err;
  }
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
  const detail = event?.detail || {};
  const isAuthenticated = !!detail.authenticated;
  const user = detail.user || null;

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
    apiEndpoints
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
    return false; // Let default error handling continue
  };

  // Add unhandled promise rejection handler
  window.addEventListener('unhandledrejection', function(event) {
    console.error('[UNHANDLED PROMISE REJECTION]', event.reason);
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
