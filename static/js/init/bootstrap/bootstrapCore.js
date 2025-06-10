/**
 * Bootstrap Core Module
 * Initializes core infrastructure services that other modules depend on
 */

export function createBootstrapCore(opts) {
    const { DependencySystem, browserService, APP_CONFIG } = opts;
    
    if (!DependencySystem || !browserService || !APP_CONFIG) {
        throw new Error('[bootstrapCore] Missing required dependencies');
    }

    function initializeCoreServices() {
        // Initialize core services that all other modules depend on
        
        // Create logger (should already exist but ensure it's registered)
        if (!DependencySystem.modules.has('logger')) {
            const { createLogger } = opts;
            if (createLogger) {
                const logger = createLogger();
                DependencySystem.register('logger', logger);
            }
        }

        // Create event service
        if (!DependencySystem.modules.has('eventService')) {
            const { createEventService } = opts;
            if (createEventService) {
                const eventService = createEventService();
                DependencySystem.register('eventService', eventService);
            }
        }

        // Create DOM API
        if (!DependencySystem.modules.has('domAPI')) {
            const { createDomAPI } = opts;
            if (createDomAPI) {
                const domAPI = createDomAPI({ browserService });
                DependencySystem.register('domAPI', domAPI);
            }
        }

        // Create DOM readiness service
        if (!DependencySystem.modules.has('domReadinessService')) {
            const { createDomReadinessService } = opts;
            if (createDomReadinessService) {
                const domReadinessService = createDomReadinessService({
                    DependencySystem,
                    browserService
                });
                DependencySystem.register('domReadinessService', domReadinessService);
            }
        }

        // Create event handlers
        if (!DependencySystem.modules.has('eventHandlers')) {
            const { createEventHandler } = opts;
            if (createEventHandler) {
                const logger = DependencySystem.modules.get('logger');
                const eventHandlers = createEventHandler({ logger });
                DependencySystem.register('eventHandlers', eventHandlers);
            }
        }

        // Create global utils
        if (!DependencySystem.modules.has('globalUtils')) {
            const { createGlobalUtils } = opts;
            if (createGlobalUtils) {
                const globalUtils = createGlobalUtils({ browserService });
                DependencySystem.register('globalUtils', globalUtils);
            }
        }

        // Return core services for immediate use
        return {
            logger: DependencySystem.modules.get('logger'),
            eventService: DependencySystem.modules.get('eventService'),
            domAPI: DependencySystem.modules.get('domAPI'),
            domReadinessService: DependencySystem.modules.get('domReadinessService'),
            eventHandlers: DependencySystem.modules.get('eventHandlers'),
            globalUtils: DependencySystem.modules.get('globalUtils')
        };
    }

    return {
        initializeCoreServices
    };
}