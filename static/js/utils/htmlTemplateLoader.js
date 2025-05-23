/**
 * Creates an HTML template loader with injected dependencies for DOM manipulation, HTTP requests, and event handling.
 *
 * Returns an object with two methods:
 * - `loadTemplate`: Loads an external HTML template into a specified DOM container, optionally sanitizes it, and emits a custom event upon completion. If the template URL contains `'modals.html'`, also emits a `'modalsLoaded'` event with the result.
 * - `loadAppTemplates`: Sequentially loads multiple HTML templates based on an array of configuration objects, returning an array of results for each load attempt.
 *
 * @returns {{ loadTemplate: Function, loadAppTemplates: Function }} An object with methods to load single or multiple HTML templates.
 *
 * @throws {Error} If required dependencies are missing or invalid.
 */
export function createHtmlTemplateLoader({
  DependencySystem,
  domAPI,
  sanitizer = null,
  eventHandlers,
  apiClient,
  timerAPI,
  logger = DependencySystem?.modules?.get?.('logger') || { warn: () => { } }
} = {}) {
  // Guardrail checks:
  if (!DependencySystem) throw new Error('DependencySystem required by HtmlTemplateLoader');
  if (!domAPI) throw new Error('domAPI required by HtmlTemplateLoader');
  if (!eventHandlers || typeof eventHandlers.createCustomEvent !== 'function')
    throw new Error('[HtmlTemplateLoader] eventHandlers.createCustomEvent required');
  if (!apiClient || typeof apiClient.fetch !== 'function') {
    throw new Error('[HtmlTemplateLoader] apiClient with a .fetch() method is required');
  }
  if (!timerAPI || typeof timerAPI.setTimeout !== 'function' || typeof timerAPI.clearTimeout !== 'function') {
    throw new Error('[HtmlTemplateLoader] timerAPI with setTimeout/clearTimeout is required');
  }

  // ──────────────────────────────────────────────────────────────
  // Native fetch shortcut (bypasses apiClient pre-processing).
  // Will be used for “pure” static assets such as *.html, *.css, …
  // It is derived from domAPI DI to remain test/environment safe.
  // ──────────────────────────────────────────────────────────────
  const _nativeFetch =
    domAPI?.getWindow?.()?.fetch?.bind?.(domAPI.getWindow()) || null;

  /**
   * Loads an external HTML template into a specified DOM container and emits a custom event upon completion.
   *
   * Fetches the template from the given URL, injects its HTML into the target container, and optionally sanitizes the content if a sanitizer is available. Emits the specified event with success or failure details after the operation. If the URL contains "modals.html", also emits a "modalsLoaded" event with the same outcome.
   *
   * @param {Object} options - Template loading options.
   * @param {string} options.url - The URL of the HTML template to load.
   * @param {string} options.containerSelector - CSS selector for the DOM container to inject the template into.
   * @param {string} [options.eventName='htmlTemplateLoaded'] - Name of the custom event to emit after loading.
   * @param {number} [options.timeout=15000] - Timeout in milliseconds for the fetch request.
   * @returns {Promise<boolean>} Resolves to true if the template was loaded and injected successfully; false otherwise.
   *
   * @remark
   * If the container is not found or the fetch fails, the event is still dispatched with failure details. For templates with URLs containing "modals.html", a "modalsLoaded" event is always emitted in addition to the main event.
   */
  async function loadTemplate({
    url,
    containerSelector,
    eventName = 'htmlTemplateLoaded',
    timeout = 15_000 // default to 15s
  } = {}) {
    const isModalsHtml = url && url.includes('modals.html');
    logger.info?.(`[HtmlTemplateLoader] Attempting to load template: ${url} into ${containerSelector}`, { url, containerSelector, eventName, isModalsHtml });

    const container = domAPI.querySelector(containerSelector);
    if (!container) {
      logger.warn(`[HtmlTemplateLoader] containerSelector "${containerSelector}" not found in DOM. Template ${url} will not be injected.`);
      // Dispatch event even if container is not found, so listeners are unblocked
      const notFoundEvt = eventHandlers.createCustomEvent(eventName, { detail: { success: false, error: `Container ${containerSelector} not found` } });
      domAPI.dispatchEvent(domAPI.getDocument(), notFoundEvt);
      if (isModalsHtml) {
        const modalsNotFoundEvt = eventHandlers.createCustomEvent('modalsLoaded', { detail: { success: false, error: `Container ${containerSelector} not found for modals.html` } });
        domAPI.dispatchEvent(domAPI.getDocument(), modalsNotFoundEvt);
      }
      return false;
    }

    // Create a manual AbortController for this request
    const controller = new AbortController();
    // Use injected timerAPI instead of window
    const tm = timerAPI.setTimeout(() => {
      logger.warn(`[HtmlTemplateLoader] Timeout loading template: ${url}`, { url, timeout });
      controller.abort();
    }, timeout);

    let success = false;
    let errorInfo = null;
    try {
      logger.info?.(`[HtmlTemplateLoader] Fetching template: ${url}`, { url });

      // Decide which fetch to use:
      // • /static/… or any *.html → use browser/native fetch directly
      // • otherwise → try apiClient.fetch first, then fallback
      const looksStatic = url.startsWith('/static/') || url.endsWith('.html');
      const primaryFetch = looksStatic && _nativeFetch ? _nativeFetch : apiClient.fetch;

      let resp;
      try {
        resp = await primaryFetch(url, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal
        });
      } catch (primaryErr) {
        // Fallback: if the first try used apiClient and we have native fetch
        if (primaryFetch !== _nativeFetch && _nativeFetch) {
          logger.warn('[HtmlTemplateLoader] Primary fetch failed, retrying with native fetch', { url });
          resp = await _nativeFetch(url, {
            method: 'GET',
            cache: 'no-store',
            signal: controller.signal
          });
        } else {
          throw primaryErr;
        }
      }

      if (!resp.ok) {
        errorInfo = `HTTP ${resp.status}`;
        throw new Error(errorInfo);
      }

      const html = await resp.text();
      logger.info?.(`[HtmlTemplateLoader] Successfully fetched template: ${url}, preparing to inject. Length: ${html.length}`, { url });

      // Always inject via domAPI to respect DI & built-in sanitiser
      domAPI.setInnerHTML(container, html);
      logger.info?.(`[HtmlTemplateLoader] Successfully injected template: ${url} into ${containerSelector}`, { url });
      success = true;

    } catch (err) {
      errorInfo = errorInfo || err.message;
      // Log the actual error for debugging
      logger.error(`[HtmlTemplateLoader] Failed to load template from ${url}`, err, {
        context: 'HtmlTemplateLoader.loadTemplate',
        url,
        containerSelector,
        eventName
      });
      success = false;
    } finally {
      timerAPI.clearTimeout(tm);

      logger.info?.(`[HtmlTemplateLoader] Dispatching event: ${eventName} for ${url}`, { success, error: errorInfo, url });
      const evt = eventHandlers.createCustomEvent(eventName,
        { detail: { success, error: errorInfo } });
      domAPI.dispatchEvent(domAPI.getDocument(), evt);

      // Special handling for modals.html - always emit modalsLoaded event
      if (isModalsHtml) {
        logger.info?.(`[HtmlTemplateLoader] Dispatching event: modalsLoaded for ${url}`, { success, error: errorInfo, url });
        const modalsLoadedEvent = eventHandlers.createCustomEvent('modalsLoaded',
          { detail: { success, error: errorInfo } });
        domAPI.dispatchEvent(domAPI.getDocument(), modalsLoadedEvent);
      }
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
          url: config.url,
          success: false,
          error: 'Invalid configuration'
        });
        continue;
      }

      const eventName = config.eventName ||
        `templateLoaded:${config.url.split('/').pop()}`;
      const tmo = config.timeout || 15000;

      try {
        const success = await loadTemplate({
          url: config.url,
          containerSelector: config.containerSelector,
          eventName,
          timeout: tmo
        });

        results.push({
          url: config.url,
          success,
          eventNameEmitted: eventName
        });

      } catch (err) {
        results.push({
          url: config.url,
          success: false,
          error: err.message,
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
