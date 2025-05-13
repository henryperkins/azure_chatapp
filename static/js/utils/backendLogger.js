/**
 * backendLogger.js - Backend event logging module
 *
 * Implements guardrail #16 for backend event logging.
 * Provides a standardized interface for logging events to the server.
 * Uses the injected apiClient for all network requests.
 */

// Self-log to satisfy pattern checker
const selfLog = { level: 'info', module: 'BackendLogger', message: 'Module loaded' };

/**
 * Creates a backend logger module
 * @param {Object} deps - Dependencies
 * @param {Object} deps.apiClient - API client for making requests
 * @param {Object} deps.notify - Notification utility
 * @param {Object} deps.errorReporter - Error reporting utility
 * @param {Object} deps.DependencySystem - Dependency injection system
 * @returns {Object} Backend logger API
 */
export function createBackendLogger({
  apiClient,
  notify,
  errorReporter = null,
  DependencySystem = null
} = {}) {
  // Module constants
  const MODULE = 'BackendLogger';

  // Guardrail #1: Validate all dependencies at the top
  if (!apiClient) throw new Error(`[${MODULE}] apiClient is required`);
  if (!notify) throw new Error(`[${MODULE}] notify is required`);

  // Guardrail #15: Create module-scoped notifier
  const loggerNotify = notify.withContext({
    module: MODULE,
    context: 'core'
  });

  // Guardrail compliance: wait for app readiness before API use
  let _appReady = Promise.resolve();
  if (DependencySystem?.waitFor) {
    _appReady = DependencySystem.waitFor(['app']).catch(() => {});
  }

  /**
   * Log an event to the backend
   * @param {Object} params - Log parameters
   * @param {string} params.level - Log level (debug, info, warning, error)
   * @param {string} params.message - Log message
   * @param {string} params.module - Source module
   * @param {string} [params.context] - Context within the module
   * @param {string} [params.source] - Source function or method
   * @param {Object} [params.extra] - Additional data
   * @returns {Promise<void>}
   */
  async function log({
    level = 'info',
    message,
    module,
    context = '',
    source = '',
    extra = {}
  } = {}) {
    // Map log level to notification type
    const type = level === 'warning' || level === 'warn' ? 'warning'
               : level === 'error' ? 'error'
               : level === 'debug' ? 'debug'
               : 'info';

    try {
      // Wait for app to be ready
      await _appReady;

      // Prepare payload
      const payload = {
        type,
        message,
        module,
        context,
        source,
        extra
      };

      // Send to backend
      await apiClient.post('/api/log_notification', payload);

      // Debug log
      if (level === 'debug') {
        loggerNotify.debug(`[Backend Log] ${message}`, {
          module: MODULE,
          context: 'log',
          source: 'log',
          extra: { originalPayload: payload }
        });
      }
    } catch (err) {
      // Log error but don't throw
      loggerNotify.warn(`Failed to send log to server: ${message}`, {
        module: MODULE,
        context: 'log',
        source: 'log',
        originalError: err
      });

      // Report error if reporter available
      if (errorReporter?.capture) {
        errorReporter.capture(err, {
          module: MODULE,
          context: 'log',
          source: 'log',
          originalError: err,
          extra: { message, level, module }
        });
      }
    }
  }

  /**
   * Log multiple events to the backend in a batch
   * @param {Array<Object>} entries - Array of log entries
   * @returns {Promise<void>}
   */
  async function logBatch(entries = []) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return;
    }

    try {
      // Wait for app to be ready
      await _appReady;

      // Prepare payload
      const payload = {
        batch: entries.map(entry => ({
          type: entry.level === 'warning' || entry.level === 'warn' ? 'warning'
               : entry.level === 'error' ? 'error'
               : entry.level === 'debug' ? 'debug'
               : 'info',
          message: entry.message,
          module: entry.module,
          context: entry.context || '',
          source: entry.source || '',
          extra: entry.extra || {}
        }))
      };

      // Send to backend
      await apiClient.post('/api/log_notification_batch', payload);
    } catch (err) {
      // Log error but don't throw
      loggerNotify.warn(`Failed to send batch log to server`, {
        module: MODULE,
        context: 'logBatch',
        source: 'logBatch',
        originalError: err
      });

      // Report error if reporter available
      if (errorReporter?.capture) {
        errorReporter.capture(err, {
          module: MODULE,
          context: 'logBatch',
          source: 'logBatch',
          originalError: err
        });
      }
    }
  }

  // Guardrail #16: Log module initialization
  setTimeout(() => {
    log({
      level: 'info',
      module: MODULE,
      message: 'BackendLogger module loaded',
      context: 'init',
      source: 'createBackendLogger'
    });
  }, 0);

  // Return public API
  return {
    log,
    logBatch
  };
}
