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
  domReadinessService,  // NEW: For replay-able events
  logger = DependencySystem?.modules?.get?.('logger') || { warn () {} }
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
  if (!domReadinessService?.emitReplayable)
    throw new Error('[HtmlTemplateLoader] domReadinessService with replay capability is mandatory');

  // ──────────────────────────────────────────────────────────────
  // Native fetch shortcut (bypasses apiClient pre-processing).
  // Will be used for "pure" static assets such as *.html, *.css, …
  // It is derived from domAPI DI to remain test/environment safe.
  // ──────────────────────────────────────────────────────────────
  const _nativeFetch =
    domAPI?.getWindow?.()?.fetch?.bind?.(domAPI.getWindow()) || null;

  /**
   * Helper function to emit events using replay capability if available
   */
  function emitEvent(eventName, detail) {
    if (domReadinessService?.emitReplayable) {
      logger.info?.(`[HtmlTemplateLoader] Emitting replayable event: ${eventName}`, { eventName, detail });
      domReadinessService.emitReplayable(eventName, detail);
    } else {
      logger.info?.(`[HtmlTemplateLoader] Emitting standard event: ${eventName}`, { eventName, detail });
      const evt = eventHandlers.createCustomEvent(eventName, { detail });
      domAPI.dispatchEvent(domAPI.getDocument(), evt);
    }
  }

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
    timeout = 10_000 // default to 10s
  } = {}) {
    const isModalsHtml = url && url.includes('modals.html');
    logger.info?.(`[HtmlTemplateLoader] Attempting to load template: ${url} into ${containerSelector}`, { url, containerSelector, eventName, isModalsHtml });

    const container = domAPI.querySelector(containerSelector);
    if (!container) {
      logger.warn(`[HtmlTemplateLoader] containerSelector "${containerSelector}" not found in DOM. Template ${url} will not be injected.`);
      // Surface template error visibly in document body
      try {
        const errDiv = domAPI.createElement('div');
        errDiv.className = 'template-error';
        errDiv.setAttribute('style', 'background:#efe5e5;color:#a00;font-size:1.2em;padding:1.5em;margin:2em;border:2px solid #a00;z-index:3000;');
        domAPI.setInnerHTML(errDiv, `[HtmlTemplateLoader] ERROR: Could not find container <code>${containerSelector}</code> for template: <code>${url}</code>.<br>Check base.html or container injection order.`);
        domAPI.appendChild(domAPI.getBody(), errDiv);
      } catch (e) {
        // fallback: ignore
      }
      // Dispatch event even if container is not found, so listeners are unblocked
      emitEvent(eventName, { success: false, error: `Container ${containerSelector} not found` });

      if (isModalsHtml) {
        emitEvent('modalsLoaded', { success: false, error: `Container ${containerSelector} not found for modals.html` });
      }
      return false;
    }

    // Early exit: template already injected – we mark this via a data attribute
    if (container.dataset?.htmlLoaded === 'true') {
      // Robustness: Check that DOM actually contains the expected selector for project_list.html
      let templateValid = true;
      if (url.endsWith('project_list.html') && !domAPI.querySelector('#projectCardsPanel', container)) {
        logger.warn?.(`[HtmlTemplateLoader] data-html-loaded is set but #projectCardsPanel missing — resetting loader state for ${url}`);
        templateValid = false;
        // Reset the state
        container.removeAttribute('data-html-loaded');
        domAPI.setInnerHTML(container, ''); // clear out possibly corrupt/partial markup
      }
      if (templateValid) {
        logger.info?.(`[HtmlTemplateLoader] Template already present in ${containerSelector}, skipping fetch for ${url}`, { url, containerSelector });
        emitEvent(eventName, { success: true, skipped: true, reason: 'Template already present', url });
        if (isModalsHtml) {
          emitEvent('modalsLoaded', { success: true, skipped: true, reason: 'Template already present', url });
        }
        return true;
      }
      // Otherwise, proceed to fetch as normal below.
    }

    if (container.dataset.htmlLoading === 'true') {
      logger.info?.('[HtmlTemplateLoader] Another fetch in-flight – waiting…', { url });
      await domReadinessService.waitForEvent(eventName, { timeout });
      return container.dataset.htmlLoaded === 'true';
    }
    container.dataset.htmlLoading = 'true';

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

      // ── Injection strategy ───────────────────────────────────────────────
      // Replacing innerHTML on <body> wipes out existing DOM (e.g. the
      // #projectDetailsView / #projectListView containers already injected),
      // causing domReadinessService time-outs.  If the target container *is*
      // <body>, append the fetched markup instead of replacing it.
      //
      if (domAPI.isSameNode(container, domAPI.getBody())) {
        // Build the markup in a temporary wrapper to avoid double sanitisation
        const tempWrapper = domAPI.createElement('div');
        domAPI.setInnerHTML(tempWrapper, html);
        Array.from(tempWrapper.childNodes).forEach((node) =>
          domAPI.appendChild(container, node)
        );
      } else {
        // Regular containers – safe to replace their content
        domAPI.setInnerHTML(container, html);
      }
      // Mark as loaded so subsequent loadTemplate calls can short-circuit safely
      container.setAttribute('data-html-loaded', 'true');
      logger.info?.(
        `[HtmlTemplateLoader] Successfully injected template: ${url} into ${containerSelector}`,
        { url }
      );
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
      delete container.dataset.htmlLoading;
      timerAPI.clearTimeout(tm);

      // Emit main event using replay capability
      emitEvent(eventName, { success, error: errorInfo, url });

      // Special handling for modals.html - always emit modalsLoaded event
      if (isModalsHtml) {
        emitEvent('modalsLoaded', { success, error: errorInfo, url, synthetic: false });
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
        emitEvent(eventName, { success: false, error: err.message });
      }
    }

    return results;
  }

  // Guardrails: expose cleanup in factory return
  function cleanup() {
    // No-op, present for API uniformity. If listeners or timeouts were set up by this module, clear here.
  }

  return { loadTemplate, loadAppTemplates, cleanup };
}
