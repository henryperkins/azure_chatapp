/**
 * knowledgeBaseReadinessService.js
 * ------------------------------------------------------------
 * Lightweight, front-end wrapper around the KB health endpoint
 * (`/api/knowledge-base/health/:projectId`).  It provides a
 * cached, promise-based API that other modules (ChatManager,
 * KnowledgeBaseComponent, etc.) can use to quickly determine
 * whether the Knowledge-Base for a given project is available
 * without triggering heavyweight initialisation on the server.
 *
 * The implementation purposefully keeps its own logic minimal so
 * that it can be loaded early during bootstrap (see
 * appInitializer.js – serviceInit.registerAdvancedServices).
 */

 

export function createKnowledgeBaseReadinessService({
  DependencySystem,
  apiClient,
  logger
}) {
  // ────────────────────────────────────────────────────────────
  // Dependency validation (fail fast – this is a factory)
  // ────────────────────────────────────────────────────────────
  if (!DependencySystem) throw new Error('[KBReadinessService] Missing DependencySystem');
  if (typeof apiClient !== 'function') throw new Error('[KBReadinessService] Missing apiClient function');
  if (!logger) throw new Error('[KBReadinessService] Missing logger dependency');

  const MODULE = 'kbReadinessService';

  // ────────────────────────────────────────────────────────────
  // Internal cache – Map<cacheKey,{ status,timestamp }>
  // cacheKey = `project_${projectId}` | 'global'
  // ────────────────────────────────────────────────────────────
  const CACHE_TTL_MS = 30_000; // 30 seconds
  const cache = new Map();

  /**
   * Internal helper – returns cached entry if fresh, otherwise null.
   * @param {string} key
   */
  function _getCached(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    const { status, timestamp } = entry;
    if (Date.now() - timestamp > CACHE_TTL_MS) {
      cache.delete(key);
      return null;
    }
    return status;
  }

  /**
   * Internal helper – stores status along with timestamp.
   * @param {string} key
   * @param {object} status
   */
  function _storeCache(key, status) {
    cache.set(key, { status, timestamp: Date.now() });
  }

  /**
   * Perform a fast health-check for the knowledge-base of *projectId*.
   *
   * @param {string} projectId – UUID string
   * @param {object} [options]
   * @param {boolean} [options.useCache=true]
   * @param {number} [options.timeout=5000] – soft timeout (ms).
   * @returns {Promise<object>} – shape mirrors backend response
   */
  async function checkProjectReadiness(projectId, options = {}) {
    const { useCache = true, timeout = 5000 } = options;

    if (!projectId) throw new Error('[KBReadinessService] projectId is required');

    const cacheKey = `project_${projectId}`;
    if (useCache) {
      const cached = _getCached(cacheKey);
      if (cached) return cached;
    }

    const url = `/api/knowledge-base/health/${projectId}`;

    // Soft timeout using Promise.race (apiClient has its own internal timeout,
    // but we want a quicker pessimistic answer in the UI).
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          available: false,
          reason: 'Health check timeout',
          fallback_available: false,
          missing_dependencies: []
        });
      }, timeout);
    });

    try {
      const apiPromise = apiClient(url, { method: 'GET' });

      const status = await Promise.race([apiPromise, timeoutPromise]);

      _storeCache(cacheKey, status);
      logger.debug(`[${MODULE}] Health check result`, { projectId, status });
      return status;
    } catch (err) {
      logger.warn(`[${MODULE}] Health check failed`, err, { projectId });
      const fallback = {
        available: false,
        reason: 'Health check failed',
        fallback_available: false,
        missing_dependencies: []
      };
      _storeCache(cacheKey, fallback);
      return fallback;
    }
  }

  /**
   * Poll the health endpoint until it reports available or attempts are
   * exhausted.
   *
   * @param {string} projectId
   * @param {object} [options]
   * @param {number} [options.maxAttempts=5]
   * @param {number} [options.interval=1000] – ms between attempts
   * @returns {Promise<object>} final status
   */
  async function waitForReadiness(projectId, options = {}) {
    const { maxAttempts = 5, interval = 1000 } = options;
    let attempt = 0;
    while (attempt < maxAttempts) {
      // Always bypass cache after the first iteration
      // (first iteration may have returned cached value above)
      const status = await checkProjectReadiness(projectId, { useCache: attempt === 0 });
      if (status?.available) return status;
      attempt += 1;
      if (attempt < maxAttempts) {
         
        await new Promise((r) => setTimeout(r, interval));
      }
    }
    // Final pessimistic call without cache before giving up
    return checkProjectReadiness(projectId, { useCache: false });
  }

  /**
   * Clear cache for a single project or all projects.
   * @param {string|null} [projectId]
   */
  function invalidateCache(projectId = null) {
    if (projectId) {
      cache.delete(`project_${projectId}`);
    } else {
      cache.clear();
    }
  }

  /** Cleanup method for DependencySystem lifecycle hooks */
  function cleanup() {
    cache.clear();
  }

  // Public API returned by factory
  return Object.freeze({
    checkProjectReadiness,
    waitForReadiness,
    invalidateCache,
    cleanup
  });
}

export default createKnowledgeBaseReadinessService;
