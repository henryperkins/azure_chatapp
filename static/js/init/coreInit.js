/**
 * coreInit.js
 * Factory for initializing core systems (modal manager, auth module, model config, chat manager, project manager, dashboard, etc).
 *
 * Guardrails:
 * - Factory export (createCoreInitializer)
 * - Strict DI: Accept all dependencies as factory arguments
 * - No import-time side effects
 * - No global/window/document usage directly
 * - All event/listener registration via injected eventHandlers
 * - All logging via injected logger
 * - Use domReadinessService for DOM waits
 */

export function createCoreInitializer({
  DependencySystem,
  domAPI,
  browserService,
  eventHandlers,
  sanitizer,
  logger,
  APP_CONFIG,
  domReadinessService
}) {
  if (
    !DependencySystem || !domAPI || !browserService ||
    !eventHandlers || !sanitizer || !logger || !APP_CONFIG || !domReadinessService
  ) {
    throw new Error('[coreInit] Missing required dependencies for core initialization.');
  }

  // Utility: Create or get chat manager
  function createOrGetChatManager(apiRequest, modelConfig, projectDetailsComponent, app, apiEndpoints) {
    const existing = DependencySystem.modules.get('chatManager');
    if (existing) return existing;

    const createChatManager = DependencySystem.modules.get('createChatManager');
    if (!createChatManager) throw new Error('[coreInit] createChatManager factory not available in DI.');

    const authModule = DependencySystem.modules.get('auth');
    const cm = createChatManager({
      DependencySystem,
      apiRequest,
      auth: authModule,
      eventHandlers,
      modelConfig,
      projectDetailsComponent,
      app,
      domAPI,
      domReadinessService,
      logger,
      navAPI: {
        getSearch: () => browserService.getLocation().search,
        getHref: () => browserService.getLocation().href,
        pushState: (url, title = "") => browserService.pushState({}, title, url),
        getPathname: () => browserService.getLocation().pathname
      },
      isValidProjectId: DependencySystem.modules.get('globalUtils').isValidProjectId,
      isAuthenticated: () => !!authModule?.isAuthenticated?.(),
      DOMPurify: DependencySystem.modules.get('sanitizer'),
      apiEndpoints,
      APP_CONFIG
    });
    DependencySystem.register('chatManager', cm);
    return cm;
  }

  // Placeholder utility
  function createPlaceholder(name) {
    return {
      state: { initialized: false },
      initialize: async () => { },
      show: () => { },
      hide: () => { },
      cleanup: () => { },
      __placeholder: true,
      toString() { return `[Placeholder ${name}]`; }
    };
  }

  /**
   * Main core systems initialization.
   * Registers and initializes modalManager, auth module, logger, model config, chatManager,
   * projectManager, projectDashboard, projectListComponent, projectDetailsComponent, etc.
   */
  async function initializeCoreSystems() {
    logger.log('[coreInit][initializeCoreSystems] Starting', { context: 'coreInit' });

    // Wait for minimal DOM readiness
    await domReadinessService.dependenciesAndElements({
      deps: ['domAPI'],
      domSelectors: ['body'],
      timeout: 10000,
      context: 'coreInit:initializeCoreSystems'
    });

    // Get required factories from DependencySystem
    const createModalManager = DependencySystem.modules.get('createModalManager');
    if (!createModalManager) throw new Error('[coreInit] createModalManager factory not available in DI.');
    const createAuthModule = DependencySystem.modules.get('createAuthModule');
    if (!createAuthModule) throw new Error('[coreInit] createAuthModule factory not available in DI.');
    const createProjectManager = DependencySystem.modules.get('createProjectManager');
    if (!createProjectManager) throw new Error('[coreInit] createProjectManager factory not available in DI.');
    const createModelConfig = DependencySystem.modules.get('createModelConfig');
    if (!createModelConfig) throw new Error('[coreInit] createModelConfig factory not available in DI.');
    const createProjectDashboard = DependencySystem.modules.get('createProjectDashboard');
    if (!createProjectDashboard) throw new Error('[coreInit] createProjectDashboard factory not available in DI.');
    const createProjectDetailsComponent = DependencySystem.modules.get('createProjectDetailsComponent');
    if (!createProjectDetailsComponent) throw new Error('[coreInit] createProjectDetailsComponent factory not available in DI.');
    const createProjectListComponent = DependencySystem.modules.get('createProjectListComponent');
    if (!createProjectListComponent) throw new Error('[coreInit] createProjectListComponent factory not available in DI.');
    const createProjectModal = DependencySystem.modules.get('createProjectModal');
    if (!createProjectModal) throw new Error('[coreInit] createProjectModal factory not available in DI.');
    const createSidebar = DependencySystem.modules.get('createSidebar');
    if (!createSidebar) throw new Error('[coreInit] createSidebar factory not available in DI.');

    const MODAL_MAPPINGS = DependencySystem.modules.get('MODAL_MAPPINGS');
    const apiRequest = DependencySystem.modules.get('apiRequest');
    const apiEndpoints = DependencySystem.modules.get('apiEndpoints');
    const app = DependencySystem.modules.get('app');

    // 1. ModalManager
    const modalManager = createModalManager({
      domAPI,
      browserService,
      eventHandlers,
      DependencySystem,
      modalMapping: MODAL_MAPPINGS,
      domPurify: sanitizer
    });
    DependencySystem.register('modalManager', modalManager);

    // 2. Auth module
    const authModule = createAuthModule({
      DependencySystem,
      apiClient: apiRequest,
      eventHandlers,
      domAPI,
      sanitizer,
      APP_CONFIG,
      modalManager,
      apiEndpoints,
      logger,
      domReadinessService
    });
    DependencySystem.register('auth', authModule);

    logger.log('[coreInit] auth module registered', { context: 'coreInit' });
    // authModule.init() will be called by authInit.initializeAuthSystem() later in app.js

    // 3. Model config
    const modelConfigInstance = createModelConfig({
      dependencySystem: DependencySystem,
      domReadinessService: DependencySystem.modules.get('domReadinessService'),
      eventHandler: eventHandlers,
      storageHandler: DependencySystem.modules.get('storage'),
      sanitizer: DependencySystem.modules.get('sanitizer')
    });
    DependencySystem.register('modelConfig', modelConfigInstance);

    // 4. Pre-register projectListComponent and projectDetailsComponent (instantiate or placeholder)
    if (!DependencySystem.modules.has('projectListComponent')) {
      const plc = createProjectListComponent({
        projectManager: null, // Will be set after projectManager is created
        eventHandlers,
        modalManager,
        app,
        router: DependencySystem.modules.get('navigationService'),
        storage: DependencySystem.modules.get('storage'),
        sanitizer: DependencySystem.modules.get('sanitizer'),
        htmlSanitizer: DependencySystem.modules.get('sanitizer'),
        apiClient: apiRequest,
        domAPI,
        domReadinessService,
        browserService,
        globalUtils: DependencySystem.modules.get('globalUtils'),
        APP_CONFIG,
        logger
      });
      DependencySystem.register('projectListComponent', plc);
    }

    if (!DependencySystem.modules.has('projectDetailsComponent')) {
      const pdc = createProjectDetailsComponent({
        projectManager: null, // Will be set after projectManager is created
        eventHandlers,
        modalManager,
        FileUploadComponentClass: DependencySystem.modules.get('FileUploadComponent'),
        domAPI,
        sanitizer: DependencySystem.modules.get('sanitizer'),
        app,
        navigationService: DependencySystem.modules.get('navigationService'),
        htmlTemplateLoader: DependencySystem.modules.get('htmlTemplateLoader'),
        logger,
        APP_CONFIG,
        chatManager: null, // Will be set after chatManager is created
        modelConfig: modelConfigInstance,
        knowledgeBaseComponent: null,
        apiClient: apiRequest,
        domReadinessService
      });
      DependencySystem.register('projectDetailsComponent', pdc);
    }

    // 5. ChatManager
    const projectDetailsComponent = DependencySystem.modules.get('projectDetailsComponent');
    const chatManager = createOrGetChatManager(
      apiRequest,
      modelConfigInstance,
      projectDetailsComponent,
      app,
      apiEndpoints
    );

    // 6. ProjectManager
    const pmFactory = await createProjectManager({
      DependencySystem,
      chatManager,
      app,
      modelConfig: modelConfigInstance,
      apiRequest,
      apiEndpoints,
      storage: DependencySystem.modules.get('storage'),
      listenerTracker: {
        add: (el, type, handler, description) =>
          eventHandlers.trackListener(el, type, handler, { description, context: 'projectManager' }),
        remove: () => eventHandlers.cleanupListeners({ context: 'projectManager' })
      },
      domAPI,
      domReadinessService,
      logger
    });
    const projectManager = pmFactory.instance;

    // Ensure projectManager is explicitly registered in DependencySystem
    if (!DependencySystem.modules.has('projectManager')) {
      DependencySystem.register('projectManager', projectManager);
      logger.log('[coreInit] projectManager explicitly registered in DependencySystem', { context: 'coreInit' });
    } else {
      logger.log('[coreInit] projectManager already registered in DependencySystem', { context: 'coreInit' });
    }

    eventHandlers.setProjectManager?.(projectManager);

    // Update components with projectManager reference
    const plc = DependencySystem.modules.get('projectListComponent');
    if (plc && typeof plc.setProjectManager === 'function') {
      plc.setProjectManager(projectManager);
    }
    if (projectDetailsComponent && typeof projectDetailsComponent.setProjectManager === 'function') {
      projectDetailsComponent.setProjectManager(projectManager);
    }
    if (projectDetailsComponent && typeof projectDetailsComponent.setChatManager === 'function') {
      projectDetailsComponent.setChatManager(chatManager);
    }

    // 7. modalManager.init (handles modal loading internally with proper timeouts)
    // CRITICAL: Initialize modalManager BEFORE eventHandlers to avoid circular dependency
    // eventHandlers.init() may need to access modal elements, so modals must be loaded first
    if (modalManager.init) {
      try {
        await modalManager.init();
        logger.log('[coreInit] modalManager initialization complete', { context: 'coreInit' });
      } catch (err) {
        logger.error('[coreInit] Error in modalManager.init', err, { context: 'coreInit:modalManager:init' });
        throw err;
      }
    }

    // 8. EventHandlers init (now that modals are ready)
    if (eventHandlers?.init) {
      await eventHandlers.init();
      logger.log('[coreInit] eventHandlers initialization complete', { context: 'coreInit' });
    }

    // 9. ProjectDashboard
    const projectDashboard = createProjectDashboard({
      dependencySystem: DependencySystem,
      domAPI,
      browserService,
      eventHandlers,
      logger,
      sanitizer,
      APP_CONFIG,
      domReadinessService
    });
    DependencySystem.register('projectDashboard', projectDashboard);

    // 10. Project modal
    const registeredProjectManager = DependencySystem.modules.get('projectManager');
    if (!registeredProjectManager) {
      logger.error('[coreInit] projectManager not found in DependencySystem', {
        context: 'coreInit',
        availableModules: Array.from(DependencySystem.modules.keys())
      });
      throw new Error('[coreInit] projectManager must be registered before creating projectModal');
    }

    logger.log('[coreInit] Creating projectModal with all required dependencies', {
      context: 'coreInit',
      hasProjectManager: !!registeredProjectManager,
      hasEventHandlers: !!eventHandlers,
      hasDomAPI: !!domAPI,
      hasDomReadinessService: !!domReadinessService
    });

    const projectModal = createProjectModal({
      projectManager: registeredProjectManager,
      eventHandlers,
      DependencySystem,
      domAPI,
      domReadinessService,
      domPurify: sanitizer
    });
    DependencySystem.register('projectModal', projectModal);

    // 11. Sidebar
    const sidebar = createSidebar({
      eventHandlers,
      DependencySystem,
      domAPI,
      uiRenderer: DependencySystem.modules.get('uiRenderer'),
      storageAPI: DependencySystem.modules.get('storage'),
      projectManager: DependencySystem.modules.get('projectManager'),
      modelConfig: modelConfigInstance,
      app: DependencySystem.modules.get('app'),
      projectDashboard: DependencySystem.modules.get('projectDashboard'),
      viewportAPI: browserService,
      accessibilityUtils: DependencySystem.modules.get('accessibilityUtils'),
      sanitizer,
      domReadinessService,
      logger,
      safeHandler: DependencySystem.modules.get('safeHandler'),
      APP_CONFIG
    });
    DependencySystem.register('sidebar', sidebar);

    // --- NEW: Ensure the sidebar is fully initialised so that it can
    // wire DOM listeners, react to auth state, and expose its public API.
    // Without this call the sidebar remains dormant, causing the observed
    // “sidebar not working / ignoring authentication” issue.
    if (sidebar?.init) {
      try {
        await sidebar.init();
        logger.log('[coreInit] sidebar initialization complete', { context: 'coreInit:sidebar' });
      } catch (err) {
        logger.error('[coreInit] Error in sidebar.init', err, { context: 'coreInit:sidebar:init' });
        throw err;
      }
    } else {
      logger.warn('[coreInit] Sidebar module missing init() method', { context: 'coreInit:sidebar' });
    }

    logger.log('[coreInit][initializeCoreSystems] Complete', { context: 'coreInit' });
    return true;
  }

  return { 
    initializeCoreSystems,
    cleanup() {
      // Cleanup any event listeners registered by core initialization
      eventHandlers.cleanupListeners({ context: 'coreInit' });
      logger.debug('[coreInit] Cleanup completed', { context: 'coreInit:cleanup' });
    }
  };
}
