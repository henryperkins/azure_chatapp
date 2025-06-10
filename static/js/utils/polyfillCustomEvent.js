export function createCustomEventPolyfill({ browserService, logger } = {}) {
  if (!browserService) throw new Error('[CustomEventPolyfill] browserService required');
  const win = browserService.getWindow();
  const doc = browserService.getDocument();
  if (typeof win.CustomEvent === 'function')
    return { applied: false, cleanup () {} };

  function CustomEvent(event, params = { bubbles: false, cancelable: false, detail: undefined }) {
    if (typeof doc?.createEvent === 'function') {
      const evt = doc.createEvent('CustomEvent');
      evt.initCustomEvent(event, params.bubbles, params.cancelable, params.detail);
      return evt;
    }
    return { type: event, detail: params.detail, bubbles: params.bubbles, cancelable: params.cancelable };
  }

  if (typeof win.Event === 'function') {
    CustomEvent.prototype = win.Event.prototype;
  }

  win.CustomEvent = CustomEvent;

  logger?.info?.('[CustomEventPolyfill] applied', { context: 'CustomEventPolyfill' });
  return {
    applied: true,
    cleanup () { delete win.CustomEvent; }
  };
}
