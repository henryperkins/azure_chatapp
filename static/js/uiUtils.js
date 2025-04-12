// Basic UI utilities for the project.
// This file ensures window.uiUtilsInstance is available with necessary helper methods.

window.uiUtilsInstance = {
  createElement(tagName, options = {}) {
    const el = document.createElement(tagName);
    if (options.className) el.className = options.className;
    if (options.id) el.id = options.id;
    if (options.textContent) el.textContent = options.textContent;
    if (options.innerHTML) el.innerHTML = options.innerHTML;
    // Transfer any other properties (e.g., data attributes) onto the element
    for (const [key, value] of Object.entries(options)) {
      if (!['className','id','textContent','innerHTML'].includes(key)) {
        el[key] = value;
      }
    }
    return el;
  },

  toggleVisibility(element, show) {
    if (!element) return;
    element.style.display = show ? '' : 'none';
  },

  formatDate(dateStr) {
    // Basic date formatting helper
    if (!dateStr) return '';
    try {
      const dateObj = new Date(dateStr);
      return dateObj.toLocaleString();
    } catch (err) {
      console.warn('Invalid date:', dateStr);
      return dateStr;
    }
  },

  formatNumber(num) {
    if (typeof num !== 'number') {
      if (!num) return '0';
      const asNum = parseFloat(num);
      if (isNaN(asNum)) return String(num);
      num = asNum;
    }
    return num.toLocaleString();
  },

  fileIcon(fileName = '') {
    // Return an icon name (or short HTML) based on file extension, for display
    const ext = fileName.split('.').pop().toLowerCase();
    // For simplicity, return a short text or placeholder
    const knownExtensions = {
      pdf: '📄',
      doc: '📄',
      docx: '📄',
      txt: '📄',
      md: '📄',
      csv: '📑',
      json: '📑',
      js: '💻',
      py: '💻',
      html: '🌐',
      css: '🎨'
    };
    return knownExtensions[ext] || '📄';
  }
};
