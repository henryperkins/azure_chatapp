/**
 * app.js - Main application orchestration.
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
import { resolveApiEndpoints } from './utils/apiEndpoints.js';
import { createErrorReporterStub } from './utils/errorReporterStub.js';
import { createBrowserService, normaliseUrl } from './utils/browserService.js';
import { setBrowserService as registerSessionBrowserService } from './utils/session.js';
import { createDomReadinessService } from './utils/domReadinessService.js';
import { createApiClient } from './utils/apiClient.js';
import { createHtmlTemplateLoader } from './utils/htmlTemplateLoader.js';
import { createServiceInitializer } from './init/serviceInit.js';
import { createCoreInitializer } from './init/coreInit.js';
import { createUIInitializer } from './init/uiInit.js';
import { createAuthInitializer } from './init/authInit.js';
import { createAppStateManager } from './init/appState.js';
import { createErrorInitializer } from './init/errorInit.js';

import {
  shouldSkipDedup,
  stableStringify,
  isAbsoluteUrl,
  isValidProjectId,
  formatBytes  as globalFormatBytes,
  formatDate   as globalFormatDate,
  fileIcon     as globalFileIcon
} from './utils/globalUtils.js';

import { createEventHandlers } from './eventHandler.js';
import { createAuthModule } from './auth.js';
import { createChatManager } from './chat.js';
import { createProjectManager } from './projectManager.js';
import { createProjectModal, createModalManager } from './modalManager.js';
import { createModelConfig } from './modelConfig.js';
import { createProjectDashboard } from './projectDashboard.js';
import { createProjectListComponent } from './projectListComponent.js';
import { createProjectDetailsComponent } from './projectDetailsComponent.js';
import { createKnowledgeBaseComponent } from './knowledgeBaseComponent.js';
import { createAccessibilityEnhancements } from './accessibility-utils.js';
import { createNavigationService } from './navigationService.js';
import { createProjectDetailsEnhancements } from './project-details-enhancements.js';
import { createTokenStatsManager } from './tokenStatsManager.js';

import MODAL_MAPPINGS from './modalConstants.js';
import { createFileUploadComponent } from './FileUploadComponent.js';

// ---------------------------------------------------------------------------
// UI helpers for KnowledgeBaseComponent
// ---------------------------------------------------------------------------
const uiUtils = {
  formatBytes: globalFormatBytes,
  formatDate : globalFormatDate,
  fileIcon   : globalFileIcon
};

// ---------------------------------------------------------------------------
// 1) Create base services
// ---------------------------------------------------------------------------
const browserServiceInstance = createBrowserService({
  windowObject: (typeof window !== 'undefined') ? window : undefined
});
registerSessionBrowserService(browserServiceInstance);
const browserAPI = browserServiceInstance;

// ---------------------------------------------------------------------------
// 2) Initialize DependencySystem (moved up, before first use)
// ---------------------------------------------------------------------------
const DependencySystem = browserAPI.getDependencySystem();
if (!DependencySystem?.modules?.get) {
  throw new Error('[App] DependencySystem not present - bootstrap aborted');
}

// Logger: Import first for early DI registration
import { createLogger } from './logger.js';

// PHASE 1: Create a basic logger for early DI (no authModule yet)
let logger = createLogger({
  context: 'App',
  debug: APP_CONFIG && APP_CONFIG.DEBUG === true,
  minLevel: APP_CONFIG.LOGGING?.MIN_LEVEL ?? 'info',
  fetcher: browserAPI.getWindow()?.fetch?.bind?.(browserAPI.getWindow()) || null,
  enableServer: false // Prevent backend POSTs before authModule is available
});
DependencySystem.register('logger', logger);

 // Dedicated App Event Bus
const AppBus = new (browserAPI.getWindow()?.EventTarget || EventTarget)();
DependencySystem.register('AppBus', AppBus);

// ──  initialise sanitizer FIRST ──────────────────────────────────
let sanitizer = browserAPI.getWindow()?.DOMPurify;
if (!sanitizer) {
  throw new Error('[App] DOMPurify not found - aborting bootstrap for security reasons.');
}
DependencySystem.register('sanitizer', sanitizer);
DependencySystem.register('domPurify', sanitizer);  // legacy alias

// ──  now it is safe to create domAPI  ────────────────────────────
const domAPI = createDomAPI({
  documentObject: browserAPI.getDocument(),
  windowObject: browserAPI.getWindow(),
  debug: APP_CONFIG.DEBUG === true,
  logger,
  sanitizer                      // ← now defined
});

// ---------------------------------------------------------------------------
// 3) Create domReadinessService (CRITICAL FIX)
// ---------------------------------------------------------------------------
const domReadinessService = createDomReadinessService({
  DependencySystem,
  domAPI,
  browserService: browserServiceInstance,
  logger,
  timeoutMs: APP_CONFIG.TIMEOUTS?.DEPENDENCY_WAIT ?? 5000
});
DependencySystem.register('domReadinessService', domReadinessService);

// ---------------------------------------------------------------------------
// 4) Create eventHandlers (CRITICAL FIX)
// ---------------------------------------------------------------------------
const errorReporter = createErrorReporterStub(logger,'app:ErrorReporterStub');
DependencySystem.register('errorReporter', errorReporter);

const eventHandlers = createEventHandlers({
  DependencySystem,
  domAPI,
  browserService: browserServiceInstance,
  logger,
  errorReporter,
  APP_CONFIG
});
DependencySystem.register('eventHandlers', eventHandlers);

// Wire circular dependency with setter (post-construction)
eventHandlers.setDomReadinessService(domReadinessService);


// ---------------------------------------------------------------------------
// 6) Early app module (using factory)
// ---------------------------------------------------------------------------
const appModule = createAppStateManager({ DependencySystem, logger });
DependencySystem.register('appModule', appModule);

// ---------------------------------------------------------------------------
// 7) Define app object early (CRITICAL FIX)
// ---------------------------------------------------------------------------
const app = {}; // This will be enriched later
DependencySystem.register('app', app);

// ---------------------------------------------------------------------------
// Early 'app:ready' dispatch helper
// ---------------------------------------------------------------------------
let _appReadyDispatched = false;
/**
 * fireAppReady – Emits the global "app:ready" event exactly once.
 * Subsequent calls are ignored.
 *
 * @param {boolean} success - true if init succeeded.
 * @param {Error|null} error - optional error object on failure.
 */
function fireAppReady(success = true, error = null) {
  if (_appReadyDispatched) return;
  _appReadyDispatched = true;
  // Register 'app' in DI once (skip if already present)
  if (
    success &&
    DependencySystem &&
    typeof DependencySystem.register === "function" &&
    !(DependencySystem.modules?.has?.('app'))
  ) {
    DependencySystem.register('app', app);
  }
  const detail = success ? { success } : { success, error };
  const evt = eventHandlers.createCustomEvent('app:ready', { detail });
  AppBus.dispatchEvent(evt);
  domAPI.dispatchEvent(domAPI.getDocument(), evt);
  DependencySystem.modules.get('logger')?.log('[fireAppReady] dispatched', { success, error, context: 'app' });
}

// ---------------------------------------------------------------------------
// 8) Register all factory functions before using them
// ---------------------------------------------------------------------------
DependencySystem.register('createModalManager', createModalManager);
DependencySystem.register('createAuthModule', createAuthModule);
DependencySystem.register('createChatManager', createChatManager);
DependencySystem.register('createProjectManager', createProjectManager);
DependencySystem.register('createModelConfig', createModelConfig);
DependencySystem.register('createProjectDashboard', createProjectDashboard);
DependencySystem.register('createProjectDetailsComponent', createProjectDetailsComponent);
DependencySystem.register('createProjectListComponent', createProjectListComponent);
DependencySystem.register('createProjectModal', createProjectModal);
DependencySystem.register('MODAL_MAPPINGS', MODAL_MAPPINGS);
DependencySystem.register('globalUtils', { shouldSkipDedup, stableStringify, normaliseUrl, isAbsoluteUrl, isValidProjectId });

// ---------------------------------------------------------------------------
const apiEndpoints = resolveApiEndpoints(APP_CONFIG);
DependencySystem.register('apiEndpoints', apiEndpoints);

// ---------------------------------------------------------------------------
// 10) Create and use service initializer
// ---------------------------------------------------------------------------
const serviceInit = createServiceInitializer({
  DependencySystem,
  domAPI,
  browserServiceInstance,
  eventHandlers,
  domReadinessService,
  logger,
  sanitizer,
  APP_CONFIG,
  uiUtils,
  globalUtils: { shouldSkipDedup, stableStringify, normaliseUrl, isAbsoluteUrl, isValidProjectId },
  createFileUploadComponent,
  createApiClient,
  createAccessibilityEnhancements,
  createNavigationService,
  createHtmlTemplateLoader
});

// Register basic services
serviceInit.registerBasicServices();
serviceInit.registerAdvancedServices();

// ---------------------------------------------------------------------------
// Create API client (now should be available via serviceInit)
// ---------------------------------------------------------------------------
const apiRequest = DependencySystem.modules.get('apiRequest');

// Modals.html will be loaded synchronously during init() before UI components

// ---------------------------------------------------------------------------
// 12) app object & top-level state (enrich the early-defined app object)
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
    return new browserAPI.URLSearchParams(search).get('project');
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
      appBus.dispatchEvent(
        eventHandlers.createCustomEvent('currentProjectChanged', {
          detail: { project, previousProject: previous }
        })
      );
    }
    // Do not re-register in DependencySystem. Only the initial registration (null) at startup is allowed.
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

// Update app properties with required references
app.DependencySystem = DependencySystem;
app.apiRequest = apiRequest;
app.state = appModule.state; // Point app.state to the single source of truth in appModule
// Add isInitializing getter to delegate to appModule state
Object.defineProperty(app, 'isInitializing', {
  get: () => appModule.state.initializing,
  enumerable: true,
  configurable: true
});

// Force currentUser to null in DI
DependencySystem.register('currentUser', null);

// ---------------------------------------------------------------------------
// Utility functions
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

/**
 * safeHandler - Ensures all event handler exceptions are logged via DI logger.
 * Always use for user-initiated/UI handlers, with context tagging.
 */
function safeHandler(handler, description) {
  // logger is guaranteed in DI for all app modules
  const logger = DependencySystem.modules.get && DependencySystem.modules.get('logger');
  return (...args) => {
    try {
      return handler(...args);
    } catch (err) {
      if (logger && typeof logger.error === "function") {
        logger.error(
          `[app.js][${description}]`,
          err && err.stack ? err.stack : err,
          { context: description || "app.js" }
        );
      }
      throw err;
    }
  };
}

// ---------------------------------------------------------------------------
// Create auth initializer (after safeHandler is defined)
// ---------------------------------------------------------------------------
const authInit = createAuthInitializer({
  DependencySystem,
  domAPI,
  eventHandlers,
  logger,
  sanitizer,
  safeHandler,
  domReadinessService,
  APP_CONFIG
});
DependencySystem.register('authInit', authInit);

// ---------------------------------------------------------------------------
// Create error initializer (after safeHandler is defined)
// ---------------------------------------------------------------------------
const errorInit = createErrorInitializer({
  DependencySystem,
  browserService: browserServiceInstance,
  eventHandlers,
  logger,
  safeHandler
});
DependencySystem.register('errorInit', errorInit);

// ---------------------------------------------------------------------------
// Create core initializer
// ---------------------------------------------------------------------------
const coreInit = createCoreInitializer({
  DependencySystem,
  domAPI,
  browserService: browserServiceInstance,
  eventHandlers,
  sanitizer,
  logger,
  APP_CONFIG,
  domReadinessService
});

// ---------------------------------------------------------------------------
// Create UI initializer
// ---------------------------------------------------------------------------
const uiInit = createUIInitializer({
  DependencySystem,
  domAPI,
  browserService: browserServiceInstance,
  eventHandlers,
  domReadinessService,
  logger,
  APP_CONFIG,
  safeHandler,
  sanitizer,
  createProjectDetailsEnhancements,
  createTokenStatsManager,
  createKnowledgeBaseComponent,
  apiRequest,
  uiUtils
});

/* ---------------------------------------------------------------------------
   Utility functions required by init and other top-level logic
--------------------------------------------------------------------------- */
async function safeInit(instance, name, methodName) {
  const logger = DependencySystem.modules.get('logger');
  if (!instance) {
    logger?.warn(`[safeInit] Instance ${name} is null/undefined. Cannot call ${methodName}.`, { context: `app:safeInit:${name}` });
    return false;
  }
  if (typeof instance[methodName] !== 'function') {
    logger?.warn(`[safeInit] Method ${methodName} not found on ${name}.`, { context: `app:safeInit:${name}` });
    return false;
  }
  try {
    const result = await instance[methodName]();
    return result === undefined ? true : !!result;
  } catch (err) {
    logger?.error(`[safeInit] Error during ${name}.${methodName}()`, err, { context: `app:safeInit:${name}:${methodName}` });
    throw err;
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
    logger.error('[fetchCurrentUser]', error, { context: 'app:fetchCurrentUser' });
    return null;
  }
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
    safeHandler(async (e) => {
      const projectId = e?.detail?.projectId;
      if (!projectId) return;

      if (auth.isAuthenticated() && chatManager?.initialize) {
        try {
          await chatManager.initialize({
            projectId,
            containerSelector: "#projectChatContainer",
            messageContainerSelector: "#projectChatMessages",
            inputSelector: "#projectChatInput",
            sendButtonSelector: "#projectChatSendBtn"
          });
        } catch (err) {
          logger.error('[safeInit]', err, { context: 'app:safeInit:ChatExtensions' });
          throw err;
        }
      }
    }, 'projectSelected/init chat'),
    { description: 'Initialize ChatManager on projectSelected', context: 'app' }
  );
}

function registerAppListeners() {
  domReadinessService.dependenciesAndElements({
    deps: ['auth', 'chatManager', 'projectManager', 'eventHandlers'],
    context: 'app.js:registerAppListeners'
  })
    .then(() => {
      setupChatInitializationTrigger();
    })
    .catch(() => {
      // Error handled silently
    });
}

function handleInitError(err) {
  const modalManager = DependencySystem.modules.get?.('modalManager');
  const shownViaModal = modalManager?.show?.('error', {
    title: 'Application initialization failed',
    message: err?.message || 'Unknown initialization error',
    showDuringInitialization: true
  });

  // Emitir evento centralizado para otros módulos
  domAPI.dispatchEvent(
    domAPI.getDocument(),
    eventHandlers.createCustomEvent('app:initError', { detail: { error: err } })
  );

  // Fallback visible sólo si no existe el modal
  if (!shownViaModal) {
    try {
      const errorContainer = domAPI.getElementById('appInitError');
      if (errorContainer) {
        domAPI.setTextContent(
          errorContainer,
          `Application initialization failed: ${err?.message || 'Unknown error'}`
        );
        domAPI.removeClass(errorContainer, 'hidden');
      }
    } catch (displayErr) {
      logger.error('[handleInitError]', displayErr, { context: 'app:handleInitError' });
      // Error handled silently
    }
  }
}

// ---------------------------------------------------------------------------
// 14) Main initialization function
// ---------------------------------------------------------------------------
export async function init() {
  logger.log('[App.init] Called', { context: 'app:init', ts: Date.now() });

  // Ensure the DOM is fully loaded before initialization
  await domReadinessService.documentReady();

  // ────────── timing helpers ──────────
  const phaseTimings = Object.create(null);     // { [phase]: { start, end } }
  const SLOW_PHASE = 4_000;                     // ms – warn if phase ≥ 4 s
  function _now() {
    const w = browserAPI.getWindow();
    return (w?.performance?.now?.()) ?? Date.now();
  }

  // Global emergency fail-safe: if this init hasn't completed in the configured time, forcibly log & dispatch 'app:ready' with error
  let globalInitTimeoutFired = false;
  const GLOBAL_INIT_TIMEOUT_MS = (
    (APP_CONFIG && APP_CONFIG.TIMEOUTS && typeof APP_CONFIG.TIMEOUTS.GLOBAL_INIT === 'number')
      ? APP_CONFIG.TIMEOUTS.GLOBAL_INIT
      : 90000 // Default: 90 seconds
  );
  const globalInitTimeoutId = browserAPI.getWindow().setTimeout(() => {
    globalInitTimeoutFired = true;
    const err = new Error(
      `[App.init] Global initialization timeout after ${GLOBAL_INIT_TIMEOUT_MS}ms.`
    );
    logger.error('[App.init] Emergency global timeout', err, { context: 'app:init:globalTimeout', ts: Date.now() });
    handleInitError(err);
    fireAppReady(false, err);
  }, GLOBAL_INIT_TIMEOUT_MS);

  if (_globalInitCompleted || _globalInitInProgress) {
    browserAPI.getWindow().clearTimeout(globalInitTimeoutId);
    return _globalInitCompleted;
  }
  if (appModule.state.initialized || appModule.state.initializing) {
    browserAPI.getWindow().clearTimeout(globalInitTimeoutId);
    return appModule.state.initialized;
  }

  _globalInitInProgress = true;
  appModule.setAppLifecycleState({ initializing: true, currentPhase: 'starting_init_process' });

  toggleLoadingSpinner(true);

  // Per-phase timeout in ms for each awaited step
  const PHASE_TIMEOUT = 12000; // 12s per step to catch long hangs

  // Diagnostic step marker
  function logStep(phase, stage, extra = {}) {
    const t = _now();
    if (stage === 'pre') {
      phaseTimings[phase] = { start: t };             // mark start
    } else if (stage === 'post') {
      const rec = phaseTimings[phase] || (phaseTimings[phase] = {});
      rec.end = t;
      const dur = rec.end - (rec.start ?? rec.end);
      logger.log('[App.init][TIMING]', { phase, duration: Math.round(dur), context: 'app:init:timing' });
      if (dur >= SLOW_PHASE) {
        logger.warn(`[App.init] Phase "${phase}" took ${Math.round(dur)} ms`, { phase, duration: dur, context: 'app:init:timing' });
      }
    }
    logger.log('[App.init]', { phase, stage, ts: t, ...extra });
  }

  try {
    // 0.5) Load modals.html synchronously before ANY initialization
    logStep('loadModalsHtml', 'pre');
    await Promise.race([
      domReadinessService.dependenciesAndElements({
        domSelectors: ['#modalsContainer'],
        timeout: APP_CONFIG.TIMEOUTS?.COMPONENT_ELEMENTS_READY ?? 8000,
        context: 'app:loadModalsHtml'
      }).then(() => {
        const htmlTemplateLoader = DependencySystem.modules.get('htmlTemplateLoader');
        return htmlTemplateLoader.loadTemplate({
          url: '/static/html/modals.html',
          containerSelector: '#modalsContainer',
          eventName: 'modalsLoaded'
        });
      }),
      new Promise((_, reject) =>
        browserAPI.getWindow().setTimeout(
          () => reject(new Error('Timeout in loadModalsHtml')),
          PHASE_TIMEOUT
        )
      )
    ]);
    logStep('loadModalsHtml', 'post');

    // 1) Initialize core systems using factory
    logStep('initializeCoreSystems', 'pre');
    await Promise.race([
      coreInit.initializeCoreSystems(),
      new Promise((_, reject) =>
        browserAPI.getWindow().setTimeout(
          () => reject(new Error('Timeout in initializeCoreSystems')),
          PHASE_TIMEOUT
        )
      )
    ]);
    logStep('initializeCoreSystems', 'post');

    /* ── Wait for critical DI modules via domReadinessService ─────────── */
    logStep('depsReady', 'pre');
    await domReadinessService.dependenciesAndElements({
      deps: ['auth', 'eventHandlers', 'modalManager'],
      timeout: APP_CONFIG.TIMEOUTS?.DEPENDENCY_WAIT ?? PHASE_TIMEOUT,
      context: 'app.init:depsReady'
    });
    logStep('depsReady', 'post');

    // 3) Initialize auth system
    logStep('initializeAuthSystem', 'pre');
    await Promise.race([
      authInit.initializeAuthSystem(),
      new Promise((_, reject) =>
        browserAPI.getWindow().setTimeout(
          () => reject(new Error('Timeout in initializeAuthSystem')),
          PHASE_TIMEOUT
        )
      )
    ]);
    logStep('initializeAuthSystem', 'post');
    // Early app:ready dispatch: emits right after auth is ready (guaranteed single-fire)
    if (!_appReadyDispatched) fireAppReady(true);

    // 4) If authenticated, fetch current user
    logStep('fetchCurrentUser', 'pre', { authed: !!appModule.state.isAuthenticated });
    if (appModule.state.isAuthenticated) {
      const user = await Promise.race([
        fetchCurrentUser(),
        new Promise((_, reject) =>
          browserAPI.getWindow().setTimeout(
            () => reject(new Error('Timeout in fetchCurrentUser')),
            PHASE_TIMEOUT
          )
        )
      ]);
      if (user) {
        app.setCurrentUser(user);
        browserAPI.setCurrentUser(user);
      }
    }
    logStep('fetchCurrentUser', 'post');

    // 5) Initialize UI components using factory (modals already loaded in step 0.5)
    logStep('initializeUIComponents', 'pre');
    await Promise.race([
      uiInit.initializeUIComponents(),
      new Promise((_, reject) =>
        browserAPI.getWindow().setTimeout(
          () => reject(new Error('Timeout in initializeUIComponents')),
          PHASE_TIMEOUT
        )
      )
    ]);
    logStep('initializeUIComponents', 'post');

    // 6) (Optional) initialize leftover model config UI
    logStep('modelConfig.initializeUI', 'pre');
    const mc = DependencySystem.modules.get('modelConfig');
    if (mc?.initializeUI) {
      mc.initializeUI();
    }
    logStep('modelConfig.initializeUI', 'post');

    // 7) Register app-level listeners
    logStep('registerAppListeners', 'pre');
    registerAppListeners();
    logStep('registerAppListeners', 'post');

    // 8) Initialize navigation service
    logStep('navigationService', 'pre');
    const navService = DependencySystem.modules.get('navigationService');
    if (!navService) {
      throw new Error('[App] NavigationService missing from DI. Aborting initialization.');
    }
    let navigationService = navService;

    if (navigationService?.init) {
      await Promise.race([
        navigationService.init(),
        new Promise((_, reject) =>
          browserAPI.getWindow().setTimeout(
            () => reject(new Error('Timeout in navigationService.init')),
            PHASE_TIMEOUT
          )
        )
      ]);

      // Register navigation views
      if (!navigationService.hasView('projectList')) {
        navigationService.registerView('projectList', {
          show: async () => {
            try {
              const dashboard = DependencySystem.modules.get('projectDashboard');
              if (dashboard?.components?.projectList?.show) {
                await dashboard.components.projectList.show();
                return true;
              }
              const plc = DependencySystem.modules.get('projectListComponent');
              if (plc?.show) {
                await plc.show();
                return true;
              }
              return false;
            } catch (err) {
              logger.error('[initializeUIComponents]', err, { context: 'app:initializeUIComponents:projectList:show' });
              throw err;
            }
          },
          hide: async () => {
            try {
              const dashboard = DependencySystem.modules.get('projectDashboard');
              if (dashboard?.components?.projectList?.hide) {
                await dashboard.components.projectList.hide();
                return true;
              }
              const plc = DependencySystem.modules.get('projectListComponent');
              if (plc?.hide) {
                await plc.hide();
                return true;
              }
              return false;
            } catch (err) {
              logger.error('[initializeUIComponents]', err, { context: 'app:initializeUIComponents:projectList:hide' });
              throw err;
            }
          }
        });
      }

      // Enhanced projectDetails view registration with dependency waiting
      if (!navigationService.hasView('projectDetails')) {
        navigationService.registerView('projectDetails', {
          show: async (params) => {
            try {
              await domReadinessService.dependenciesAndElements({
                deps: ['projectDashboard', 'projectDetailsComponent'],
                timeout: 10000,
                context: 'app.js:nav:projectDetails'
              });

              const dashboard = DependencySystem.modules.get('projectDashboard');
              if (dashboard?.showProjectDetails) {
                await dashboard.showProjectDetails(params.projectId);
                return true;
              }
              const pdc = DependencySystem.modules.get('projectDetailsComponent');
              if (pdc?.showProjectDetails) {
                await pdc.showProjectDetails(params.projectId);
                return true;
              }
              return false;
            } catch (err) {
              logger.error('[navigationService]', err, { context: 'app:navigationService:projectDetails:show' });
              throw err;
            }
          },
          hide: async () => {
            try {
              const dashboard = DependencySystem.modules.get('projectDashboard');
              if (dashboard?.components?.projectDetails?.hideProjectDetails) {
                await dashboard.components.projectDetails.hideProjectDetails();
                return true;
              }
              const pdc = DependencySystem.modules.get('projectDetailsComponent');
              if (pdc?.hideProjectDetails) {
                await pdc.hideProjectDetails();
                return true;
              }
              return false;
            } catch (err) {
              logger.error('[navigationService]', err, { context: 'app:navigationService:projectDetails:hide' });
              throw err;
            }
          }
        });
      }
    }
    logStep('navigationService', 'post');

    appModule.setAppLifecycleState({ initialized: true });
    _globalInitCompleted = true;

    // Log a compact summary of all timings
    Object.entries(phaseTimings).forEach(([p, { start, end }]) => {
      if (start && end) {
        const d = Math.round(end - start);
        logger.info(`[App.init] Phase "${p}" duration: ${d} ms`);
      }
    });

    // Log DOM selector wait stats
    const selStats = domReadinessService.getSelectorTimings?.() || {};
    Object.entries(selStats)
      .sort(([, a], [, b]) => b - a)
      .forEach(([sel, ms]) =>
        logger.info(`[Perf] DOM selector "${sel}" waited ${ms} ms total`));
    domAPI.dispatchEvent(
      domAPI.getDocument(),
      eventHandlers.createCustomEvent('app:domSelectorTimings', { detail: selStats })
    );

    if (!globalInitTimeoutFired) {
      browserAPI.getWindow().clearTimeout(globalInitTimeoutId);
      fireAppReady(true);
    }
    return true;
  } catch (err) {
    logger.error('[init]', err, { context: 'app:init', ts: Date.now() });
    handleInitError(err);
    fireAppReady(false, err);
    throw err;
  } finally {
    _globalInitInProgress = false;
    appModule.setAppLifecycleState({
      initializing: false,
      currentPhase: appModule.state.initialized ? 'initialized_idle' : 'failed_idle'
    });
    toggleLoadingSpinner(false);
  }
}

// ---------------------------------------------------------------------------
// Auto-bootstrap when running in browser
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
  // Setup global error handling using errorInit module
  errorInit.initializeErrorHandling();

  const doc = browserAPI.getDocument();
  // Use forceShowLoginModal from authInit module
  const forceShowLoginModal = authInit.forceShowLoginModal;

  // ---------------------------------------------------------------------
  // 🚀 Auto-bootstrap the application
  // ---------------------------------------------------------------------
  // app.js is the only file in the codebase allowed to run side-effects at
  // import time.  Previous refactors accidentally removed the automatic
  // invocation of `init()`, leaving the loading spinner visible forever
  // because initialization never started.  We restore the behaviour by
  // kicking off the async init sequence once the module is evaluated in the
  // browser environment.  Any error is surfaced through the DI-provided
  // logger so that it reaches the unified logging pipeline.

  (async () => {
    try {
      await init();
    } catch (err) {
      const log = DependencySystem?.modules?.get?.('logger');
      if (log?.error) {
        log.error('[app.js][bootstrap] init() failed', err, { context: 'app:bootstrap' });
      }
      // Fire app:ready with failure so external listeners are unblocked
      try {
        fireAppReady(false, err);
      } catch (e) {
        logger.error('[app.js][bootstrap] Error in fireAppReady', e, { context: 'app:bootstrap:fireAppReady' });
      }
    }
  })();
}
