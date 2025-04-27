/**
 * accessibility-utils.js
 * Enhanced accessibility utilities for Azure Chat Application
 */

(function() {
  // Track whether keyboard shortcuts are enabled
  let keyboardShortcutsEnabled = true;
  let lastFocusedElement = null;

  // Initialize when DOM is loaded
  document.addEventListener('DOMContentLoaded', initAccessibilityEnhancements);

  /**
   * Initialize all accessibility enhancements
   */
  function initAccessibilityEnhancements() {
    setupKeyboardShortcuts();
    enhanceFormAccessibility();
    improveModalAccessibility();
    setupSkipLinks();

    // Register with DependencySystem if available
    if (window.DependencySystem) {
      window.DependencySystem.register('accessibilityUtils', {
        focusElement,
        getFocusableElements,
        trapFocusInElement,
        toggleKeyboardShortcuts,
        announceScreenReaderText
      });
    }
  }

  /**
   * Set up keyboard shortcuts for common actions
   */
  function setupKeyboardShortcuts() {
    // Only apply when not in input elements
    document.addEventListener('keydown', function(e) {
      // Skip if shortcuts are disabled or if target is an input/textarea/etc
      if (!keyboardShortcutsEnabled || isInputElement(e.target)) {
        return;
      }

      // Question mark opens keyboard shortcut help
      if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        toggleKeyboardHelp();
      }

      // 'N' for new project/conversation
      if (e.key === 'n' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        const newProjBtn = document.getElementById('sidebarNewProjectBtn');
        if (newProjBtn) newProjBtn.click();
      }

      // 'S' to focus search
      if (e.key === 's' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        const searchBox = document.getElementById('sidebarProjectSearch');
        if (searchBox) {
          searchBox.focus();
          searchBox.select();
        }
      }

      // ESC to close keyboard help
      if (e.key === 'Escape') {
        const keyboardHelp = document.getElementById('keyboardHelp');
        if (keyboardHelp && !keyboardHelp.classList.contains('hidden')) {
          e.preventDefault();
          toggleKeyboardHelp(false);
        }
      }
    });

    // Setup keyboard shortcut help panel close button
    document.addEventListener('click', function(e) {
      if (e.target.closest('#keyboardHelp button')) {
        toggleKeyboardHelp(false);
      }
    });
  }

  /**
   * Toggle keyboard shortcut help dialog
   */
  function toggleKeyboardHelp(showHelp) {
    const keyboardHelp = document.getElementById('keyboardHelp');
    if (!keyboardHelp) return;

    const isCurrentlyShown = !keyboardHelp.classList.contains('hidden');
    const shouldShow = showHelp === undefined ? !isCurrentlyShown : showHelp;

    if (shouldShow && isCurrentlyShown) return;
    if (!shouldShow && !isCurrentlyShown) return;

    if (shouldShow) {
      // Store last focused element before showing help
      lastFocusedElement = document.activeElement;
      keyboardHelp.classList.remove('hidden');

      // Focus first interactive element in the help dialog
      const closeBtn = keyboardHelp.querySelector('button');
      if (closeBtn) setTimeout(() => closeBtn.focus(), 50);

      // Trap focus in the dialog
      trapFocusInElement(keyboardHelp);
    } else {
      keyboardHelp.classList.add('hidden');

      // Return focus to previous element
      if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
        setTimeout(() => lastFocusedElement.focus(), 50);
      }
    }
  }

  /**
   * Enable or disable keyboard shortcuts
   */
  function toggleKeyboardShortcuts(enabled) {
    keyboardShortcutsEnabled = enabled === undefined ? !keyboardShortcutsEnabled : !!enabled;
    return keyboardShortcutsEnabled;
  }

  /**
   * Enhance form accessibility throughout the application
   */
  function enhanceFormAccessibility() {
    // Add validation feedback for forms
    document.addEventListener('invalid', function(e) {
      if (e.target.classList.contains('validator')) {
        handleFormValidation(e.target, false);
      }
    }, true);

    document.addEventListener('change', function(e) {
      if (e.target.classList.contains('validator')) {
        handleFormValidation(e.target, e.target.validity.valid);
      }
    });
  }

  /**
   * Handle form validation styling and messaging
   */
  function handleFormValidation(input, isValid) {
    // Find or create hint element
    let hintEl = document.querySelector(`#${input.id}-hint`);
    if (!hintEl) {
      hintEl = document.createElement('p');
      hintEl.id = `${input.id}-hint`;
      hintEl.className = 'validator-hint';
      input.insertAdjacentElement('afterend', hintEl);
    }

    if (isValid) {
      input.classList.add('validator-success');
      input.classList.remove('validator-error');
      hintEl.className = 'validator-hint validator-hint-success';
      hintEl.textContent = '✓ Valid input';
      hintEl.setAttribute('aria-live', 'polite');
    } else {
      input.classList.add('validator-error');
      input.classList.remove('validator-success');
      hintEl.className = 'validator-hint validator-hint-error';

      // Set appropriate error message based on validity state
      if (input.validity.valueMissing) {
        hintEl.textContent = 'This field is required';
      } else if (input.validity.typeMismatch) {
        hintEl.textContent = `Please enter a valid ${input.type}`;
      } else if (input.validity.tooShort) {
        hintEl.textContent = `Must be at least ${input.minLength} characters`;
      } else if (input.validity.tooLong) {
        hintEl.textContent = `Must be at most ${input.maxLength} characters`;
      } else if (input.validity.patternMismatch) {
        hintEl.textContent = input.title || 'Please match the requested format';
      } else {
        hintEl.textContent = 'Please enter a valid value';
      }

      hintEl.setAttribute('aria-live', 'assertive');
    }
  }

  /**
   * Improve modal accessibility by ensuring proper focus management
   */
  function improveModalAccessibility() {
    // Monitor for dialog/modal openings
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' &&
            mutation.attributeName === 'open' &&
            mutation.target.tagName === 'DIALOG') {
          const dialog = mutation.target;
          if (dialog.hasAttribute('open')) {
            trapFocusInElement(dialog);
          }
        }
      });
    });

    // Observe all existing and future dialogs
    document.querySelectorAll('dialog').forEach(dialog => {
      observer.observe(dialog, { attributes: true });
    });

    // Check for new dialogs when content changes
    const bodyObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.addedNodes.length) {
          mutation.addedNodes.forEach(node => {
            if (node.tagName === 'DIALOG') {
              observer.observe(node, { attributes: true });
            } else if (node.querySelectorAll) {
              node.querySelectorAll('dialog').forEach(dialog => {
                observer.observe(dialog, { attributes: true });
              });
            }
          });
        }
      });
    });

    bodyObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Set up skip links for keyboard users
   */
  function setupSkipLinks() {
    const skipLink = document.querySelector('.skip-to-content');
    if (skipLink) {
      skipLink.addEventListener('click', function(e) {
        e.preventDefault();
        const target = document.getElementById(this.getAttribute('href').substring(1));
        if (target) {
          target.tabIndex = -1;
          target.focus();
        }
      });
    }
  }

  /**
   * Trap focus within a specific element (for modals, dialogs)
   */
  function trapFocusInElement(element) {
    if (!element) return;

    const focusableElements = getFocusableElements(element);
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    element.addEventListener('keydown', function(e) {
      if (e.key === 'Tab') {
        // Shift+Tab on first element goes to last element
        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
        // Tab on last element goes to first element
        else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    });

    // Focus first element on open
    setTimeout(() => {
      if (!element.contains(document.activeElement)) {
        firstElement.focus();
      }
    }, 50);
  }

  /**
   * Get all focusable elements within a container
   */
  function getFocusableElements(container) {
    const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const candidates = Array.from(container.querySelectorAll(selector));

    // Filter to only visible and enabled elements
    return candidates.filter(el => {
      return (
        !el.disabled &&
        el.offsetParent !== null &&
        getComputedStyle(el).visibility !== 'hidden'
      );
    });
  }

  /**
   * Focus a specific element with safety checks
   */
  function focusElement(selector, delay = 0) {
    const element = typeof selector === 'string' ?
      document.querySelector(selector) :
      selector;

    if (element && typeof element.focus === 'function') {
      if (delay) {
        setTimeout(() => element.focus(), delay);
      } else {
        element.focus();
      }
      return true;
    }
    return false;
  }

  /**
   * Check if an element is an input element
   */
  function isInputElement(element) {
    const tagName = element.tagName.toLowerCase();
    return (
      tagName === 'input' ||
      tagName === 'textarea' ||
      tagName === 'select' ||
      element.isContentEditable
    );
  }

  /**
   * Announce text via screen reader (ARIA live region)
   */
  function announceScreenReaderText(text, importance = 'polite') {
    let announcer = document.getElementById('a11y-announcer');

    if (!announcer) {
      announcer = document.createElement('div');
      announcer.id = 'a11y-announcer';
      announcer.className = 'sr-only';
      announcer.setAttribute('aria-live', importance);
      announcer.setAttribute('aria-atomic', 'true');
      document.body.appendChild(announcer);
    }

    // Clear previous text first
    announcer.textContent = '';

    // Set new text after a short delay to ensure announcement
    setTimeout(() => {
      announcer.textContent = text;
    }, 50);
  }

  // Export to window for global usage
  window.accessibilityUtils = {
    focusElement,
    getFocusableElements,
    trapFocusInElement,
    toggleKeyboardShortcuts,
    announceScreenReaderText,
    isInputElement
  };
})();
