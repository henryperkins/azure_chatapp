/**
 * bootstrap.js - Application Bootstrapping Orchestrator (Refactored)
 *
 * Initializes the DependencySystem, loads and registers all core modules,
 * and executes the main application initialization sequence.
 * Uses only real factories and patterns from codebase; no hypothetical modules.
 */

// Import Core Utilities & Factories—all must exist in codebase!
import { createCoreSystems } from './core-systems.js'; // Existing: infrastructure composer
import { createEventHandlers } from './eventHandler.js';
import { createNotificationHandler } from './notification-handler.js';
import { createAuthSystem } from './auth-system.js';
import { createApiRequest } from './api-request.js';   // Confirmed as present elsewhere
import { createUIShell } from './ui-shell.js';
import { createComponentFactories } from './component-factories.js';
import { createNavigation } from './navigation.js';
import { createRuntime } from './runtime.js';

// Use the globally available DI system (created in the HTML entry, see [[base]])
const DependencySystem = window.DependencySystem;

/**
 * Creates the main application bootstrap orchestrator.
 * @param {object} initialConfig - Any initial configuration overrides.
 * @returns {object} API - { startApp }
 */
export function createBootstrap(initialConfig = {}) {
  let appState = {
    initialized: false,
    initializing: false,
    currentPhase: 'idle',
    fatalError: null,
  };
  // Core DI-shared references
  let notificationHandler, notify, errorReporter, eventHandlers, runtime;

  /**
   * Handles fatal initialization errors.
   */
  function handleFatalError(error, phase) {
    appState.initialized = false;
    appState.initializing = false;
    appState.currentPhase = `failed (${phase})`;
    appState.fatalError = error;
    const errorMessage = `Application failed to start during [${phase}]: ${error.message}. Please refresh.`;

    // Prefer unified notification, fallback to console
    if (notify?.error) {
      notify.error(errorMessage, { timeout: 0, group: true, context: 'bootstrap' });
    } else if (notificationHandler?.show) {
      notificationHandler.show(errorMessage, 'error', { timeout: 0, group: true, context: 'bootstrap' });
    } else {
      console.error(`[Bootstrap] FATAL ERROR: ${errorMessage}`, error);
    }

    // Optionally update dedicated DOM container for fatal errors
    try {
      const errorContainer = document.getElementById('appFatalError');
      if (errorContainer) {
        errorContainer.textContent = errorMessage;
        errorContainer.style.display = 'block';
      }
      const loadingSpinner = document.getElementById('appLoading');
      if (loadingSpinner) loadingSpinner.style.display = 'none';
    } catch {
      // Silent fallback; don't throw.
    }
  }

  /**
   * The main application initialization sequence.
   * @returns {Promise<boolean>}
   */
  async function startApp() {
    const phaseLogger = (tag, extra) => {
      const msg = `[Bootstrap DI] Phase: ${tag}` + (extra ? ` | ${extra}` : '');
      console.info(msg);
      if (notify?.info) notify.info(msg, { context: 'bootstrap', timeout: 1000 });
    };

    if (appState.initialized || appState.initializing) {
      console.warn('[Bootstrap] Initialization attempt skipped (already done or in progress).');
      return appState.initialized;
    }
    const initStartTime = performance.now();
    appState.initializing = true;
    appState.currentPhase = 'starting';
    phaseLogger(appState.currentPhase);

    try {
      // --- Phase 1: Setup Core Systems ---
      appState.currentPhase = 'init_core_systems';
      phaseLogger(appState.currentPhase);
      // createCoreSystems wires up browserAPI, notificationHandler, notify, storage, sanitizer, etc.
      const core = await createCoreSystems({
        DependencySystem,
        eventHandlers: createEventHandlers({ DependencySystem }),
        createNotificationHandler,
        APP_CONFIG: initialConfig || {},
      });
      // Register core output if not already registered inside core-systems.js
      [
        { key: 'browserAPI', value: core.browserAPI },
        { key: 'notificationHandler', value: core.notificationHandler },
        { key: 'notify', value: core.notify },
        { key: 'storage', value: core.storageService },
        { key: 'sanitizer', value: core.sanitizer },
        { key: 'errorReporter', value: core.errorReporter },
      ].forEach(({ key, value }) => {
        if (value && !DependencySystem.modules.has(key)) {
          DependencySystem.register(key, value);
        }
      });

      // Adopt DI-resolved instances
      notificationHandler = core.notificationHandler;
      notify = core.notify;
      eventHandlers = DependencySystem.modules.get('eventHandlers');
      errorReporter = core.errorReporter;

      // --- Phase 2: Register context-aware API (apiRequest) and auth system ---
      appState.currentPhase = 'init_api_auth';
      phaseLogger(appState.currentPhase);
      const APP_CONFIG = DependencySystem.modules.get('APP_CONFIG') || initialConfig;

      const apiRequest = createApiRequest({
        DependencySystem,
        APP_CONFIG,
        notificationHandler: notify, // Use DI-level notification util
        authProvider: () => DependencySystem.modules.get('auth')
      });
      DependencySystem.register('apiRequest', apiRequest);

      const authSystem = await createAuthSystem({
        DependencySystem,
        createAuthModule: DependencySystem.modules.get('createAuthModule'),
        eventHandlers,
        notify,
        errorReporter,
        toggleElement: () => {}, // Optionally inject, see app.js context
        fetchCurrentUser: () => {}, // Optionally inject, see app.js
        APP_CONFIG
      });
      DependencySystem.register('auth', authSystem);

      // --- Phase 3: Instantiate UI, Components, Navigation ---
      appState.currentPhase = 'instantiate_modules';
      phaseLogger(appState.currentPhase);

      const coreSystems = DependencySystem.modules.get('coreSystems')
        || (typeof createCoreSystems === 'function' && createCoreSystems({ DependencySystem }));
      DependencySystem.register('coreSystems', coreSystems);

      const uiShell = createUIShell({
        DependencySystem,
        notify,
        apiRequest,
        domAPI: core.browserAPI,
        browserAPI: core.browserAPI,
        eventHandlers,
        modalManager: DependencySystem.modules.get('modalManager'),
        app: DependencySystem.modules.get('app'),
        projectManager: DependencySystem.modules.get('projectManager'),
        storage: DependencySystem.modules.get('storage'),
        sanitizer: DependencySystem.modules.get('sanitizer'),
        auth: DependencySystem.modules.get('auth'),
        config: APP_CONFIG
      });
      DependencySystem.register('uiShell', uiShell);

      const componentFactories = createComponentFactories({ DependencySystem });
      DependencySystem.register('componentFactories', componentFactories);

      const navigation = createNavigation({ DependencySystem });
      DependencySystem.register('navigation', navigation);

      // --- Phase 4: Initialize Modules in Dependency Order ---
      appState.currentPhase = 'init_modules_core';
      phaseLogger(appState.currentPhase);
      if (coreSystems?.init) await coreSystems.init();

      appState.currentPhase = 'init_modules_auth';
      phaseLogger(appState.currentPhase);
      if (authSystem?.init) await authSystem.init();

      appState.currentPhase = 'init_modules_ui_shell';
      phaseLogger(appState.currentPhase);
      if (uiShell?.initialize) await uiShell.initialize();

      appState.currentPhase = 'init_modules_navigation';
      phaseLogger(appState.currentPhase);
      if (navigation?.init) await navigation.init();

      // --- Phase 5: Start Runtime Listeners ---
      appState.currentPhase = 'start_runtime';
      phaseLogger(appState.currentPhase);
      runtime = createRuntime({ DependencySystem });
      if (runtime?.startRuntimeListeners) runtime.startRuntimeListeners();

      // --- Finalization ---
      appState.currentPhase = 'finalizing';
      phaseLogger(appState.currentPhase);
      appState.initialized = true;
      appState.initializing = false;

      const initEndTime = performance.now();
      notify.info(`[Bootstrap] Initialization complete in ${(initEndTime - initStartTime).toFixed(2)} ms.`);
      core.browserAPI.getDocument()?.dispatchEvent(new CustomEvent('appInitialized', { detail: { success: true } }));

      return true;
    } catch (error) {
      handleFatalError(error, appState.currentPhase);
      try {
        DependencySystem.modules.get('browserAPI')?.getDocument()?.dispatchEvent(
          new CustomEvent('appInitialized', { detail: { success: false, error } })
        );
      } catch { /* intentionally empty: ignore errors on dispatch */ }
      return false;
    } finally {
      appState.initializing = false;
      try { document.getElementById('appLoading')?.style?.setProperty('display', 'none'); } catch { /* intentionally empty: ignore errors on spinner hide */ }
    }
  }

  return { startApp };
}
