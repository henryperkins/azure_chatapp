/**
 * kb-result-handlers.js
 * Enhanced handlers for Knowledge Base result interactions
 */

document.addEventListener('DOMContentLoaded', function() {
  // Initialize copy functionality
  initializeKnowledgeCopyFeatures();
  
  // Enhance the knowledge result displays
  enhanceKnowledgeResultDisplay();
});

/**
 * Initialize clipboard functionality for knowledge base results
 */
function initializeKnowledgeCopyFeatures() {
  // Add copy button functionality
  const copyBtn = document.getElementById('copyContentBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', function() {
      copyKnowledgeContent();
    });
  }
  
  // Listen for Ctrl+C in the knowledge result modal when focused
  const kbModal = document.getElementById('knowledgeResultModal');
  if (kbModal) {
    kbModal.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        // Only handle if no text is selected (defer to browser if text is selected)
        const selection = window.getSelection();
        if (!selection || selection.toString().trim() === '') {
          e.preventDefault();
          copyKnowledgeContent();
        }
      }
    });
  }
}

/**
 * Copy the knowledge content to clipboard
 */
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

/**
 * Show feedback after clipboard operation
 * @param {boolean} success - Whether the operation was successful
 */
function showCopyFeedback(success) {
  const feedbackEl = document.getElementById('copyFeedback');
  if (!feedbackEl) return;
  
  // Update message based on success/failure
  if (!success) {
    feedbackEl.classList.remove('alert-success');
    feedbackEl.classList.add('alert-error');
    feedbackEl.querySelector('span').textContent = 'Failed to copy to clipboard';
    
    // Update the icon to an error icon
    const iconSvg = feedbackEl.querySelector('svg');
    if (iconSvg) {
      iconSvg.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />';
    }
  } else {
    feedbackEl.classList.remove('alert-error');
    feedbackEl.classList.add('alert-success');
    feedbackEl.querySelector('span').textContent = 'Content copied to clipboard!';
    
    // Restore success icon
    const iconSvg = feedbackEl.querySelector('svg');
    if (iconSvg) {
      iconSvg.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />';
    }
  }
  
  // Show feedback
  feedbackEl.classList.remove('hidden');
  
  // Hide after delay
  setTimeout(() => {
    feedbackEl.classList.add('hidden');
  }, 3000);
}

/**
 * Enhance knowledge result display with metadata and styling
 */
function enhanceKnowledgeResultDisplay() {
  // Hook into the modal opening
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && 
          mutation.attributeName === 'open' && 
          mutation.target.id === 'knowledgeResultModal' &&
          mutation.target.hasAttribute('open')) {
        
        // Modal is opening, enhance the display
        updateResultStyleByRelevance();
      }
    });
  });
  
  const resultModal = document.getElementById('knowledgeResultModal');
  if (resultModal) {
    observer.observe(resultModal, { attributes: true });
  }
}

/**
 * Update KB result styling based on relevance score
 */
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
  
  // Reset all classes
  scoreEl.classList.remove(
    'kb-result-relevance-high',
    'kb-result-relevance-medium',
    'kb-result-relevance-low'
  );
  
  // Apply appropriate class based on score
  if (scorePercent >= 80) {
    scoreEl.classList.add('kb-result-relevance-high');
  } else if (scorePercent >= 60) {
    scoreEl.classList.add('kb-result-relevance-medium');
  } else {
    scoreEl.classList.add('kb-result-relevance-low');
  }
  
  // Add metadata if available
  populateResultMetadata();
}

/**
 * Populate the metadata fields with file information
 */
function populateResultMetadata() {
  const typeEl = document.getElementById('knowledgeResultType');
  const dateEl = document.getElementById('knowledgeResultDate');
  const sizeEl = document.getElementById('knowledgeResultSize');
  
  // Skip if any elements are missing
  if (!typeEl || !dateEl || !sizeEl) return;
  
  // Get file path from source element
  const sourceEl = document.getElementById('knowledgeResultSource');
  if (!sourceEl) return;
  
  const filePath = sourceEl.textContent || '';
  
  // Try to determine type from file extension
  if (filePath) {
    const fileExt = filePath.split('.').pop().toLowerCase();
    let fileType = fileExt || 'text';
    
    // Map common extensions to more readable types
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
  
  // Set placeholder date if not available from API
  dateEl.textContent = 'N/A';
  
  // Set placeholder size if not available from API
  sizeEl.textContent = 'N/A';
  
  // In a real implementation, you would fetch this data from the API
  // response when the result is selected
}

// Export functionality for use in other modules
window.kbResultHandlers = {
  copyKnowledgeContent,
  showCopyFeedback,
  updateResultStyleByRelevance
};