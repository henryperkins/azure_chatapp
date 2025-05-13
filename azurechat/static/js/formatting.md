```javascript
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

export { formatText };

```