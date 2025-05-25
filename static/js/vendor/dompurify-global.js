import DOMPurify from './dompurify.es.js';

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
