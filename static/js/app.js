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
import { getSessionId } from './utils/session.js';
import { createDomReadinessService } from './utils/domReadinessService.js';
import { createApiClient } from './utils/apiClient.js';
import { createHtmlTemplateLoader } from './utils/htmlTemplateLoader.js';
import { createServiceInitializer } from './init/serviceInit.js';
import { createCoreInitializer } from './init/coreInit.js';
import { createUIInitializer } from './init/uiInit.js';
import { createAuthInitializer } from './init/authInit.js';
import { createAppStateManager } from './init/appState.js';
import { createErrorInitializer } from './init/errorInit.js';
import { safeInit } from './utils/initHelpers.js';

import {
  shouldSkipDedup,
  stableStringify,
  isAbsoluteUrl,
  isValidProjectId,
  formatBytes as globalFormatBytes,
  formatDate as globalFormatDate,
  fileIcon as globalFileIcon
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
import { createSidebar } from './sidebar.js';
import { createUiRenderer } from './uiRenderer.js';

import MODAL_MAPPINGS from './modalConstants.js';
import { createFileUploadComponent } from './FileUploadComponent.js';
import { createSafeHandler } from './safeHandler.js'; // Canonical SafeHandler factory

// ---------------------------------------------------------------------------
// UI helpers for KnowledgeBaseComponent
// ---------------------------------------------------------------------------
const uiUtils = {
  formatBytes: globalFormatBytes,
  formatDate: globalFormatDate,
  fileIcon: globalFileIcon
};

import { createLogger } from './logger.js';

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

// --- EARLY SAFEHANDLER: Register dummy for boot phase to break logger/safeHandler/eventHandlers chain ---
function __dummySafeHandler(fn) {
  return typeof fn === "function" ? fn : () => {};
}
__dummySafeHandler.cleanup = function() {};
DependencySystem.register('safeHandler', __dummySafeHandler);

// --- 1) Early logger REMOVED: logger is now initialized after serviceInit basic services (see below)

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
  // logger is registered later; domAPI will pick it up via DependencySystem DI after logger is registered.
  sanitizer
});

/* (deleted old domReadinessService creation; correct DI with eventHandlers after eventHandlers instantiation) */

// ---------------------------------------------------------------------------
// 6) Early app module (using factory) — NO LOGGER YET
// ---------------------------------------------------------------------------
const appModule = createAppStateManager({ DependencySystem /* logger registered later */ });
DependencySystem.register('appModule', appModule);

// ---------------------------------------------------------------------------
// 7) Define app object early (CRITICAL FIX)
// ---------------------------------------------------------------------------
const app = {}; // This will be enriched later
DependencySystem.register('app', app);

/* ──  NOW: Create eventHandlers instance via DI-compliant factory  ────────── */
const eventHandlers = createEventHandlers({
  DependencySystem,
  domAPI,
  browserService: browserServiceInstance,
  APP_CONFIG,
  // logger registered later via DependencySystem
  errorReporter: createErrorReporterStub({ /* logger registered later */ }),
  sanitizer,
  app,
  projectManager: null,
  modalManager: null,
  safeHandler: DependencySystem.modules.get('safeHandler')  // fetch via DI (avoid TDZ)
  // domReadinessService to be injected after instantiation
});
DependencySystem.register('eventHandlers', eventHandlers);

/* Correct domReadinessService creation — after eventHandlers are available. */
const domReadinessService = createDomReadinessService({
  DependencySystem,
  domAPI,
  browserService: browserServiceInstance,
  eventHandlers
  // logger registered later via DependencySystem
});
DependencySystem.register('domReadinessService', domReadinessService);

/* Wire the circular dependency */
eventHandlers.setDomReadinessService(domReadinessService);

// (duplicate safeHandler and app:ready dispatch helper removed)

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
DependencySystem.register('createSidebar', createSidebar);
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
  sanitizer,
  APP_CONFIG,
  uiUtils,
  globalUtils: { shouldSkipDedup, stableStringify, normaliseUrl, isAbsoluteUrl, isValidProjectId },
  createFileUploadComponent,
  createApiClient, // apiClient factory
  createAccessibilityEnhancements,
  createNavigationService,
  createHtmlTemplateLoader,
  createUiRenderer,
  // logger will be created after serviceInit.registerBasicServices()
  getSessionId
});

 // Register basic services (this creates the logger)
serviceInit.registerBasicServices(); // This should now create and register apiClientObject

// ---- NEW ORDER: Logger creation/registration BEFORE advanced services ----


/* Logger creation and SafeHandler upgrade remain in place (no changes needed here) */
const loggerInstance = createLogger({
  endpoint: APP_CONFIG.API_ENDPOINTS?.LOGS ?? '/api/logs',
  enableServer: true,
  debug: APP_CONFIG.DEBUG === true,
  minLevel: APP_CONFIG.LOGGING?.MIN_LEVEL ?? 'debug',
  consoleEnabled: APP_CONFIG.LOGGING?.CONSOLE_ENABLED ?? true,
  browserService: browserServiceInstance,
  sessionIdProvider: getSessionId,
  apiClient: DependencySystem.modules.get('apiClientObject'),
  safeHandler: DependencySystem.modules.get('safeHandler') // Ensure safeHandler is available
});
DependencySystem.register('logger', loggerInstance);
const logger = loggerInstance; // Make it available to rest of app.js

// Upgrade safeHandler to use the correct logger
const safeHandler = createSafeHandler({ logger });
if (DependencySystem?.modules?.has?.('safeHandler')) {
  DependencySystem.modules.set('safeHandler', safeHandler);
  logger.debug('[app] safeHandler upgraded to canonical implementation', { context: 'app:safeHandler' });
} else {
  DependencySystem.register('safeHandler', safeHandler);
}

// Inject the fully configured logger into serviceInit if needed
serviceInit.setLogger(logger);
// NOTE: serviceInit.registerAdvancedServices() is now called earlier.

// serviceInit.registerAdvancedServices(); // MOVED EARLIER

// Create API client (now should be available via serviceInit)
// ---------------------------------------------------------------------------
// const apiRequest = DependencySystem.modules.get('apiRequest'); // Commented out

// Modals.html will be loaded synchronously during init() before UI components

// ---------------------------------------------------------------------------
// 12) app object & top-level state (enrich the early-defined app object)
// ---------------------------------------------------------------------------
// The local 'currentUser' variable has been removed.
// appModule.state.currentUser is the single source of truth.

// The local appState variable has also been removed. Its properties are merged into appModule.state.
// appModule.state is now the single source of truth for these flags.

let _globalInitCompleted = false;
let _globalInitInProgress = false;

/* Enrich the stub "app" (registered earlier) with its real API */

// CONSOLIDATED: All project state management moved to appState.js
Object.assign(app, {
  // CONSOLIDATED: Fully delegate URL parsing to navigationService
  getProjectId: () => {
    const navigationService = DependencySystem.modules.get('navigationService');
    if (navigationService?.getUrlParams) {
      return navigationService.getUrlParams().project || null;
    }
    // No fallback - navigationService should handle all URL parsing
    logger.warn('[app] getProjectId: navigationService not available', { context: 'app:getProjectId' });
    return null;
  },
  // CONSOLIDATED: Delegate to canonical appModule state
  getCurrentProject: () => {
    const appModule = DependencySystem.modules.get('appModule');
    return appModule?.getCurrentProject?.() || null;
  },
  // CONSOLIDATED: Delegate to canonical appModule state
  setCurrentProject: (project) => {
    const appModule = DependencySystem.modules.get('appModule');
    if (appModule?.setCurrentProject) {
      // CONSOLIDATED: appState.js handles ALL validation, logging, and event dispatching (including legacy events)
      appModule.setCurrentProject(project);
      return project;
    } else {
      logger.warn('[app] setCurrentProject: appModule not available', { context: 'app:setCurrentProject' });
      return null;
    }
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
    if (appModuleRef) {
      logger.info('[app] setCurrentUser: Setting user in appModule.state', { userId: user?.id, username: user?.username });
      appModuleRef.setAuthState({
        currentUser: user, // This updates appModule's state
        // isAuthenticated should be updated by authModule logic, not directly here unless intended
      });
    } else {
      logger.warn('[app] setCurrentUser: appModule not found. Cannot set user.');
    }
  }
});

// ─── Compatibility helper (remove once all callers updated) ───
app.setLifecycleState = (...args) => {
  DependencySystem.modules.get('logger')
    ?.warn?.('[app] setLifecycleState() is deprecated – use appModule.setAppLifecycleState()', { context: 'app:compat' });
  DependencySystem.modules.get('appModule')
    ?.setAppLifecycleState?.(...args);
};

// Update app properties with required references
app.DependencySystem = DependencySystem;
// app.apiRequest = apiRequest; // Commented out
app.state = appModule.state; // Point app.state to the single source of truth in appModule
// Add isInitializing getter to delegate to appModule state
Object.defineProperty(app, 'isInitializing', {
  get: () => appModule.state.initializing,
  enumerable: true,
  configurable: true
});

// `currentUser` is accessible exclusively via `appModule.state.currentUser`.
// No separate DI registration is required (avoids duplicate sources of truth).


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

  // expose flag for modules that check it via DependencySystem.modules.get('app')
  app._appReadyDispatched = true;

  const detail = success ? { success } : { success, error };
  const drs = DependencySystem.modules.get?.('domReadinessService');
  if (drs?.emitReplayable) {
    // Use replay-capable emitter so late listeners resolve immediately
    drs.emitReplayable('app:ready', detail);
  } else {
    const evt = eventHandlers.createCustomEvent('app:ready', { detail });
    AppBus.dispatchEvent(evt);
    domAPI.dispatchEvent(domAPI.getDocument(), evt);
  }

  DependencySystem.modules.get('logger')?.log('[fireAppReady] dispatched', { success, error, context: 'app' });
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
  safeHandler: DependencySystem.modules.get('safeHandler'),
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
  safeHandler: DependencySystem.modules.get('safeHandler')
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
  safeHandler: DependencySystem.modules.get('safeHandler'),
  sanitizer,
  createProjectDetailsEnhancements,
  createTokenStatsManager,
  createKnowledgeBaseComponent,
  apiRequest,
  uiUtils
});

// safeInit and other init helpers are now imported from shared utilities
// This eliminates duplication across init modules

// fetchCurrentUser logic is now delegated to auth module
// This eliminates duplication and ensures single source of truth for user fetching

// CONSOLIDATED: Chat initialization logic moved to chatManager.js
// ChatManager already handles:
// 1. Project changes via AppBus 'currentProjectChanged' events
// 2. Authentication changes via AuthBus 'authStateChanged' events
// 3. Initialization via projectDetailsComponent._restoreChatAndModelConfig()
// No duplicate logic needed here.

function registerAppListeners() {
  // CONSOLIDATED: No app-level listeners needed
  // All event handling is now managed by individual modules:
  // - ChatManager handles project/auth changes
  // - ProjectManager handles project events
  // - AuthModule handles authentication events
  logger.info('[app] registerAppListeners: All event handling delegated to individual modules', { context: 'app:registerAppListeners' });
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
/**
 * Orchestrates the full asynchronous initialization sequence for the application.
 *
 * Waits for DOM readiness, loads required HTML templates, initializes core systems, waits for critical dependencies, sets up authentication, fetches the current user if authenticated, initializes UI components, registers navigation views, and sets up app-level listeners. Handles timing, error management, and global timeouts, and dispatches the final "app:ready" event upon completion or failure.
 *
 * @returns {Promise<boolean>} Resolves to `true` if initialization completes successfully.
 *
 * @throws {Error} If any critical initialization phase fails or required dependencies are missing.
 *
 * @remark
 * If initialization exceeds the configured global timeout, an error is logged, error handling is triggered, and the "app:ready" event is dispatched with failure status.
 */
export async function init() {
  logger.log('[App.init] Called', { context: 'app:init', ts: Date.now() });

  // ---------------------------------------------------------------------------
  // Phase 0: Pre-Initialization & Safety Checks
  // ---------------------------------------------------------------------------
  const GLOBAL_INIT_TIMEOUT_MS = 15000; // 15 seconds
  const PHASE_TIMEOUT = 5000; // 5 seconds

  // Global emergency fail-safe
  let globalInitTimeoutFired = false;
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

  try {
    // ---------------------------------------------------------------------------
    // Phase 1: Essential Services Setup
    // ---------------------------------------------------------------------------
    // Ensure the DOM is fully loaded before initialization (moved here as part of Phase 1)
    await domReadinessService.documentReady();
    logger.info('[App.init] DOM ready.');

    // serviceInit.registerBasicServices() is called outside init, prior to logger creation.
    // Logger creation and registration happen outside init.
    // serviceInit.setLogger(logger) is called outside init.

    // Moved serviceInit.registerAdvancedServices() call
    if (serviceInit?.registerAdvancedServices) {
      serviceInit.registerAdvancedServices();
      logger.info('[App.init] Advanced services registered by serviceInit.');
    } else {
      logger.error('[App.init] serviceInit.registerAdvancedServices is not defined. Critical services might be missing.');
      // throw new Error("serviceInit.registerAdvancedServices is not defined"); // Optional: fatal error
    }
    logger.info('[App.init] Essential services setup phase completed.');

    // ---------------------------------------------------------------------------
    // Phase 2: Core Systems and Error Handling Initialization
    // ---------------------------------------------------------------------------
    logger.log('[App.init] Initializing Error Handling...');
    errorInit.initializeErrorHandling();
    logger.info('[App.init] Error handling initialization completed.');

    logger.log('[App.init] Initializing Core Systems...');
    await coreInit.initializeCoreSystems(); // This implicitly starts modal loading
    logger.info('[App.init] Core systems initialization phase completed.');

    // ---------------------------------------------------------------------------
    // Phase 3: Post-Core & Auth Initialization
    // ---------------------------------------------------------------------------
    logger.log('[App.init] Waiting for modals to load (triggered by coreInit)...');
    await domReadinessService.waitForEvent('modalsLoaded', {
      timeout: 10000, // Increased timeout for modals
      context: 'app.init:modalsLoaded'
    });
    logger.info('[App.init] Modals loaded successfully.');

    logger.log('[App.init] Waiting for critical DI modules (auth, eventHandlers, modalManager)...');

    // Debug: Check which modules are already available
    const modulesStatus = {
      auth: !!DependencySystem.modules.get('auth'),
      eventHandlers: !!DependencySystem.modules.get('eventHandlers'),
      modalManager: !!DependencySystem.modules.get('modalManager'),
      sidebar: !!DependencySystem.modules.get('sidebar')
    };
    logger.info('[App.init] Modules status before wait:', modulesStatus);

    await domReadinessService.dependenciesAndElements({
      deps: ['auth', 'eventHandlers', 'modalManager'],
      timeout: PHASE_TIMEOUT, // Use PHASE_TIMEOUT
      context: 'app.init:depsReady'
    });
    logger.info('[App.init] Critical DI modules ready.');

    logger.log('[App.init] Initializing Auth System...');
    const safeAuthInit = safeHandler(
      () => authInit.initializeAuthSystem(),
      'authInit.initializeAuthSystem'
    );
    await safeAuthInit();
    logger.info('[App.init] Auth system initialization completed.');

    // Logger is now created after API client is ready, so no upgrade needed here.

    if (appModule.state.isAuthenticated) {
      logger.log('[App.init] Fetching Current User (as part of Auth init)...');
      const authModule = DependencySystem.modules.get('auth');
      if (authModule?.fetchCurrentUser) {
        const user = await authModule.fetchCurrentUser();
        if (user) {
          app.setCurrentUser(user); // Uses appModule.setAuthState internally
          browserAPI.setCurrentUser(user); // For browser-level context if needed
        }
      } else {
        logger.warn('[App.init] Auth module fetchCurrentUser method not available');
      }
      logger.info('[App.init] Fetch current user step completed.');
    }
    logger.info('[App.init] Post-core and auth initialization phase completed.');

    // ---------------------------------------------------------------------------
    // Phase 4: UI, Navigation, and Application Ready
    // ---------------------------------------------------------------------------
    logger.log('[App.init] Initializing UI Components...');

    // Debug: Check DOM elements before UI init
    const domElementsStatus = {
      mainSidebar: !!domAPI.getElementById('mainSidebar'),
      navToggleBtn: !!domAPI.getElementById('navToggleBtn'),
      authButton: !!domAPI.getElementById('authButton'),
      modalsContainer: !!domAPI.getElementById('modalsContainer')
    };
    logger.info('[App.init] DOM elements status before UI init:', domElementsStatus);

    await uiInit.initializeUIComponents();

    // Debug: Check modules after UI init
    const modulesAfterUI = {
      sidebar: !!DependencySystem.modules.get('sidebar'),
      sidebarInitialized: DependencySystem.modules.get('sidebar')?.initialized || false
    };
    logger.info('[App.init] Modules after UI init:', modulesAfterUI);

    logger.info('[App.init] UI components initialization completed.');

    const mc = DependencySystem.modules.get('modelConfig');
    if (mc?.initializeUI) {
      logger.log('[App.init] Initializing Model Config UI...');
      mc.initializeUI();
      logger.info('[App.init] Model Config UI initialization completed.');
    }

    logger.log('[App.init] Registering App Listeners...');
    registerAppListeners(); // Note: This function currently logs delegation, no direct listeners.
    logger.info('[App.init] App listeners registration step completed.');

    logger.log('[App.init] Initializing Navigation Service...');
    const navService = DependencySystem.modules.get('navigationService');
    if (!navService) {
      throw new Error('[App] NavigationService missing from DI. Aborting initialization.');
    }
    if (navService?.init) {
      await navService.init();
    }
    logger.info('[App.init] Navigation service initialization completed.');

    appModule.setAppLifecycleState({ initialized: true }); // Mark app as initialized in central state
    _globalInitCompleted = true; // Mark global flag

    // Debug: Force sidebar visibility check
    logger.info('[App.init] Final debug - checking sidebar state');
    const sidebar = DependencySystem.modules.get('sidebar');
    const sidebarEl = domAPI.getElementById('mainSidebar');
    if (sidebarEl) {
      const sidebarClasses = Array.from(sidebarEl.classList);
      const viewportWidth = browserAPI.getWindow().innerWidth;
      logger.info('[App.init] Sidebar final state:', {
        sidebarExists: !!sidebar,
        elementExists: !!sidebarEl,
        classes: sidebarClasses,
        viewportWidth,
        hasTranslateXFull: sidebarClasses.includes('-translate-x-full'),
        hasTranslateX0: sidebarClasses.includes('translate-x-0')
      });

      // Force sidebar visible on desktop if not already
      if (viewportWidth >= 768 && sidebarClasses.includes('-translate-x-full')) {
        logger.warn('[App.init] FORCING sidebar visible on desktop');
        sidebarEl.classList.remove('-translate-x-full');
        sidebarEl.classList.add('translate-x-0');
      }
    }

    if (!globalInitTimeoutFired) {
      browserAPI.getWindow().clearTimeout(globalInitTimeoutId); // Clear global timeout
      fireAppReady(true); // Dispatch app:ready event
    }
    logger.info('[App.init] UI, Navigation, and Application Ready phase completed.');

    // ---------------------------------------------------------------------------
    // Phase 5: Post-Ready Operations
    // ---------------------------------------------------------------------------
    exposeDebugHelpers(); // Expose debug helpers after app:ready
    logger.info('[App.init] Post-ready operations phase completed.');

    return true;
  } catch (err) {
    logger.error('[init] Initialization failed', err, { context: 'app:init', ts: Date.now() });
    handleInitError(err); // Centralized error handling
    if (!globalInitTimeoutFired) {
      browserAPI.getWindow().clearTimeout(globalInitTimeoutId);
      fireAppReady(false, err); // Dispatch app:ready with failure
    }
    throw err; // Re-throw the error after handling
  } finally {
    _globalInitInProgress = false; // Reset progress flag
    appModule.setAppLifecycleState({ // Update central lifecycle state
      initializing: false,
      currentPhase: appModule.state.initialized ? 'initialized_idle' : 'failed_idle'
    });
    toggleLoadingSpinner(false); // Hide loading spinner
    logger.log('[App.init] Final cleanup completed.', { context: 'app:init:finally', ts: Date.now() });
  }
}

// ---------------------------------------------------------------------------
// Expose debug helpers after app:ready (Now part of Phase 5)
// ---------------------------------------------------------------------------
async function exposeDebugHelpers() {
  await domReadinessService.waitForEvent('app:ready'); // Ensure app is ready before exposing
  const windowObj = browserAPI.getWindow();
  if (windowObj) {
    windowObj.debugSidebarAuth = () => {
      const sidebar = DependencySystem.modules.get('sidebar');
      return sidebar?.debugAuthState ? sidebar.debugAuthState() : (logger.warn('[App] Sidebar debug function not available'), null);
    };
    windowObj.debugAppState = () => {
      const appModuleRef = DependencySystem.modules.get('appModule');
      const state = {
        appState: appModuleRef?.state,
        authInfo: {
          isAuthenticated: appModuleRef?.state?.isAuthenticated,
          currentUser: appModuleRef?.state?.currentUser
        }
      };
      logger.info('[App] Debug app state requested', state);
      return state;
    };
    logger.info('[App] Debug functions available: window.debugSidebarAuth(), window.debugAppState()');
  }
}

// ---------------------------------------------------------------------------
// Auto-bootstrap when running in browser
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
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
// Auto-bootstrap when running in browser
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
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
