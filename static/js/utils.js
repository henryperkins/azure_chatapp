/**
 * Utilities for safe DOM manipulation
 */
class DOMUtils {
  static sanitize(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  static setText(element, text) {
    if (element instanceof HTMLElement) {
      if (element.dataset.sanitize === 'true') {
        element.innerHTML = this.sanitize(text);
      } else {
        element.textContent = text;
      }
    }
  }
}

window.DOMUtils = DOMUtils;
