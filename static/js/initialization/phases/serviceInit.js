// ========================================
// FILE: /initialization/phases/serviceInit.js
// ========================================
/**
 * Service Registration and Initialization
 * Registers basic and advanced services in the DI container
 * ~150 lines
 */

export function createServiceInit(deps) {
    const {
        DependencySystem, domAPI, browserService, eventHandlers,
        domReadinessService, sanitizer, APP_CONFIG, getSessionId,
        uiUtils, globalUtils, createFileUploadComponent,
        createApiEndpoints, createApiClient, createAccessibilityEnhancements,
        createNavigationService, createHtmlTemplateLoader, createUiRenderer
    } = deps;

    let logger = DependencySystem?.modules?.get('logger');

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

        // No need to register tokenStatsManager placeholder here. bootstrapCore
        // already exposes tokenStatsManagerProxy under both
        // 'tokenStatsManagerProxy' *and* the canonical 'tokenStatsManager'
        // module names.

        // Register API endpoints
        if (typeof createApiEndpoints !== 'function') {
            throw new Error('[serviceInit] createApiEndpoints factory missing.');
        }
        const apiEndpointsInstance = createApiEndpoints({ logger, DependencySystem, config: APP_CONFIG });
        const resolvedEndpoints = apiEndpointsInstance; // Assuming createApiEndpoints returns the endpoints object directly
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

        // API Client creation and registration
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
                logger
            });

            // Register API client
            if (DependencySystem.modules.has('apiRequest')) {
                DependencySystem.modules.set('apiRequest', apiClientInstance.fetch);
            } else {
                safeRegister('apiRequest', apiClientInstance.fetch);
            }

            safeRegister('apiClient', apiClientInstance.fetch);
            safeRegister('apiClientObject', apiClientInstance);

            logger.debug('[serviceInit] API client created and registered.', {
                context: 'serviceInit:registerAdvancedServices'
            });
        }

        // Register other advanced services
        if (createAccessibilityEnhancements) {
            const accessibilityUtilsInstance = createAccessibilityEnhancements({
                domAPI,
                eventHandlers,
                logger,
                domReadinessService,
                DependencySystem,
                safeHandler: DependencySystem.modules.get('safeHandler'),
                htmlTemplateLoader: DependencySystem.modules.get('htmlTemplateLoader')
            });
            safeRegister('accessibilityUtils', accessibilityUtilsInstance);
        }

        if (createNavigationService) {
            const navInstance = createNavigationService({
                domAPI,
                browserService,
                DependencySystem,
                eventHandlers,
                logger
            });
            navInstance.init();
            safeRegister('navigationService', navInstance);
        }

        if (createHtmlTemplateLoader) {
            const htmlLoaderInstance = createHtmlTemplateLoader({
                DependencySystem,
                domAPI,
                sanitizer,
                eventHandlers,
                apiClient: apiClientInstance,
                timerAPI: browserService,
                domReadinessService,
                logger
            });
            safeRegister('htmlTemplateLoader', htmlLoaderInstance);
        }

        if (createUiRenderer && apiClientInstance) {
            const curEndpoints = DependencySystem.modules.get('apiEndpoints');
            if (curEndpoints) {
                const uiRendererInstance = createUiRenderer({
                    domAPI,
                    eventHandlers,
                    apiRequest: apiClientInstance.fetch,
                    apiEndpoints: curEndpoints,
                    domReadinessService,
                    logger,
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
            }
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
}
