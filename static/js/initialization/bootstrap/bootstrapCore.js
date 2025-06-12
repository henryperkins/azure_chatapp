// ========================================
// FILE: /initialization/bootstrap/bootstrapCore.js
// ========================================
/**
 * Core Bootstrap Logic
 * Handles circular dependency resolution and early service setup
 * Extracted from initialDISetup()
 */

import { createDomAPI } from "../../utils/domAPI.js";
import { createEventHandlers } from "../../eventHandler.js";
import { createSafeHandler } from "../../safeHandler.js";
import { createDomReadinessService } from "../../utils/domReadinessService.js";
import { createLogger } from "../../logger.js";
import { createCustomEventPolyfill } from "../../utils/polyfillCustomEvent.js";
import { createEventService } from "../../services/eventService.js";
import { createUIStateService } from "../../uiStateService.js";
import { setBrowserService as registerSessionBrowserService, getSessionId as coreGetSessionId } from "../../utils/session.js";

// Core utility imports
import { createStorageService } from "../../utils/storageService.js";
import { createFormattingUtils } from "../../formatting.js";
import { createPullToRefresh } from "../../utils/pullToRefresh.js";

// Statically import modules that were previously loaded with dynamic `import()`.
import { createTokenStatsManagerProxy } from "../../tokenStatsManagerProxy.js";
import { createAuthFormHandler } from "../../authFormHandler.js";
import { createAuthApiService } from "../../authApiService.js";
import { createAuthStateManager } from "../../authStateManager.js";

export function createBootstrapCore(opts) {
    const { DependencySystem, browserService, APP_CONFIG } = opts;

    /**
     * Bootstrap core services with circular dependency resolution
     */
    function initializeCoreServices() {
        // 1. Attach browserService to session for backward-compatibility
        registerSessionBrowserService(browserService);

        // 2. Ensure DOMPurify (sanitizer) is available.
        // If it does not exist yet, attempt to lazily create it using the
        // injected `createDOMPurifyGlobal` factory (added to opts by
        // app.js).  This preserves the original safety check while avoiding
        // a hard-failure during early bootstrap ordering.

        let sanitizer = browserService?.getWindow?.()?.DOMPurify;

        if (!sanitizer) {
            const { createDOMPurifyGlobal } = opts;
            if (typeof createDOMPurifyGlobal === 'function') {
                try {
                    createDOMPurifyGlobal({ browserService });
                    sanitizer = browserService?.getWindow?.()?.DOMPurify;
                } catch (err) {
                    // DOMPurify initialization failed - continue without it
                    logger?.warn?.('[bootstrapCore] DOMPurify initialization failed', err);
                }
            }
        }

        // --------------------------------------------------------------
        // If a sanitizer implementation (DOMPurify) is still missing we
        // degrade gracefully instead of aborting the whole boot sequence.
        // A *very* loud warning is still logged once the real logger is
        // available so security reviewers can catch this during QA.
        // --------------------------------------------------------------

        let sanitizerWasStubbed = false;

        if (!sanitizer) {
            // Provide a minimal stub that fulfils the interface expected by
            // downstream modules (only `sanitize` is absolutely required).
            sanitizer = {
                sanitize(dirty /*, opts */) {
                    // No-op – returns the input unmodified.
                    return dirty;
                },
            };
            sanitizerWasStubbed = true;

            // We cannot use `logger` yet – it will be created further below.
            if (typeof console !== 'undefined') {
                console.warn('[bootstrapCore] ⚠️  DOMPurify unavailable – proceeding with *UNSAFE* no-op sanitizer.');
            }
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

        // Late warning using the proper logger if we had to fall back to the
        // unsafe sanitizer stub above.
        if (sanitizerWasStubbed) {
            logger.critical('[bootstrapCore] DOMPurify missing – using *UNSAFE* no-op sanitizer. XSS protection is DISABLED!', {
                context: 'bootstrapCore:sanitizerFallback'
            });
        }

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
        const safeHandlerInstance = createSafeHandler({ logger });

        // Upgrade eventHandlers with real safeHandler
        if (typeof eventHandlers.setSafeHandler === 'function') {
            eventHandlers.setSafeHandler(safeHandlerInstance.safeHandler);
        }

        // Register core objects into DependencySystem
        DependencySystem.register('browserService', browserService);
        DependencySystem.register('logger', logger);
        DependencySystem.register('sanitizer', sanitizer);
        DependencySystem.register('domPurify', sanitizer); // legacy alias
        DependencySystem.register('safeHandler', safeHandlerInstance.safeHandler);
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
        // ------------------------------------------------------------------
        // Unified Event Bus
        // ------------------------------------------------------------------

        const _internalBus = new EventTarget();

        const eventService = createEventService({
            DependencySystem,
            logger,
            eventHandlers,
            existingBus: _internalBus
        });

        // Provide *deprecated* aliases that forward to the unified bus and
        // emit a one-time warning when accessed.  This prevents a split event
        // graph while nudging developers to migrate.

        function createDeprecatedBusProxy(name) {
            let warned = false;
            const warnOnce = () => {
                if (!warned) {
                    warned = true;
                    logger.warn(`[bootstrapCore] ${name} is deprecated – use eventService instead`, {
                        context: 'bootstrapCore:deprecatedBus'
                    });
                }
            };
            return new Proxy(_internalBus, {
                get(target, prop, receiver) {
                    if (typeof prop === 'string' && ['addEventListener','dispatchEvent','removeEventListener'].includes(prop)) {
                        warnOnce();
                    }
                    return Reflect.get(target, prop, receiver);
                }
            });
        }

        const deprecatedAppBus   = createDeprecatedBusProxy('AppBus');
        const deprecatedEventBus = createDeprecatedBusProxy('eventBus');
        const deprecatedAuthBus  = createDeprecatedBusProxy('AuthBus');

        DependencySystem.register('AppBus', deprecatedAppBus);
        DependencySystem.register('eventService', eventService);

        // Legacy aliases – forward to unified bus with deprecation warning
        if (!DependencySystem.modules.get('eventBus')) {
            DependencySystem.register('eventBus', deprecatedEventBus);
        }
        if (!DependencySystem.modules.get('AuthBus')) {
            DependencySystem.register('AuthBus', deprecatedAuthBus);
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
        const tokenStatsProxy = createTokenStatsManagerProxy({ DependencySystem, logger });
        DependencySystem.register('tokenStatsManagerProxy', tokenStatsProxy);
        // Alias: expose proxy under canonical name so downstream modules can
        // safely `modules.get('tokenStatsManager')` before the real manager is
        // ready.  uiInit later replaces this entry with the concrete
        // implementation.
        if (!DependencySystem.modules.get('tokenStatsManager')) {
            DependencySystem.register('tokenStatsManager', tokenStatsProxy);
        }

        // UI State Service
        const uiStateService = createUIStateService({ logger });
        DependencySystem.register('uiStateService', uiStateService);

        // Core utility services
        const storageService = createStorageService({
            browserService,
            logger
        });
        DependencySystem.register('storageService', storageService);

        const formattingUtils = createFormattingUtils({
            logger
        });
        DependencySystem.register('formattingUtils', formattingUtils);

        const pullToRefresh = createPullToRefresh({
            domAPI,
            eventHandlers,
            logger,
            browserService
        });
        DependencySystem.register('pullToRefresh', pullToRefresh);

        // Register auth component factories
        const authFormHandler = createAuthFormHandler({
            domAPI, sanitizer, eventHandlers, logger, safeHandler: safeHandlerInstance.safeHandler
        });
        DependencySystem.register('authFormHandler', authFormHandler);

        // AuthApiService will be registered later in serviceInit:registerAdvancedServices
        // where apiClient and apiEndpoints are available. No proxy needed.

        const authStateManager = createAuthStateManager({
            eventService,
            logger,
            browserService,
            storageService,
            DependencySystem
        });
        DependencySystem.register('authStateManager', authStateManager);

        // Return all created services
        // Start background factory registration (non-blocking)
        try {
            // Intentionally not awaited – side-effects only.
            registerFactories();
        } catch (err) {
            logger.warn('[bootstrapCore] registerFactories() failed', err, {
                context: 'bootstrapCore:registerFactories'
            });
        }

        return {
            logger,
            eventHandlers,
            domAPI,
            safeHandler: safeHandlerInstance.safeHandler,
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
            'KBRendererFactory',
            'KBAPIServiceFactory',
            'KBStateServiceFactory',
            'PollingServiceFactory',
            'chatUIEnhancementsFactory',
            // Phase-2 factories
            'createChatUIController',
            'createConversationManager',
            'createMessageHandler',
            'createProjectDetailsRenderer',
            'createProjectDataCoordinator',
            'createProjectEventHandlers'
            , 'createProjectListRenderer'
            , 'createProjectListComponent'
            , 'createProjectDashboard'
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

        import("../../knowledgeBaseRenderer.js").then(m => {
            if (!DependencySystem.modules.get('KBRendererFactory')) {
                DependencySystem.register('KBRendererFactory', m.createKnowledgeBaseRenderer);
            }
        });

        // KBAPIService and KBStateService will be registered in serviceInit:registerAdvancedServices
        // where dependencies are properly available without runtime lookups
        
        import("../../../services/knowledgeBaseAPIService.js").then(m => {
            if (!DependencySystem.modules.get('KBAPIServiceFactory')) {
                DependencySystem.register('KBAPIServiceFactory', m.createKnowledgeBaseAPIService || m.default);
            }
        });

        import("../../../services/knowledgeBaseStateService.js").then(m => {
            if (!DependencySystem.modules.get('KBStateServiceFactory')) {
                DependencySystem.register('KBStateServiceFactory', m.createKnowledgeBaseStateService || m.default);
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
