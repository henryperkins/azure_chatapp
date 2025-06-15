/**
 * debounce.js — DI-safe debounce helper.
 * Requires a timer API that exposes setTimeout and clearTimeout.
 */

export function debounce(fn, wait = 250, timerAPI = null) {
  let timerId = null;

  function getTimerAPI() {
    if (timerAPI?.setTimeout && timerAPI?.clearTimeout) return timerAPI;
    const ds = globalThis?.DependencySystem;
    const bs = ds?.modules?.get?.('browserService');
    if (bs?.setTimeout && bs?.clearTimeout) return bs;
    throw new Error('[debounce] timerAPI with setTimeout/clearTimeout is required (strict DI)');
  }

  return function debounced(...args) {
    const api = getTimerAPI();
    api.clearTimeout(timerId);
    timerId = api.setTimeout(() => {
      timerId = null;
      fn.apply(this, args);
    }, wait);
  };
}