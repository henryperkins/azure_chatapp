/**
 * errorInit.js
 * Factory for global error handling setup.
 * 
 * Handles global error and unhandled promise rejection setup for the application.
 * Sets up centralized error logging through the DI system.
 *
 * Guardrails:
 * - Factory export (createErrorInitializer)
 * - Strict DI: Accept all dependencies as factory arguments
 * - No import-time side effects
 * - All logging via injected logger
 */

export function createErrorInitializer({
  DependencySystem,
  browserService,
  eventHandlers,
  logger,
  safeHandler
}) {
  if (
    !DependencySystem || !browserService || !eventHandlers || !logger || !safeHandler
  ) {
    throw new Error('[errorInit] Missing required dependencies for error handling initialization.');
  }

  /**
   * Setup global error handling for the application
   */
  function setupGlobalErrorHandling() {
    try {
      const window = browserService.getWindow();
      if (!window) {
        logger.warn('[errorInit] Window object not available, skipping error handler setup', { context: 'errorInit:setupGlobalErrorHandling' });
        return;
      }

      // Centralised global-error listener via DI event system
      eventHandlers.trackListener(
        window,
        'error',
        (evt) => {
          const {
            message,
            filename: source,
            lineno,
            colno,
            error
          } = evt;
          const log = DependencySystem?.modules?.get?.('logger');
          log?.error?.(
            '[window.error]',
            { message, source, lineno, colno, err: error?.stack || error },
            { context: 'global.error' }
          );
        },
        { context: 'errorInit', description: 'window error handler', passive: true }
      );

      // Track unhandled promise rejections
      eventHandlers.trackListener(
        window,
        'unhandledrejection',
        safeHandler(function (event) {
          logger.error('[unhandledrejection]', event?.reason, { context: 'global.unhandledrejection' });
          // Note: We don't prevent default to allow browser handling
        }, 'global unhandledrejection'),
        { context: 'errorInit' }
      );

      logger.log('[errorInit] Global error handling setup completed', { context: 'errorInit:setupGlobalErrorHandling' });
    } catch (err) {
      logger.error('[errorInit] Failed to setup global error handling', err, { context: 'errorInit:setupGlobalErrorHandling' });
      throw err;
    }
  }

  /**
   * Setup specific error handlers for different error types
   */
  function setupSpecificErrorHandlers() {
    try {
      const window = browserService.getWindow();
      if (!window) {
        return;
      }

      // Setup additional error handling for specific scenarios if needed
      // This is where we can add more specific error handling in the future

      logger.log('[errorInit] Specific error handlers setup completed', { context: 'errorInit:setupSpecificErrorHandlers' });
    } catch (err) {
      logger.error('[errorInit] Failed to setup specific error handlers', err, { context: 'errorInit:setupSpecificErrorHandlers' });
      throw err;
    }
  }

  /**
   * Initialize all error handling systems
   */
  function initializeErrorHandling() {
    try {
      logger.log('[errorInit] Starting error handling initialization', { context: 'errorInit:initializeErrorHandling' });

      setupGlobalErrorHandling();
      setupSpecificErrorHandlers();

      logger.log('[errorInit] Error handling initialization completed', { context: 'errorInit:initializeErrorHandling' });
    } catch (err) {
      logger.error('[errorInit] Error handling initialization failed', err, { context: 'errorInit:initializeErrorHandling' });
      throw err;
    }
  }

  return {
    setupGlobalErrorHandling,
    setupSpecificErrorHandlers,
    initializeErrorHandling,
    cleanup() {
      // Cleanup error handling event listeners
      eventHandlers.cleanupListeners({ context: 'errorInit' });
      logger.debug('[errorInit] Cleanup completed', { context: 'errorInit:cleanup' });
    }
  };
}
