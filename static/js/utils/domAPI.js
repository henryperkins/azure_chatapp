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
     * Returns the injected documentObject.
     * @returns {Document}
     */
    getDocument: () => documentObject,
  };
}
