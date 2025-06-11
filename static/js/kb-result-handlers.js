/**
 * kb-result-handlers.js – Modular KB result interaction handlers (fully DI/SPA-compliant)
 *
 * ## Features
 *  - Clipboard copy for KB results (ARIA, safe DOM APIs)
 *  - Enhanced KB result display styling by relevance
 *  - Metadata enrichment for KB result modal
 *
 * ## Dependencies (all via DI, none global!)
 *   - eventHandlers: REQUIRED ({ trackListener })
 *   - DOMPurify: REQUIRED (sanitizer function/class instance for innerHTML)
 *   - domAPI: REQUIRED (for window/document access)
 *   - logger: REQUIRED (for error logging)
 *
 * ## Usage
 *   import { createKbResultHandlers } from './kb-result-handlers.js';
 *   const kbResultHandlers = createKbResultHandlers({ eventHandlers, DOMPurify, domAPI, logger });
 *   kbResultHandlers.init();
 *
 *  - DO NOT use as a global script or legacy script tag.
 *  - NO direct window, document, or singleton usage is permitted; safe for SSR/testing.
 */

export function createKbResultHandlers({
  eventHandlers,
  browserService,          // NEW – safe window provider
  domAPI,
  sanitizer,               // NEW – replaces DOMPurify
  logger,
  safeHandler,
  DependencySystem
} = {}) {
  if (!browserService) throw new Error('[kb-result-handlers] browserService dependency required');
  if (!sanitizer)      throw new Error('[kb-result-handlers] sanitizer dependency required');
  if (!eventHandlers) throw new Error('[kb-result-handlers] eventHandlers dependency required');
  if (!domAPI) throw new Error('[kb-result-handlers] domAPI dependency required');
  if (!logger) throw new Error('[kb-result-handlers] logger dependency required');
  if (!safeHandler) throw new Error('[kb-result-handlers] safeHandler dependency required');
  if (!DependencySystem) throw new Error('Missing DependencySystem');

  const MODULE_CONTEXT = 'KbResultHandlers'; // single declaration
  const wnd = browserService.getWindow?.();

  // Keep reference to MutationObserver for cleanup
  let observer = null;

  // -- Init function, call once when DOM is ready and deps are injected
  function _cleanup() {
    if (observer && typeof observer.disconnect === 'function') {
      try {
        observer.disconnect();
      } catch (err) {
        logger.error(`[${MODULE_CONTEXT}] Failed to disconnect observer`, err, { context: MODULE_CONTEXT });
      }
      observer = null;
    }
    eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
  }

  function init() {
    initializeKnowledgeCopyFeatures();
    enhanceKnowledgeResultDisplay();

    // Auto-register cleanup with DI so parent components do not forget.
    if (DependencySystem?.modules?.registerCleanup) {
      DependencySystem.modules.registerCleanup(MODULE_CONTEXT, _cleanup);
    }
  }

  /** Clipboard features */
  function initializeKnowledgeCopyFeatures() {
    // Tracked listener via eventHandlers -- never direct addEventListener
    const copyBtn = domAPI.getElementById('copyContentBtn');
    if (copyBtn) {
      eventHandlers.trackListener(
        copyBtn,
        'click',
        safeHandler(copyKnowledgeContent, MODULE_CONTEXT+':copy'),
        { context: MODULE_CONTEXT, description: 'copyBtn click' }
      );
    }

    const kbModal = domAPI.getElementById('knowledgeResultModal');
    if (kbModal) {
      eventHandlers.trackListener(
        kbModal,
        'keydown',
        safeHandler((e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
            const selection = wnd.getSelection && wnd.getSelection();
            if (!selection || selection.toString().trim() === '') {
              e.preventDefault();
              copyKnowledgeContent();
            }
          }
        }, MODULE_CONTEXT+':kbModalKeydown'),
        { context: MODULE_CONTEXT, description: 'kbModal keydown' }
      );
    }
  }

  function copyKnowledgeContent() {
    const contentElement = domAPI.getElementById('knowledgeResultContent');
    if (!contentElement) return;

    const textToCopy = contentElement.textContent;

    wnd.navigator.clipboard.writeText(textToCopy)
      .then(() => {
        showCopyFeedback(true);
      })
      .catch((err) => {
        logger.error(`[${MODULE_CONTEXT}][copyKnowledgeContent] Clipboard write failed`, err, { context: MODULE_CONTEXT });
        showCopyFeedback(false);
      });
  }

  function showCopyFeedback(success) {
    const feedbackEl = domAPI.getElementById('copyFeedback');
    if (!feedbackEl) return;

    // Update message and icon
    if (!success) {
      feedbackEl.classList.remove('alert-success');
      feedbackEl.classList.add('alert-error');
      feedbackEl.querySelector('span').textContent = 'Failed to copy to clipboard!';

      const iconSvg = feedbackEl.querySelector('svg');
      if (iconSvg) {
        domAPI.setInnerHTML(
          iconSvg,
          sanitizer.sanitize('<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />')
        );
      }
    } else {
      feedbackEl.classList.remove('alert-error');
      feedbackEl.classList.add('alert-success');
      feedbackEl.querySelector('span').textContent = 'Content copied to clipboard!';

      const iconSvg = feedbackEl.querySelector('svg');
      if (iconSvg) {
        domAPI.setInnerHTML(
          iconSvg,
          sanitizer.sanitize('<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />')
        );
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
    const kbModal = domAPI.getElementById('knowledgeResultModal');
    if (!kbModal) return;

    // Enhance style on open attribute change
    observer = new MutationObserver(
      safeHandler((mutations) => {
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
      }, MODULE_CONTEXT+':MutationObserver'),
    );
    observer.observe(kbModal, { attributes: true });
  }

  function updateResultStyleByRelevance() {
    const scoreEl = domAPI.getElementById('knowledgeResultScore');
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
    const typeEl = domAPI.getElementById('knowledgeResultType');
    const dateEl = domAPI.getElementById('knowledgeResultDate');
    const sizeEl = domAPI.getElementById('knowledgeResultSize');
    if (!typeEl || !dateEl || !sizeEl) return;
    const sourceEl = domAPI.getElementById('knowledgeResultSource');
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
  return {
    init,
    cleanup: _cleanup
  };
}
