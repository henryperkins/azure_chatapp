// ========================================
// FILE: /initialization/bootstrap/bootstrapCore.js
// ========================================
/**
 * Core Bootstrap Logic
 * Handles circular dependency resolution and early service setup
 * Extracted from initialDISetup()
 */

import { createLogDeliveryService } from "../../logDeliveryService.js";
import { createDomAPI } from "../../utils/domAPI.js";
import { createEventHandlers } from "../../eventHandler.js";
import { createSafeHandler } from "../../safeHandler.js";
import { createDomReadinessService } from "../../utils/domReadinessService.js";
import { createLogger } from "../../logger.js";
import { createCustomEventPolyfill } from "../../utils/polyfillCustomEvent.js";
import { createEventService } from "../../../services/eventService.js";
import { createUIStateService } from "../../uiStateService.js";
import { setBrowserService as registerSessionBrowserService, getSessionId as coreGetSessionId } from "../../utils/session.js";

export function createBootstrapCore(opts) {
    const { DependencySystem, browserService, APP_CONFIG } = opts;

    /**
     * Bootstrap core services with circular dependency resolution
     */
    function initializeCoreServices() {
        // 1. Attach browserService to session for backward-compatibility
        registerSessionBrowserService(browserService);

        // 2. Ensure DOMPurify (sanitizer) is available
        const sanitizer = browserService?.getWindow?.()?.DOMPurify;
        if (!sanitizer) {
            throw new Error('[appInitializer] DOMPurify not found — cannot proceed (security requirement).');
        }

        // 3. Create domAPI BEFORE logger/eventHandlers
        const domAPI = createDomAPI({
            documentObject: browserService.getDocument(),
            windowObject: browserService.getWindow(),
            debug: APP_CONFIG?.DEBUG === true,
            sanitizer
        });

        // 4. Bootstrap logger with stub pattern for circular dependency

        // Bootstrap minimal safeHandler stub for pre-logger DI
        function stubSafeHandler(fn, _description) {
            if (typeof fn !== 'function') return () => {};
            return function (...args) {
                try { return fn.apply(this, args); } catch { /* intentionally ignored */ }
            };
        }

        let logger;

        // Create eventHandlers with stub logger
        const eventHandlers = createEventHandlers({
            DependencySystem,
            domAPI,
            browserService,
            APP_CONFIG,
            safeHandler: stubSafeHandler,
            sanitizer,
            errorReporter: {
                report: (...args) => logger ? logger.error('[errorReporter]', ...args) : undefined
            },
            logger: {
                debug: () => {},
                info: () => {},
                warn: () => {},
                error: () => {},
                log: () => {}
            }
        });

        // Create real logger
        logger = createLogger({
            context: 'App',
            debug: APP_CONFIG?.DEBUG === true,
            minLevel: APP_CONFIG?.LOGGING?.MIN_LEVEL || 'info',
            consoleEnabled: APP_CONFIG?.LOGGING?.CONSOLE_ENABLED !== false,
            sessionIdProvider: coreGetSessionId,
            domAPI,
            browserService,
            eventHandlers
        });

        // Create custom event polyfill
        const { cleanup: customEventPolyfillCleanup } = createCustomEventPolyfill({
            browserService,
            logger
        });
        DependencySystem.register('customEventPolyfill', {
            cleanup: customEventPolyfillCleanup
        });

        // Wire logger into eventHandlers
        if (typeof eventHandlers.setLogger === 'function') {
            eventHandlers.setLogger(logger);
        }

        // Create error reporter
        const errorReporter = {
            report(error, ctx = {}) {
                if (logger) {
                    logger.error('[errorReporter] reported', error, { context: 'errorReporter', ...ctx });
                } else if (typeof console !== 'undefined') {
                    console.error('[errorReporter] reported', error, ctx);
                }
            }
        };

        // Wire logger into domAPI
        if (typeof domAPI.setLogger === 'function') {
            domAPI.setLogger(logger);
        }

        // Create real safeHandler with logger
        const { safeHandler } = createSafeHandler({ logger });

        // Upgrade eventHandlers with real safeHandler
        if (typeof eventHandlers.setSafeHandler === 'function') {
            eventHandlers.setSafeHandler(safeHandler);
        }

        // Register core objects into DependencySystem
        DependencySystem.register('browserService', browserService);
        DependencySystem.register('logger', logger);
        DependencySystem.register('sanitizer', sanitizer);
        DependencySystem.register('domPurify', sanitizer); // legacy alias
        DependencySystem.register('safeHandler', safeHandler);
        DependencySystem.register('createChatManager', opts.createChatManager);
        DependencySystem.register('domAPI', domAPI);
        DependencySystem.register('eventHandlers', eventHandlers);
        DependencySystem.register('errorReporter', errorReporter);

        // Setup domReadinessService
        const domReadinessService = createDomReadinessService({
            DependencySystem,
            domAPI,
            browserService,
            eventHandlers,
            APP_CONFIG,
            logger
        });
        DependencySystem.register('domReadinessService', domReadinessService);
        eventHandlers.setDomReadinessService(domReadinessService);

        // Create event bus and services
        const AppBus = new EventTarget();
        DependencySystem.register('AppBus', AppBus);

        const eventService = createEventService({
            DependencySystem,
            logger,
            eventHandlers,
            existingBus: AppBus
        });
        DependencySystem.register('eventService', eventService);

        // Legacy aliases
        if (!DependencySystem.modules.get('eventBus')) {
            DependencySystem.register('eventBus', AppBus);
        }
        if (!DependencySystem.modules.get('AuthBus')) {
            DependencySystem.register('AuthBus', AppBus);
        }

        // UI utilities
        const uiUtils = {
            formatBytes: opts.globalFormatBytes,
            formatDate: opts.globalFormatDate,
            fileIcon: opts.globalFileIcon
        };

        const globalUtils = {
            shouldSkipDedup: opts.shouldSkipDedup,
            stableStringify: opts.stableStringify,
            normaliseUrl: browserService.normaliseUrl || null,
            isAbsoluteUrl: opts.isAbsoluteUrl,
            isValidProjectId: opts.isValidProjectId
        };

        // Register token stats proxy
        const { createTokenStatsManagerProxy } = await import("../../tokenStatsManagerProxy.js");
        const tokenStatsProxy = createTokenStatsManagerProxy({ DependencySystem, logger });
        DependencySystem.register('tokenStatsManagerProxy', tokenStatsProxy);

        // UI State Service
        const uiStateService = createUIStateService({ logger });
        DependencySystem.register('uiStateService', uiStateService);

        // Register auth component factories
        const { createAuthFormHandler } = await import("../../authFormHandler.js");
        const { createAuthApiService } = await import("../../authApiService.js");
        const { createAuthStateManager } = await import("../../authStateManager.js");

        const authFormHandler = createAuthFormHandler({
            domAPI, sanitizer, eventHandlers, logger, safeHandler
        });
        DependencySystem.register('authFormHandler', authFormHandler);

        const authApiService = createAuthApiService({
            apiClient: null, // will be set later
            apiEndpoints: opts.apiEndpoints,
            logger,
            browserService
        });
        DependencySystem.register('authApiService', authApiService);

        const authStateManager = createAuthStateManager({
            eventService, logger, browserService,
            storageService: null // will be set later
        });
        DependencySystem.register('authStateManager', authStateManager);

        // Return all created services
        return {
            logger,
            eventHandlers,
            domAPI,
            safeHandler,
            sanitizer,
            domReadinessService,
            uiUtils,
            globalUtils,
            getSessionId: coreGetSessionId,
            eventService,
            errorReporter
        };
    }

    /**
     * Register factory functions in DI container
     */
    function registerFactories() {
        const factoriesToRegister = [
            'KBManagerFactory',
            'KBSearchHandlerFactory',
            'PollingServiceFactory',
            'chatUIEnhancementsFactory',
            // Phase-2 factories
            'createChatUIController',
            'createConversationManager',
            'createMessageHandler',
            'createProjectDetailsRenderer',
            'createProjectDataCoordinator',
            'createProjectEventHandlers'
        ];

        // Import and register KB factories
        import("../../knowledgeBaseManager.js").then(m => {
            if (!DependencySystem.modules.get('KBManagerFactory')) {
                DependencySystem.register('KBManagerFactory', m.createKnowledgeBaseManager);
            }
        });

        import("../../knowledgeBaseSearchHandler.js").then(m => {
            if (!DependencySystem.modules.get('KBSearchHandlerFactory')) {
                DependencySystem.register('KBSearchHandlerFactory', m.createKnowledgeBaseSearchHandler);
            }
        });

        import("../../pollingService.js").then(m => {
            if (!DependencySystem.modules.get('PollingServiceFactory')) {
                DependencySystem.register('PollingServiceFactory', m.createPollingService);
            }
        });

        import("../../chatUIEnhancements.js").then(m => {
            if (!DependencySystem.modules.get('chatUIEnhancementsFactory')) {
                DependencySystem.register('chatUIEnhancementsFactory', m.createChatUIEnhancements);
            }
        });
    }

    return {
        initializeCoreServices,
        registerFactories
    };
}
