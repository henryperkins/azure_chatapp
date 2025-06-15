/**
 * elementUtils.js — DOM element helpers.
 * Creates DOM elements with attributes/event listeners, and toggles element visibility.
 */

export function createElement(tag, opts = {}, trackListener, domAPI) {
  const doc = domAPI?.getDocument?.();
  if (!doc) throw new Error('[createElement] domAPI with getDocument() is required');

  const el = doc.createElement(tag);
  if (opts.className) el.className = opts.className;
  if (opts.id) el.id = opts.id;
  if ("textContent" in opts) el.textContent = opts.textContent;
  if ("innerHTML" in opts) {
    if (domAPI?.setInnerHTML) {
      domAPI.setInnerHTML(el, opts.innerHTML);
    } else {
      el.textContent = String(opts.innerHTML).replace(/<[^>]*>?/gm, '');
    }
  }

  Object.entries(opts).forEach(([k, v]) => {
    if (k.startsWith("on") && typeof v === "function") {
      const evt = k.slice(2).toLowerCase();
      if (!trackListener) throw new Error(`[createElement] trackListener required for ${evt}`);
      trackListener(el, evt, v);
    }
  });

  Object.entries(opts).forEach(([k, v]) => {
    if (k.startsWith("data-")) el.setAttribute(k, v);
  });

  [
    "title", "alt", "src", "href", "placeholder", "type", "value", "name"
  ].forEach((p) => {
    if (opts[p] !== undefined) el[p] = opts[p];
  });

  return el;
}

export function toggleElement(selOrEl, show, domAPI) {
  try {
    if (typeof selOrEl === "string") {
      domAPI.querySelectorAll(selOrEl).forEach((el) => el.classList.toggle("hidden", !show));
    } else if (selOrEl && selOrEl.classList) {
      selOrEl.classList.toggle("hidden", !show);
    }
  } catch {
    // Silently fail
  }
}