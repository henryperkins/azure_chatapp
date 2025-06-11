// ========================================
// FILE: /initialization/phases/serviceInit.js
// ========================================
/**
 * Service Registration and Initialization
 * Registers basic and advanced services in the DI container
 * ~150 lines
 */

import { createAuth } from "../../auth.js";
import { createApiClient } from "../../utils/apiClient.js";

// Standalone service imports
import { createThemeManager } from "../../theme-toggle.js";
import { createKnowledgeBaseReadinessService } from "../../knowledgeBaseReadinessService.js";
import { createKbResultHandlers } from "../../kb-result-handlers.js";
import { createAuthenticationService } from "../../../services/authenticationService.js";

export function createServiceInit(deps) {
    
    const {
        DependencySystem, domAPI, browserService, eventHandlers,
        domReadinessService, sanitizer, APP_CONFIG, getSessionId,
        uiUtils, globalUtils, createFileUploadComponent,
        createApiEndpoints, createAccessibilityEnhancements,
        createNavigationService, createHtmlTemplateLoader, createUiRenderer,
        createLogDeliveryService,
        createModalConstants,
        createSelectorConstants,
        errorReporter
    } = deps;
    
    // Use imported createApiClient since it's not being passed correctly in dependencies
    
    let { logger } = deps;

    if (!DependencySystem || !domAPI || !browserService || !eventHandlers ||
        !domReadinessService || !sanitizer || !APP_CONFIG || !getSessionId || !logger || !errorReporter) {
        throw new Error('[serviceInit] Missing required dependencies for service initialization.');
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

        // Register the injected errorReporter (no runtime lookup needed)
        safeRegister('errorReporter', errorReporter);

        if (uiUtils) safeRegister('uiUtils', uiUtils);
        if (globalUtils) safeRegister('globalUtils', globalUtils);
        safeRegister('sanitizer', sanitizer);
        safeRegister('domPurify', sanitizer);

        // Modal / Selector constants registration (if factories provided)
        if (typeof createModalConstants === 'function') {
            try {
                const modalConst = createModalConstants();
                if (modalConst?.MODAL_MAPPINGS) {
                    safeRegister('modalConstants', modalConst.MODAL_MAPPINGS);
                    safeRegister('MODAL_MAPPINGS', modalConst.MODAL_MAPPINGS); // legacy alias / convenience
                } else {
                    safeRegister('modalConstants', modalConst);
                }
            } catch (err) {
                logger.error('[serviceInit] Failed to create modalConstants', err, { context: 'serviceInit:modalConstants' });
            }
        }

        if (typeof createSelectorConstants === 'function') {
            try {
                const selConst = createSelectorConstants();
                if (selConst?.SELECTORS) {
                    safeRegister('selectorConstants', selConst.SELECTORS);
                    safeRegister('ELEMENT_SELECTORS', selConst.ELEMENT_SELECTORS || selConst.SELECTORS);
                } else {
                    safeRegister('selectorConstants', selConst);
                }
            } catch (err) {
                logger.error('[serviceInit] Failed to create selectorConstants', err, { context: 'serviceInit:selectorConstants' });
            }
        }

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
        
        try {
            const apiEndpointsInstance = createApiEndpoints({ logger, DependencySystem, config: APP_CONFIG });
            const resolvedEndpoints = apiEndpointsInstance.endpoints; // Get the endpoints from the factory result
            safeRegister('apiEndpoints', resolvedEndpoints);
            
            logger.debug('[serviceInit] API endpoints created and registered.', {
                endpointCount: Object.keys(resolvedEndpoints).length,
                hasAuthEndpoints: !!(resolvedEndpoints.AUTH_LOGIN && resolvedEndpoints.AUTH_CSRF),
                context: 'serviceInit:registerBasicServices'
            });
        } catch (err) {
            logger.error('[serviceInit] Failed to create API endpoints', err, {
                context: 'serviceInit:registerBasicServices'
            });
            throw err;
        }

        logger.info('[serviceInit] Basic services registration completed.', {
            context: 'serviceInit:registerBasicServices'
        });
    }

    async function registerAdvancedServices() {
        logger.info('[serviceInit] Starting registration of advanced services...', {
            context: 'serviceInit:registerAdvancedServices'
        });

        // ------------------------------------------------------------------
        // Register AuthenticationService façade (requires appModule)
        // ------------------------------------------------------------------

        const existingAuthSvc = DependencySystem.modules.get('authenticationService');
        const appModuleInst   = DependencySystem.modules.get('appModule');

        if (!existingAuthSvc && appModuleInst) {
            try {
                const authSvc = createAuthenticationService({
                    DependencySystem,
                    logger,
                    appModule: appModuleInst
                });
                DependencySystem.register('authenticationService', authSvc);
                // Expose on opts (outer scope) so that later phases receive it
                deps.authenticationService = authSvc;
                logger.debug('[serviceInit] authenticationService registered.', {
                    context: 'serviceInit:registerAdvancedServices'
                });
            } catch (err) {
                logger.error('[serviceInit] Failed to register authenticationService', err, {
                    context: 'serviceInit:registerAdvancedServices'
                });
            }
        }

        // API Client creation and registration
        let apiClientInstance = null;
        
        if (createApiClient && globalUtils) {
            logger.info('[serviceInit] Creating API client...', {
                context: 'serviceInit:registerAdvancedServices'
            });

            try {
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

                logger.info('[serviceInit] API client created and registered.', {
                    context: 'serviceInit:registerAdvancedServices'
                });
            } catch (error) {
                logger.error('[serviceInit] Failed to create API client', error, {
                    context: 'serviceInit:registerAdvancedServices'
                });
            }
        } else {
            logger.error('[serviceInit] Cannot create API client - missing dependencies', {
                context: 'serviceInit:registerAdvancedServices',
                createApiClient: !!createApiClient,
                globalUtils: !!globalUtils
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

        // --------------------------------------------------------------
        // Client Log Delivery Service – send console logs to backend
        // --------------------------------------------------------------
        if (createLogDeliveryService && apiClientInstance) {
            try {
                const logDeliveryServiceInstance = createLogDeliveryService({
                    apiClient: apiClientInstance,
                    browserService,
                    eventHandlers,
                    enabled: true // Start immediately; respects internal batching
                });

                if (typeof logDeliveryServiceInstance.start === 'function') {
                    logDeliveryServiceInstance.start();
                }

                safeRegister('logDeliveryService', logDeliveryServiceInstance);

                logger.debug('[serviceInit] LogDeliveryService registered and started.', {
                    context: 'serviceInit:registerAdvancedServices'
                });
            } catch (err) {
                logger.error('[serviceInit] Failed to initialize LogDeliveryService', err, {
                    context: 'serviceInit:registerAdvancedServices'
                });
            }
        }

        // --------------------------------------------------------------
        // Auth Module – requires apiClient to be available
        // --------------------------------------------------------------
        if (apiClientInstance) {
            try {
                if (!DependencySystem.modules.get('auth')) {
                    logger.info('[serviceInit] Creating Auth module...', {
                        context: 'serviceInit:registerAdvancedServices'
                    });


                    const authModule = createAuth({
                        apiClient: apiClientInstance.fetch,
                        logger,
                        domReadinessService,
                        eventHandlers,
                        domAPI,
                        sanitizer,
                        apiEndpoints: DependencySystem.modules.get('apiEndpoints'),
                        safeHandler: DependencySystem.modules.get('safeHandler'),
                        browserService,
                        eventService: DependencySystem.modules.get('eventService'),
                        appModule: DependencySystem.modules.get('appModule'),
                        storageService: browserService, // browserService provides storage methods
                        modalManager: DependencySystem.modules.get('modalManager') || null, // Optional dependency
                        DependencySystem,
                        APP_CONFIG: deps.APP_CONFIG
                    });

                    safeRegister('auth', authModule);
                    
                    if (typeof authModule.init === 'function') {
                        await authModule.init();
                    }

                    logger.info('[serviceInit] Auth module created and registered successfully.', {
                        context: 'serviceInit:registerAdvancedServices'
                    });
                }
            } catch (err) {
                logger.error('[serviceInit] Failed to initialize Auth Module', err, {
                    context: 'serviceInit:registerAdvancedServices'
                });
                throw err;
            }
        }

        // --------------------------------------------------------------
        // Standalone Services
        // --------------------------------------------------------------
        
        // Theme Manager
        try {
            // ThemeManager factory expects a `dom` abstraction, but we expose our
            // canonical wrapper as `domAPI` throughout the DI chain. Pass it over
            // under the expected property name to satisfy the factory contract.
            const themeManager = createThemeManager({
                dom: domAPI,
                eventHandlers,
                logger
            });
            safeRegister('themeManager', themeManager);
            
            logger.debug('[serviceInit] ThemeManager registered.', {
                context: 'serviceInit:registerAdvancedServices'
            });
        } catch (err) {
            logger.error('[serviceInit] Failed to initialize ThemeManager', err, {
                context: 'serviceInit:registerAdvancedServices'
            });
        }

        // Knowledge Base Readiness Service
        if (apiClientInstance) {
            try {
                const kbReadinessService = createKnowledgeBaseReadinessService({
                    DependencySystem,
                    logger,
                    apiClient: apiClientInstance.fetch,
                    eventHandlers,
                    browserService
                });
                safeRegister('knowledgeBaseReadinessService', kbReadinessService);
                
                logger.debug('[serviceInit] KnowledgeBaseReadinessService registered.', {
                    context: 'serviceInit:registerAdvancedServices'
                });
            } catch (err) {
                logger.error('[serviceInit] Failed to initialize KnowledgeBaseReadinessService', err, {
                    context: 'serviceInit:registerAdvancedServices'
                });
            }
        }

        // KB Result Handlers
        try {
            const kbResultHandlers = createKbResultHandlers({
                DependencySystem,
                logger,
                domAPI,
                eventHandlers,
                sanitizer,
                browserService,
                safeHandler: DependencySystem.modules.get('safeHandler')
            });
            safeRegister('kbResultHandlers', kbResultHandlers);
            
            logger.debug('[serviceInit] KbResultHandlers registered.', {
                context: 'serviceInit:registerAdvancedServices'
            });
        } catch (err) {
            logger.error('[serviceInit] Failed to initialize KbResultHandlers', err, {
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
}
