/**
 * formatting.js - Core text formatting utilities
 * Provides HTML escaping and basic code block formatting
 */

/**
 * Format text with HTML escaping and code block support
 * @param {string} content - Input text to format
 * @returns {string} Formatted HTML
 */
function formatText(content) {
  const escaped = escapeHtml(content);
  return processCodeBlocks(escaped);
}
window.formatText = formatText;

/**
 * Process code blocks in text (```code```)
 * @param {string} text - Input text
 * @returns {string} Text with code blocks wrapped in pre/code tags
 */
function processCodeBlocks(text) {
  return text.replace(/```([^`]+)```/g, (match, code) => {
    return `<pre class="code-block"><code>${code.trim()}</code></pre>`;
  });
}

/**
 * Escape HTML special characters
 * @param {string} str - Input string
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Optionally auto-format any elements with [data-format="true"] on page load.
 */
function autoFormatExistingElements() {
  const nodes = document.querySelectorAll('[data-format="true"]');
  nodes.forEach((node) => {
    const original = node.textContent;
    node.innerHTML = formatText(original);
  });
}

// NEW UTILITY FUNCTIONS TO REDUCE DUPLICATION

/**
 * Format file size in human-readable format
 * @param {Number} bytes - Size in bytes
 * @param {Number} decimals - Decimal places
 * @returns {String} - Formatted size (e.g., "1.5 MB")
 */
window.formatBytes = function(bytes, decimals = 1) {
  if (bytes === 0) return '0 Bytes';
  if (bytes < 1024) return `${bytes} Bytes`;

  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unit = '';

  for (let i = 0; i < units.length; i++) {
    size /= 1024;
    unit = units[i];
    if (size < 1024 || i === units.length - 1) {
      break;
    }
  }

  return `${size.toFixed(decimals)} ${unit}`;
};

/**
 * Format date in human-readable format
 * @param {Date|String} date - Date to format
 * @param {Boolean} includeTime - Whether to include time
 * @returns {String} - Formatted date string
 */
window.formatDate = function(date, includeTime = true) {
  if (!date) return '';

  const d = new Date(date);
  const options = {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  };

  if (includeTime) {
    options.hour = '2-digit';
    options.minute = '2-digit';
  }

  return d.toLocaleDateString(undefined, options);
};

/**
 * Get icon for file type
 * @param {String} fileType - File extension or type
 * @returns {String} - Icon HTML
 */
window.getFileTypeIcon = function(fileType) {
  const icons = {
    pdf: '📄',
    doc: '📝',
    docx: '📝',
    txt: '📄',
    csv: '📊',
    json: '📊',
    jpg: '🖼️',
    jpeg: '🖼️',
    png: '🖼️',
    gif: '🖼️',
    zip: '📦',
    default: '📄'
  };

  return icons[fileType.toLowerCase()] || icons.default;
};

/**
 * Create DOM element with given type, attributes, and children
 * @param {String} type - Element type (e.g., 'div', 'span')
 * @param {Object} attributes - Element attributes
 * @param {Array|String} children - Child elements or text
 * @returns {HTMLElement} - Created element
 */
window.createDomElement = function(type, attributes = {}, children = []) {
  const element = document.createElement(type);

  // Set attributes
  Object.entries(attributes).forEach(([key, value]) => {
    if (key === 'class' || key === 'className') {
      element.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.entries(value).forEach(([prop, val]) => {
        element.style[prop] = val;
      });
    } else if (key.startsWith('on') && typeof value === 'function') {
      const eventType = key.substring(2).toLowerCase();
      element.addEventListener(eventType, value);
    } else {
      element.setAttribute(key, value);
    }
  });

  // Add children
  if (typeof children === 'string') {
    element.textContent = children;
  } else if (Array.isArray(children)) {
    children.forEach(child => {
      if (typeof child === 'string') {
        element.appendChild(document.createTextNode(child));
      } else if (child instanceof HTMLElement) {
        element.appendChild(child);
      }
    });
  }

  return element;
};

/**
 * Parse query string parameters
 * @param {String} queryString - URL query string
 * @returns {Object} - Parsed parameters
 */
window.parseQueryString = function(queryString = window.location.search) {
  const params = {};
  const searchParams = new URLSearchParams(queryString);

  for (const [key, value] of searchParams.entries()) {
    params[key] = value;
  }

  return params;
};

/**
 * Create standardized error handling for form submission
 * @param {Event} event - Form submit event
 * @param {Function} successCallback - Function to call on success
 * @param {String} errorMessage - Error message to show
 */
window.handleFormSubmit = function(event, successCallback, errorMessage = "An error occurred") {
  event.preventDefault();

  const form = event.target;
  const data = Object.fromEntries(new FormData(form).entries());

  // Disable form elements during submission
  const formElements = Array.from(form.elements);
  formElements.forEach(el => {
    if (el.tagName !== 'FIELDSET') {
      el.disabled = true;
    }
  });

  // Show loading indicator if present
  const submitBtn = form.querySelector('[type="submit"]');
  const originalBtnText = submitBtn?.textContent;
  if (submitBtn) {
    submitBtn.textContent = 'Loading...';
  }

  // Process form data
  fetch(form.action, {
    method: form.method || 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    credentials: 'include',
    body: JSON.stringify(data)
  })
  .then(response => {
    if (!response.ok) {
      return response.text().then(text => {
        throw new Error(text);
      });
    }
    return response.json();
  })
  .then(result => {
    if (typeof successCallback === 'function') {
      successCallback(result);
    }
  })
  .catch(error => {
    console.error('Form submission error:', error);
    if (window.showNotification) {
      window.showNotification(errorMessage, 'error');
    }
  })
  .finally(() => {
    // Re-enable form elements
    formElements.forEach(el => {
      el.disabled = false;
    });

    // Restore button text
    if (submitBtn && originalBtnText) {
      submitBtn.textContent = originalBtnText;
    }
  });
};
