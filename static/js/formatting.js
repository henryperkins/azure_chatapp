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
export function formatText(content) {
  // 1) Escape any malicious HTML
  let safe = escapeHtml(content);

  // 2) Detect code blocks or markdown
  safe = processCodeBlocks(safe);

  // 3) If you want advanced markdown parsing, integrate a library or custom parse
  // safe = marked.parse(safe);

  return safe;
}

/**
 * Summaries often returned by do_summarization could be collapsed by default.
 * This function wraps summarized text in a collapsible element with a toggle.
 */
export function wrapSummarizedContent(summary) {
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
export function activateSummaryToggles(container) {
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
  return result;
}

/**
 * Basic function to safely escape HTML characters.
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
