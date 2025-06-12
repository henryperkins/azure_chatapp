/**
 * ModalRenderer - extracted modal DOM manipulation (Phase-2)
 * ---------------------------------------------------------
 * Handles modal DOM operations, scroll management, dialog element interactions,
 * and modal visibility. Extracted from oversized modalManager.js.
 */

export function createModalRenderer({
  domAPI,
  browserService,
  logger,
  sanitizer
} = {}) {
  const MODULE = 'ModalRenderer';

  if (!domAPI || !browserService || !logger || !sanitizer) {
    throw new Error(`[${MODULE}] Required dependencies missing: domAPI, browserService, logger, sanitizer`);
  }

  const _log = (msg, extra = {}) => logger?.debug?.(`[${MODULE}] ${msg}`, {
    context: MODULE,
    ...extra
  });

  const _logError = (msg, err, extra = {}) => {
    logger?.error?.(`[${MODULE}] ${msg}`, err?.stack || err, {
      context: MODULE,
      ...extra
    });
  };

  // Track body scroll state
  let scrollLockCount = 0;
  let originalScrollPosition = 0;

  function manageBodyScroll(enableScroll) {
    try {
      const document = domAPI.getDocument();
      const body = document.body;
      const scrollingEl = document.documentElement || body;

      if (!enableScroll) {
        // Disable scroll
        scrollLockCount++;
        if (scrollLockCount === 1) {
          // Store current scroll position
          originalScrollPosition = browserService.getWindow().pageYOffset || scrollingEl.scrollTop || 0;
          
          // Apply scroll lock styles
          body.style.position = 'fixed';
          body.style.top = `-${originalScrollPosition}px`;
          body.style.width = '100%';
          body.style.overflow = 'hidden';
          
          _log('Body scroll disabled', { scrollPosition: originalScrollPosition });
        }
      } else {
        // Enable scroll
        scrollLockCount = Math.max(0, scrollLockCount - 1);
        if (scrollLockCount === 0) {
          // Remove scroll lock styles
          body.style.position = '';
          body.style.top = '';
          body.style.width = '';
          body.style.overflow = '';
          
          // Restore scroll position
          setTimeout(() => {
            if (typeof scrollingEl.scrollTo === 'function') {
              scrollingEl.scrollTo(0, originalScrollPosition);
            } else {
              scrollingEl.scrollTop = originalScrollPosition;
            }
          }, 0);
          
          _log('Body scroll enabled', { restoredPosition: originalScrollPosition });
        }
      }
    } catch (err) {
      logger.error('[ModalRenderer] Failed to manage body scroll', err, { enableScroll, context: 'ModalRenderer:manageBodyScroll' });
    }
  }

  function showModalElement(modalEl) {
    if (!modalEl) {
      _logError('showModalElement: modal element required');
      return false;
    }

    try {
      // Use native dialog API if available
      if (typeof modalEl.showModal === 'function') {
        modalEl.showModal();
        _log('Modal shown using native dialog API', { modalId: modalEl.id });
      } else {
        // Fallback for non-dialog elements
        modalEl.style.display = 'block';
        domAPI.removeClass(modalEl, 'hidden');
        modalEl.setAttribute('aria-hidden', 'false');
        _log('Modal shown using fallback method', { modalId: modalEl.id });
      }

      // Disable body scroll
      manageBodyScroll(false);

      // Focus management
      const firstFocusable = modalEl.querySelector(
        'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (firstFocusable) {
        setTimeout(() => firstFocusable.focus(), 100);
      }

      return true;
    } catch (err) {
      logger.error('[ModalRenderer] Failed to show modal element', err, { modalId: modalEl.id, context: 'ModalRenderer:showModalElement' });
      return false;
    }
  }

  function hideModalElement(modalEl) {
    if (!modalEl) {
      _logError('hideModalElement: modal element required');
      return false;
    }

    try {
      // Use native dialog API if available
      if (typeof modalEl.close === 'function') {
        modalEl.close();
        _log('Modal hidden using native dialog API', { modalId: modalEl.id });
      } else {
        // Fallback for non-dialog elements
        modalEl.style.display = 'none';
        domAPI.addClass(modalEl, 'hidden');
        modalEl.setAttribute('aria-hidden', 'true');
        _log('Modal hidden using fallback method', { modalId: modalEl.id });
      }

      // Re-enable body scroll
      manageBodyScroll(true);

      return true;
    } catch (err) {
      logger.error('[ModalRenderer] Failed to hide modal element', err, { modalId: modalEl.id, context: 'ModalRenderer:hideModalElement' });
      return false;
    }
  }

  function findModalElement(modalId) {
    if (!modalId) return null;

    try {
      const modalEl = domAPI.getElementById(modalId);
      if (!modalEl) {
        _log('Modal element not found', { modalId });
        return null;
      }
      return modalEl;
    } catch (err) {
      logger.error('[ModalRenderer] Failed to find modal element', err, { modalId, context: 'ModalRenderer:findModalElement' });
      return null;
    }
  }

  function updateModalContent(modalEl, content, options = {}) {
    if (!modalEl || !content) {
      _logError('updateModalContent: modal element and content required');
      return false;
    }

    try {
      const { sanitize = true, selector = '.modal-content' } = options;
      
      let targetEl = modalEl;
      if (selector) {
        targetEl = modalEl.querySelector(selector) || modalEl;
      }

      const sanitizedContent = sanitize ? sanitizer.sanitize(content) : content;
      
      if (typeof content === 'string') {
        domAPI.setInnerHTML(targetEl, sanitizedContent);
      } else {
        // Assume it's a DOM element
        domAPI.removeAllChildren(targetEl);
        domAPI.appendChild(targetEl, content);
      }

      _log('Modal content updated', { 
        modalId: modalEl.id, 
        contentLength: typeof content === 'string' ? content.length : 'DOM element',
        selector 
      });
      return true;
    } catch (err) {
      _logError('Failed to update modal content', err, { modalId: modalEl.id });
      return false;
    }
  }

  function setModalTitle(modalEl, title) {
    if (!modalEl || !title) return false;

    try {
      const titleEl = modalEl.querySelector('.modal-title, h1, h2, h3');
      if (titleEl) {
        domAPI.setTextContent(titleEl, sanitizer.sanitize(title));
        _log('Modal title updated', { modalId: modalEl.id, title });
        return true;
      }
      return false;
    } catch (err) {
      _logError('Failed to set modal title', err, { modalId: modalEl.id, title });
      return false;
    }
  }

  function createModalBackdrop(modalId) {
    try {
      const document = domAPI.getDocument();
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop fade show';
      backdrop.id = `${modalId}-backdrop`;
      backdrop.setAttribute('aria-hidden', 'true');
      
      document.body.appendChild(backdrop);
      
      _log('Modal backdrop created', { modalId, backdropId: backdrop.id });
      return backdrop;
    } catch (err) {
      _logError('Failed to create modal backdrop', err, { modalId });
      return null;
    }
  }

  function removeModalBackdrop(modalId) {
    try {
      const backdrop = domAPI.getElementById(`${modalId}-backdrop`);
      if (backdrop) {
        backdrop.remove();
        _log('Modal backdrop removed', { modalId });
        return true;
      }
      return false;
    } catch (err) {
      _logError('Failed to remove modal backdrop', err, { modalId });
      return false;
    }
  }

  function isModalVisible(modalEl) {
    if (!modalEl) return false;

    try {
      const isDialogOpen = modalEl.tagName === 'DIALOG' && modalEl.open;
      const isElementVisible = modalEl.style.display !== 'none' && 
                              !domAPI.hasClass(modalEl, 'hidden') &&
                              modalEl.getAttribute('aria-hidden') !== 'true';
      
      return isDialogOpen || isElementVisible;
    } catch (err) {
      _logError('Failed to check modal visibility', err, { modalId: modalEl.id });
      return false;
    }
  }

  function getModalSize(modalEl) {
    if (!modalEl) return null;

    try {
      const rect = modalEl.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        x: rect.x,
        y: rect.y
      };
    } catch (err) {
      _logError('Failed to get modal size', err, { modalId: modalEl.id });
      return null;
    }
  }

  function centerModal(modalEl) {
    if (!modalEl) return false;

    try {
      const window = browserService.getWindow();
      const size = getModalSize(modalEl);
      
      if (size) {
        const centerX = (window.innerWidth - size.width) / 2;
        const centerY = (window.innerHeight - size.height) / 2;
        
        modalEl.style.left = `${Math.max(0, centerX)}px`;
        modalEl.style.top = `${Math.max(0, centerY)}px`;
        
        _log('Modal centered', { modalId: modalEl.id, centerX, centerY });
        return true;
      }
      return false;
    } catch (err) {
      _logError('Failed to center modal', err, { modalId: modalEl.id });
      return false;
    }
  }

  return {
    // Core modal operations
    showModalElement,
    hideModalElement,
    findModalElement,
    isModalVisible,

    // Content management
    updateModalContent,
    setModalTitle,

    // Layout and positioning
    centerModal,
    getModalSize,

    // Backdrop management
    createModalBackdrop,
    removeModalBackdrop,

    // Scroll management
    manageBodyScroll,

    // Utility methods
    getScrollLockCount: () => scrollLockCount,
    getOriginalScrollPosition: () => originalScrollPosition,

    cleanup() {
      _log('cleanup()');
      // Restore scroll if locked
      if (scrollLockCount > 0) {
        scrollLockCount = 0;
        manageBodyScroll(true);
      }
    }
  };
}

export default createModalRenderer;