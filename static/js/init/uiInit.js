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
  createKnowledgeBaseComponent,
  apiRequest,
  uiUtils
}) {
  if (
    !DependencySystem || !domAPI || !browserService ||
    !eventHandlers || !domReadinessService || !logger || !APP_CONFIG || !safeHandler
  ) {
    throw new Error('[uiInit] Missing required dependencies for UI initialization.');
  }

  let _uiInitialized = false;

  async function setupSidebarControls() {
    const navToggleBtn = domAPI.getElementById('navToggleBtn');
    const closeSidebarBtn = domAPI.getElementById('closeSidebarBtn');
    const doc = domAPI.getDocument();

    function setSidebarOpen(open) {
      const sidebar = domAPI.getElementById('mainSidebar');
      // freeze / release background scroll
      domAPI[open ? 'addClass' : 'removeClass'](doc.body, 'sidebar-open');
      domAPI[open ? 'addClass' : 'removeClass'](doc.documentElement, 'sidebar-open');

      // slide sidebar in/out
      if (sidebar) {
        domAPI[open ? 'addClass' : 'removeClass'](sidebar, 'translate-x-0');
        domAPI[open ? 'removeClass' : 'addClass'](sidebar, '-translate-x-full');
        domAPI.setAttribute(sidebar, 'aria-hidden', String(!open));
      }
      // update toggle button ARIA
      if (navToggleBtn) domAPI.setAttribute(navToggleBtn, 'aria-expanded', String(open));
    }

    if (navToggleBtn) {
      eventHandlers.trackListener(
        navToggleBtn,
        'click',
        safeHandler(() => setSidebarOpen(domAPI.getAttribute(navToggleBtn, 'aria-expanded') !== 'true'), 'navToggleBtn:toggleSidebar'),
        { context: 'uiInit:sidebar', description: 'toggleSidebar' }
      );
    }
    if (closeSidebarBtn) {
      eventHandlers.trackListener(
        closeSidebarBtn, 'click',
        () => setSidebarOpen(false),
        { context: 'uiInit:sidebar', description: 'closeSidebar' }
      );
    }

    // Global escape key listener
    eventHandlers.trackListener(
      doc,
      'keydown',
      (e) => { if (e.key === 'Escape') setSidebarOpen(false); },
      { context: 'uiInit:sidebar', description: 'escCloseSidebar' }
    );
  }

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
    if (modalMgr?.isReadyPromise) {
      await Promise.race([
        modalMgr.isReadyPromise(),
        new Promise(res => browserService.getWindow().setTimeout(res, 8000))
      ]).catch(() => {
        logger.warn('[UIInit] ModalManager not ready after 8s – continuing', { context: 'uiInit' });
      });
    }
  }

  async function createAndRegisterUIComponents() {
    logger.log('[UIInit] Creating and registering UI components', { context: 'uiInit:createAndRegisterUIComponents' });

    // Project Details Enhancements - Create and register visual improvements
    if (createProjectDetailsEnhancements) {
      const projectDetailsEnhancementsInstance = createProjectDetailsEnhancements({
        domAPI,
        browserService,
        eventHandlers,
        domReadinessService,
        logger,
        sanitizer
      });
      DependencySystem.register('projectDetailsEnhancements', projectDetailsEnhancementsInstance);

      // Initialize if available
      if (projectDetailsEnhancementsInstance.initialize) {
        await projectDetailsEnhancementsInstance.initialize().catch(err =>
          logger.error('[UIInit] ProjectDetailsEnhancements init failed', err, { context: 'uiInit:projectDetailsEnhancements' })
        );
      }
    }

    // Token Stats Manager - Create and register token stats functionality
    if (createTokenStatsManager) {
      const tokenStatsManagerInstance = createTokenStatsManager({
        apiClient: apiRequest,
        domAPI,
        eventHandlers,
        browserService,
        modalManager: DependencySystem.modules.get('modalManager'),
        sanitizer,
        logger,
        projectManager: DependencySystem.modules.get('projectManager'),
        app: DependencySystem.modules.get('app'),
        chatManager: DependencySystem.modules.get('chatManager'),
        domReadinessService
      });
      DependencySystem.register('tokenStatsManager', tokenStatsManagerInstance);
    }

    // Knowledge Base Component - Create and register if not already present
    let knowledgeBaseComponentInstance = DependencySystem.modules.get('knowledgeBaseComponent');
    if (!knowledgeBaseComponentInstance && createKnowledgeBaseComponent) {
      try {
        knowledgeBaseComponentInstance = createKnowledgeBaseComponent({
          DependencySystem,
          apiRequest,
          projectManager: DependencySystem.modules.get('projectManager'),
          uiUtils,
          sanitizer: DependencySystem.modules.get('sanitizer')
        });
        DependencySystem.register('knowledgeBaseComponent', knowledgeBaseComponentInstance);
      } catch (err) {
        logger.warn('[UIInit] KnowledgeBaseComponent creation failed; falling back to placeholder.', { context: 'uiInit:createAndRegisterUIComponents', error: err?.message });
        logger.error('[UIInit] KnowledgeBaseComponent creation failed', err, { context: 'uiInit:createAndRegisterUIComponents:KnowledgeBaseComponent' });
        throw err;
      }
    }

    // Project Details Component - Inject KnowledgeBaseComponent into it
    const projectDetailsComponent = DependencySystem.modules.get('projectDetailsComponent');
    if (projectDetailsComponent && knowledgeBaseComponentInstance) {
      if (typeof projectDetailsComponent.setKnowledgeBaseComponent === 'function') {
        projectDetailsComponent.setKnowledgeBaseComponent(knowledgeBaseComponentInstance);
      } else {
        logger.warn('[UIInit] projectDetailsComponent is missing setKnowledgeBaseComponent method.', { context: 'uiInit:createAndRegisterUIComponents' });
      }
    } else if (!projectDetailsComponent) {
      logger.warn('[UIInit] projectDetailsComponent not found in DI. Cannot inject KBC.', { context: 'uiInit:createAndRegisterUIComponents' });
    }

    // Update ProjectDashboard references using the setter methods
    const projectDashboardInstance = DependencySystem.modules.get('projectDashboard');
    if (projectDashboardInstance) {
      const pdcForDashboard = DependencySystem.modules.get('projectDetailsComponent');
      const plcForDashboard = DependencySystem.modules.get('projectListComponent');

      if (pdcForDashboard && typeof projectDashboardInstance.setProjectDetailsComponent === 'function') {
        projectDashboardInstance.setProjectDetailsComponent(pdcForDashboard);
      } else if (pdcForDashboard) {
        logger.warn('[UIInit] projectDashboardInstance missing setProjectDetailsComponent method.', { context: 'uiInit:createAndRegisterUIComponents' });
        // Fallback to direct assignment if setter is missing but component exists (less ideal)
        if (projectDashboardInstance.components) projectDashboardInstance.components.projectDetails = pdcForDashboard;
      }

      if (plcForDashboard && typeof projectDashboardInstance.setProjectListComponent === 'function') {
        projectDashboardInstance.setProjectListComponent(plcForDashboard);
      } else if (plcForDashboard) {
        logger.warn('[UIInit] projectDashboardInstance missing setProjectListComponent method.', { context: 'uiInit:createAndRegisterUIComponents' });
        // Fallback
        if (projectDashboardInstance.components) projectDashboardInstance.components.projectList = plcForDashboard;
      }
    } else {
      logger.warn('[UIInit] projectDashboardInstance not found. Cannot set sub-components.', { context: 'uiInit:createAndRegisterUIComponents' });
   }

   // Initialize ProjectModal
   const projectModalInstance = DependencySystem.modules.get('projectModal');
   if (projectModalInstance && typeof projectModalInstance.init === 'function') {
     try {
       logger.log('[UIInit] Initializing ProjectModal instance.', { context: 'uiInit:createAndRegisterUIComponents' });
       await projectModalInstance.init();
     } catch (err) {
       logger.error('[UIInit] ProjectModal initialization failed', err, { context: 'uiInit:projectModalInit' });
       // Depending on severity, might want to throw or handle gracefully
     }
   } else {
     logger.warn('[UIInit] ProjectModal instance or its init method not found in DI.', { context: 'uiInit:createAndRegisterUIComponents' });
   }

   logger.log('[UIInit] All UI components created and registered', { context: 'uiInit:createAndRegisterUIComponents' });
 }

 async function registerNavigationViews() {
    const navigationService = DependencySystem.modules.get('navigationService');
    if (!navigationService || typeof navigationService.registerView !== 'function') {
      logger.warn('[UIInit] NavigationService not available or missing registerView method', { context: 'uiInit:registerNavigationViews' });
      return;
    }

    try {
      // Wait for project list elements to be ready
      await domReadinessService.dependenciesAndElements({
        domSelectors: ['#projectListContainer'],
        timeout: APP_CONFIG.TIMEOUTS?.PROJECT_LIST_ELEMENTS ?? 5000,
        context: 'uiInit:registerNavigationViews:projectListElements'
      });

      navigationService.registerView('projectList', {
        selector: '#projectListView',
        onActivate: async () => {
          logger.log('[UIInit] Activating project list view', { context: 'uiInit:navigation:projectList' });
          // Additional activation logic can go here
        }
      });

      // Wait for project details elements to be ready
      await domReadinessService.dependenciesAndElements({
        domSelectors: ['#projectDetailsContainer'],
        timeout: APP_CONFIG.TIMEOUTS?.PROJECT_DETAILS_ELEMENTS ?? 5000,
        context: 'uiInit:registerNavigationViews:projectDetailsElements'
      });

      navigationService.registerView('projectDetails', {
        selector: '#projectDetailsView',
        onActivate: async () => {
          logger.log('[UIInit] Activating project details view', { context: 'uiInit:navigation:projectDetails' });
          // Additional activation logic can go here
        }
      });

      logger.log('[UIInit] Navigation views registered', { context: 'uiInit:navigation' });
    } catch (err) {
      logger.error('[UIInit] Failed to register navigation views', err, { context: 'uiInit:registerNavigationViews' });
      // Don't throw - this is not critical for app functionality
    }
  }

  async function initializeUIComponents() {
    if (_uiInitialized) {
      return;
    }

    try {
      logger.log('[UIInit] Starting UI component initialization', { context: 'uiInit:initializeUIComponents' });

      // First, wait for critical DOM elements
      await domReadinessService.dependenciesAndElements({
        domSelectors: [
          '#projectListView',     // contenedor que ya existe en el HTML base
          '#projectDetailsView'   // idem
        ],
        timeout: 10000, // Adjusted timeout for clarity
        context: 'uiInit:initializeUIComponents:domCheck'
      });

      // Setup sidebar functionality
      await setupSidebarControls();

      // Load templates
      await loadProjectTemplates();

      // Wait for modal readiness
      await waitForModalReadiness();

      // Create and register UI components
      await createAndRegisterUIComponents();

      // Register navigation views
      await registerNavigationViews();

      logger.log('[UIInit] UI component initialization completed successfully', { context: 'uiInit:initializeUIComponents' });
      _uiInitialized = true;
    } catch (err) {
      logger.error('[UIInit] Error during UI initialization', err, { context: 'uiInit:initializeUIComponents' });
      throw err;
    }
  }

  return { initializeUIComponents };
}
