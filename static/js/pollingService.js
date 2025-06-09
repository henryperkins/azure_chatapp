/**
 * pollingService.js – Canonical background job polling utility (2025 Front-End Guard-Rails compliant)
 *
 * Responsibilities:
 * 1. Maintain a single, DI-instantiated hub for polling long-running backend jobs.
 * 2. Expose an imperative API – startJob / stopJob – used by UI modules (FileUploadComponent, etc.).
 * 3. Dispatch versioned AppBus analytics events so multiple consumers can react without coupling.
 * 4. Ensure deterministic cleanup (all timers cleared, listeners removed) to prevent memory leaks.
 *
 * Factory signature – called exclusively by appInitializer.js.  All other modules must
 * obtain the created instance via `DependencySystem.modules.get('pollingService')`.
 */

export function createPollingService({
  DependencySystem,
  apiClient,
  eventHandlers,
  logger,
  pollingInterval = 3000 // default 3 seconds
} = {}) {
  // ────────────────────────────────────────────────────────────
  // Dependency validation (fail-fast, guard-rail requirement)
  // ────────────────────────────────────────────────────────────
  if (!DependencySystem) throw new Error('[PollingService] Missing DependencySystem');
  if (typeof apiClient !== 'function') throw new Error('[PollingService] Missing apiClient function');
  if (!eventHandlers) throw new Error('[PollingService] Missing eventHandlers');
  if (!logger) {
    // Fall back to console, but flag loudly – polling is critical for UX.
    // eslint-disable-next-line no-console
    console.warn('[PollingService] Logger missing – falling back to `console`.');
    logger = console;
  }

  const MODULE = 'PollingService';

  // Global AppBus – already registered by appInitializer.
  const AppBus = DependencySystem.modules.get('AppBus');

  // Local EventTarget for fine-grained UI listeners (optional).
  const _bus = new EventTarget();

  // Internal map: jobId → { intervalId, lastStatus }
  const _jobs = new Map();

  function _dispatchAppBusEvent(name, detail) {
    if (!AppBus || typeof AppBus.dispatchEvent !== 'function') return;
    try {
      const evt = eventHandlers?.createCustomEvent
        ? eventHandlers.createCustomEvent(name, { detail })
        : new CustomEvent(name, { detail });
      AppBus.dispatchEvent(evt);
    } catch (err) {
      logger.warn(`[${MODULE}] Failed to dispatch AppBus event ${name}`, err, { context: MODULE });
    }
  }

  async function _pollJob(jobId) {
    try {
      // Back-end contract: GET /api/jobs/{id}  → { status: 'pending'|'processing'|'completed'|'failed', progress: 0-100 }
      const res = await apiClient(`/api/jobs/${jobId}`, { method: 'GET' });
      const status = res?.status ?? 'unknown';
      const progress = typeof res?.progress === 'number' ? res.progress : null;

      // Notify local listeners first (fine-grained UI)
      _bus.dispatchEvent(new CustomEvent('update', { detail: { jobId, status, progress, raw: res } }));

      // Analytics / global consumers
      _dispatchAppBusEvent('knowledgebase:jobProgress', { jobId, status, progress });

      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        stopJob(jobId); // auto-cleanup finished jobs

        if (status === 'completed') {
          _dispatchAppBusEvent('knowledgebase:ready', { jobId });
        }
      }
    } catch (err) {
      logger.error(`[${MODULE}] Polling failed for job ${jobId}`, err, { context: MODULE });
    }
  }

  /**
   * Start polling a backend jobId.  If the job is already being polled, this is a no-op.
   * @param {string} jobId – backend job identifier
   * @param {object} [options]
   * @param {number} [options.interval] – custom polling interval (ms)
   */
  function startJob(jobId, options = {}) {
    if (!jobId) return;
    if (_jobs.has(jobId)) return; // Already polling

    const interval = options.interval ?? pollingInterval;
    // Kick off immediate poll to give UI fast response, then at interval
    _pollJob(jobId);
    const id = setInterval(() => _pollJob(jobId), interval);
    _jobs.set(jobId, { intervalId: id });
    logger.debug(`[${MODULE}] Started polling for job ${jobId}`, { context: MODULE, interval });
  }

  /** Stop polling a given jobId */
  function stopJob(jobId) {
    const entry = _jobs.get(jobId);
    if (entry) {
      clearInterval(entry.intervalId);
      _jobs.delete(jobId);
      logger.debug(`[${MODULE}] Stopped polling for job ${jobId}`, { context: MODULE });
    }
  }

  /** Cleanup all intervals & listeners – called on view deactivation / logout */
  function cleanup() {
    for (const { intervalId } of _jobs.values()) {
      clearInterval(intervalId);
    }
    _jobs.clear();
    if (eventHandlers?.cleanupListeners) {
      eventHandlers.cleanupListeners({ context: MODULE });
    }
  }

  // View lifecycle / logout integration – auto-cleanup
  (function _setupLifecycleHooks() {
    const doc = DependencySystem.modules.get('domAPI')?.getDocument?.();
    if (doc) {
      eventHandlers.trackListener(doc, 'navigation:deactivateView', cleanup, {
        context: MODULE, description: 'PollingService_DeactivateView'
      });
    }

    const auth = DependencySystem.modules.get('auth');
    if (auth?.AuthBus) {
      eventHandlers.trackListener(auth.AuthBus, 'authStateChanged', (e) => {
        if (e?.detail?.authenticated === false) {
          cleanup();
        }
      }, { context: MODULE, description: 'PollingService_AuthStateChanged' });
    }
  }());

  // Public, immutable API
  return Object.freeze({
    startJob,
    stopJob,
    cleanup,
    onUpdate: (handler) => {
      if (typeof handler !== 'function') return () => {};
      _bus.addEventListener('update', handler);
      return () => _bus.removeEventListener('update', handler);
    }
  });
}

export default createPollingService;
