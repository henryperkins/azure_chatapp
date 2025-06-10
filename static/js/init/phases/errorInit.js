/**
 * Error Initialization Module
 * Sets up error handling and reporting systems
 */

export function createErrorInit(opts) {
    const { DependencySystem, logger, browserService } = opts;
    
    if (!DependencySystem || !logger || !browserService) {
        throw new Error('[errorInit] Missing required dependencies');
    }

    async function initializeErrorHandling() {
        logger.info('[errorInit] Initializing error handling systems');

        // Set up global error handlers
        const handleUnhandledRejection = (event) => {
            logger.error('[errorInit] Unhandled Promise rejection', event.reason, {
                context: 'errorInit.unhandledRejection'
            });
        };

        const handleError = (event) => {
            logger.error('[errorInit] Unhandled JavaScript error', event.error, {
                context: 'errorInit.error',
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno
            });
        };

        // Register global error handlers
        browserService.addEventListener(browserService.getWindow(), 'unhandledrejection', handleUnhandledRejection);
        browserService.addEventListener(browserService.getWindow(), 'error', handleError);

        // Store handlers for cleanup
        if (!DependencySystem.modules.has('errorHandlers')) {
            DependencySystem.register('errorHandlers', {
                handleUnhandledRejection,
                handleError,
                cleanup() {
                    browserService.removeEventListener(browserService.getWindow(), 'unhandledrejection', handleUnhandledRejection);
                    browserService.removeEventListener(browserService.getWindow(), 'error', handleError);
                }
            });
        }

        logger.info('[errorInit] Error handling initialized');
    }

    async function cleanup() {
        const errorHandlers = DependencySystem.modules.get('errorHandlers');
        if (errorHandlers) {
            errorHandlers.cleanup();
            DependencySystem.unregister('errorHandlers');
        }
        logger.info('[errorInit] Error handling cleaned up');
    }

    return {
        initializeErrorHandling,
        cleanup
    };
}