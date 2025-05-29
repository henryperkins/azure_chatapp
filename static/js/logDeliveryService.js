// static/js/logDeliveryService.js (not in services/ subdirectory)

/**
 * logDeliveryService.js - Handles server-side log delivery
 * Completely separate from logger to avoid circular dependencies
 */

export function createLogDeliveryService({
  apiClient,
  browserService,
  eventHandlers,
  enabled = false, // Start disabled until auth ready
  batchInterval = 5000,
  maxBatchSize = 100
}) {
  if (!apiClient) throw new Error('[LogDelivery] apiClient required');
  if (!browserService) throw new Error('[LogDelivery] browserService required');
  if (!eventHandlers) throw new Error('[LogDelivery] eventHandlers required');

  let buffer = [];
  let batchTimer = null;
  let isEnabled = enabled;
  let isDelivering = false;
  let logListener = null;

  async function deliverBatch(logs) {
    if (!isEnabled || logs.length === 0 || isDelivering) return;

    isDelivering = true;
    try {
      const response = await apiClient.post('/api/logs',
        { logs },
        {
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include'
        }
      );

      // Success - clear delivered logs
      return true;
    } catch (error) {
      // On 4xx errors, drop the batch
      if (error.status >= 400 && error.status < 500) {
        return true; // Consider delivered
      }
      // On 5xx or network errors, keep for retry
      return false;
    } finally {
      isDelivering = false;
    }
  }

  function scheduleBatch() {
    if (batchTimer || !isEnabled) return;

    batchTimer = browserService.setTimeout(async () => {
      batchTimer = null;
      if (buffer.length > 0) {
        const batch = buffer.splice(0, maxBatchSize);
        const delivered = await deliverBatch(batch);
        if (!delivered) {
          // Put back at front for retry
          buffer.unshift(...batch);
        }
      }
    }, batchInterval);
  }

  function handleLogEvent(event) {
    if (!isEnabled) return;

    const logEntry = event.detail;

    // Only send warn/error/critical to server
    const level = logEntry.level;
    if (level === 'debug' || level === 'info') return;

    buffer.push({
      ...logEntry,
      // Ensure clean serialization
      data: logEntry.data ? JSON.parse(JSON.stringify(logEntry.data)) : null,
      metadata: logEntry.metadata ? JSON.parse(JSON.stringify(logEntry.metadata)) : null
    });

    // Trim buffer if too large
    if (buffer.length > maxBatchSize * 2) {
      buffer = buffer.slice(-maxBatchSize);
    }

    scheduleBatch();
  }

  function start() {
    if (isEnabled) return;

    isEnabled = true;

    // Attach listener
    logListener = eventHandlers.trackListener(
      browserService.getWindow(),
      'app:log',
      handleLogEvent,
      { context: 'LogDelivery' }
    );

    scheduleBatch();
  }

  function stop() {
    isEnabled = false;

    if (batchTimer) {
      browserService.clearTimeout(batchTimer);
      batchTimer = null;
    }

    if (logListener) {
      logListener(); // Call the cleanup function
      logListener = null;
    }

    buffer = [];
  }

  return {
    start,
    stop,

    async flush() {
      if (buffer.length > 0) {
        const batch = [...buffer];
        buffer = [];
        await deliverBatch(batch);
      }
    },

    cleanup() {
      stop();
      eventHandlers.cleanupListeners({ context: 'LogDelivery' });
    }
  };
}
