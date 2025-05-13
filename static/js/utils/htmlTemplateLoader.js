/**
 * HtmlTemplateLoader
 * Factory that fetches & injects external HTML fragments, then emits a
 * custom event (<eventName>) on document so other modules can await it.
 *
 * @param {Object} deps
 * @param {DependencySystem} deps.DependencySystem
 * @param {Object} deps.domAPI
 * @param {Function} deps.notify            – DI notify util (required)
 * @param {Window}   [deps.windowObj=window]
 * @param {Object}   [deps.sanitizer]      – sanitizer util (should provide .sanitize)
 * @param {Object}   [deps.errorReporter]  – error monitoring util (optional)
 */
export function createHtmlTemplateLoader({
  DependencySystem,
  domAPI,
  notify,
  windowObj = window,
  sanitizer = null,
  errorReporter = null
} = {}) {
  if (!DependencySystem) throw new Error('DependencySystem required');
  if (!domAPI)           throw new Error('domAPI required');
  if (!notify) throw new Error('notify required');

  const loaderNotify = notify.withContext({
    module : 'HtmlTemplateLoader',
    context: 'htmlLoader'
  });

  async function loadTemplate({
    url,
    containerSelector,
    eventName    = 'htmlTemplateLoaded',
    timeout      = 15_000 // Increased from 8_000 to 15_000
  } = {}) {
    const container = domAPI.querySelector(containerSelector);
    if (!container) {
      loaderNotify.error(`Container not found: ${containerSelector}`, { source: 'loadTemplate', url });
      return false;
    }

    // Added detailed logging for container state
    loaderNotify.info(`Container ${containerSelector} found for url ${url}. Child count: ${container.childElementCount}. InnerHTML length: ${container.innerHTML.length}`, {
        source: 'loadTemplate',
        url,
        selector: containerSelector,
        childCount: container.childElementCount,
        innerHTMLSample: container.innerHTML.substring(0, 100)
    });

    loaderNotify.info(`Fetching ${url}`, { source: 'loadTemplate' });
    const controller = new AbortController();
    const tm = windowObj.setTimeout(() => controller.abort(), timeout);

    try {
      const resp = await fetch(url, { cache: 'no-store', signal: controller.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const html = await resp.text();
      if (sanitizer && typeof sanitizer.sanitize === "function") {
        container.innerHTML = sanitizer.sanitize(html);
      } else {
        loaderNotify.warn("Injecting HTML without sanitizer present", {
          module: 'HtmlTemplateLoader',
          context: 'loadTemplate',
          critical: true,
          url
        });
        container.innerHTML = html;
      }
      loaderNotify.success(`Injected ${url}`, { source: 'loadTemplate' });
      domAPI.dispatchEvent(domAPI.getDocument(),
        new CustomEvent(eventName, { detail: { success: true } }));
      return true;
    } catch (err) {
      loaderNotify.error(`Failed ${url}: ${err.message}`, {
        source: 'loadTemplate', originalError: err
      });
      if (errorReporter?.capture) {
        errorReporter.capture(err, {
          module: 'HtmlTemplateLoader',
          method: 'loadTemplate',
          url,
          source: 'loadTemplate',
          originalError: err
        });
      }
      domAPI.dispatchEvent(domAPI.getDocument(),
        new CustomEvent(eventName, { detail: { success: false, error: err.message } }));
      return false;
    } finally {
      windowObj.clearTimeout(tm);
    }
  }

  /**
   * Orchestrates the loading of multiple HTML templates.
   * Each template is loaded individually with its own timeout and error handling.
   *
   * @param {Array<Object>} templateConfigs - Array of template configuration objects.
   * Each object should have: { url, containerSelector, eventName, timeout }
   * @returns {Promise<Array<Object>>} A promise that resolves to an array of result objects,
   *                                   each indicating success/failure for a template.
   */
  async function loadAppTemplates(templateConfigs = []) {
    if (!Array.isArray(templateConfigs) || templateConfigs.length === 0) {
      loaderNotify.warn('No template configurations provided to loadAppTemplates.', {
        source: 'loadAppTemplates'
      });
      return [];
    }

    loaderNotify.info(`Starting to load ${templateConfigs.length} app templates.`, {
      source: 'loadAppTemplates',
      count: templateConfigs.length
    });

    const results = [];

    for (const config of templateConfigs) {
      if (!config.url || !config.containerSelector) {
        loaderNotify.error('Invalid template configuration. Missing url or containerSelector.', {
          source: 'loadAppTemplates',
          config
        });
        results.push({ url: config.url, success: false, error: 'Invalid configuration' });
        continue;
      }

      // Use a default eventName if not provided, specific to this orchestrated load
      const eventName = config.eventName || `templateLoaded:${config.url.split('/').pop()}`;
      const timeout = config.timeout || 15000; // Default timeout for individual template

      loaderNotify.info(`Orchestrating load for: ${config.url}`, {
        source: 'loadAppTemplates',
        url: config.url,
        container: config.containerSelector,
        eventName,
        timeout
      });

      try {
        // The existing loadTemplate function handles its own AbortController and timeout.
        // We await its completion here.
        const success = await loadTemplate({
          url: config.url,
          containerSelector: config.containerSelector,
          eventName: eventName, // Ensure this event name is unique or handled appropriately
          timeout: timeout
        });
        results.push({ url: config.url, success, eventNameEmitted: eventName });
        if (success) {
          loaderNotify.success(`Successfully loaded template via orchestration: ${config.url}`, {
            source: 'loadAppTemplates',
            url: config.url
          });
        } else {
          loaderNotify.error(`Failed to load template via orchestration: ${config.url}`, {
            source: 'loadAppTemplates',
            url: config.url
          });
        }
      } catch (err) {
        // This catch block might be redundant if loadTemplate handles all its errors
        // and doesn't re-throw, but kept for safety.
        loaderNotify.error(`Critical error during orchestrated load of ${config.url}: ${err.message}`, {
          source: 'loadAppTemplates',
          url: config.url,
          originalError: err
        });
        results.push({ url: config.url, success: false, error: err.message, eventNameEmitted: eventName });
        // Dispatch event even on critical error to prevent hangs if something upstream awaits it
        domAPI.dispatchEvent(domAPI.getDocument(),
          new CustomEvent(eventName, { detail: { success: false, error: err.message } }));
      }
    }

    loaderNotify.info(`Finished loading all app templates. Results count: ${results.length}`, {
      source: 'loadAppTemplates',
      resultsSummary: results.map(r => ({ url: r.url, success: r.success }))
    });
    return results;
  }

  return { loadTemplate, loadAppTemplates };
}
