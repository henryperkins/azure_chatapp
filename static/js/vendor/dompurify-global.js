import DOMPurify from './dompurify.es.js';

// Immediately attach to window for app.js compatibility (needed when loaded via <script type="module">)
if (typeof window !== 'undefined') {
  window.DOMPurify = DOMPurify;
}

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
