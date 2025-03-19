/**
 * formatting.js
 * ----------------------------------------------------------------------------
 * Provides safe text formatting (HTML escaping, optional Markdown or code block highlighting),
 * in compliance with the advanced user experience from the Azure Chat Implementation prompt:
 *   - Summarized content expansions
 *   - Code highlighting / inline styling
 *   - Potential markdown transformations
 *   - Basic security via HTML-escaping
 *
 * Use or integrate with highlight.js or marked.js as needed.
 */

document.addEventListener("DOMContentLoaded", () => {
  // If you want to automatically format certain elements on page load:
  autoFormatExistingElements();
});

/**
 * Main entry point for formatting a string representing user/assistant messages or system output.
 * - Escapes HTML to prevent XSS
 * - Optionally detects triple-backtick code blocks or other syntax
 * - Can parse or highlight code if a library is integrated
 */
function formatText(content) {
  // 1) Escape any malicious HTML
  let safe = escapeHtml(content);

  // 2) Detect code blocks or markdown
  safe = processCodeBlocks(safe);

  // 3) If you want advanced markdown parsing, integrate a library or custom parse
  // safe = marked.parse(safe);

  const result = safe;

  return result;
}
window.formatText = formatText;
window.showSummaryIndicator = showSummaryIndicator;

function showSummaryIndicator() {
  const indicator = document.createElement('div');
  indicator.className = 'summary-indicator bg-yellow-100 p-2 mb-2 text-sm';
  indicator.textContent = '⚠️ Conversation was summarized to maintain context';
  return indicator;
}

/**
 * Summaries often returned by do_summarization could be collapsed by default.
 * This function wraps summarized text in a collapsible element with a toggle.
 */
function wrapSummarizedContent(summary) {
  return `
    <div class="bg-yellow-50 p-2 border-l-4 border-yellow-300 text-sm my-2 summarized-block"
         data-collapsed="true">
      <div class="flex items-center justify-between">
        <span class="font-semibold text-yellow-800">Summarized Content</span>
        <button class="toggle-summary-btn text-yellow-700 underline text-sm">
          Expand
        </button>
      </div>
      <div class="summary-content mt-2 hidden">
        ${formatText(summary)}
      </div>
    </div>
  `;
}

/**
 * Utility to attach event listeners for toggling summarized content.
 * This can be invoked after you insert the summarized-block into the DOM.
 */
function activateSummaryToggles(container) {
  const toggles = container.querySelectorAll(".toggle-summary-btn");
  toggles.forEach((btn) => {
    btn.addEventListener("click", () => {
      const parentBlock = btn.closest(".summarized-block");
      const contentEl = parentBlock.querySelector(".summary-content");
      const isCollapsed = parentBlock.getAttribute("data-collapsed") === "true";
      if (isCollapsed) {
        btn.textContent = "Collapse";
        contentEl.classList.remove("hidden");
        parentBlock.setAttribute("data-collapsed", "false");
      } else {
        btn.textContent = "Expand";
        contentEl.classList.add("hidden");
        parentBlock.setAttribute("data-collapsed", "true");
      }
    });
  });
}

/**
 * A naive approach to code block detection:
 * - Looks for triple-backtick-delimited text (``` ... ```).
 * - Wraps the content in <pre><code> for optional highlighting.
 */
function processCodeBlocks(text) {
  const codeRegex = /```([^`]+)```/g;
  let match;
  let lastIndex = 0;
  let result = "";

  while ((match = codeRegex.exec(text)) !== null) {
    result += text.slice(lastIndex, match.index);
    const codeSnippet = match[1].trim();
    result += `<pre class="bg-gray-100 p-2 my-2 rounded"><code>${codeSnippet}</code></pre>`;
    lastIndex = codeRegex.lastIndex;
  }
  result += text.slice(lastIndex);

  // Add support for image responses: [Image: http://...]
  const imageRegex = /\[Image:\s*(data:image\/[^;]+;base64,[^\]]+)\]/gi;
  result = result.replace(imageRegex, (match, base64) => {
    return `<img src="${base64}" alt="Uploaded content" 
                 class="max-w-full h-auto rounded-lg shadow-md mt-2 border
                        border-gray-200 dark:border-gray-600">`;
  });

  return result;
}

/**
 * Basic function to safely escape HTML characters.
 */
function escapeHtml(str) {
  return str.replace(/[^\w. ]/gi, function(c) {
    return '&#' + c.charCodeAt(0) + ';';
  });
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
window.formatBytes = function(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
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