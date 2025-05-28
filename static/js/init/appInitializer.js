/**
 * appInitializer.js
 * Unified bootstrap module combining:
 *   • appState.js
 *   • authInit.js
 *   • coreInit.js
 *   • errorInit.js
 *   • serviceInit.js
 *   • uiInit.js
 *
 * Exported factory: createAppInitializer(deps)
 *
 * Public API:
 *   • initializeApp()  — boots entire app
 *   • cleanup()        — tears everything down
 *   • sub-APIs for backward compatibility (appModule, serviceInit, etc.)
 */

export function createAppInitializer({
    // Core infrastructure
    DependencySystem,
    domAPI,
    browserService,
    eventHandlers,
    logger,
    sanitizer,
    safeHandler,
    domReadinessService,
    APP_CONFIG,
    uiUtils,
    globalUtils,
    getSessionId,

    // Modal mapping constant
    MODAL_MAPPINGS,

    // Factories formerly injected into individual init modules
    createFileUploadComponent,
    createApiClient,
    createAccessibilityEnhancements,
    createNavigationService,
    createHtmlTemplateLoader,
    createUiRenderer,
    createKnowledgeBaseComponent,
    createProjectDetailsEnhancements,
    createTokenStatsManager,
    createModalManager,
    createAuthModule,
    createProjectManager,
    createModelConfig,
    createProjectDashboard,
    createProjectDetailsComponent,
    createProjectListComponent,
    createProjectModal,
    createSidebar
}) {
    // ──────────────────────────────────────────────
    // 1. Validate required dependencies
    // ──────────────────────────────────────────────
    const required = {
        DependencySystem, domAPI, browserService, eventHandlers,
        logger, sanitizer, safeHandler, domReadinessService,
        APP_CONFIG, uiUtils, globalUtils, getSessionId,
        MODAL_MAPPINGS,
        createModalManager, createAuthModule, createProjectManager,
        createModelConfig, createProjectDashboard, createProjectDetailsComponent,
        createProjectListComponent, createProjectModal, createSidebar,
        createFileUploadComponent, createApiClient,
        createAccessibilityEnhancements, createNavigationService,
        createHtmlTemplateLoader, createUiRenderer,
        createKnowledgeBaseComponent, createProjectDetailsEnhancements,
        createTokenStatsManager
    };
    for (const [k, v] of Object.entries(required)) {
        if (!v) throw new Error(`[appInitializer] Missing required dependency: ${k}`);
    }

    // ──────────────────────────────────────────────
    // 2. Register all factory functions in DI so coreInit can retrieve them
    // ──────────────────────────────────────────────
    [
        'createModalManager', 'createAuthModule', 'createProjectManager',
        'createModelConfig', 'createProjectDashboard', 'createProjectDetailsComponent',
        'createProjectListComponent', 'createProjectModal', 'createSidebar',
        'createFileUploadComponent', 'createApiClient',
        'createAccessibilityEnhancements', 'createNavigationService',
        'createHtmlTemplateLoader', 'createUiRenderer',
        'createKnowledgeBaseComponent', 'createProjectDetailsEnhancements',
        'createTokenStatsManager'
    ].forEach(name => {
        const fn = eval(name);
        DependencySystem.register(name, fn);
    });

    // ──────────────────────────────────────────────
    // 3. appState module (inlined from appState.js)
    // ──────────────────────────────────────────────
    const appModule = (() => {
        if (!DependencySystem) {
            throw new Error('[appState] Missing required dependencies for app state management.');
        }
        let _logger = logger;
        if (!_logger) {
            const winConsole =
                DependencySystem?.modules?.get?.('browserService')?.getWindow?.()?.console;
            _logger = winConsole ?? { info() { }, warn() { }, error() { }, debug() { }, log() { } };
        }

        function setLogger(newLogger) {
            if (newLogger) _logger = newLogger;
        }

        const state = {
            isAuthenticated: false,
            currentUser: null,
            currentProjectId: null,
            currentProject: null,
            isReady: false,
            disableErrorTracking: false,
            initialized: false,
            initializing: false,
            currentPhase: 'idle'
        };

        function setAuthState(newAuthState) {
            const oldAuthState = {
                isAuthenticated: state.isAuthenticated,
                currentUser: state.currentUser ? {
                    id: state.currentUser.id,
                    username: state.currentUser.username
                } : null
            };
            const newAuthStateForLog = {
                isAuthenticated: newAuthState.isAuthenticated,
                currentUser: newAuthState.currentUser ? {
                    id: newAuthState.currentUser.id,
                    username: newAuthState.currentUser.username
                } : null
            };
            _logger.info('[appState][setAuthState] Updating auth state.', {
                oldAuthState,
                newAuthState: newAuthStateForLog,
                context: 'appState:setAuthState'
            });
            Object.assign(state, newAuthState);
        }

        function setAppLifecycleState(newLifecycleState) {
            const oldLifecycleStateForLog = {
                isReady: state.isReady,
                initialized: state.initialized,
                initializing: state.initializing,
                currentPhase: state.currentPhase
            };
            _logger.info('[appState][setAppLifecycleState] Updating app lifecycle state.', {
                oldLifecycleState: oldLifecycleStateForLog,
                newLifecycleState,
                context: 'appState:setAppLifecycleState'
            });
            Object.assign(state, newLifecycleState);

            if (newLifecycleState.initialized === true) {
                if (state.currentPhase === 'initialized_idle') {
                    state.isReady = true;
                } else if (state.currentPhase === 'failed_idle') {
                    state.isReady = false;
                }
            } else if (Object.prototype.hasOwnProperty.call(newLifecycleState, 'isReady')) {
                state.isReady = newLifecycleState.isReady;
            }
        }

        function setLifecycleState(...args) {
            _logger.warn('[appState] setLifecycleState() is deprecated – use setAppLifecycleState()', {
                context: 'appState:compat'
            });
            return setAppLifecycleState(...args);
        }

        function setCurrentProject(projectIdOrObject) {
            const oldProjectId = state.currentProjectId;
            const oldProject = state.currentProject;

            if (projectIdOrObject === null) {
                state.currentProjectId = null;
                state.currentProject = null;
                _logger.info('[appState][setCurrentProject] Clearing current project.', {
                    oldProjectId,
                    context: 'appState:setCurrentProject:clear'
                });
            } else if (typeof projectIdOrObject === 'string') {
                state.currentProjectId = projectIdOrObject;
                if (state.currentProject?.id !== projectIdOrObject) {
                    state.currentProject = null;
                }
                _logger.info('[appState][setCurrentProject] Updating current project ID.', {
                    oldProjectId,
                    newProjectId: projectIdOrObject,
                    context: 'appState:setCurrentProject:id'
                });
            } else if (projectIdOrObject && typeof projectIdOrObject === 'object' && projectIdOrObject.id) {
                state.currentProjectId = projectIdOrObject.id;
                state.currentProject = projectIdOrObject;
                _logger.info('[appState][setCurrentProject] Updating current project object.', {
                    oldProjectId,
                    newProjectId: projectIdOrObject.id,
                    context: 'appState:setCurrentProject:object'
                });
            } else {
                _logger.warn('[appState][setCurrentProject] Invalid project data provided.', {
                    projectIdOrObject,
                    context: 'appState:setCurrentProject:invalid'
                });
                return;
            }

            if (oldProjectId !== state.currentProjectId) {
                try {
                    const appBus = DependencySystem.modules.get('AppBus');
                    const handlers = DependencySystem.modules.get('eventHandlers');
                    const domAPIlookup = DependencySystem.modules.get('domAPI');
                    if (appBus && handlers?.createCustomEvent) {
                        const detail = {
                            project: state.currentProject ? { ...state.currentProject } : null,
                            previousProject: oldProject ? { ...oldProject } : null,
                            projectId: state.currentProject?.id || null,
                            previousProjectId: oldProject?.id || null
                        };
                        _logger.debug('[appState] Dispatching currentProjectChanged event.', {
                            projectId: detail.projectId,
                            previousProjectId: detail.previousProjectId,
                            context: 'appState:projectChangeEvent'
                        });
                        appBus.dispatchEvent(
                            handlers.createCustomEvent('currentProjectChanged', { detail })
                        );

                        if (state.currentProject && domAPIlookup) {
                            const doc = domAPIlookup.getDocument();
                            if (doc) {
                                _logger.debug('[appState] Dispatching legacy "projectSelected" event.', {
                                    projectId: state.currentProject.id,
                                    context: 'appState:projectChangeEvent:legacy'
                                });
                                domAPIlookup.dispatchEvent(
                                    doc,
                                    handlers.createCustomEvent('projectSelected', {
                                        detail: {
                                            projectId: state.currentProject.id,
                                            project: { ...state.currentProject }
                                        }
                                    })
                                );
                            }
                        }
                    }
                } catch (error) {
                    _logger.error('[appState] Failed to dispatch project change event.', {
                        error: error.message,
                        context: 'appState:projectChangeEvent:error'
                    });
                }
            }
        }

        function cleanup() {
            const handlers = DependencySystem.modules.get('eventHandlers');
            if (handlers) handlers.cleanupListeners({ context: 'appState' });
            _logger.debug('[appState] Cleanup completed', { context: 'appState:cleanup' });
        }

        const api = {
            state,
            setLogger,
            setAuthState,
            setAppLifecycleState,
            setLifecycleState,
            isAuthenticated: () => state.isAuthenticated,
            getCurrentUser: () => state.currentUser,
            setCurrentProject,
            getCurrentProjectId: () => state.currentProjectId,
            getCurrentProject: () => state.currentProject,
            isAppReady: () => state.isReady,
            isInitialized: () => state.initialized,
            isInitializing: () => state.initializing,
            getCurrentPhase: () => state.currentPhase,
            cleanup
        };

        return api;
    })();
    DependencySystem.register('appModule', appModule);


    // ──────────────────────────────────────────────
    // 4. serviceInit (inlined from serviceInit.js)
    // ──────────────────────────────────────────────
    const serviceInit = (() => {
        if (!DependencySystem || !domAPI || !browserService || !eventHandlers ||
            !domReadinessService || !sanitizer || !APP_CONFIG || !getSessionId) {
            throw new Error('[serviceInit] Missing required dependencies for service initialization.');
        }
        if (!logger) {
            throw new Error('[serviceInit] Logger instance is required; fallback removed.');
        }

        function safeRegister(name, value) {
            if (!DependencySystem.modules.has(name)) {
                DependencySystem.register(name, value);
                logger.debug(`[serviceInit] Registered "${name}"`, { context: 'serviceInit:safeRegister' });
            } else {
                logger.debug(`[serviceInit] "${name}" already registered – skipping.`, { context: 'serviceInit:safeRegister' });
            }
        }

        function registerBasicServices() {
            logger.info('[serviceInit] Starting registration of basic services...', { context: 'serviceInit:registerBasicServices' });
            safeRegister('logger', logger);
            safeRegister('domAPI', domAPI);
            safeRegister('browserAPI', browserService);
            safeRegister('browserService', browserService);
            safeRegister('viewportAPI', browserService);
            safeRegister('storage', browserService);
            safeRegister('eventHandlers', eventHandlers);
            safeRegister('domReadinessService', domReadinessService);

            if (eventHandlers.setDomReadinessService) {
                eventHandlers.setDomReadinessService(domReadinessService);
            } else {
                logger.warn('[serviceInit] eventHandlers.setDomReadinessService is not defined.', { context: 'serviceInit:registerBasicServices' });
            }

            const existingErrorReporter = DependencySystem.modules.get('errorReporter');
            if (!existingErrorReporter) {
                throw new Error('[serviceInit] errorReporter module must be registered before ServiceInit runs.');
            }
            safeRegister('errorReporter', existingErrorReporter);

            if (uiUtils) safeRegister('uiUtils', uiUtils);
            if (globalUtils) safeRegister('globalUtils', globalUtils);
            safeRegister('sanitizer', sanitizer);
            safeRegister('domPurify', sanitizer);

            if (createFileUploadComponent) {
                safeRegister('FileUploadComponent', createFileUploadComponent);
            }

            // Register API endpoints
            const { createApiEndpoints } = require('../utils/apiEndpoints.js');
            const apiEndpointsInstance = createApiEndpoints({ logger, DependencySystem, config: APP_CONFIG });
            const resolvedEndpoints = DependencySystem.modules.get('apiEndpoints') || apiEndpointsInstance.endpoints;
            safeRegister('apiEndpoints', resolvedEndpoints);

            logger.debug('[serviceInit] API endpoints registered.', {
                endpointCount: Object.keys(resolvedEndpoints).length,
                context: 'serviceInit:registerBasicServices'
            });
            logger.info('[serviceInit] Basic services registration completed.', {
                context: 'serviceInit:registerBasicServices'
            });
        }

        function registerAdvancedServices() {
            logger.info('[serviceInit] Starting registration of advanced services...', {
                context: 'serviceInit:registerAdvancedServices'
            });
            let apiClientInstance = null;

            if (createApiClient && globalUtils) {
                logger.debug('[serviceInit] Creating API client...', {
                    context: 'serviceInit:registerAdvancedServices'
                });
                apiClientInstance = createApiClient({
                    APP_CONFIG,
                    globalUtils: {
                        shouldSkipDedup: globalUtils.shouldSkipDedup,
                        stableStringify: globalUtils.stableStringify,
                        normaliseUrl: globalUtils.normaliseUrl,
                        isAbsoluteUrl: globalUtils.isAbsoluteUrl
                    },
                    getAuthModule: () => DependencySystem.modules.get('auth'),
                    browserService,
                    eventHandlers,
                    logger: DependencySystem.modules.get('logger')
                });

                if (DependencySystem.modules.has('apiRequest')) {
                    DependencySystem.modules.set('apiRequest', apiClientInstance.fetch);
                    logger.debug('[serviceInit] apiRequest proxy replaced with real implementation.', {
                        context: 'serviceInit:registerAdvancedServices'
                    });
                } else {
                    safeRegister('apiRequest', apiClientInstance.fetch);
                }

                if (DependencySystem.modules.has('apiClientObject')) {
                    DependencySystem.modules.set('apiClientObject', apiClientInstance);
                } else {
                    safeRegister('apiClientObject', apiClientInstance);
                }

                logger.debug('[serviceInit] API client created and registered.', {
                    context: 'serviceInit:registerAdvancedServices'
                });

                const globalLogger = DependencySystem.modules.get('logger');
                if (apiClientInstance && globalLogger.upgradeWithApiClient) {
                    globalLogger.upgradeWithApiClient(apiClientInstance);
                    globalLogger.debug('[serviceInit] Logger upgraded with apiClient', {
                        context: 'serviceInit:registerAdvancedServices'
                    });
                }
            } else {
                logger.warn('[serviceInit] createApiClient or globalUtils not provided. Skipping API client.', {
                    context: 'serviceInit:registerAdvancedServices'
                });
            }

            if (createAccessibilityEnhancements) {
                logger.debug('[serviceInit] Creating Accessibility Enhancements...', {
                    context: 'serviceInit:registerAdvancedServices'
                });
                const accessibilityUtilsInstance = createAccessibilityEnhancements({
                    domAPI,
                    eventHandlers,
                    logger: DependencySystem.modules.get('logger'),
                    domReadinessService,
                    DependencySystem,
                    safeHandler: DependencySystem.modules.get('safeHandler')
                });
                safeRegister('accessibilityUtils', accessibilityUtilsInstance);
                logger.debug('[serviceInit] Accessibility Enhancements created.', {
                    context: 'serviceInit:registerAdvancedServices'
                });
            }

            if (createNavigationService) {
                logger.debug('[serviceInit] Creating Navigation Service...', {
                    context: 'serviceInit:registerAdvancedServices'
                });
                const navInstance = createNavigationService({
                    domAPI,
                    browserService,
                    DependencySystem,
                    eventHandlers
                });
                navInstance.init();                 // ACTIVATE lifecycle & popstate handler
                safeRegister('navigationService', navInstance);
                logger.debug('[serviceInit] Navigation Service created.', {
                    context: 'serviceInit:registerAdvancedServices'
                });
            }

            if (createHtmlTemplateLoader) {
                logger.debug('[serviceInit] Creating HTML Template Loader...', {
                    context: 'serviceInit:registerAdvancedServices'
                });
                if (!domReadinessService) {
                    throw new Error('[serviceInit] domReadinessService required for htmlTemplateLoader');
                }
                const htmlLoaderInstance = createHtmlTemplateLoader({
                    DependencySystem,
                    domAPI,
                    sanitizer,
                    eventHandlers,
                    apiClient: apiClientInstance,
                    timerAPI: browserService,
                    domReadinessService,
                    logger: DependencySystem.modules.get('logger')
                });
                safeRegister('htmlTemplateLoader', htmlLoaderInstance);
                logger.debug('[serviceInit] HTML Template Loader created.', {
                    context: 'serviceInit:registerAdvancedServices'
                });
            }

            if (createUiRenderer && apiClientInstance) {
                logger.debug('[serviceInit] Creating UI Renderer...', {
                    context: 'serviceInit:registerAdvancedServices'
                });
                const curEndpoints = DependencySystem.modules.get('apiEndpoints');
                const curLogger = DependencySystem.modules.get('logger');
                if (curEndpoints) {
                    const uiRendererInstance = createUiRenderer({
                        domAPI,
                        eventHandlers,
                        apiRequest: apiClientInstance.fetch,
                        apiEndpoints: curEndpoints,
                        domReadinessService,
                        logger: curLogger,
                        DependencySystem,
                        onConversationSelect: (conversationId) => {
                            const doc = domAPI.getDocument();
                            if (doc && eventHandlers.createCustomEvent) {
                                domAPI.dispatchEvent(doc,
                                    eventHandlers.createCustomEvent('uiRenderer:conversationSelected', {
                                        detail: { conversationId }
                                    })
                                );
                            }
                        },
                        onProjectSelect: (projectId) => {
                            const doc = domAPI.getDocument();
                            if (doc && eventHandlers.createCustomEvent) {
                                domAPI.dispatchEvent(doc,
                                    eventHandlers.createCustomEvent('uiRenderer:projectSelected', {
                                        detail: { projectId }
                                    })
                                );
                            }
                        }
                    });
                    safeRegister('uiRenderer', uiRendererInstance);
                    logger.debug('[serviceInit] UI Renderer created.', {
                        context: 'serviceInit:registerAdvancedServices'
                    });
                } else {
                    curLogger.error('[serviceInit] apiEndpoints missing; skipping uiRenderer.', {
                        context: 'serviceInit:registerAdvancedServices'
                    });
                }
            } else if (!apiClientInstance && createUiRenderer) {
                logger.warn('[serviceInit] UI Renderer requires API client; skipping.', {
                    context: 'serviceInit:registerAdvancedServices'
                });
            }

            logger.info('[serviceInit] Advanced services registration completed.', {
                context: 'serviceInit:registerAdvancedServices'
            });
        }

        function setLogger(newLogger) {
            if (!newLogger) return;
            logger = newLogger;
            safeRegister('logger', newLogger);
        }

        function cleanup() {
            eventHandlers.cleanupListeners({ context: 'serviceInit' });
            const log = DependencySystem.modules.get('logger');
            log.debug('[serviceInit] Cleanup completed', { context: 'serviceInit:cleanup' });
        }

        return {
            registerBasicServices,
            registerAdvancedServices,
            setLogger,
            cleanup
        };
    })();


    // ──────────────────────────────────────────────
    // 5. errorInit (inlined from errorInit.js)
    // ──────────────────────────────────────────────
    const errorInit = (() => {
        if (!DependencySystem || !browserService || !eventHandlers || !logger || !safeHandler) {
            throw new Error('[errorInit] Missing required dependencies for error handling initialization.');
        }

        function setupGlobalErrorHandling() {
            try {
                const windowObj = browserService.getWindow();
                if (!windowObj) {
                    throw new Error('[errorInit] browserService.getWindow() returned null/undefined.');
                }

                eventHandlers.trackListener(
                    windowObj,
                    'error',
                    (evt) => {
                        const { message, filename: source, lineno, colno, error } = evt;
                        const log = DependencySystem.modules.get('logger');
                        log.error(
                            '[window.error]',
                            { message, source, lineno, colno, err: error?.stack || error },
                            { context: 'global.error' }
                        );
                    },
                    { context: 'errorInit', description: 'window error handler', passive: true }
                );

                eventHandlers.trackListener(
                    windowObj,
                    'unhandledrejection',
                    safeHandler((event) => {
                        logger.error('[unhandledrejection]', event?.reason, { context: 'global.unhandledrejection' });
                    }, 'global unhandledrejection'),
                    { context: 'errorInit' }
                );

                logger.log('[errorInit] Global error handling setup completed', {
                    context: 'errorInit:setupGlobalErrorHandling'
                });
            } catch (err) {
                logger.error('[errorInit] Failed to setup global error handling', err, {
                    context: 'errorInit:setupGlobalErrorHandling'
                });
                throw err;
            }
        }

        function setupSpecificErrorHandlers() {
            try {
                const windowObj = browserService.getWindow();
                if (!windowObj) {
                    throw new Error('[errorInit] browserService.getWindow() returned null/undefined.');
                }
                // Placeholder for future specific handlers
                logger.log('[errorInit] Specific error handlers setup completed', {
                    context: 'errorInit:setupSpecificErrorHandlers'
                });
            } catch (err) {
                logger.error('[errorInit] Failed to setup specific error handlers', err, {
                    context: 'errorInit:setupSpecificErrorHandlers'
                });
                throw err;
            }
        }

        function initializeErrorHandling() {
            try {
                logger.log('[errorInit] Starting error handling initialization', {
                    context: 'errorInit:initializeErrorHandling'
                });
                setupGlobalErrorHandling();
                setupSpecificErrorHandlers();
                logger.log('[errorInit] Error handling initialization completed', {
                    context: 'errorInit:initializeErrorHandling'
                });
            } catch (err) {
                logger.error('[errorInit] Error handling initialization failed', err, {
                    context: 'errorInit:initializeErrorHandling'
                });
                throw err;
            }
        }

        function cleanup() {
            eventHandlers.cleanupListeners({ context: 'errorInit' });
            logger.debug('[errorInit] Cleanup completed', { context: 'errorInit:cleanup' });
        }

        return {
            setupGlobalErrorHandling,
            setupSpecificErrorHandlers,
            initializeErrorHandling,
            cleanup
        };
    })();


    // ──────────────────────────────────────────────
    // 6. coreInit (inlined from coreInit.js)
    // ──────────────────────────────────────────────
    const coreInit = (() => {
        async function initializeCoreSystems() {
            logger.log('[coreInit][initializeCoreSystems] Starting core systems initialization.', {
                context: 'coreInit'
            });

            function validateRuntimeDeps() {
                const runtimeRequired = {
                    DependencySystem, domAPI, browserService, eventHandlers, sanitizer, logger, APP_CONFIG,
                    domReadinessService, createKnowledgeBaseComponent, MODAL_MAPPINGS,
                    apiRequest: DependencySystem.modules.get('apiRequest'),
                    apiClientObject: DependencySystem.modules.get('apiClientObject'),
                    apiEndpoints: DependencySystem.modules.get('apiEndpoints'),
                    app: appModule,
                    uiUtils,
                    navigationService: DependencySystem.modules.get('navigationService'),
                    globalUtils,
                    FileUploadComponent: createFileUploadComponent,
                    htmlTemplateLoader: DependencySystem.modules.get('htmlTemplateLoader'),
                    uiRenderer: DependencySystem.modules.get('uiRenderer'),
                    accessibilityUtils: DependencySystem.modules.get('accessibilityUtils'),
                    safeHandler
                };
                for (const [k, v] of Object.entries(runtimeRequired)) {
                    if (!v) throw new Error(`[coreInit] Missing required dependency: ${k}`);
                }
            }

            // Phase 1: Basic DOM readiness
            await domReadinessService.dependenciesAndElements({
                deps: ['domAPI'],
                domSelectors: ['body'],
                timeout: 10000,
                context: 'coreInit:domReady'
            });

            // Phase 2: Retrieve factories
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
            for (const [name, fn] of Object.entries(factories)) {
                if (!fn) {
                    logger.error(`[coreInit] Missing required factory: ${name}`, {
                        context: 'coreInit:factoryCheck'
                    });
                    throw new Error(`[coreInit] Missing required factory: ${name}`);
                }
            }
            const {
                createModalManager: makeModalManager,
                createAuthModule: makeAuthModule,
                createProjectManager: makeProjectManager,
                createModelConfig: makeModelConfig,
                createProjectDashboard: makeProjectDashboard,
                createProjectDetailsComponent: makeProjectDetailsComponent,
                createProjectListComponent: makeProjectListComponent,
                createProjectModal: makeProjectModal,
                createSidebar: makeSidebar
            } = factories;

            // Phase 3.1: ModalManager
            const modalManager = makeModalManager({
                domAPI,
                browserService,
                eventHandlers,
                DependencySystem,
                modalMapping: MODAL_MAPPINGS,
                domPurify: sanitizer,
                domReadinessService,
                logger
            });
            DependencySystem.register('modalManager', modalManager);

            // Phase 3.2: Auth module factory
            if (typeof DependencySystem.modules.get('apiRequest') !== 'function') {
                throw new Error('[coreInit] apiRequest argument is not a function.');
            }
            if (!DependencySystem.modules.get('apiClientObject')) {
                throw new Error('[coreInit] apiClientObject argument is missing.');
            }
            const authModule = makeAuthModule({
                DependencySystem,
                apiClient: DependencySystem.modules.get('apiRequest'),
                eventHandlers,
                domAPI,
                sanitizer,
                APP_CONFIG,
                modalManager,
                apiEndpoints: DependencySystem.modules.get('apiEndpoints'),
                logger,
                domReadinessService
            });
            DependencySystem.register('auth', authModule);

            logger.log('[coreInit] auth module registered', { context: 'coreInit' });

            // Phase 3.3: ModelConfig
            const modelConfigInstance = makeModelConfig({
                dependencySystem: DependencySystem,
                domReadinessService,
                eventHandler: eventHandlers,
                storageHandler: browserService,
                sanitizer
            });
            DependencySystem.register('modelConfig', modelConfigInstance);
            await modelConfigInstance.initWithReadiness();

            // Phase 3.4: ProjectDetailsComponent (partial)
            const projectDetailsComp = makeProjectDetailsComponent({
                projectManager: null, // set later
                eventHandlers,
                modalManager,
                FileUploadComponentClass: createFileUploadComponent,
                domAPI,
                sanitizer,
                app: appModule,
                navigationService: DependencySystem.modules.get('navigationService'),
                htmlTemplateLoader: DependencySystem.modules.get('htmlTemplateLoader'),
                logger,
                APP_CONFIG,
                chatManager: null, // set later
                modelConfig: modelConfigInstance,
                knowledgeBaseComponent: null,
                apiClient: DependencySystem.modules.get('apiRequest'),
                domReadinessService
            });
            DependencySystem.register('projectDetailsComponent', projectDetailsComp);

            // Phase 3.5: KnowledgeBaseComponent & ChatManager
            const knowledgeBaseComponentInstance = createKnowledgeBaseComponent({
                DependencySystem,
                apiRequest: DependencySystem.modules.get('apiRequest'),
                projectManager: null, // set when projectManager is created
                uiUtils,
                sanitizer
            });
            DependencySystem.register('knowledgeBaseComponent', knowledgeBaseComponentInstance);

            const navigationService = DependencySystem.modules.get('navigationService');
            const chatManagerInstance = (() => {
                const factory = DependencySystem.modules.get('createChatManager');
                if (!factory) {
                    logger.error('[coreInit] createChatManager factory not found.', {
                        context: 'coreInit:createOrGetChatManager'
                    });
                    throw new Error('[coreInit] createChatManager factory missing.');
                }
                const instance = factory({
                    DependencySystem,
                    apiRequest: DependencySystem.modules.get('apiRequest'),
                    auth: authModule,
                    eventHandlers,
                    modelConfig: modelConfigInstance,
                    projectDetailsComponent: projectDetailsComp,
                    app: appModule,
                    domAPI,
                    domReadinessService,
                    logger,
                    navAPI: navigationService?.navAPI,
                    isValidProjectId: globalUtils.isValidProjectId,
                    isAuthenticated: () => !!authModule.isAuthenticated?.(),
                    DOMPurify: sanitizer,
                    apiEndpoints: DependencySystem.modules.get('apiEndpoints'),
                    APP_CONFIG
                });
                DependencySystem.register('chatManager', instance);
                return instance;
            })();

            // Phase 3.6: ProjectManager
            const pmFactory = await makeProjectManager({
                DependencySystem,
                chatManager: chatManagerInstance,
                app: appModule,
                modelConfig: modelConfigInstance,
                apiRequest: DependencySystem.modules.get('apiRequest'),
                apiEndpoints: DependencySystem.modules.get('apiEndpoints'),
                storage: browserService,
                listenerTracker: {
                    add: (el, type, handler, desc) =>
                        eventHandlers.trackListener(el, type, handler, { description: desc, context: 'projectManager' }),
                    remove: () => eventHandlers.cleanupListeners({ context: 'projectManager' })
                },
                domAPI,
                domReadinessService,
                logger
            });
            const projectManager = pmFactory.instance;
            if (!DependencySystem.modules.has('projectManager')) {
                DependencySystem.register('projectManager', projectManager);
                logger.log('[coreInit] projectManager registered', { context: 'coreInit' });
            }

            // Phase 3.7: ProjectListComponent
            const projectListComponent = makeProjectListComponent({
                projectManager,
                eventHandlers,
                modalManager,
                app: appModule,
                router: DependencySystem.modules.get('navigationService'),
                storage: browserService,
                sanitizer,
                htmlSanitizer: sanitizer,
                apiClient: DependencySystem.modules.get('apiRequest'),
                domAPI,
                domReadinessService,
                browserService,
                globalUtils,
                APP_CONFIG,
                logger
            });
            DependencySystem.register('projectListComponent', projectListComponent);
            logger.debug('[coreInit] ProjectListComponent registered.', { context: 'coreInit' });

            // Phase 4: ModalManager UI init
            if (modalManager.init) {
                try {
                    await modalManager.init();
                    await domReadinessService.dependenciesAndElements({
                        domSelectors: ['#loginModal', '#errorModal', '#confirmModal', '#projectModal'],
                        timeout: APP_CONFIG.MODAL_DOM_TIMEOUT ?? 12000,
                        context: 'coreInit:modalReadiness'
                    });
                } catch (err) {
                    logger.error('[coreInit] ModalManager.init() error', err, {
                        context: 'coreInit:modalManager:init'
                    });
                    throw err;
                }
            }

            // Phase 5: eventHandlers init
            if (eventHandlers.init) {
                await eventHandlers.init();
                logger.log('[coreInit] eventHandlers init complete', { context: 'coreInit' });
            }

            // Phase 6: UI-oriented core components
            const projectDashboard = makeProjectDashboard({
                DependencySystem, domAPI, browserService, eventHandlers,
                logger, sanitizer, APP_CONFIG, domReadinessService
            });
            DependencySystem.register('projectDashboard', projectDashboard);

            const plc = DependencySystem.modules.get('projectListComponent');
            if (plc && projectDashboard.setProjectListComponent) {
                projectDashboard.setProjectListComponent(plc);
            }
            const pdc = DependencySystem.modules.get('projectDetailsComponent');
            if (pdc && projectDashboard.setProjectDetailsComponent) {
                projectDashboard.setProjectDetailsComponent(pdc);
            }

            const projectModal = makeProjectModal({
                projectManager, eventHandlers, DependencySystem, domAPI,
                domReadinessService, domPurify: sanitizer
            });
            DependencySystem.register('projectModal', projectModal);
            await projectModal.initialize();

            const sidebar = makeSidebar({
                eventHandlers, DependencySystem, domAPI,
                uiRenderer: DependencySystem.modules.get('uiRenderer'),
                storageAPI: browserService,
                projectManager, modelConfig: modelConfigInstance,
                app: appModule, projectDashboard,
                viewportAPI: browserService,
                accessibilityUtils: DependencySystem.modules.get('accessibilityUtils'),
                sanitizer, domReadinessService, logger, safeHandler, APP_CONFIG
            });
            DependencySystem.register('sidebar', sidebar);
            if (sidebar.init) await sidebar.init();

            logger.info('[coreInit] Core systems initialization completed.', {
                context: 'coreInit'
            });
            return true;
        }

        function cleanup() {
            eventHandlers.cleanupListeners({ context: 'coreInit' });
            logger.debug('[coreInit] Cleanup completed', { context: 'coreInit:cleanup' });
        }

        return { initializeCoreSystems, cleanup };
    })();


    // ──────────────────────────────────────────────
    // 7. authInit (inlined from authInit.js)
    // ──────────────────────────────────────────────
    const authInit = (() => {
        if (!DependencySystem || !domAPI || !eventHandlers ||
            !logger || !sanitizer || !safeHandler ||
            !domReadinessService || !APP_CONFIG) {
            throw new Error('[authInit] Missing required dependencies for auth initialization.');
        }

        async function initializeAuthSystem() {
            await domReadinessService.documentReady();
            await domReadinessService.dependenciesAndElements({
                deps: ['auth', 'eventHandlers'],
                domSelectors: ['#loginModalForm', '#authButton'],
                timeout: 8000,
                context: 'authInit.initializeAuthSystem'
            });

            const auth = DependencySystem.modules.get('auth');
            if (!auth?.init) {
                throw new Error('[authInit] Auth module is missing or invalid.');
            }

            if (auth.AuthBus) {
                logger.info('[authInit] Registering AuthBus listeners', { context: 'authInit:init' });
                eventHandlers.trackListener(
                    auth.AuthBus,
                    'authStateChanged',
                    safeHandler((event) => {
                        logger.info('[authInit][AuthBus] Received authStateChanged', event?.detail, { context: 'authInit:authStateChanged' });
                        handleAuthStateChange(event);
                    }, 'AuthBus authStateChanged handler'),
                    { description: '[authInit] AuthBus authStateChanged', context: 'authInit' }
                );
                eventHandlers.trackListener(
                    auth.AuthBus,
                    'authReady',
                    safeHandler((event) => {
                        logger.info('[authInit][AuthBus] Received authReady', event?.detail, { context: 'authInit:authReady' });
                        handleAuthStateChange(event);
                    }, 'AuthBus authReady handler'),
                    { description: '[authInit] AuthBus authReady', context: 'authInit' }
                );
            } else {
                logger.warn('[authInit] No AuthBus instance for registration', { context: 'authInit:init' });
            }

            try {
                logger.info('[authInit] Calling auth.init()', { context: 'authInit:init' });
                await auth.init();
                eventHandlers.dispatch('authReady');
                renderAuthHeader();
                return true;
            } catch (err) {
                logger.error('[authInit] Auth system initialization failed', err, {
                    context: 'authInit:init'
                });
                throw err;
            }
        }

        function handleAuthStateChange(event) {
            const appModuleLocal = DependencySystem.modules.get('appModule');
            const projectManager = DependencySystem.modules.get('projectManager');
            logger.info('[authInit][handleAuthStateChange]', {
                eventDetail: event?.detail,
                appModuleState: JSON.stringify(appModuleLocal.state),
                context: 'authInit:handleAuthStateChange'
            });

            const isAuthenticated = appModuleLocal.state.isAuthenticated;
            const navService = DependencySystem.modules.get('navigationService');
            const appReadyDispatched = DependencySystem.modules.get('app')?._appReadyDispatched;
            const readyNow = appReadyDispatched || appModuleLocal.state.isReady;

            const proceed = () => {
                if (navService?.navigateToProjectList) {
                    navService.navigateToProjectList().catch(() => { });
                } else if (projectManager?.loadProjects) {
                    projectManager.loadProjects('all').catch(() => { });
                }
            };

            if (isAuthenticated) {
                if (readyNow) {
                    proceed();
                } else {
                    domReadinessService.waitForEvent('app:ready', {
                        timeout: APP_CONFIG.TIMEOUTS?.APP_READY_WAIT ?? 30000,
                        context: 'authInit:handleAuthStateChange'
                    }).then(proceed).catch(() => { });
                }
            }

            renderAuthHeader();
        }

        function renderAuthHeader() {
            try {
                const appModuleLocal = DependencySystem.modules.get('appModule');
                if (!appModuleLocal) {
                    logger.error('[authInit][renderAuthHeader] appModule not found.', {
                        context: 'authInit:renderAuthHeader'
                    });
                    return;
                }
                const isAuth = appModuleLocal.state.isAuthenticated;
                const user = appModuleLocal.state.currentUser;

                logger.debug('[authInit][renderAuthHeader] Rendering auth header', {
                    isAuth, user, context: 'authInit:renderAuthHeader'
                });

                const authBtn = domAPI.getElementById('authButton');
                const userMenu = domAPI.getElementById('userMenu');
                const logoutBtn = domAPI.getElementById('logoutBtn');
                const userInitialsEl = domAPI.getElementById('userInitials');
                const authStatus = domAPI.getElementById('authStatus');
                const userStatus = domAPI.getElementById('userStatus');

                if (authBtn) {
                    if (isAuth) {
                        domAPI.addClass(authBtn, 'hidden');
                        domAPI.setStyle(authBtn, 'display', 'none');
                        domAPI.setAttribute(authBtn, 'hidden', 'hidden');
                    } else {
                        domAPI.removeClass(authBtn, 'hidden');
                        domAPI.setStyle(authBtn, 'display', '');
                        domAPI.removeAttribute(authBtn, 'hidden');
                    }
                }

                if (userMenu) {
                    domAPI.toggleClass(userMenu, 'hidden', !isAuth);
                    domAPI.setStyle(userMenu, 'display', isAuth ? '' : 'none');
                    isAuth
                        ? domAPI.removeAttribute(userMenu, 'hidden')
                        : domAPI.setAttribute(userMenu, 'hidden', 'hidden');
                }

                if (!isAuth) {
                    const orphan = domAPI.getElementById('headerLoginForm');
                    if (orphan) {
                        const p = domAPI.getParentNode(orphan);
                        if (p) domAPI.removeChild(p, orphan);
                    }
                }

                if (isAuth && userMenu && userInitialsEl) {
                    if (!user?.name) {
                        throw new Error('[authInit][renderAuthHeader] user.name is required.');
                    }
                    const initials = user.name.trim().split(/\s+/).map(p => p[0]).join('').toUpperCase();
                    domAPI.setTextContent(userInitialsEl, initials);
                } else if (userMenu && userInitialsEl) {
                    domAPI.setTextContent(userInitialsEl, '');
                }

                if (authStatus) {
                    domAPI.setTextContent(authStatus,
                        isAuth
                            ? (user?.username ? `Signed in as ${user.username}` : 'Authenticated')
                            : 'Not Authenticated'
                    );
                }

                if (userStatus) {
                    domAPI.setTextContent(userStatus,
                        isAuth && user?.username
                            ? `Hello, ${user.name ?? user.username}`
                            : 'Offline'
                    );
                }

                if (logoutBtn) {
                    eventHandlers.trackListener(
                        logoutBtn,
                        'click',
                        safeHandler((e) => {
                            domAPI.preventDefault(e);
                            logger.debug('[authInit][renderAuthHeader] Logout clicked.', {
                                context: 'authInit:logout'
                            });
                            const authMod = DependencySystem.modules.get('auth');
                            authMod?.logout?.().catch(err => {
                                logger.error('[authInit] Error during logout:', err, {
                                    context: 'authInit:logout'
                                });
                            });
                        }, 'Auth logout click'),
                        { description: 'Auth logout click', context: 'authInit' }
                    );
                }
            } catch (err) {
                logger.error('[authInit][renderAuthHeader] Error during rendering', err, {
                    context: 'authInit:renderAuthHeader'
                });
            }
        }

        function forceShowLoginModal() {
            const appModuleLocal = DependencySystem.modules.get?.('appModule');
            if (appModuleLocal && !appModuleLocal.state?.isAuthenticated) {
                const modalManager = DependencySystem.modules.get?.('modalManager');
                if (modalManager && typeof modalManager.show === 'function') {
                    modalManager.show('login');
                } else {
                    throw new Error('[authInit][forceShowLoginModal] modalManager missing.');
                }
            }
        }

        function cleanup() {
            eventHandlers.cleanupListeners({ context: 'authInit' });
            logger.debug('[authInit] Cleanup completed', { context: 'authInit:cleanup' });
        }

        return {
            initializeAuthSystem,
            handleAuthStateChange,
            renderAuthHeader,
            forceShowLoginModal,
            cleanup
        };
    })();


    // ──────────────────────────────────────────────
    // 8. uiInit (inlined from uiInit.js)
    // ──────────────────────────────────────────────
    const uiInit = (() => {
        if (!DependencySystem || !domAPI || !browserService || !eventHandlers ||
            !domReadinessService || !logger || !APP_CONFIG || !safeHandler ||
            !sanitizer || !createProjectDetailsEnhancements ||
            !createTokenStatsManager || !createKnowledgeBaseComponent ||
            !domReadinessService || !uiUtils) {
            throw new Error('[uiInit] Missing required dependencies for UI initialization.');
        }

        let _uiInitialized = false;

        async function setupSidebarControls() {
            logger.log('[UIInit] setupSidebarControls: no-op (handled by Sidebar module)', {
                context: 'uiInit:setupSidebarControls'
            });
        }

        async function loadProjectTemplates() {
            const htmlLoader = DependencySystem.modules.get('htmlTemplateLoader');
            if (!htmlLoader?.loadTemplate) {
                logger.error('[UIInit] htmlTemplateLoader.loadTemplate unavailable', {
                    context: 'uiInit:loadTemplates'
                });
                return;
            }
            try {
                logger.log('[UIInit] Loading project templates', {
                    context: 'uiInit:loadTemplates'
                });
                await htmlLoader.loadTemplate({
                    url: '/static/html/project_list.html',
                    containerSelector: '#projectListView',
                    eventName: 'projectListHtmlLoaded'
                });
                await htmlLoader.loadTemplate({
                    url: '/static/html/project_details.html',
                    containerSelector: '#projectDetailsView',
                    eventName: 'projectDetailsHtmlLoaded'
                });
                logger.log('[UIInit] Project templates loaded', {
                    context: 'uiInit:loadTemplates'
                });
            } catch (err) {
                logger.error('[UIInit] Failed to load project templates', err, {
                    context: 'uiInit:loadTemplates'
                });
                throw err;
            }
        }

        async function waitForModalReadiness() {
            const modalMgr = DependencySystem.modules.get('modalManager');
            if (!modalMgr?.isReadyPromise) {
                throw new Error('[uiInit] ModalManager or isReadyPromise not available.');
            }
            const timeoutMS = 8000;
            let timedOut = false;
            await Promise.race([
                modalMgr.isReadyPromise(),
                new Promise((_, reject) =>
                    browserService.getWindow().setTimeout(() => {
                        timedOut = true;
                        reject(new Error(`[uiInit] Modal readiness timeout after ${timeoutMS}ms.`));
                    }, timeoutMS)
                )
            ]);
            if (timedOut) {
                throw new Error('[uiInit] ModalManager not ready within timeout.');
            }
        }

        async function waitForModalReadinessWithTimeout(timeout = 8000, context = 'waitForModalReadiness') {
            const modalMgr = DependencySystem.modules.get('modalManager');
            if (!modalMgr?.isReadyPromise) {
                throw new Error(`[${context}] ModalManager or isReadyPromise not available.`);
            }
            let timedOut = false;
            await Promise.race([
                modalMgr.isReadyPromise(),
                new Promise((_, reject) =>
                    browserService.getWindow().setTimeout(() => {
                        timedOut = true;
                        reject(new Error(`[${context}] Modal readiness timeout after ${timeout}ms`));
                    }, timeout)
                )
            ]);
            if (timedOut) {
                throw new Error(`[${context}] ModalManager not ready after ${timeout}ms`);
            }
            return true;
        }

        async function createAndRegisterUIComponents() {
            logger.log('[UIInit] Creating late-stage UI components', {
                context: 'uiInit:createAndRegisterUIComponents'
            });

            if (createProjectDetailsEnhancements) {
                const inst = createProjectDetailsEnhancements({
                    domAPI, browserService, eventHandlers,
                    domReadinessService, logger, sanitizer,
                    DependencySystem
                });
                DependencySystem.register('projectDetailsEnhancements', inst);
                if (inst.initialize) {
                    await inst.initialize().catch(err =>
                        logger.error('[UIInit] ProjectDetailsEnhancements init failed', err, {
                            context: 'uiInit:projectDetailsEnhancements'
                        })
                    );
                }
            }

            if (createTokenStatsManager) {
                const inst = createTokenStatsManager({
                    apiClient: DependencySystem.modules.get('apiRequest'),
                    domAPI, eventHandlers, browserService,
                    modalManager: DependencySystem.modules.get('modalManager'),
                    sanitizer, logger,
                    projectManager: DependencySystem.modules.get('projectManager'),
                    app: appModule, chatManager: DependencySystem.modules.get('chatManager'),
                    domReadinessService, DependencySystem
                });
                DependencySystem.register('tokenStatsManager', inst);
                if (typeof inst.initialize === 'function') {
                    await inst.initialize().catch(err =>
                        logger.error('[UIInit] TokenStatsManager init failed', err, {
                            context: 'uiInit:tokenStatsManager'
                        })
                    );
                }
            }

            const pdDashboard = DependencySystem.modules.get('projectDashboard');
            const pdc = DependencySystem.modules.get('projectDetailsComponent');
            const plc = DependencySystem.modules.get('projectListComponent');
            if (pdDashboard) {
                if (pdc && typeof pdDashboard.setProjectDetailsComponent === 'function') {
                    pdDashboard.setProjectDetailsComponent(pdc);
                }
                if (plc && typeof pdDashboard.setProjectListComponent === 'function') {
                    pdDashboard.setProjectListComponent(plc);
                }
            }
            logger.log('[UIInit] Late-stage UI components registered', {
                context: 'uiInit:createAndRegisterUIComponents'
            });
        }

        async function registerNavigationViews() {
            const navSvc = DependencySystem.modules.get('navigationService');
            if (!navSvc || typeof navSvc.registerView !== 'function') {
                throw new Error('[uiInit] NavigationService missing registerView');
            }
            try {
                if (!navSvc.hasView('projectList')) {
                    navSvc.registerView('projectList', {
                        show: async () => {
                            const dash = DependencySystem.modules.get('projectDashboard');
                            if (dash?.components?.projectList?.show) {
                                await dash.components.projectList.show();
                                return true;
                            }
                            const plc = DependencySystem.modules.get('projectListComponent');
                            if (plc?.show) {
                                await plc.show();
                                return true;
                            }
                            throw new Error('[uiInit] Cannot show projectList');
                        },
                        hide: async () => {
                            const dash = DependencySystem.modules.get('projectDashboard');
                            if (dash?.components?.projectList?.hide) {
                                await dash.components.projectList.hide();
                                return true;
                            }
                            const plc = DependencySystem.modules.get('projectListComponent');
                            if (plc?.hide) {
                                await plc.hide();
                                return true;
                            }
                            throw new Error('[uiInit] Cannot hide projectList');
                        }
                    });
                }
                if (!navSvc.hasView('projectDetails')) {
                    navSvc.registerView('projectDetails', {
                        show: async ({ projectId }) => {
                            await domReadinessService.dependenciesAndElements({
                                deps: ['projectDashboard', 'projectDetailsComponent'],
                                timeout: 10000,
                                context: 'uiInit:nav:projectDetails'
                            });
                            const dash = DependencySystem.modules.get('projectDashboard');
                            if (dash?.showProjectDetails) {
                                await dash.showProjectDetails(projectId);
                                return true;
                            }
                            const pdc = DependencySystem.modules.get('projectDetailsComponent');
                            if (pdc?.showProjectDetails) {
                                await pdc.showProjectDetails(projectId);
                                return true;
                            }
                            throw new Error('[uiInit] Cannot show projectDetails');
                        },
                        hide: async () => {
                            const dash = DependencySystem.modules.get('projectDashboard');
                            if (dash?.components?.projectDetails?.hideProjectDetails) {
                                await dash.components.projectDetails.hideProjectDetails();
                                return true;
                            }
                            const pdc = DependencySystem.modules.get('projectDetailsComponent');
                            if (pdc?.hideProjectDetails) {
                                await pdc.hideProjectDetails();
                                return true;
                            }
                            throw new Error('[uiInit] Cannot hide projectDetails');
                        }
                    });
                }
                logger.log('[UIInit] Navigation views registered', { context: 'uiInit:navigation' });
            } catch (err) {
                logger.error('[uiInit] Failed to register navigation views', err, {
                    context: 'uiInit:registerNavigationViews'
                });
            }
        }

        async function initializeUIComponents() {
            if (_uiInitialized) {
                logger.debug('[uiInit] UI already initialized; skipping', {
                    context: 'uiInit:initializeUIComponents'
                });
                return;
            }
            try {
                logger.log('[uiInit] Starting UI initialization...', { context: 'uiInit' });
                await domReadinessService.dependenciesAndElements({
                    domSelectors: ['#projectListView', '#projectDetailsView'],
                    timeout: 10000,
                    context: 'uiInit:initializeUIComponents:baseDomCheck'
                });
                await setupSidebarControls();
                await loadProjectTemplates();
                await waitForModalReadiness();
                await createAndRegisterUIComponents();
                await registerNavigationViews();
                logger.log('[uiInit] UI initialization complete', {
                    context: 'uiInit:initializeUIComponents'
                });
                _uiInitialized = true;
            } catch (err) {
                logger.error('[uiInit] Critical error in UI init', err, {
                    context: 'uiInit:initializeUIComponents'
                });
                throw err;
            }
        }

        function cleanup() {
            eventHandlers.cleanupListeners({ context: 'uiInit' });
            logger.debug('[uiInit] Cleanup completed', { context: 'uiInit:cleanup' });
        }

        return {
            initializeUIComponents,
            waitForModalReadinessWithTimeout,
            registerNavigationViews,
            cleanup
        };
    })();



    // ──────────────────────────────────────────────
    // 9. Orchestrator: initializeApp & cleanup
    // ──────────────────────────────────────────────
    async function initializeApp() {
        logger.info('[appInitializer] Boot sequence start');
        appModule.setAppLifecycleState({
            initializing: true,
            currentPhase: 'starting_init_process'
        });

        // 1. Services
        serviceInit.registerBasicServices();
        serviceInit.registerAdvancedServices();

        // 2. Errors
        errorInit.initializeErrorHandling();

        // 3. Core
        await coreInit.initializeCoreSystems();

        // 4. Auth
        await authInit.initializeAuthSystem();

        // 5. UI
        await uiInit.initializeUIComponents();

        // 6. Finalize
        appModule.setAppLifecycleState({
            initializing: false,
            initialized: true,
            currentPhase: 'initialized_idle',
            isReady: true
        });
        eventHandlers.dispatch('app:ready');
        logger.info('[appInitializer] Boot sequence complete – app is READY');
    }

    async function cleanup() {
        logger.info('[appInitializer] Shutdown start');
        await uiInit.cleanup();
        await authInit.cleanup();
        await coreInit.cleanup();
        await serviceInit.cleanup();
        await errorInit.cleanup();
        appModule.cleanup();
        eventHandlers.cleanupListeners({ context: 'appInitializer' });
        logger.info('[appInitializer] Shutdown complete');
    }

    // ──────────────────────────────────────────────
    // 10. Public API
    // ──────────────────────────────────────────────
    return {
        initializeApp,
        cleanup,
        // expose sub-APIs if external code still references them
        appModule,
        serviceInit,
        errorInit,
        coreInit,
        authInit,
        uiInit
    };
}
