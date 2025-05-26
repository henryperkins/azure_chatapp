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
  domReadinessService,
  createKnowledgeBaseComponent, // Existing

  // --- Core Dependencies (passed from app.js) ---

  // --- Services & Utilities (passed from app.js, previously DI-resolved) ---
  MODAL_MAPPINGS,           // Constant object mapping modal types to their configurations.
  apiRequest,               // The configured API fetch function (from apiClient.fetch).
  apiClientObject,          // (initial value – will be refreshed later)
  apiEndpoints,             // Object containing resolved API endpoint URLs.
  app,                      // The main application state object.
  uiUtils,                  // General UI utility functions (formatting, icons).
  navigationService,        // Service for URL parsing and navigation control.
  globalUtils,              // Global utility functions (validation, string manipulation).
  FileUploadComponent,      // Factory for FileUploadComponent.
  htmlTemplateLoader,       // Service for loading HTML templates.
  uiRenderer,               // Service for rendering UI elements/components.
  accessibilityUtils,       // Utilities for accessibility enhancements.
  safeHandler               // Wrapper for safe function execution with error handling.
 }) {
   // Allow apiClientObject to be refreshed later, after ServiceInit has
   // registered it.  Capture in a mutable ref.
   let apiClientObjectRef = apiClientObject;

   /**
    * Some dependencies (e.g. `apiRequest`, `apiClientObject`) are not available
    * at *construction* time because they are registered later by
    * `serviceInit.registerAdvancedServices()` which runs during `App.init`.
    *
    * Therefore we postpone the exhaustive dependency validation until the first
    * call to `initializeCoreSystems()`.  At factory-creation time we only
    * validate the absolutely critical low-level services that are guaranteed to
    * exist from the early bootstrap phase.
    */
   const constructionRequired = {
     DependencySystem, domAPI, browserService, eventHandlers,
     sanitizer, APP_CONFIG, domReadinessService, createKnowledgeBaseComponent
   };
   for (const [depName, dep] of Object.entries(constructionRequired)) {
     if (!dep) {
       throw new Error(`[coreInit] Missing critical dependency during coreInit construction: ${depName}`);
     }
   }

   // ────────────────────────────────────────────────────────────────────────────
   // Runtime validation helper – executed at the top of initializeCoreSystems().
   // ────────────────────────────────────────────────────────────────────────────
   function validateRuntimeDeps() {
     // Pull latest apiClientObject from DI if not supplied at construction
     if (!apiClientObjectRef) {
       apiClientObjectRef = DependencySystem.modules.get('apiClientObject');
     }

     const runtimeRequired = {
       DependencySystem, domAPI, browserService, eventHandlers, sanitizer, logger, APP_CONFIG,
       domReadinessService, createKnowledgeBaseComponent, MODAL_MAPPINGS, apiRequest,
       apiClientObject : apiClientObjectRef, apiEndpoints, app, uiUtils, navigationService, globalUtils,
       FileUploadComponent, htmlTemplateLoader, uiRenderer, accessibilityUtils, safeHandler
     };
     for (const [depName, dep] of Object.entries(runtimeRequired)) {
       if (!dep) {
         throw new Error(`[coreInit] Missing required dependency: ${depName}`);
       }
     }
   }

   // Utility: Create or get chatManager.
  // This function ensures a single instance of ChatManager.
  // Dependencies like `authModule`, `modelConfig`, `projectDetailsComponent` are passed directly.
  function createOrGetChatManager(currentAuthModule, currentModelConfig, currentProjectDetailsComponent) {
    const existingChatManager = DependencySystem.modules.get('chatManager');
    if (existingChatManager) return existingChatManager;

    // Retrieve the ChatManager factory from DI (as it's not a direct dependency of coreInit itself)
    const createChatManagerFactory = DependencySystem.modules.get('createChatManager');
    if (!createChatManagerFactory) {
      logger.error('[coreInit] createChatManager factory not found in DependencySystem.', { context: 'coreInit:createOrGetChatManager' });
      throw new Error('[coreInit] createChatManager factory not available in DI.');
    }

    const chatManagerInstance = createChatManagerFactory({
      DependencySystem,         // For internal DI if ChatManager needs it
      apiRequest,               // Direct arg: API fetch function
      auth: currentAuthModule,  // Direct arg: The created AuthModule instance
      eventHandlers,            // Direct arg: Central event bus
      modelConfig: currentModelConfig, // Direct arg: The created ModelConfig instance
      projectDetailsComponent: currentProjectDetailsComponent, // Direct arg: ProjectDetailsComponent (can be placeholder initially)
      app,                      // Direct arg: Main application object
      domAPI,                   // Direct arg: DOM API utility
      domReadinessService,      // Direct arg: DOM readiness service
      logger,                   // Direct arg: Logger instance
      navAPI: {                 // Constructed from browserService (direct arg)
        getSearch: () => browserService.getLocation().search,
        getHref: () => browserService.getLocation().href,
        pushState: (url, title = "") => browserService.pushState({}, title, url),
        getPathname: () => browserService.getLocation().pathname
      },
      isValidProjectId: globalUtils.isValidProjectId, // From globalUtils (direct arg)
      isAuthenticated: () => !!currentAuthModule?.isAuthenticated?.(), // Derived from currentAuthModule
      DOMPurify: sanitizer,     // Direct arg: DOMPurify instance
      apiEndpoints,             // Direct arg: API endpoints map
      APP_CONFIG
    });
    DependencySystem.register('chatManager', chatManagerInstance);
    return chatManagerInstance;
  }

  // Placeholder utility (No changes needed, it's self-contained)
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
   * @async
   * @function initializeCoreSystems
   * @description Main core systems initialization function.
   * Orchestrates the creation and registration of essential application modules and components.
   * The order of initialization is critical for some dependencies.
   *
   * Initialization Order & Rationale:
   * 1.  **ModalManager**: Needed early for error reporting and UI interactions during bootstrap.
   * 2.  **AuthModule**: Fundamental for user authentication state, influences other modules.
   * 3.  **ModelConfig**: Manages model configurations, potentially used by ProjectManager and ChatManager. Initializes its UI here.
   * 4.  **ProjectListComponent (Placeholder)**: Registered early, full init may depend on ProjectManager.
   * 5.  **ProjectDetailsComponent (Placeholder)**: Registered early for ChatManager. Full init after ProjectManager & KnowledgeBaseComponent.
   * 6.  **ChatManager**: Depends on AuthModule, ModelConfig, and a (potentially placeholder) ProjectDetailsComponent.
   * 7.  **ProjectManager**: Manages project data, depends on ChatManager, ModelConfig.
   * 8.  **KnowledgeBaseComponent**: Depends on ProjectManager. Created here and injected into ProjectDetailsComponent.
   * 9.  **ProjectDetailsComponent (Final)**: Fully initialized with ProjectManager and KnowledgeBaseComponent.
   * 10. **modalManager.init()**: Loads modal HTML templates. Called after other core modules are registered, before eventHandlers.init().
   * 11. **eventHandlers.init()**: Initializes global event handlers, potentially needing modal elements.
   * 12. **ProjectDashboard**: UI container for project views.
   * 13. **ProjectModal**: UI for project creation/editing. Initializes its UI here.
   * 14. **Sidebar**: Main navigation UI, depends on many core services. Initializes its UI here.
   */
  async function initializeCoreSystems() {
    logger.log('[coreInit][initializeCoreSystems] Starting core systems initialization.', { context: 'coreInit' });

    // Validate that all runtime dependencies are present before proceeding.
    validateRuntimeDeps();

    // Phase 1: DOM Readiness Check (Basic)
    logger.debug('[coreInit] Phase 1: Waiting for basic DOM readiness (body element).', { context: 'coreInit' });
    await domReadinessService.dependenciesAndElements({
      deps: ['domAPI'], // domAPI is a direct argument, this ensures it's usable
      domSelectors: ['body'],
      timeout: 10000,
      context: 'coreInit:initializeCoreSystems:domReady'
    });
    logger.debug('[coreInit] Phase 1: Basic DOM readiness confirmed.', { context: 'coreInit' });

    // Phase 2: Retrieve Component Factories from DependencySystem
    // These are factories for creating instances, not the instances themselves.
    // Direct dependencies (services, utils) are already available as arguments to createCoreInitializer.
    logger.debug('[coreInit] Phase 2: Retrieving component factories from DependencySystem.', { context: 'coreInit' });
    const factories = {
      createModalManager: DependencySystem.modules.get('createModalManager'),
      createAuthModule: DependencySystem.modules.get('createAuthModule'),
      createProjectManager: DependencySystem.modules.get('createProjectManager'),
      createModelConfig: DependencySystem.modules.get('createModelConfig'),
      createProjectDashboard: DependencySystem.modules.get('createProjectDashboard'),
      createProjectDetailsComponent: DependencySystem.modules.get('createProjectDetailsComponent'),
      createProjectListComponent: DependencySystem.modules.get('createProjectListComponent'),
      createProjectModal: DependencySystem.modules.get('createProjectModal'),
      createSidebar: DependencySystem.modules.get('createSidebar')
    };

    for (const [factoryName, factory] of Object.entries(factories)) {
      if (!factory) {
        logger.error(`[coreInit] Missing required factory: ${factoryName}`, { context: 'coreInit:factoryCheck' });
        throw new Error(`[coreInit] Missing required factory: ${factoryName}`);
      }
    }
    const {
        createModalManager,
        createAuthModule,
        createProjectManager,
        createModelConfig,
        createProjectDashboard,
        createProjectDetailsComponent,
        createProjectListComponent,
        createProjectModal,
        createSidebar
    } = factories;
    logger.debug('[coreInit] Phase 2: All component factories destructured with correct names.', { context: 'coreInit' });

    // Phase 3: Instantiate and Register Core Services & Components
    logger.debug('[coreInit] Phase 3: Instantiating and registering core services and components.', { context: 'coreInit' });

    // 3.1. ModalManager
    logger.debug('[coreInit] Creating ModalManager...', { context: 'coreInit' });
    const modalManager = createModalManager({ // Use corrected factory name
      domAPI,
      browserService,
      eventHandlers,
      DependencySystem,
      modalMapping : MODAL_MAPPINGS, // Use direct argument
      domPurify    : sanitizer,
      domReadinessService,   // NEW – mandatory for constructor
      logger                   // NEW – ensure structured logging
    });
    DependencySystem.register('modalManager', modalManager);

    // 2. Auth module
    // apiRequest (fetch function) is a direct argument. apiClientObject (full client) is also a direct argument.
    if (typeof apiRequest !== 'function') { // Should still validate the passed apiRequest if it's used directly
      throw new Error('[coreInit] apiRequest argument is not a function.');
    }
    if (!apiClientObjectRef) { // apiAuthModule needs the full client object
        throw new Error('[coreInit] apiClientObject argument is missing.');
    }
    const authModule = createAuthModule({ // Use corrected factory name
      DependencySystem,
      apiClient: apiClientObjectRef, // use refreshed reference
      eventHandlers,
      domAPI,
      sanitizer,
      APP_CONFIG,
      modalManager,
      apiEndpoints, // Use direct argument
      logger,
      domReadinessService
    });
    DependencySystem.register('auth', authModule);

    logger.log('[coreInit] auth module registered', { context: 'coreInit' });
    // authModule.init() will be called by authInit.initializeAuthSystem() later in app.js, not here.

    // 3.3. ModelConfig
    // Manages model configurations; its UI (if any) is initialized via initWithReadiness.
    logger.debug('[coreInit] Creating ModelConfig...', { context: 'coreInit' });
    const modelConfigInstance = createModelConfig({ // Use corrected factory name
      dependencySystem: DependencySystem, // Retained for potential internal DI use by ModelConfig
      domReadinessService,      // Direct arg
      eventHandler: eventHandlers, // Direct arg
      storageHandler: browserService, // Direct arg (browserService acts as storage)
      sanitizer                 // Direct arg
    });
    DependencySystem.register('modelConfig', modelConfigInstance);
    await modelConfigInstance.initWithReadiness(); // Initializes ModelConfig and its UI elements.
    logger.debug('[coreInit] ModelConfig instance created, registered, and UI initialized.', { context: 'coreInit' });

    // uiUtils (direct argument) is used by KnowledgeBaseComponent later.

    // 3.4. ProjectListComponent (Placeholder or Full Instance)
    // Handles the display of the project list.
    logger.debug('[coreInit] Creating ProjectListComponent (or ensuring placeholder)...', { context: 'coreInit' });
    if (!DependencySystem.modules.has('projectListComponent')) {
      const projectListComponentInstance = createProjectListComponent({ // Use corrected factory name
        projectManager: null,     // Will be set after ProjectManager is created
        eventHandlers,            // Direct arg
        modalManager,             // Instance created above
        app,                      // Direct arg
        router: navigationService,// Direct arg
        storage: browserService,  // Direct arg (browserService acts as storage)
        sanitizer,                // Direct arg
        htmlSanitizer: sanitizer, // Direct arg
        apiClient: apiRequest,    // Direct arg (fetch function)
        domAPI,                   // Direct arg
        domReadinessService,      // Direct arg
        browserService,           // Direct arg
        globalUtils,              // Direct arg
        APP_CONFIG,
        logger
      });
      // DependencySystem.register('projectListComponent', plc); // Original had `plc` which is undefined here. Corrected.
      DependencySystem.register('projectListComponent', projectListComponentInstance);
    }

    // 3.5. ProjectDetailsComponent (Placeholder for ChatManager)
    // A placeholder might be needed if ChatManager requires it before ProjectManager and KBC are ready.
    // The definitive instance (`finalPdc`) is created later.
    logger.debug('[coreInit] Creating/ensuring ProjectDetailsComponent placeholder for ChatManager...', { context: 'coreInit' });
    let projectDetailsComponentPlaceholder;
    if (DependencySystem.modules.has('projectDetailsComponent')) {
        projectDetailsComponentPlaceholder = DependencySystem.modules.get('projectDetailsComponent');
         logger.debug('[coreInit] Existing ProjectDetailsComponent placeholder found.', { context: 'coreInit' });
    } else {
        projectDetailsComponentPlaceholder = createProjectDetailsComponent({ // Use corrected factory name
            projectManager: null, eventHandlers, modalManager,
            FileUploadComponentClass: FileUploadComponent, // Direct arg
            domAPI, sanitizer, app, navigationService, htmlTemplateLoader, logger, APP_CONFIG, // Direct args
            chatManager: null, modelConfig: modelConfigInstance, knowledgeBaseComponent: null,
            apiClient: apiRequest, // Direct arg (fetch function)
            domReadinessService, __placeholder: true // Flag as placeholder
        });
        DependencySystem.register('projectDetailsComponent', projectDetailsComponentPlaceholder);
        logger.debug('[coreInit] New ProjectDetailsComponent placeholder registered.', { context: 'coreInit' });
    }

    // 3.6. ChatManager
    // Manages chat functionalities; depends on auth state, model config, and project details.
    logger.debug('[coreInit] Creating ChatManager...', { context: 'coreInit' });
    const authModuleInstance = DependencySystem.modules.get('auth'); // Retrieve the instance created above
    const chatManager = createOrGetChatManager(
      authModuleInstance,             // The AuthModule instance
      modelConfigInstance,            // The ModelConfig instance
      projectDetailsComponentPlaceholder // The placeholder ProjectDetailsComponent
    );
    logger.debug('[coreInit] ChatManager instance created and registered.', { context: 'coreInit' });

    // 3.7. ProjectManager
    // Manages project data and lifecycle. Depends on ChatManager and ModelConfig.
    logger.debug('[coreInit] Creating ProjectManager...', { context: 'coreInit' });
    const pmFactory = await createProjectManager({ // Use corrected factory name
      DependencySystem,           // For potential internal DI
      chatManager,                // Instance created above
      app,                        // Direct arg
      modelConfig: modelConfigInstance, // Instance created above
      apiRequest,                 // Direct arg (fetch function)
      apiEndpoints,               // Direct arg
      storage: browserService,    // Direct arg (browserService acts as storage)
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

    logger.debug('[coreInit] ProjectManager instance created and registered.', { context: 'coreInit' });

    // 3.8. KnowledgeBaseComponent
    // Manages knowledge base interactions; depends on ProjectManager.
    logger.debug('[coreInit] Creating KnowledgeBaseComponent...', { context: 'coreInit' });
    const knowledgeBaseComponentInstance = createKnowledgeBaseComponent({ // createKnowledgeBaseComponent is already correct (direct arg)
      DependencySystem,         // For potential internal DI
      apiRequest,               // Direct arg (fetch function)
      projectManager,           // Instance created above
      uiUtils,                  // Direct arg
      sanitizer                 // Direct arg
    });
    DependencySystem.register('knowledgeBaseComponent', knowledgeBaseComponentInstance);
    logger.debug('[coreInit] KnowledgeBaseComponent instance created and registered.', { context: 'coreInit' });

    // 3.9. ProjectDetailsComponent (Definitive Instance)
    // Handles the display of project details; depends on ProjectManager and KnowledgeBaseComponent.
    // This overwrites the placeholder previously registered.
    logger.debug('[coreInit] Creating definitive ProjectDetailsComponent instance...', { context: 'coreInit' });
    const finalPdc = createProjectDetailsComponent({ // Use corrected factory name
        projectManager,           // Instance created above
        eventHandlers,            // Direct arg
        modalManager,             // Instance created above
        FileUploadComponentClass: FileUploadComponent, // Direct arg (factory)
        domAPI,                   // Direct arg
        sanitizer,                // Direct arg
        app,                      // Direct arg
        navigationService,        // Direct arg
        htmlTemplateLoader,       // Direct arg
        logger,                   // Direct arg
        APP_CONFIG,               // Direct arg
        chatManager,              // Instance created above
        modelConfig: modelConfigInstance, // Instance created above
        knowledgeBaseComponent: knowledgeBaseComponentInstance, // Instance created above
        apiClient: apiRequest,    // Direct arg (fetch function)
        domReadinessService       // Direct arg
    });
    DependencySystem.modules.set('projectDetailsComponent', finalPdc); // Overwrite placeholder
    logger.debug('[coreInit] Definitive ProjectDetailsComponent instance created and registered.', { context: 'coreInit' });

    // Update ChatManager with the final ProjectDetailsComponent instance
    if (typeof chatManager.setProjectDetailsComponent === 'function') {
        chatManager.setProjectDetailsComponent(finalPdc);
        logger.debug('[coreInit] Updated ChatManager with the final ProjectDetailsComponent instance.', { context: 'coreInit' });
    } else {
        logger.warn('[coreInit] ChatManager does not have a setProjectDetailsComponent method. It might be using the placeholder or an outdated instance.', { context: 'coreInit' });
    }

    // Phase 4: Initialize Modal Manager UI (Loads Modal HTML)
    // This is done *after* core components are registered, as modals might be used by them,
    // but *before* eventHandlers.init() which might attach listeners to modal elements.
    logger.debug('[coreInit] Phase 4: Initializing ModalManager UI (loading modal.html)...', { context: 'coreInit' });
    if (modalManager.init) {
      try {
        // htmlTemplateLoader is a direct argument, so it's available.
        await modalManager.init(); // Loads modal.html
        logger.debug('[coreInit] Phase 4: ModalManager UI initialization complete.', { context: 'coreInit' });

        // Explicit DOM readiness check for modals before handlers
        if (domReadinessService && domReadinessService.dependenciesAndElements) {
          logger.debug('[coreInit] Phase 4: Waiting for modal DOM elements readiness...', { context: 'coreInit' });
          await domReadinessService.dependenciesAndElements({
            domSelectors: [
              '#loginModal',
              '#errorModal',
              '#confirmModal',
              '#projectModal'
            ],
            timeout: 6000,
            context: 'coreInit:modalReadiness',
            optional: true // Don't throw if some are missing
          });
          logger.debug('[coreInit] Phase 4: Modal DOM elements readiness confirmed.', { context: 'coreInit' });
        } else {
          logger.warn('[coreInit] Phase 4: domReadinessService.dependenciesAndElements not available, cannot confirm modal DOM readiness.', { context: 'coreInit' });
        }
      } catch (err) {
        logger.error('[coreInit] Phase 4: Error in modalManager.init()', err, { context: 'coreInit:modalManager:init' });
        throw err; // Critical failure if modals cannot be loaded
      }
    } else {
        logger.warn('[coreInit] Phase 4: modalManager.init method not found. Modals may not load.', { context: 'coreInit' });
    }

    // Phase 5: Initialize Event Handlers (modals now confirmed ready)
    logger.debug('[coreInit] Phase 5: Initializing global event handlers...', { context: 'coreInit' });
    if (eventHandlers?.init) {
      await eventHandlers.init();
      logger.log('[coreInit] eventHandlers initialization complete', { context: 'coreInit' });
    }

    logger.debug('[coreInit] Phase 5: Global event handlers initialization complete.', { context: 'coreInit' });

    // Phase 6: Instantiate and Register Remaining UI-Oriented Core Components
    logger.debug('[coreInit] Phase 6: Instantiating and registering remaining UI-oriented core components.', { context: 'coreInit' });

    // 6.1. ProjectDashboard
    // Main UI container for project list and details views.
    logger.debug('[coreInit] Creating ProjectDashboard...', { context: 'coreInit' });
    const projectDashboard = createProjectDashboard({ // Use corrected factory name
      DependencySystem,         // For potential internal DI
      domAPI,                   // Direct arg
      browserService,           // Direct arg
      eventHandlers,            // Direct arg
      logger,                   // Direct arg
      sanitizer,                // Direct arg
      APP_CONFIG,               // Direct arg
      domReadinessService       // Direct arg
    });
    DependencySystem.register('projectDashboard', projectDashboard);
    logger.debug('[coreInit] ProjectDashboard instance created and registered.', { context: 'coreInit' });

    // 6.2. ProjectModal
    // UI for project creation and editing. Initializes its own UI elements.
    logger.debug('[coreInit] Creating ProjectModal...', { context: 'coreInit' });
    if (!projectManager) { // Should be available from pmFactory.instance
      logger.error('[coreInit] ProjectManager instance is not available for ProjectModal creation.', { context: 'coreInit' });
      throw new Error('[coreInit] ProjectManager must be available before creating ProjectModal.');
    }
    logger.debug('[coreInit] ProjectModal dependencies check passed.', {
      context: 'coreInit',
      hasProjectManager: !!projectManager, // Should be true
      hasEventHandlers: !!eventHandlers,
      hasDomAPI: !!domAPI,
      hasDomReadinessService: !!domReadinessService
    });

    const projectModal = createProjectModal({ // Use corrected factory name
      projectManager,           // Instance created above
      eventHandlers,            // Direct arg
      DependencySystem,         // For potential internal DI
      domAPI,                   // Direct arg
      domReadinessService,      // Direct arg
      domPurify: sanitizer      // Direct arg
    });
    DependencySystem.register('projectModal', projectModal);
    await projectModal.initialize(); // Initializes ProjectModal and its UI elements.
    logger.debug('[coreInit] ProjectModal instance created, registered, and UI initialized.', { context: 'coreInit' });

    // 6.3. Sidebar
    // Main navigation sidebar; depends on various services and components.
    logger.debug('[coreInit] Creating Sidebar...', { context: 'coreInit' });
    const sidebar = createSidebar({ // Use corrected factory name
      eventHandlers,            // Direct arg
      DependencySystem,         // For potential internal DI
      domAPI,                   // Direct arg
      uiRenderer,               // Direct arg
      storageAPI: browserService, // Direct arg (browserService acts as storage)
      projectManager,           // Instance created above
      modelConfig: modelConfigInstance, // Instance created above
      app,                      // Direct arg
      projectDashboard,         // Instance created above
      viewportAPI: browserService, // Direct arg
      accessibilityUtils,       // Direct arg
      sanitizer,                // Direct arg
      domReadinessService,      // Direct arg
      logger,                   // Direct arg
      safeHandler,              // Direct arg
      APP_CONFIG
    });
    DependencySystem.register('sidebar', sidebar);

    // Initialize the sidebar to wire up its internal listeners and UI.
    // This was identified as a critical step to ensure sidebar functionality.
    if (sidebar?.init) {
      try {
        await sidebar.init();
        logger.debug('[coreInit] Sidebar initialization (sidebar.init()) complete.', { context: 'coreInit:sidebar' });
      } catch (err) {
        logger.error('[coreInit] Error during sidebar.init()', err, { context: 'coreInit:sidebar:init' });
        throw err; // Sidebar is critical, rethrow if its init fails.
      }
    } else {
      logger.warn('[coreInit] Sidebar module does not have an init() method. Sidebar may not function correctly.', { context: 'coreInit:sidebar' });
    }
    logger.debug('[coreInit] Sidebar instance created and registered.', { context: 'coreInit' });
    logger.debug('[coreInit] Phase 6: Remaining UI-oriented core components registered.', { context: 'coreInit' });

    logger.info('[coreInit][initializeCoreSystems] Core systems initialization successfully completed.', { context: 'coreInit' });
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
