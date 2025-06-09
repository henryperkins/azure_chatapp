// ========================================
// FILE: /initialization/phases/errorInit.js
// ========================================
/**
 * Error Handling Initialization
 * Sets up global error handlers and unhandled rejection handlers
 * ~80 lines
 */

export function createErrorInit(deps) {
    const { DependencySystem, browserService, eventHandlers, logger, safeHandler } = deps;

    if (!DependencySystem || !browserService || !eventHandlers || !logger || !safeHandler) {
        throw new Error('[errorInit] Missing required dependencies for error handling initialization.');
    }

    function setupGlobalErrorHandling() {
        try {
            const windowObj = browserService.getWindow();
            if (!windowObj) {
                throw new Error('[errorInit] browserService.getWindow() returned null/undefined.');
            }

            // Global error handler
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

            // Unhandled promise rejection handler
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
            // Add any application-specific error handlers here

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
}
