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

    // Lazy require to avoid import-time effects (assumes factories are globally available via DependencySystem)
    const createChatManager = DependencySystem.modules.get('createChatManager');
    if (!createChatManager) throw new Error('[coreInit] createChatManager factory not available in DI.');
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

    // Factories from DependencySystem
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

    // 3. (Optionally) recreate auth-aware logger if required
    if (APP_CONFIG.LOGGING?.AUTH_AWARE !== false) {
      const createLogger = DependencySystem.modules.get('createLogger');
      if (createLogger) {
        const authAwareLogger = createLogger({
          context: 'App',
          debug: APP_CONFIG && APP_CONFIG.DEBUG === true,
          minLevel: APP_CONFIG.LOGGING?.MIN_LEVEL ?? 'info',
          fetcher: browserService.getWindow()?.fetch?.bind?.(browserService.getWindow()) || null,
          authModule
        });
        // Replace logger reference in DI (do not re-register if forbidden)
        DependencySystem.register('logger', authAwareLogger); // Optionally comment this line if avoiding re-register
      }
    }

    logger.log('[coreInit] auth module registered', { context: 'coreInit' });
    // Initialize auth module to set up event listeners
    if (authModule.init) {
      try {
        await authModule.init();
      } catch (err) {
        logger.error('[coreInit] Auth module initialization error', err, { context: 'coreInit' });
      }
    }

    // 4. Model config
    const modelConfigInstance = createModelConfig({
      dependencySystem: DependencySystem,
      domReadinessService: DependencySystem.modules.get('domReadinessService'),
      eventHandler: eventHandlers,
      storageHandler: DependencySystem.modules.get('storage'),
      sanitizer: DependencySystem.modules.get('sanitizer')
    });
    DependencySystem.register('modelConfig', modelConfigInstance);

    // 5. ChatManager
    const projectDetailsComponent =
      DependencySystem.modules.get('projectDetailsComponent') ||
      createPlaceholder('projectDetailsComponent');
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
    eventHandlers.setProjectManager?.(projectManager);

    // 7. EventHandlers init
    if (eventHandlers?.init) {
      await eventHandlers.init();
      logger.log('[coreInit] eventHandlers initialization complete', { context: 'coreInit' });
    }

    // 8. Pre-register projectListComponent and projectDetailsComponent (instantiate or placeholder)
    if (!DependencySystem.modules.has('projectListComponent')) {
      const plc = createProjectListComponent({
        projectManager,
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
        projectManager,
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
        chatManager: DependencySystem.modules.get('chatManager'),
        modelConfig: DependencySystem.modules.get('modelConfig'),
        knowledgeBaseComponent: null,
        apiClient: apiRequest,
        domReadinessService
      });
      DependencySystem.register('projectDetailsComponent', pdc);
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
    const projectModal = createProjectModal({
      DependencySystem,
      eventHandlers,
      domAPI,
      browserService,
      domPurify: sanitizer
    });
    DependencySystem.register('projectModal', projectModal);

    // 11. Wait for modals to load (event-based or fallback)
    let modalsLoadedSuccess = false;
    const injected = domAPI.getElementById('modalsContainer')?.childElementCount > 0;
    if (injected) {
      modalsLoadedSuccess = true;
    } else {
      await new Promise((res) => {
        eventHandlers.trackListener(
          domAPI.getDocument(),
          'modalsLoaded',
          (e) => {
            modalsLoadedSuccess = !!(e?.detail?.success);
            res(true);
          },
          { once: true, description: 'modalsLoaded for coreInit', context: 'coreInit' }
        );
      });
    }

    // 12. modalManager.init
    if (modalManager.init) {
      try {
        await modalManager.init();
      } catch (err) {
        logger.error('[coreInit] Error in modalManager.init', err, { context: 'coreInit:modalManager:init' });
        throw err;
      }
    }

    logger.log('[coreInit][initializeCoreSystems] Complete', { context: 'coreInit' });
    return true;
  }

  return { initializeCoreSystems };
}
