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
export function createHtmlTemplateLoader({
  DependencySystem,
  domAPI,
  notify,
  windowObj = window
} = {}) {
  if (!DependencySystem) throw new Error('DependencySystem required');
  if (!domAPI)           throw new Error('domAPI required');
  if (!notify)           throw new Error('notify util required');

  const loaderNotify = notify.withContext({
    module : 'HtmlTemplateLoader',
    context: 'htmlLoader'
  });

  async function loadTemplate({
    url,
    containerSelector,
    eventName    = 'htmlTemplateLoaded',
    timeout      = 8_000
  } = {}) {
    const container = domAPI.querySelector(containerSelector);
    if (!container) {
      loaderNotify.error(`Container not found: ${containerSelector}`, { source: 'loadTemplate' });
      return false;
    }
    if (container.childElementCount) {                        // already injected
      domAPI.dispatchEvent(domAPI.getDocument(),
        new CustomEvent(eventName, { detail: { success: true, cached: true } }));
      return true;
    }

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
