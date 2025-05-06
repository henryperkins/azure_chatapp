/**
 * domAPI.js — Abstracted DOM helpers for strict DI, testability, and browser-independent access.
 * To be injected throughout app modules instead of direct usage of document, window, or related globals.
 *
 * Usage:
 *   import { createDomAPI } from './domAPI.js';
 *   const domAPI = createDomAPI({ documentObject: document, windowObject: window });
 *   domAPI.getElementById('foo'); // etc.
 *
 * @param {Object} opts
 * @param {Document} opts.documentObject
 * @param {Window}   opts.windowObject
 * @returns {Object} domAPI instance
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
    // For event, dispatch, etc. attaching to ownerDocument/window, use domAPI.ownerDocument, domAPI.window
  };
}
