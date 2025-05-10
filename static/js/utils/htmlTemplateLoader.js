/**
 * HtmlTemplateLoader
 * Factory that fetches & injects external HTML fragments, then emits a
 * custom event (<eventName>) on document so other modules can await it.
 *
 * @param {Object} deps
 * @param {DependencySystem} deps.DependencySystem
 * @param {Object} deps.domAPI
 * @param {Function} deps.notify            – DI notify util
 * @param {Window}   [deps.windowObj=window]
 */
import notify from './notify.js';

/**
 * HtmlTemplateLoader
 * Factory that fetches & injects external HTML fragments, then emits a
 * custom event (<eventName>) on document so other modules can await it.
 *
 * @param {Object} deps
 * @param {DependencySystem} deps.DependencySystem
 * @param {Object} deps.domAPI
 * @param {Window}   [deps.windowObj=window]
 */
export function createHtmlTemplateLoader({
  DependencySystem,
  domAPI,
  windowObj = window
} = {}) {
  if (!DependencySystem) throw new Error('DependencySystem required');
  if (!domAPI)           throw new Error('domAPI required');

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
      container.innerHTML = html;
      loaderNotify.success(`Injected ${url}`, { source: 'loadTemplate' });
      domAPI.dispatchEvent(domAPI.getDocument(),
        new CustomEvent(eventName, { detail: { success: true } }));
      return true;
    } catch (err) {
      loaderNotify.error(`Failed ${url}: ${err.message}`, {
        source: 'loadTemplate', originalError: err
      });
      domAPI.dispatchEvent(domAPI.getDocument(),
        new CustomEvent(eventName, { detail: { success: false, error: err.message } }));
      return false;
    } finally {
      windowObj.clearTimeout(tm);
    }
  }

  return { loadTemplate };
}
