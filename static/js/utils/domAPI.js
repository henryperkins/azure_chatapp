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
export function createDomAPI({ documentObject = document, windowObject = window } = {}) {
  if (!documentObject || !windowObject)
    throw new Error("domAPI: Both documentObject and windowObject are required");

  return {
    getElementById: (id) => documentObject.getElementById(id),
    querySelector: (selector) => documentObject.querySelector(selector),
    querySelectorAll: (selector) => documentObject.querySelectorAll(selector),
    createElement: (tag) => documentObject.createElement(tag),
    getBody: () => documentObject.body,
    getDocumentElement: () => documentObject.documentElement,
    getScrollingElement: () =>
      documentObject.scrollingElement ||
      documentObject.documentElement ||
      documentObject.body,
    appendChild: (parent, child) => parent && child && parent.appendChild(child),
    replaceChildren: (parent, ...nodes) => parent && parent.replaceChildren && parent.replaceChildren(...nodes),
    setInnerHTML: (el, html) => {
      if (el) el.innerHTML = html;
    },
    isDocumentHidden: () => documentObject.hidden === true,
    ownerDocument: documentObject,
    window: windowObject,
    // Add getActiveElement for DI strictness; see sidebar/notification rules
    getActiveElement: () => documentObject.activeElement,
    // For event, dispatch, etc. attaching to ownerDocument/window, use domAPI.ownerDocument, domAPI.window

    /**
     * Attach event listener to element or documentObject.
     * @param {Element|Document} el - Target element (or null for documentObject)
     * @param {string} type - Event type
     * @param {Function} handler - Event handler
     * @param {Object|boolean} [opts] - Options
     */
    addEventListener: (el, ...args) => {
      (el ?? documentObject).addEventListener(...args);
    },

    /**
     * Remove event listener from element or documentObject.
     * @param {Element|Document} el - Target element (or null for documentObject)
     * @param {string} type - Event type
     * @param {Function} handler - Event handler
     * @param {Object|boolean} [opts] - Options
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
        // Fallback to documentObject if target is null/undefined and meant for document
        if (target === null || target === undefined) {
          return documentObject.dispatchEvent(event);
        }
        // Optionally warn in dev mode
        if (typeof window !== "undefined" && window.console && window.console.warn) {
          window.console.warn('domAPI.dispatchEvent: Invalid target or target does not support dispatchEvent.', { target });
        }
        return false;
      }
      return target.dispatchEvent(event);
    },

    /**
     * Returns the injected documentObject.
     * @returns {Document}
     */
    getDocument: () => documentObject,
  };
}
