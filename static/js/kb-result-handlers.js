/**
 * kb-result-handlers.js (DependencySystem/ESM Refactored)
 *
 * Modular handlers for Knowledge Base result interactions:
 * - Clipboard copy for KB results
 * - Enhanced KB result display styling by relevance
 * - Metadata enrichment for KB result modal
 *
 * Dependencies (supplied via DI/DependencySystem options):
 *   - eventHandlers: REQUIRED (for trackListener)
 *
 * Usage (in app.js or orchestrator):
 *   import { createKbResultHandlers } from './kb-result-handlers.js';
 *   const kbResultHandlers = createKbResultHandlers({ eventHandlers });
 *   kbResultHandlers.init();
 *
 * *DO NOT* use as a global script or with legacy global event listeners!
 */

export function createKbResultHandlers({ eventHandlers } = {}) {
  if (!eventHandlers) {
    throw new Error('[kb-result-handlers] eventHandlers dependency required');
  }

  // -- Init function, call once when DOM is ready and deps are injected
  function init() {
    initializeKnowledgeCopyFeatures();
    enhanceKnowledgeResultDisplay();
  }

  /** Clipboard features */
  function initializeKnowledgeCopyFeatures() {
    // Tracked listener via eventHandlers -- never direct addEventListener
    const copyBtn = document.getElementById('copyContentBtn');
    if (copyBtn) {
      eventHandlers.trackListener(copyBtn, 'click', () => {
        copyKnowledgeContent();
      });
    }

    const kbModal = document.getElementById('knowledgeResultModal');
    if (kbModal) {
      eventHandlers.trackListener(kbModal, 'keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
          const selection = window.getSelection();
          if (!selection || selection.toString().trim() === '') {
            e.preventDefault();
            copyKnowledgeContent();
          }
        }
      });
    }
  }

  function copyKnowledgeContent() {
    const contentElement = document.getElementById('knowledgeResultContent');
    if (!contentElement) return;

    const textToCopy = contentElement.textContent;

    navigator.clipboard.writeText(textToCopy)
      .then(() => {
        showCopyFeedback(true);
      })
      .catch(err => {
        console.error('Failed to copy text: ', err);
        showCopyFeedback(false);
      });
  }

  function showCopyFeedback(success) {
    const feedbackEl = document.getElementById('copyFeedback');
    if (!feedbackEl) return;

    // Update message and icon
    if (!success) {
      feedbackEl.classList.remove('alert-success');
      feedbackEl.classList.add('alert-error');
      feedbackEl.querySelector('span').textContent = 'Failed to copy to clipboard';

      const iconSvg = feedbackEl.querySelector('svg');
      if (iconSvg) {
        iconSvg.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />';
      }
    } else {
      feedbackEl.classList.remove('alert-error');
      feedbackEl.classList.add('alert-success');
      feedbackEl.querySelector('span').textContent = 'Content copied to clipboard!';

      const iconSvg = feedbackEl.querySelector('svg');
      if (iconSvg) {
        iconSvg.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />';
      }
    }

    feedbackEl.classList.remove('hidden');

    // Hide after delay (reset state)
    setTimeout(() => {
      feedbackEl.classList.add('hidden');
    }, 3000);
  }

  /** Enhance display by relevance score and metadata */
  function enhanceKnowledgeResultDisplay() {
    const kbModal = document.getElementById('knowledgeResultModal');
    if (!kbModal) return;

    // Enhance style on open attribute change
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'open' &&
          mutation.target.id === 'knowledgeResultModal' &&
          mutation.target.hasAttribute('open')
        ) {
          updateResultStyleByRelevance();
        }
      });
    });
    observer.observe(kbModal, { attributes: true });
  }

  function updateResultStyleByRelevance() {
    const scoreEl = document.getElementById('knowledgeResultScore');
    if (!scoreEl) return;

    const scoreText = scoreEl.textContent;
    let scorePercent = 0;

    // Extract numeric percentage from text (e.g., "92%" -> 92)
    if (scoreText) {
      const match = scoreText.match(/(\d+)%?/);
      if (match && match[1]) {
        scorePercent = parseInt(match[1], 10);
      }
    }

    scoreEl.classList.remove(
      'kb-result-relevance-high',
      'kb-result-relevance-medium',
      'kb-result-relevance-low'
    );
    if (scorePercent >= 80) {
      scoreEl.classList.add('kb-result-relevance-high');
    } else if (scorePercent >= 60) {
      scoreEl.classList.add('kb-result-relevance-medium');
    } else {
      scoreEl.classList.add('kb-result-relevance-low');
    }
    populateResultMetadata();
  }

  function populateResultMetadata() {
    const typeEl = document.getElementById('knowledgeResultType');
    const dateEl = document.getElementById('knowledgeResultDate');
    const sizeEl = document.getElementById('knowledgeResultSize');
    if (!typeEl || !dateEl || !sizeEl) return;
    const sourceEl = document.getElementById('knowledgeResultSource');
    if (!sourceEl) return;
    const filePath = sourceEl.textContent || '';
    if (filePath) {
      const fileExt = filePath.split('.').pop().toLowerCase();
      let fileType = fileExt || 'text';
      const typeMap = {
        'py': 'Python',
        'js': 'JavaScript',
        'html': 'HTML',
        'css': 'CSS',
        'json': 'JSON',
        'md': 'Markdown',
        'txt': 'Text',
        'pdf': 'PDF',
        'docx': 'Word',
        'xlsx': 'Excel'
      };
      typeEl.textContent = typeMap[fileExt] || fileType;
    } else {
      typeEl.textContent = 'Text';
    }
    dateEl.textContent = 'N/A';
    sizeEl.textContent = 'N/A';
  }

  // Factory returns API
  return { init };
}

export default createKbResultHandlers;
