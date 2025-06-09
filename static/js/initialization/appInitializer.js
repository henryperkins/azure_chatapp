// ========================================
// FILE: /initialization/appInitializer.js (REFACTORED)
// ========================================
/**
 * Main Application Initializer - Refactored Version
 * Target: <200 lines of pure orchestration
 */

// Import external dependencies (already extracted)
import { createLogDeliveryService } from "../logDeliveryService.js";
import { createDomAPI } from "../utils/domAPI.js";
import { createEventHandlers } from "../eventHandler.js";
import { createSafeHandler } from "../safeHandler.js";
import { createDomReadinessService } from "../utils/domReadinessService.js";
import { createLogger } from "../logger.js";
import { createCustomEventPolyfill } from "../utils/polyfillCustomEvent.js";
import { createKnowledgeBaseReadinessService } from "../knowledgeBaseReadinessService.js";
// ... all other external imports ...

// Import extracted initialization modules
import { createAppState } from "./state/appState.js";
import { createErrorInit } from "./phases/errorInit.js";
import { createServiceInit } from "./phases/serviceInit.js";
import { createAuthInit } from "./phases/authInit.js";
import { createCoreInit } from "./phases/coreInit.js";
import { createUIInit } from "./phases/uiInit.js";
import { createBootstrapCore } from "./bootstrap/bootstrapCore.js";

export function createAppInitializer(opts = {}) {
    // Validate required dependencies
    const required = [
        'DependencySystem', 'browserService', 'APP_CONFIG',
        'createApiEndpoints', 'MODAL_MAPPINGS', 'createChatManager'
        // ... list all required factory functions
    ];

    for (const key of required) {
        if (!opts[key]) {
            throw new Error(`[appInitializer] Missing required dependency: ${key}`);
        }
    }

    // Extract commonly used options
    const { DependencySystem, browserService, APP_CONFIG } = opts;

    // Phase 1: Bootstrap core infrastructure
    const bootstrap = createBootstrapCore(opts);
    const coreServices = bootstrap.initializeCoreServices();

    // Merge core services back into opts for downstream usage
    Object.assign(opts, coreServices);

    // Phase 2: Create application state
    const appModule = createAppState({
        DependencySystem,
        logger: coreServices.logger,
        eventService: coreServices.eventService,
        globalUtils: coreServices.globalUtils
    });
    DependencySystem.register('appModule', appModule);
    DependencySystem.register('app', appModule); // Legacy alias

    // Phase 3: Create initialization modules
    const serviceInit = createServiceInit(opts);
    const errorInit = createErrorInit(opts);
    const coreInit = createCoreInit(opts);
    const authInit = createAuthInit(opts);
    const uiInit = createUIInit(opts);

    // Main initialization orchestrator
    async function initializeApp() {
        const { logger, eventHandlers } = coreServices;

        logger.info('[appInitializer] Boot sequence start');
        appModule.setAppLifecycleState({
            initializing: true,
            currentPhase: 'starting_init_process'
        });

        // Unified phase runner for structured logging & error handling
        const phaseRunner = async (name, fn) => {
            const start = performance.now();
            logger.info(`[appInitializer] ▶ Phase start: ${name}`);
            try {
                const result = await fn();
                const duration = performance.now() - start;
                logger.info(`[appInitializer] ✔ Phase complete: ${name} (${duration.toFixed(0)} ms)`);
                return result;
            } catch (err) {
                const duration = performance.now() - start;
                logger.error(`[appInitializer] ✖ Phase failed: ${name} after ${duration.toFixed(0)} ms`, err, {
                    context: `appInitializer:${name}`
                });

                appModule.setAppLifecycleState({
                    initializing: false,
                    initialized: false,
                    currentPhase: 'failed_idle',
                    isReady: false
                });
                eventHandlers.dispatch('app:failed');
                throw err;
            }
        };

        // Execute phases sequentially
        await phaseRunner('services:basic', () => serviceInit.registerBasicServices());
        await phaseRunner('services:advanced', () => serviceInit.registerAdvancedServices());
        await phaseRunner('errors', () => errorInit.initializeErrorHandling());
        await phaseRunner('core', () => coreInit.initializeCoreSystems());
        await phaseRunner('auth', () => authInit.initializeAuthSystem());
        await phaseRunner('ui', () => uiInit.initializeUIComponents());

        // Mark initialization complete
        appModule.setAppLifecycleState({
            initializing: false,
            initialized: true,
            currentPhase: 'initialized_idle',
            isReady: true
        });

        // Emit app ready event
        if (!appModule.state.isReady) {
            coreServices.domReadinessService.emitReplayable('app:ready');
        }

        logger.info('[appInitializer] Boot sequence complete – app is READY');

        // Hide loading overlay
        try {
            const loadingEl = coreServices.domAPI.querySelector('#appLoading');
            if (loadingEl) {
                coreServices.domAPI.setStyle(loadingEl, 'opacity', '0');
                browserService.setTimeout(() => {
                    coreServices.domAPI.setStyle(loadingEl, 'display', 'none');
                }, 300);
            }
        } catch (err) {
            logger.warn('[appInitializer] Failed to hide loading overlay', err);
        }
    }

    // Cleanup orchestrator
    async function cleanup() {
        const { logger } = coreServices;

        logger.info('[appInitializer] Shutdown start');
        await uiInit.cleanup();
        await authInit.cleanup();
        await coreInit.cleanup();
        await serviceInit.cleanup();
        await errorInit.cleanup();
        appModule.cleanup();
        coreServices.eventHandlers.cleanupListeners({ context: 'appInitializer' });
        logger.info('[appInitializer] Shutdown complete');
    }

    // Public API
    return {
        initializeApp,
        cleanup,
        // Expose sub-APIs for backward compatibility
        appModule,
        serviceInit,
        errorInit,
        coreInit,
        authInit,
        uiInit
    };
}
