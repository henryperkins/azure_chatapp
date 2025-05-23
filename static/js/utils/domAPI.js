/**
 * domAPI.js — Abstracted DOM helpers for strict DI, testability, and browser-independent access.
 * To be injected throughout app modules instead of direct usage of document, window, or related globals.
 *
 * Usage:
 *   import { createDomAPI } from './domAPI.js';
 *   const domAPI = createDomAPI({ documentObject: document, windowObject: window });
 *   domAPI.getElementById('foo'); // etc.
 *
 * Methods added in vNEXT:
 *   - addEventListener(el, type, handler, opts): Proxy to el.addEventListener or documentObject.addEventListener.
 *   - removeEventListener(el, type, handler, opts): Proxy to el.removeEventListener or documentObject.removeEventListener.
 *   - getDocument(): Returns the injected documentObject.
 *   - dispatchEvent(el, event): Proxies native dispatchEvent.
 *
 * @param {Object} opts
 * @param {Document} opts.documentObject
 * @param {Window}   opts.windowObject
 * @returns {Object} domAPI instance
 * @method addEventListener(el, type, handler, opts)
 *   Attach event listener to element or documentObject. Proxies native addEventListener.
 * @method removeEventListener(el, type, handler, opts)
 *   Remove event listener from element or documentObject. Proxies native removeEventListener.
 * @method getDocument()
 *   Returns the injected documentObject.
 * @method dispatchEvent(el, event)
 *   Dispatches an Event at the specified EventTarget, (synchronously) invoking the affected EventListeners in the appropriate order.
 */
export function createDomAPI({
  documentObject,
  windowObject,
  debug = false,
  sanitizer = null,
  logger = null,                 // ← NEW
  DependencySystem = null        // ← NEW: fallback resolution
} = {}) {

  if (!documentObject || !windowObject) {
    throw new Error('[domAPI] documentObject & windowObject are required – do not rely on globals.');
  }

  // Local debug output (disabled when debug === false)
  const _log = (...m) => {
    if (!debug) return;
    // Silent debugging when enabled
  };

  // unified warn/error sink (no direct console)
  const _logger =
    logger ||
    DependencySystem?.modules?.get?.('logger') ||
    { warn: ()=>{}, error: ()=>{} };

  return {
    getElementById(id) {
      const el = documentObject.getElementById(id);
      if (!el) _log(`getElementById("${id}") → null`);
      return el;
    },
    /**
     * Flexible, DI-compliant querySelector.
     * Allows: querySelector(selector) -or- querySelector(contextEl, selector)
     * Always route all DOM access via DI as required.
     */
    querySelector(arg1, arg2) {
      let base, selector;
      if (typeof arg1 === 'string') {
        selector = arg1;
        base = (arg2 && typeof arg2.querySelector === 'function') ? arg2 : documentObject;
      } else if (arg1 && typeof arg1.querySelector === 'function' && typeof arg2 === 'string') {
        base = arg1;
        selector = arg2;
      } else {
        // fallback: treat first arg as selector, use document
        selector = String(arg1);
        base = documentObject;
      }
      const el = base.querySelector(selector);
      if (!el) _log(`querySelector("${selector}") (base=${base?.id || base?.nodeName || 'document'}) → null`);
      return el;
    },
    /**
     * Flexible, DI-compliant querySelectorAll.
     * Allows: querySelectorAll(selector) -or- querySelectorAll(contextEl, selector)
     * Always use DI.
     */
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

      // Sanitize HTML content before setting innerHTML
      if (sanitizer && typeof sanitizer.sanitize === 'function') {
        el.innerHTML = sanitizer.sanitize(html);
      } else {
        // SECURITY WARNING: Setting innerHTML without a sanitizer is dangerous!
        _logger.warn('[domAPI] setInnerHTML called without sanitizer (auto-escaped)');
        // Basic escape to avoid XSS when sanitizer missing
        el.textContent = String(html).replace(/<[^>]*>?/gm, '');
      }
    },
    isDocumentHidden: () => documentObject.hidden === true,
    ownerDocument: documentObject,
    window: windowObject,
    // Add getActiveElement for DI strictness; see sidebar/notification rules
    getActiveElement: () => documentObject.activeElement,

    /* quick access to <body> for modules that expect domAPI.body */
    body: documentObject.body,

    /* cross-browser helper needed by AccessibilityUtils */
    getComputedStyle: (el) =>
      (windowObject?.getComputedStyle)
        ? windowObject.getComputedStyle(el)
        : (() => {
            _logger.warn('[domAPI] getComputedStyle fallback returned stub');
            return { visibility: '', display: '' };
          })(),

    /**
     * Prevent default on event if possible
     */
    preventDefault: (e) => {
      if (e && typeof e.preventDefault === 'function') {
        e.preventDefault();
      }
    },

    /**
     * Return el.closest(selector) if available, else null
     */
    closest: (el, selector) => {
      if (el && typeof el.closest === 'function') {
        return el.closest(selector);
      }
      return null;
    },

    /* ───────── Clases utilitarias ───────── */
    addClass(el, cls) {
      if (!el?.classList || !cls) return;
      el.classList.add(...String(cls).split(/\s+/).filter(Boolean));   // admite múltiples clases
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

    /**
     * Check class existence
     */
    hasClass: (el, cls) => {
      return !!(el && el.classList && el.classList.contains(cls));
    },

    /**
     * Set attribute
     */
    setAttribute: (el, k, v) => {
      if (el && typeof el.setAttribute === 'function') {
        el.setAttribute(k, v);
      }
    },

    /**
     * Get attribute
     */
    getAttribute: (el, k) => {
      if (el && typeof el.getAttribute === 'function') {
        return el.getAttribute(k);
      }
      return null;
    },

    /**
     * Remove attribute
     */
    removeAttribute: (el, k) => {
      if (el && typeof el.removeAttribute === 'function') {
        el.removeAttribute(k);
      }
    },

    /**
     * Set data attribute
     */
    setDataAttribute: (el, k, v) => {
      if (el && el.dataset) {
        el.dataset[k] = v;
      }
    },

    /**
     * Get data attribute
     */
    getDataAttribute: (el, k) => {
      return (el && el.dataset) ? el.dataset[k] : undefined;
    },

    /**
     * Remove data attribute
     */
    removeDataAttribute: (el, k) => {
      if (el && el.dataset) {
        delete el.dataset[k];
      }
    },

    /**
     * Set style property
     */
    setStyle: (el, prop, val) => {
      if (el && el.style) {
        el.style[prop] = val;
      }
    },

    /* ───────── Propiedades (DOM & atributo) ───────── */
    setProperty(el, prop, value) {
      if (!el) return;
      try {
        if (prop in el)           el[prop] = value;         // preferencia a propiedad DOM
        else                      el.setAttribute(prop, value); // fallback atributo
      } catch {}
    },

    /**
     * Get textContent
     */
    getTextContent: (el) => {
      if (el && typeof el.textContent === 'string') {
        return el.textContent;
      }
      return '';
    },

    /**
     * Set textContent
     */
    setTextContent: (el, text) => {
      if (el && typeof text === 'string') {
        el.textContent = text;
      }
    },

    /**
     * Get form-like element value
     */
    getValue: (el) => {
      if (el && typeof el.value !== 'undefined') {
        return el.value;
      }
      return '';
    },

    /**
     * Set form-like element value
     */
    setValue: (el, value) => {
      if (el && typeof el.value !== 'undefined') {
        el.value = value;
      }
    },

    /**
     * Compare two elements by isSameNode if possible
     */
    isSameNode: (elA, elB) => {
      if (elA && typeof elA.isSameNode === 'function') {
        return elA.isSameNode(elB);
      }
      return elA === elB;
    },

    /**
     * Safe get element's id
     */
    getId: (el) => {
      if (el && typeof el.id === 'string') {
        return el.id;
      }
      return null;
    },

    /**
     * Attach event listener to element or documentObject.
     * @param {Element|Document} el - Target element (or null for documentObject)
     * @param {string} type - Event type
     * @param {Function} handler - Event handler
     * @param {Object|boolean} [opts] - Options
     */
    /**
     * Add event listener to element, documentObject, or windowObject.
     * NOTE: For global events like 'resize', 'hashchange', or 'popstate', you MUST pass windowObject explicitly.
     * If el is null/undefined, attaches to documentObject by default.
     */
    addEventListener: (el, ...args) => {
      (el ?? documentObject).addEventListener(...args);
    },

    /**
     * Remove event listener from element, documentObject, or windowObject.
     * NOTE: For global events like 'resize', 'hashchange', or 'popstate', you MUST pass windowObject explicitly.
     * If el is null/undefined, removes from documentObject by default.
     */
    removeEventListener: (el, ...args) => {
      (el ?? documentObject).removeEventListener(...args);
    },

    /**
     * Dispatches an Event at the specified EventTarget, (synchronously) invoking the affected EventListeners in the appropriate order.
     * @param {EventTarget|null|undefined} target - The target to dispatch the event on. If null/undefined, defaults to documentObject.
     * @param {Event} event - The event to dispatch.
     * @returns {boolean} Indicates whether the event was canceled.
     */
    dispatchEvent: (target, event) => {
      if (!target || typeof target.dispatchEvent !== 'function') {
        throw new Error('dispatchEvent: invalid target');
      }

      return target.dispatchEvent(event);
    },

    /**
     * Returns the injected documentObject.
     * @returns {Document}
     */
    getDocument: () => documentObject,

    /* ---------- NUEVAS UTILIDADES REQUERIDAS POR OTROS MÓDULOS ---------- */

    /**
     * Invoca con seguridad un método nativo del elemento (por ejemplo
     * checkValidity, reset, focus, reportValidity, etc.) evitando el
     * acceso directo fuera de la capa DI.  Devuelve el valor que retorne
     * el método, o undefined si el método no existe.
     */
    callMethod: (el, methodName, ...args) => (
      el && typeof el[methodName] === 'function'
        ? el[methodName](...args)
        : undefined
    ),

    /**
     * Acceso al window inyectado (algunos módulos lo usan vía domAPI).
     */
    getWindow: () => windowObject,

    /* ───────────── Additional helpers (vNext) ───────────── */
    createDocumentFragment : ()           => documentObject.createDocumentFragment(),
    createTextNode         : (txt = '')   => documentObject.createTextNode(txt),

    setElementId   : (el, id)   => { if (el) el.id         = id;   },
    setClassName   : (el, cls)  => { if (el) el.className  = cls;  },

    /* attribute / dataset shorthands already exist for setDataAttribute
       – add the missing remove variant if not present */

    /* selection helpers required by copy-to-clipboard code */
    selectElement  : (el)        => { try { el?.select?.(); } catch { } },

    /* parent / insertion helpers used by chat UI modules */
    getParentNode  : (el)        => el?.parentNode ?? null,
    insertBefore   : (parent, node, refNode = null) =>
                       parent?.insertBefore?.(node, refNode),

    /* SVG creator required by token-stats & chat extensions */
    createSVGElement : (tag) =>
      documentObject.createElementNS('http://www.w3.org/2000/svg', tag),

    /* generic getter */
    getProperty : (el, prop) => el?.[prop],
  };
}
