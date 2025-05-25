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

// --- 1) Early real logger --------------------------------------------------
const loggerInstance = createLogger({
  endpoint        : APP_CONFIG.API_ENDPOINTS?.LOGS ?? '/api/logs',
  // Start with local-only logging; authInit will enable the remote sink
  enableServer    : false,
  debug           : APP_CONFIG.DEBUG === true,
  minLevel        : APP_CONFIG.LOGGING?.MIN_LEVEL ?? 'debug',
  consoleEnabled  : APP_CONFIG.LOGGING?.CONSOLE_ENABLED ?? true,
  browserService  : browserServiceInstance,
  sessionIdProvider : getSessionId
});
DependencySystem.register('logger', loggerInstance);
const logger = loggerInstance;

// ---------------------------------------------------------------------------
//  Canonical safeHandler – must exist before createEventHandlers is invoked
// ---------------------------------------------------------------------------
function safeHandler(handler, description = 'safeHandler') {
  const log = DependencySystem.modules.get?.('logger');
  return (...args) => {
    try { return handler(...args); }
    catch (err) {
      log?.error?.(`[safeHandler][${description}]`,
                   err?.stack || err,
                   { context: description });
      throw err;
    }
  };
}
DependencySystem.register('safeHandler', safeHandler);

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
  documentObject : browserAPI.getDocument(),
  windowObject   : browserAPI.getWindow(),
  debug          : APP_CONFIG.DEBUG === true,
  logger         : logger,
  sanitizer
});

/* (deleted old domReadinessService creation; correct DI with eventHandlers after eventHandlers instantiation) */

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

/* ──  NOW: Create eventHandlers instance via DI-compliant factory  ────────── */
const eventHandlers = createEventHandlers({
  DependencySystem,
  domAPI,
  browserService: browserServiceInstance,
  APP_CONFIG,
  logger,
  errorReporter: createErrorReporterStub({ logger }),
  sanitizer,
  app,
  projectManager: null,
  modalManager: null,
  safeHandler    // provide canonical wrapper
  // domReadinessService to be injected after instantiation
});
DependencySystem.register('eventHandlers', eventHandlers);

/* Correct domReadinessService creation — after eventHandlers are available. */
const domReadinessService = createDomReadinessService({
  DependencySystem,
  domAPI,
  browserService: browserServiceInstance,
  eventHandlers,
  logger
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
  createApiClient,
  createAccessibilityEnhancements,
  createNavigationService,
  createHtmlTemplateLoader,
  createUiRenderer,
  logger,
  getSessionId
});

// Register basic services (this creates the logger)
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
  // app object is already registered at line 133, no need to register again
  const detail = success ? { success } : { success, error };
  const evt = eventHandlers.createCustomEvent('app:ready', { detail });
  AppBus.dispatchEvent(evt);
  domAPI.dispatchEvent(domAPI.getDocument(), evt);
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
    // Modal loading is now handled by coreInit and modalManager
    // This eliminates duplication and centralizes modal management

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
    logger.info('[App.init] Core systems initialization phase completed.');

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

    // ─── elevate logger to full remote mode once auth is wired ───
    {
      const logger = DependencySystem.modules.get('logger');
      logger?.setServerLoggingEnabled?.(true);

      // Upgrade logger with API client for proper CSRF handling (after auth is ready)
      const apiClientObject = DependencySystem.modules.get('apiClientObject');
      if (apiClientObject && logger?.upgradeWithApiClient) {
        logger.upgradeWithApiClient(apiClientObject);
        logger.info('[App.init] Logger upgraded with API client for CSRF support', { context: 'app:init:logger' });
      }
    }

    // Early app:ready dispatch: emits right after auth is ready (guaranteed single-fire)
    if (!_appReadyDispatched) fireAppReady(true);

    // 4) If authenticated, fetch current user via auth module
    logStep('fetchCurrentUser', 'pre', { authed: !!appModule.state.isAuthenticated });
    if (appModule.state.isAuthenticated) {
      const authModule = DependencySystem.modules.get('auth');
      if (authModule?.fetchCurrentUser) {
        const user = await Promise.race([
          authModule.fetchCurrentUser(),
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
      } else {
        logger.warn('[App.init] Auth module fetchCurrentUser method not available', { context: 'app:init:fetchCurrentUser' });
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

      // Navigation views are now registered by uiInit.registerNavigationViews()
      // This eliminates duplication and centralizes navigation view management
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

    // Add debug functions to browserAPI window for troubleshooting
    const window = browserAPI.getWindow();
    if (window) {
      window.debugSidebarAuth = () => {
        const sidebar = DependencySystem.modules.get('sidebar');
        if (sidebar?.debugAuthState) {
          return sidebar.debugAuthState();
        } else {
          // Announce using accessibilityUtils if present, else warn
          const accessibilityUtils = DependencySystem.modules.get('accessibilityUtils');
          if (accessibilityUtils?.announce) {
            accessibilityUtils.announce('Sidebar module unavailable. Debug action skipped.', 'assertive');
          }
          logger.warn('[App] Sidebar debug function not available', { context: 'app:debug' });
          return null;
        }
      };

      window.debugAppState = () => {
        const appModule = DependencySystem.modules.get('appModule');
        const authModule = DependencySystem.modules.get('auth');
        const state = {
          appState: appModule?.state,
          // CONSOLIDATED: No separate authState - all auth info is in appState
          authInfo: {
            isAuthenticated: authModule?.isAuthenticated?.(),
            currentUser: authModule?.getCurrentUserObject?.()
          }
        };
        logger.info('[App] Debug app state requested', state, { context: 'app:debug' });
        return state;
      };

      logger.info('[App] Debug functions available: window.debugSidebarAuth(), window.debugAppState()', { context: 'app:debug' });
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
