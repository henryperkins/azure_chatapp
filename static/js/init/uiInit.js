/**
 * uiInit.js
 * Factory for initializing all UI components, event tracking, sidebar helpers, and late-phase visual enhancements.
 *
 * Guardrails:
 * - Factory export (createUIInitializer)
 * - Strict DI: All dependencies passed as arguments
 * - No top-level/side effect logic
 * - All DOM access via domAPI or domReadinessService
 * - All event/listener work via injected eventHandlers
 * - All logging via injected logger
 */

export function createUIInitializer({
  DependencySystem,
  domAPI,
  browserService,
  eventHandlers,
  domReadinessService,
  logger,
  APP_CONFIG,
  safeHandler,
  sanitizer,
  createProjectDetailsEnhancements,
  createTokenStatsManager,
  createKnowledgeBaseComponent, // Factory for KnowledgeBaseComponent (though primarily used in coreInit now)
  apiRequest,                   // The general API request function (fetch wrapper)
  uiUtils                     // General UI utility functions
}) {
  /**
   * @param {object} DependencySystem - The central DI container.
   * @param {object} domAPI - Utility for DOM interactions.
   * @param {object} browserService - Service for browser-specific functionalities.
   * @param {object} eventHandlers - Centralized event management.
   * @param {object} domReadinessService - Service for DOM readiness checks.
   * @param {object} logger - Logging utility.
   * @param {object} APP_CONFIG - Global application configuration.
   * @param {function} safeHandler - Wrapper for safe function execution.
   * @param {object} sanitizer - HTML sanitizer (DOMPurify).
   * @param {function} createProjectDetailsEnhancements - Factory for ProjectDetailsEnhancements.
   * @param {function} createTokenStatsManager - Factory for TokenStatsManager.
   * @param {function} createKnowledgeBaseComponent - Factory for KnowledgeBaseComponent. (Note: KBC is now primarily initialized in coreInit)
   * @param {function} apiRequest - The general API request function.
   * @param {object} uiUtils - General UI utility functions.
   */
  if (
    !DependencySystem || !domAPI || !browserService ||
    !eventHandlers || !domReadinessService || !logger || !APP_CONFIG || !safeHandler ||
    !createProjectDetailsEnhancements || !createTokenStatsManager || !createKnowledgeBaseComponent ||
    !apiRequest || !uiUtils
  ) {
    // Added more checks for the directly passed factories/utils
    throw new Error('[uiInit] Missing one or more required dependencies for UI initialization.');
  }

  let _uiInitialized = false;

  // Sets up sidebar-related UI controls and listeners.
  // Note: Core sidebar logic (like auth state reaction) is in sidebar.js, initialized in coreInit.
  async function setupSidebarControls() {
    // This function's original primary responsibility (toggle button) is now handled by the Sidebar module itself.
    // Kept for potential future UI-specific sidebar controls managed by uiInit.
    logger.log('[UIInit] setupSidebarControls: Sidebar module handles its own core controls. This function is for any additional UI-specific setup if needed.', { context: 'uiInit:setupSidebarControls' });
  }

  // Loads HTML templates required for different views (project list, project details).
  async function loadProjectTemplates() {
    const htmlLoader = DependencySystem.modules.get('htmlTemplateLoader');
    if (!htmlLoader?.loadTemplate) {
      logger.error('[UIInit] htmlTemplateLoader.loadTemplate unavailable', { context: 'uiInit:loadTemplates' });
      return;
    }

    try {
      logger.log('[UIInit] Loading project templates', { context: 'uiInit:loadTemplates' });

      // project_list.html
      await htmlLoader.loadTemplate({
        url: '/static/html/project_list.html',
        containerSelector: '#projectListView',
        eventName: 'projectListHtmlLoaded'
      });

      // project_details.html
      await htmlLoader.loadTemplate({
        url: '/static/html/project_details.html',
        containerSelector: '#projectDetailsView',
        eventName: 'projectDetailsHtmlLoaded'
      });

      logger.log('[UIInit] Project templates loaded successfully', { context: 'uiInit:loadTemplates' });
    } catch (err) {
      logger.error('[UIInit] Failed to load project templates', err, { context: 'uiInit:loadTemplates' });
      throw err;
    }
  }

  async function waitForModalReadiness() {
    const modalMgr = DependencySystem.modules.get('modalManager');
    if (!modalMgr?.isReadyPromise) {
      throw new Error('[uiInit] ModalManager is not available or missing isReadyPromise.');
    }

    const timeoutMS = 8000;
    let timedOut = false;
    await Promise.race([
      modalMgr.isReadyPromise(),
      new Promise((_, reject) =>
        browserService.getWindow().setTimeout(() => {
          timedOut = true;
          reject(new Error(`[uiInit] ModalManager readiness timeout after ${timeoutMS}ms.`));
        }, timeoutMS)
      )
    ]);
    if (timedOut) {
      throw new Error('[uiInit] ModalManager did not become ready within the allotted time.');
    }
  }

  /**
   * Enhanced modal readiness helper that can be used by other modules.
   * Waits for modal manager to be ready with configurable timeout.
   * @param {number} timeout - Timeout in milliseconds (default: 8000)
   * @param {string} context - Context for logging (default: 'waitForModalReadiness')
   * @returns {Promise<boolean>} - True if ready, false if timeout
   */
  async function waitForModalReadinessWithTimeout(timeout = 8000, context = 'waitForModalReadiness') {
    const modalMgr = DependencySystem.modules.get('modalManager');
    if (!modalMgr?.isReadyPromise) {
      throw new Error(`[${context}] ModalManager or isReadyPromise not available (strict mode).`);
    }
    let timedOut = false;
    await Promise.race([
      modalMgr.isReadyPromise(),
      new Promise((_, reject) =>
        browserService.getWindow().setTimeout(() => {
          timedOut = true;
          reject(new Error(`[${context}] Modal readiness timeout after ${timeout}ms (strict mode)`));
        }, timeout)
      )
    ]);
    if (timedOut) {
      throw new Error(`[${context}] ModalManager not ready after ${timeout}ms (strict mode)`);
    }
    return true;
  }

  // Creates and registers UI-specific components like ProjectDetailsEnhancements and TokenStatsManager.
  // Note: Core components (ProjectModal, KnowledgeBaseComponent) are now initialized in coreInit.js.
  // This function focuses on components that are purely UI-enhancements or late-stage additions.
  async function createAndRegisterUIComponents() {
    logger.log('[UIInit] Starting creation and registration of late-stage UI components.', { context: 'uiInit:createAndRegisterUIComponents' });

    // 1. Project Details Enhancements
    //    Provides visual improvements or minor functionalities specifically for the project details view.
    if (createProjectDetailsEnhancements) {
      logger.debug('[UIInit] Creating ProjectDetailsEnhancements...', { context: 'uiInit' });
      const projectDetailsEnhancementsInstance = createProjectDetailsEnhancements({
        domAPI,
        browserService,
        eventHandlers,
        domReadinessService,
        logger,
        sanitizer,
        DependencySystem // For potential internal DI use by the component
      });
      DependencySystem.register('projectDetailsEnhancements', projectDetailsEnhancementsInstance);

      if (projectDetailsEnhancementsInstance.initialize) {
        await projectDetailsEnhancementsInstance.initialize().catch(err =>
          logger.error('[UIInit] ProjectDetailsEnhancements initialization failed', err, { context: 'uiInit:projectDetailsEnhancements' })
        );
      }
      logger.debug('[UIInit] ProjectDetailsEnhancements created and initialized.', { context: 'uiInit' });
    }

    // 2. Token Stats Manager
    //    Manages and displays token statistics, potentially interacting with various core components.
    if (createTokenStatsManager) {
      logger.debug('[UIInit] Creating TokenStatsManager...', { context: 'uiInit' });
      const tokenStatsManagerInstance = createTokenStatsManager({
        apiClient: apiRequest,    // Direct arg: API fetch function
        domAPI,                   // Direct arg
        eventHandlers,            // Direct arg
        browserService,           // Direct arg
        modalManager: DependencySystem.modules.get('modalManager'), // DI: ModalManager instance
        sanitizer,                // Direct arg
        logger,                   // Direct arg
        projectManager: DependencySystem.modules.get('projectManager'), // DI: ProjectManager instance
        app: DependencySystem.modules.get('app'),                     // DI: App object
        chatManager: DependencySystem.modules.get('chatManager'),     // DI: ChatManager instance
        domReadinessService,      // Direct arg
        DependencySystem          // For potential internal DI use by the component
      });
      DependencySystem.register('tokenStatsManager', tokenStatsManagerInstance);
      // Initialize TokenStatsManager if it has an initialize method
      if (typeof tokenStatsManagerInstance.initialize === 'function') {
        logger.debug('[UIInit] Initializing TokenStatsManager...', { context: 'uiInit' });
        await tokenStatsManagerInstance.initialize();
        logger.debug('[UIInit] TokenStatsManager initialized.', { context: 'uiInit' });
      } else {
        logger.debug('[UIInit] TokenStatsManager does not have an initialize method. Skipping initialization call.', { context: 'uiInit' });
      }
      logger.debug('[UIInit] TokenStatsManager created and registered.', { context: 'uiInit' });
    }

    // CONSOLIDATED: KnowledgeBaseComponent creation and its injection into ProjectDetailsComponent
    // are now handled in coreInit.js, as KBC is considered a core part of project details.

    // Update ProjectDashboard references:
    // ProjectDashboard (created in coreInit) might need references to components like
    // ProjectDetailsComponent and ProjectListComponent (also created/managed by coreInit).
    // This ensures the dashboard can correctly display and manage these views.
    logger.debug('[UIInit] Updating ProjectDashboard component references...', { context: 'uiInit' });
    const projectDashboardInstance = DependencySystem.modules.get('projectDashboard');
    if (projectDashboardInstance) {
      const pdcForDashboard = DependencySystem.modules.get('projectDetailsComponent');
      const plcForDashboard = DependencySystem.modules.get('projectListComponent');

      if (pdcForDashboard && typeof projectDashboardInstance.setProjectDetailsComponent === 'function') {
        projectDashboardInstance.setProjectDetailsComponent(pdcForDashboard);
      } else if (pdcForDashboard) {
        logger.warn('[UIInit] projectDashboardInstance is missing setProjectDetailsComponent method.', { context: 'uiInit:updateDashboard' });
      }

      if (plcForDashboard && typeof projectDashboardInstance.setProjectListComponent === 'function') {
        projectDashboardInstance.setProjectListComponent(plcForDashboard);
      } else if (plcForDashboard) {
        logger.warn('[UIInit] projectDashboardInstance is missing setProjectListComponent method.', { context: 'uiInit:updateDashboard' });
      }
      logger.debug('[UIInit] ProjectDashboard references updated.', { context: 'uiInit' });
    } else {
      logger.warn('[UIInit] projectDashboardInstance not found in DI. Cannot set sub-component references.', { context: 'uiInit:updateDashboard' });
    }

    // CONSOLIDATED: ProjectModal initialization is now handled in coreInit.js.

    logger.log('[UIInit] Late-stage UI component creation and registration completed.', { context: 'uiInit:createAndRegisterUIComponents' });
  }

  // Registers views with the NavigationService.
  // These views define how different application states (e.g., project list, project details) are shown and hidden.
  async function registerNavigationViews() {
    const navigationService = DependencySystem.modules.get('navigationService');
    if (!navigationService || typeof navigationService.registerView !== 'function') {
      throw new Error('[uiInit] NavigationService not available or missing registerView method (strict mode)');
    }

    try {
      // Register projectList view with enhanced functionality
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
              throw new Error('[uiInit] Could not display project list; both dashboard and projectListComponent missing show method (strict mode).');
            } catch (err) {
              logger.error('[UIInit] Error in projectList show', err, { context: 'uiInit:navigation:projectList:show' });
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
              throw new Error('[uiInit] Could not hide project list; both dashboard and projectListComponent missing hide method (strict mode).');
            } catch (err) {
              logger.error('[UIInit] Error in projectList hide', err, { context: 'uiInit:navigation:projectList:hide' });
              throw err;
            }
          }
        });
      }

      // Register projectDetails view with enhanced functionality and dependency waiting
      if (!navigationService.hasView('projectDetails')) {
        navigationService.registerView('projectDetails', {
          show: async (params) => {
            try {
              await domReadinessService.dependenciesAndElements({
                deps: ['projectDashboard', 'projectDetailsComponent'],
                timeout: 10000,
                context: 'uiInit:nav:projectDetails'
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
              throw new Error('[uiInit] Could not display project details; both dashboard and projectDetailsComponent missing showProjectDetails method (strict mode).');
            } catch (err) {
              logger.error('[UIInit] Error in projectDetails show', err, { context: 'uiInit:navigation:projectDetails:show' });
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
              throw new Error('[uiInit] Could not hide project details; both dashboard and projectDetailsComponent missing hideProjectDetails method (strict mode).');
            } catch (err) {
              logger.error('[UIInit] Error in projectDetails hide', err, { context: 'uiInit:navigation:projectDetails:hide' });
              throw err;
            }
          }
        });
      }

      logger.log('[UIInit] Navigation views registered', { context: 'uiInit:navigation' });
    } catch (err) {
      logger.error('[UIInit] Failed to register navigation views', err, { context: 'uiInit:registerNavigationViews' });
      // Don't throw - this is not critical for app functionality
    }
  }

  async function initializeUIComponents() {
    if (_uiInitialized) {
      logger.debug('[UIInit] UI components already initialized. Skipping.', { context: 'uiInit:initializeUIComponents' });
      return;
    }

    try {
      logger.log('[UIInit] Starting full UI initialization process...', { context: 'uiInit:initializeUIComponents' });

      // Step 1: Wait for critical DOM elements required for base layout.
      // These selectors should correspond to elements present in the initial HTML (index.html).
      logger.debug('[UIInit] Step 1: Waiting for critical base DOM elements...', { context: 'uiInit' });
      await domReadinessService.dependenciesAndElements({
        domSelectors: [
          '#projectListView',     // Container for the project list view
          '#projectDetailsView'   // Container for the project details view
        ],
        timeout: 10000,
        context: 'uiInit:initializeUIComponents:baseDomCheck'
      });
      logger.debug('[UIInit] Step 1: Critical base DOM elements ready.', { context: 'uiInit' });

      // Step 2: Setup sidebar related UI controls (if any beyond core sidebar module).
      logger.debug('[UIInit] Step 2: Setting up sidebar controls...', { context: 'uiInit' });
      await setupSidebarControls();
      logger.debug('[UIInit] Step 2: Sidebar controls setup complete.', { context: 'uiInit' });

      // Step 3: Load HTML templates for dynamic views.
      logger.debug('[UIInit] Step 3: Loading project HTML templates...', { context: 'uiInit' });
      await loadProjectTemplates();
      logger.debug('[UIInit] Step 3: Project HTML templates loaded.', { context: 'uiInit' });

      // Step 4: Wait for ModalManager to be ready (modals.html loaded and processed).
      // ModalManager is initialized in coreInit, but its templates are loaded asynchronously.
      logger.debug('[UIInit] Step 4: Waiting for ModalManager readiness...', { context: 'uiInit' });
      await waitForModalReadiness(); // Uses internal timeout
      logger.debug('[UIInit] Step 4: ModalManager ready.', { context: 'uiInit' });

      // Step 5: Create and register late-stage UI components.
      // (e.g., ProjectDetailsEnhancements, TokenStatsManager)
      logger.debug('[UIInit] Step 5: Creating and registering late-stage UI components...', { context: 'uiInit' });
      await createAndRegisterUIComponents();
      logger.debug('[UIInit] Step 5: Late-stage UI components registered.', { context: 'uiInit' });

      // Step 6: Register navigation views with the NavigationService.
      logger.debug('[UIInit] Step 6: Registering navigation views...', { context: 'uiInit' });
      await registerNavigationViews();
      logger.debug('[UIInit] Step 6: Navigation views registered.', { context: 'uiInit' });

      logger.log('[UIInit] Full UI component initialization completed successfully.', { context: 'uiInit:initializeUIComponents' });
      _uiInitialized = true;
    } catch (err) {
      logger.error('[UIInit] Critical error during UI initialization sequence', err, { context: 'uiInit:initializeUIComponents' });
      throw err;
    }
  }

  return {
    initializeUIComponents,
    waitForModalReadinessWithTimeout,
    registerNavigationViews,
    cleanup() {
      // Cleanup any event listeners registered during UI initialization
      eventHandlers.cleanupListeners({ context: 'uiInit' });
      logger.debug('[uiInit] Cleanup completed', { context: 'uiInit:cleanup' });
    }
  };
}
