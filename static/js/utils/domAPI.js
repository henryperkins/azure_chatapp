/**
 * domAPI.js — Abstracted DOM helpers for strict DI, testability, and browser-independent access.
 * To be injected throughout app modules instead of direct usage of document, window, or related globals.
 *
 * Usage:
 *   import { createDomAPI } from './domAPI.js';
 *   const domAPI = createDomAPI({ documentObject: document, windowObject: window });
 *   domAPI.getElementById('foo'); // etc.
 */

export function createDomAPI({
  documentObject,
  windowObject,
  debug = false,
  sanitizer = null,
  logger = null
} = {}) {
  if (!documentObject || !windowObject) {
    throw new Error('[domAPI] documentObject & windowObject are required – do not rely on globals.');
  }

  // Local debug output (disabled when debug === false)
  const _log = (...m) => {
    if (!debug) return;
    // Optionally add debugging output here if desired.
  };

  // unified warn/error sink (no direct console)
  let _logger = logger || { warn: () => { }, error: () => { } };

  /* allow late upgrade when real logger is ready */
  function setLogger(newLogger) { if (newLogger) _logger = newLogger; }

  // Guardrails: expose `cleanup()` in factory return for compliance
  function cleanup() {
    // No event listeners or DOM state to clean, but present for guardrail compliance
  }

  // --- Form helper wrappers for DI-strict modules ---
  function checkFormValidity(form) {
    return typeof form?.checkValidity === 'function' ? form.checkValidity() : false;
  }
  function reportFormValidity(form) {
    return typeof form?.reportValidity === 'function' ? form.reportValidity() : false;
  }
  function resetForm(form) {
    if (typeof form?.reset === 'function') form.reset();
  }

  return {
    getElementById(id) {
      const el = documentObject.getElementById(id);
      if (!el) _log(`getElementById("${id}") → null`);
      return el;
    },
    querySelector(arg1, arg2) {
      let base, selector;
      if (typeof arg1 === 'string') {
        selector = arg1;
        base = (arg2 && typeof arg2.querySelector === 'function') ? arg2 : documentObject;
      } else if (arg1 && typeof arg1.querySelector === 'function' && typeof arg2 === 'string') {
        base = arg1;
        selector = arg2;
      } else {
        throw new Error('[domAPI.querySelector] Invalid arguments; fallback to String(arg1) is forbidden.');
      }
      const el = base.querySelector(selector);
      if (!el) _log(`querySelector("${selector}") (base=${base?.id || base?.nodeName || 'document'}) → null`);
      return el;
    },
    querySelectorAll(arg1, arg2) {
      let base, selector;
      if (typeof arg1 === 'string') {
        selector = arg1;
        base = (arg2 && typeof arg2.querySelectorAll === 'function') ? arg2 : documentObject;
      } else if (arg1 && typeof arg1.querySelectorAll === 'function' && typeof arg2 === 'string') {
        base = arg1;
        selector = arg2;
      } else {
        selector = String(arg1);
        base = documentObject;
      }
      return base.querySelectorAll(selector);
    },
    createElement: (tag) => documentObject.createElement(tag),
    getBody: () => documentObject.body,
    getDocumentElement: () => documentObject.documentElement,
    getScrollingElement: () =>
      documentObject.scrollingElement ||
      documentObject.documentElement ||
      documentObject.body,
    appendChild: (parent, child) => parent && child && parent.appendChild(child),
    removeChild: (parent, child) => {
      if (parent && child && typeof parent.removeChild === 'function') {
        parent.removeChild(child);
      }
    },
    replaceChildren: (parent, ...nodes) => parent && parent.replaceChildren && parent.replaceChildren(...nodes),
    setInnerHTML: (el, html) => {
      if (!el) return;
      if (sanitizer && typeof sanitizer.sanitize === 'function') {
        el.innerHTML = sanitizer.sanitize(html);
      } else {
        _logger.warn('[domAPI] setInnerHTML called without sanitizer (auto-escaped)', { context: 'domAPI:setInnerHTML' });
        el.textContent = String(html).replace(/<[^>]*>?/gm, '');
      }
    },
    isDocumentHidden: () => documentObject.hidden === true,
    ownerDocument: documentObject,
    window: windowObject,
    getActiveElement: () => documentObject.activeElement,
    body: documentObject.body,
    getComputedStyle: (el) => {
      if (windowObject?.getComputedStyle) {
        return windowObject.getComputedStyle(el);
      }
      throw new Error('[domAPI.getComputedStyle] window.getComputedStyle is unavailable; fallback/stub is forbidden.');
    },
    preventDefault: (e) => {
      if (e && typeof e.preventDefault === 'function') {
        e.preventDefault();
      }
    },
    closest(el, selector) {
      if (!el || !selector) return null;
      if (typeof el.closest === 'function') {
        return el.closest(selector);
      }
      let node = el.nodeType === 1
        ? el
        : el.parentElement || el.parentNode;
      const matches =
        node?.matches ||
        node?.webkitMatchesSelector ||
        node?.msMatchesSelector ||
        (() => false);
      while (node && node.nodeType === 1) {
        try {
          if (matches.call(node, selector)) return node;
        } catch (err) {
          _logger.warn('[domAPI] closest selector match failed', { error: err.message, selector, context: 'domAPI:closest' });
        }
        node = node.parentElement || node.parentNode;
      }
      return null;
    },
    addClass(el, cls) {
      if (!el?.classList || !cls) return;
      el.classList.add(...String(cls).split(/\s+/).filter(Boolean));
    },
    removeClass(el, cls) {
      if (!el?.classList || !cls) return;
      el.classList.remove(...String(cls).split(/\s+/).filter(Boolean));
    },
    toggleClass(el, cls, force) {
      if (!el?.classList || !cls) return;
      String(cls).split(/\s+/).filter(Boolean).forEach(c =>
        typeof force === "boolean"
          ? el.classList.toggle(c, force)
          : el.classList.toggle(c)
      );
    },
    hasClass: (el, cls) => {
      return !!(el && el.classList && el.classList.contains(cls));
    },
    setAttribute: (el, k, v) => {
      if (el && typeof el.setAttribute === 'function') {
        el.setAttribute(k, v);
      }
    },
    getAttribute: (el, k) => {
      if (el && typeof el.getAttribute === 'function') {
        return el.getAttribute(k);
      }
      return null;
    },
    removeAttribute: (el, k) => {
      if (el && typeof el.removeAttribute === 'function') {
        el.removeAttribute(k);
      }
    },
    setDataAttribute: (el, k, v) => {
      if (el && el.dataset) {
        el.dataset[k] = v;
      }
    },
    getDataAttribute: (el, k) => {
      return (el && el.dataset) ? el.dataset[k] : undefined;
    },
    removeDataAttribute: (el, k) => {
      if (el && el.dataset) {
        delete el.dataset[k];
      }
    },
    setStyle: (el, prop, val) => {
      if (el && el.style) {
        el.style[prop] = val;
      }
    },
    setProperty(el, prop, value) {
      if (!el) return;
      try {
        if (prop in el) el[prop] = value;
        else el.setAttribute(prop, value);
      } catch (err) {
        _logger.warn('[domAPI] setProperty failed', { error: err.message, prop, context: 'domAPI:setProperty' });
      }
    },
    getTextContent: (el) => {
      if (el && typeof el.textContent === 'string') {
        return el.textContent;
      }
      return '';
    },
    setTextContent: (el, text) => {
      if (el && typeof text === 'string') {
        el.textContent = text;
      }
    },
    getValue: (el) => {
      if (el && typeof el.value !== 'undefined') {
        return el.value;
      }
      return '';
    },
    setValue: (el, value) => {
      if (el && typeof el.value !== 'undefined') {
        el.value = value;
      }
    },
    isSameNode: (elA, elB) => {
      if (elA && typeof elA.isSameNode === 'function') {
        return elA.isSameNode(elB);
      }
      return elA === elB;
    },
    getId: (el) => {
      if (el && typeof el.id === 'string') {
        return el.id;
      }
      return null;
    },
    addEventListener: (el, ...args) => {
      (el ?? documentObject).addEventListener(...args);
    },
    removeEventListener: (el, ...args) => {
      (el ?? documentObject).removeEventListener(...args);
    },
    dispatchEvent: (target, event) => {
      if (!target || typeof target.dispatchEvent !== 'function') {
        throw new Error('dispatchEvent: invalid target');
      }
      return target.dispatchEvent(event);
    },
    getDocument: () => documentObject,
    callMethod: (el, methodName, ...args) => (
      el && typeof el[methodName] === 'function'
        ? el[methodName](...args)
        : undefined
    ),
    getWindow: () => windowObject,
    createDocumentFragment: () => documentObject.createDocumentFragment(),
    createTextNode: (txt = '') => documentObject.createTextNode(txt),
    setElementId: (el, id) => { if (el) el.id = id; },
    setClassName: (el, cls) => { if (el) el.className = cls; },
    selectElement: (el) => {
      try {
        el?.select?.();
      } catch (err) {
        _logger.warn('[domAPI] selectElement failed', { error: err.message, context: 'domAPI:selectElement' });
      }
    },
    getParentNode: (el) => el?.parentNode ?? null,
    insertBefore: (parent, node, refNode = null) =>
      parent?.insertBefore?.(node, refNode),
    createSVGElement: (tag) =>
      documentObject.createElementNS('http://www.w3.org/2000/svg', tag),
    getProperty: (el, prop) => el?.[prop],

    /* ── <NEW helpers – added for ThemeManager> ───────────────────── */

    /**
     * Attach a listener to a MediaQueryList and return an unsubscribe fn.
     * Works with both modern addEventListener('change', …) and the
     * older addListener/removeListener APIs.
     */
    addMediaListener(mqList, handler) {
      if (!mqList || typeof handler !== 'function') return () => {};
      const wrapped = (e) => handler(e);
      if (typeof mqList.addEventListener === 'function') {
        mqList.addEventListener('change', wrapped);
        return () => mqList.removeEventListener('change', wrapped);
      }
      if (typeof mqList.addListener === 'function') {
        mqList.addListener(wrapped);
        return () => mqList.removeListener(wrapped);
      }
      // Fallback: no-op unsubscribe
      return () => {};
    },

    /**
     * Convenience wrapper that creates & starts a MutationObserver.
     * Returns the observer so callers can disconnect() later.
     */
    createMutationObserver(callback, options = {}, target = documentObject) {
      const Observer = windowObject.MutationObserver;
      if (typeof Observer !== 'function') {
        _logger.error('[domAPI] MutationObserver unavailable – createMutationObserver noop',
                      { context: 'domAPI:createMutationObserver' });
        return { disconnect() {} };
      }
      const obs = new Observer(callback);
      try {
        const opts = Object.assign({ childList: true, subtree: true }, options);
        obs.observe(target, opts);
      } catch (err) {
        _logger.error('[domAPI] MutationObserver.observe failed', err,
                      { context: 'domAPI:createMutationObserver' });
      }
      return obs;
    },

    /* ── </NEW helpers> ───────────────────────────────────────────── */

    setLogger,      // ← NEW
    cleanup
  };
}
