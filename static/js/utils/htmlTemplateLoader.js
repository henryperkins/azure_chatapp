/**
 * HtmlTemplateLoader
 * Factory that fetches & injects external HTML fragments, then emits a
 * custom event (<eventName>) on document so other modules can await it.
 *
 * @param {Object}   deps
 * @param {Object}   deps.DependencySystem  – Required (for consistency, though not used heavily here)
 * @param {Object}   deps.domAPI           – Required, for DOM queries and event dispatch
 * @param {Object}   deps.sanitizer        – Optional. If present, must have .sanitize(html)
 * @param {Object}   deps.eventHandlers    – Required, must provide createCustomEvent
 *
 * // Additional guardrail-driven injections:
 * @param {Object}   deps.apiClient        – Required, for all HTTP requests
 * @param {Object}   deps.timerAPI         – Required, must provide { setTimeout, clearTimeout }
 *
 * @returns {Object} { loadTemplate, loadAppTemplates }
 */
export function createHtmlTemplateLoader({
  DependencySystem,
  domAPI,
  sanitizer = null,
  eventHandlers,
  apiClient,
  timerAPI
} = {}) {
  // Guardrail checks:
  if (!DependencySystem) throw new Error('DependencySystem required by HtmlTemplateLoader');
  if (!domAPI)           throw new Error('domAPI required by HtmlTemplateLoader');
  if (!eventHandlers || typeof eventHandlers.createCustomEvent !== 'function')
    throw new Error('[HtmlTemplateLoader] eventHandlers.createCustomEvent required');
  if (!apiClient || typeof apiClient.fetch !== 'function') {
    throw new Error('[HtmlTemplateLoader] apiClient with a .fetch() method is required');
  }
  if (!timerAPI || typeof timerAPI.setTimeout !== 'function' || typeof timerAPI.clearTimeout !== 'function') {
    throw new Error('[HtmlTemplateLoader] timerAPI with setTimeout/clearTimeout is required');
  }

  /**
   * Loads a single HTML template into a DOM container, sanitizes if available,
   * and emits an eventName upon completion (success or failure).
   */
  async function loadTemplate({
    url,
    containerSelector,
    eventName = 'htmlTemplateLoaded',
    timeout = 15_000 // default to 15s
  } = {}) {
    const container = domAPI.querySelector(containerSelector);
    if (!container) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(`[HtmlTemplateLoader] WARNING: containerSelector "${containerSelector}" not found in DOM. Template will not be injected.`);
      }
      return false;
    }

    // Create a manual AbortController for this request
    const controller = new AbortController();
    // Use injected timerAPI instead of window
    const tm = timerAPI.setTimeout(() => controller.abort(), timeout);

    let success = false;
    try {
      const resp = await apiClient.fetch(url, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const html = await resp.text();

      if (sanitizer && typeof sanitizer.sanitize === 'function') {
        container.innerHTML = sanitizer.sanitize(html);
      } else {
        // SECURITY WARNING: Injecting raw HTML without a sanitizer is dangerous!
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[HtmlTemplateLoader] WARNING: No sanitizer provided. Injecting raw HTML is a security risk.');
        }
        container.innerHTML = html;
      }

      success = true;

    } catch (err) {
      // Error handling intentionally left blank (no notification/capture)
    } finally {
      timerAPI.clearTimeout(tm);
      const evt = eventHandlers.createCustomEvent(eventName,
        { detail: { success, error: success ? null : 'Fetch or injection failed' } });
      domAPI.dispatchEvent(domAPI.getDocument(), evt);
    }

    return success;
  }

  /**
   * Orchestrates the loading of multiple HTML templates in sequence.
   * Each template has its own timeout, container, etc.
   */
  async function loadAppTemplates(templateConfigs = []) {
    if (!Array.isArray(templateConfigs) || templateConfigs.length === 0) {
      return [];
    }

    const results = [];

    for (const config of templateConfigs) {
      if (!config.url || !config.containerSelector) {
        results.push({
          url    : config.url,
          success: false,
          error  : 'Invalid configuration'
        });
        continue;
      }

      const eventName = config.eventName ||
        `templateLoaded:${config.url.split('/').pop()}`;
      const tmo       = config.timeout || 15000;

      try {
        const success = await loadTemplate({
          url             : config.url,
          containerSelector: config.containerSelector,
          eventName,
          timeout         : tmo
        });

        results.push({
          url: config.url,
          success,
          eventNameEmitted: eventName
        });

      } catch (err) {
        results.push({
          url    : config.url,
          success: false,
          error  : err.message,
          eventNameEmitted: eventName
        });
        // Dispatch event in case something is awaiting
        const evt = eventHandlers.createCustomEvent(eventName,
          { detail: { success: false, error: err.message } });
        domAPI.dispatchEvent(domAPI.getDocument(), evt);
      }
    }

    return results;
  }

  return { loadTemplate, loadAppTemplates };
}
