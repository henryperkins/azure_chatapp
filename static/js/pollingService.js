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
* obtain the created instance via the DI container (e.g., DependencySystem.modules.get('pollingService')) – look-up happens during app bootstrap, not at runtime inside the service.
 */

export function createPollingService({
  DependencySystem,
  apiClient,
  eventHandlers,
  logger,
  pollingInterval = 3000, // default 3 seconds
  domAPI = null,
  authModule = null,
  eventService = null
} = {}) {
  // ────────────────────────────────────────────────────────────
  // Dependency validation (fail-fast, guard-rail requirement)
  // ────────────────────────────────────────────────────────────
  if (!DependencySystem) throw new Error('[PollingService] Missing DependencySystem');
  if (typeof apiClient !== 'function') throw new Error('[PollingService] Missing apiClient function');
  if (!eventHandlers) throw new Error('[PollingService] Missing eventHandlers');
  if (!logger) {
    throw new Error('[PollingService] Missing logger');
  }

  const MODULE = 'PollingService';

  // ------------------------------------------------------------------
  // Resolve once at factory-time – no runtime container look-ups later.
  // ------------------------------------------------------------------

  // Prefer injected domAPI/authModule; fall back to DI container (one-time).
  const _domAPI = domAPI || DependencySystem?.modules?.get?.('domAPI');
  const _authModule = authModule || DependencySystem?.modules?.get?.('auth');

  // Use eventService for unified event system instead of deprecated AppBus
  const _eventService = eventService || DependencySystem?.modules?.get?.('eventService');

  // Internal map: jobId → { intervalId, lastStatus }
  const _jobs = new Map();

  function _dispatchEvent(name, detail) {
    if (!_eventService || typeof _eventService.emit !== 'function') return;
    try {
      _eventService.emit(name, detail);
    } catch (err) {
      logger.warn(`[${MODULE}] Failed to dispatch event ${name}`, err, { context: MODULE });
    }
  }

  async function _pollJob(jobId) {
    try {
      // Back-end contract: GET /api/jobs/{id}  → { status: 'pending'|'processing'|'completed'|'failed', progress: 0-100 }
      const res = await apiClient(`/api/jobs/${jobId}`, { method: 'GET' });
      const status = res?.status ?? 'unknown';
      const progress = typeof res?.progress === 'number' ? res.progress : null;

      // Notify local listeners first (fine-grained UI)
      if (eventService?.emit) {
        eventService.emit('polling:jobUpdate', { jobId, status, progress, raw: res });
      } else if (_domAPI?.getDocument) {
        _domAPI.getDocument().dispatchEvent(new CustomEvent('polling:jobUpdate', { detail: { jobId, status, progress, raw: res } }));
      }

      // Analytics / global consumers
      _dispatchEvent('knowledgebase:jobProgress', { jobId, status, progress });

      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        stopJob(jobId); // auto-cleanup finished jobs

        if (status === 'completed') {
          _dispatchEvent('knowledgebase:ready', { jobId });
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
    const doc = _domAPI?.getDocument?.();
    if (doc) {
      eventHandlers.trackListener(doc, 'navigation:deactivateView', cleanup, {
        context: MODULE, description: 'PollingService_DeactivateView'
      });
    }

    if (_eventService) {
      _eventService.on('authStateChanged', (e) => {
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
      if (eventService?.on && eventService?.off) {
        eventService.on('polling:jobUpdate', handler);
        return () => eventService.off('polling:jobUpdate', handler);
      } else if (_domAPI?.getDocument) {
        const wrappedHandler = (event) => handler(event.detail ? event : { detail: event });
        _domAPI.getDocument().addEventListener('polling:jobUpdate', wrappedHandler);
        return () => _domAPI.getDocument().removeEventListener('polling:jobUpdate', wrappedHandler);
      }
      return () => {};
    }
  });
}

export default createPollingService;
