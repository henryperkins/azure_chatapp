import DOMPurify from './dompurify.es.js';

// NOTE: Removed top-level mutation of the global window object to comply with
// dependency-injection guard-rails.  The global exposure of DOMPurify is now
// performed lazily inside the DI-created factory below.

export function createDOMPurifyGlobal({ browserService }) {
  if (!browserService) {
    throw new Error('[dompurify-global] Missing browserService dependency');
  }

  const window = browserService.getWindow();
  if (window) {
    window.DOMPurify = DOMPurify;
  }

  return {
    DOMPurify,
    cleanup() {
      // Remove global if needed during cleanup
      const window = browserService.getWindow();
      if (window && window.DOMPurify) {
        delete window.DOMPurify;
      }
    }
  };
}
