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
export function createFormattingUtils({ domAPI, sanitizer, DependencySystem } = {}) {
  if (!domAPI || !sanitizer || !DependencySystem)
    throw new Error('[formatting] Missing required deps');

  //--- move existing code here ---
  // Replace every ‘document.createElement’  →  domAPI.createElement
  // Replace any other window / document usage with domAPI equivalents.

  return {
    // expose any helpers you actually keep
    cleanup() {
      const EH = DependencySystem.modules.get('eventHandlers');
      if (EH && EH.cleanupListeners) EH.cleanupListeners({ context: 'FormattingUtils' });
    }
  };
}
/**
 * formatting.js
 * Formatting utilities with strict DI.
 */
export function createFormatting({ domAPI } = {}) {
  if (!domAPI) throw new Error('[formatting] domAPI is required');
  // ... rest of the module logic ...
  function htmlToText(html) {
    const div = domAPI?.createElement
      ? domAPI.createElement('div')
      : (() => { throw new Error('[formatting] domAPI missing'); })();
    div.innerHTML = html;
    return div.textContent || '';
  }
  // ... other formatting helpers ...
  return {
    htmlToText
    // ...other exports...
  };
}
