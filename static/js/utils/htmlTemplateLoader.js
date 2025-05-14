/**
 * HtmlTemplateLoader (Guardrail-Compliant)
 * Factory that fetches & injects external HTML fragments, then emits a
 * custom event (<eventName>) on document so other modules can await it.
 *
 * @param {Object}   deps
 * @param {Object}   deps.DependencySystem  – Required (for consistency, though not used heavily here)
 * @param {Object}   deps.domAPI           – Required, for DOM queries and event dispatch
 * @param {Function} deps.notify           – Required, for contextual notifications
 * @param {Object}   deps.sanitizer        – Optional. If present, must have .sanitize(html)
 * @param {Object}   deps.errorReporter    – Optional, for capturing errors
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
  notify,
  sanitizer = null,
  errorReporter = null,
  apiClient,
  timerAPI
} = {}) {
  // Guardrail checks:
  if (!DependencySystem) throw new Error('DependencySystem required by HtmlTemplateLoader');
  if (!domAPI)           throw new Error('domAPI required by HtmlTemplateLoader');
  if (!notify)           throw new Error('notify required by HtmlTemplateLoader');
  if (!apiClient || typeof apiClient.fetch !== 'function') {
    throw new Error('[HtmlTemplateLoader] apiClient with a .fetch() method is required');
  }
  if (!timerAPI || typeof timerAPI.setTimeout !== 'function' || typeof timerAPI.clearTimeout !== 'function') {
    throw new Error('[HtmlTemplateLoader] timerAPI with setTimeout/clearTimeout is required');
  }

  // Contextual notifier
  const loaderNotify = notify.withContext({
    module : 'HtmlTemplateLoader',
    context: 'htmlLoader'
  });

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
      loaderNotify.error(`Container not found: ${containerSelector}`, {
        source: 'loadTemplate',
        url
      });
      return false;
    }

    loaderNotify.info(
      `Container "${containerSelector}" found. Child count: ${container.childElementCount}. InnerHTML length: ${container.innerHTML.length}`,
      {
        source: 'loadTemplate',
        url,
        selector: containerSelector,
        childCount: container.childElementCount,
        innerHTMLSample: container.innerHTML.substring(0, 100)
      }
    );

    loaderNotify.info(`Fetching ${url}`, { source: 'loadTemplate', url });

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
        loaderNotify.warn(
          'Injecting HTML without sanitizer present',
          { source: 'loadTemplate', url, critical: true }
        );
        container.innerHTML = html;
      }

      loaderNotify.success(`Injected ${url}`, { source: 'loadTemplate' });
      success = true;

    } catch (err) {
      loaderNotify.error(`Failed ${url}: ${err.message}`, {
        source: 'loadTemplate',
        originalError: err,
        url
      });
      if (errorReporter?.capture) {
        errorReporter.capture(err, {
          module: 'HtmlTemplateLoader',
          method: 'loadTemplate',
          url,
          source: 'loadTemplate'
        });
      }
    } finally {
      timerAPI.clearTimeout(tm);
      domAPI.dispatchEvent(
        domAPI.getDocument(),
        new CustomEvent(eventName, {
          detail: { success, error: success ? null : 'Fetch or injection failed' }
        })
      );
    }

    return success;
  }

  /**
   * Orchestrates the loading of multiple HTML templates in sequence.
   * Each template has its own timeout, container, etc.
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
        loaderNotify.error('Invalid configuration (missing url/containerSelector).', {
          source: 'loadAppTemplates',
          config
        });
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

      loaderNotify.info(`Loading template -> [${config.url}]`, {
        source: 'loadAppTemplates',
        url: config.url,
        container: config.containerSelector,
        eventName,
        timeout: tmo
      });

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

        if (success) {
          loaderNotify.success(`Loaded: ${config.url}`, {
            source: 'loadAppTemplates', url: config.url
          });
        } else {
          loaderNotify.error(`Failed: ${config.url}`, {
            source: 'loadAppTemplates', url: config.url
          });
        }

      } catch (err) {
        // This catch is redundant if loadTemplate doesn’t re-throw, but kept for coverage
        loaderNotify.error(`Critical error: ${config.url} => ${err.message}`, {
          source: 'loadAppTemplates',
          url: config.url,
          originalError: err
        });
        results.push({
          url    : config.url,
          success: false,
          error  : err.message,
          eventNameEmitted: eventName
        });
        // Dispatch event in case something is awaiting
        domAPI.dispatchEvent(
          domAPI.getDocument(),
          new CustomEvent(eventName, { detail: { success: false, error: err.message } })
        );
      }
    }

    loaderNotify.info(`Finished loading all templates.`, {
      source: 'loadAppTemplates',
      resultsSummary: results.map(r => ({ url: r.url, success: r.success }))
    });

    return results;
  }

  return { loadTemplate, loadAppTemplates };
}
