/**
 * accessibility-utils.js – centralized accessibility helpers & keyboard shortcuts
 *
 * This refactored version addresses:
 *  - A teardown method for SPA usage
 *  - Replacing direct addEventListener calls with eventHandlers.trackListener
 *  - Error handling on async code
 *  - More modular keyboard shortcut logic
 *
 * Exports:
 *   initAccessibilityEnhancements(opts)
 *   destroyAccessibilityEnhancements()
 */

let keyboardShortcutsEnabled = true;
let lastFocusedElement = null;

let eventHandlers;
let DependencySystem;

/**
 * Stores references to key event bindings so we can untrack them during teardown.
 * If your "eventHandlers" utility has thorough ways to remove events by
 * element/type/description, you may not need to store them individually here.
 */
const registeredHandlers = [];

/**
 * Initialize all accessibility enhancements.
 * Should be called once during app bootstrap.
 * @param {Object} opts - Optional dependencies
 * @param {Object} opts.eventHandlers - Event handler utilities (required)
 * @param {Object} opts.DependencySystem - Dependency system (optional)
 */
export function initAccessibilityEnhancements(opts = {}) {
  DependencySystem =
    opts.DependencySystem || (typeof window !== 'undefined' && window.DependencySystem);
  eventHandlers =
    opts.eventHandlers || (DependencySystem?.modules?.get?.('eventHandlers'));
  if (!eventHandlers) {
    throw new Error('eventHandlers required for accessibility-utils');
  }

  bindGlobalShortcuts();
  enhanceFormAccessibility();
  improveModalAccessibility();
  setupSkipLinks();

  if (DependencySystem) {
    DependencySystem.register('accessibilityUtils', {
      focusElement,
      getFocusable,
      trapFocus,
      toggleKeyboardShortcuts,
      announce,
      destroyAccessibilityEnhancements
    });
  }
}

/**
 * Unregister all tracked event listeners and reset internal state if needed.
 * Call this when the SPA is about to unload or re-initialize.
 */
export function destroyAccessibilityEnhancements() {
  // Remove each tracked listener using eventHandlers.cleanupListeners() or untrack manually
  registeredHandlers.forEach(h => {
    try {
      eventHandlers.cleanupListeners(
        h.element,
        h.type,
        h.description
      );
    } catch (err) {
      console.warn('[Accessibility] Failed removing listener:', h, err);
    }
  });
  registeredHandlers.length = 0;

  // Optionally reset any global states:
  keyboardShortcutsEnabled = true;
  lastFocusedElement = null;
}

/**
 * Bind all global keyboard shortcuts (including sidebar controls).
 */
function bindGlobalShortcuts() {
  const handler = async function handleGlobalKeydown(e) {
    if (!keyboardShortcutsEnabled || isInput(e.target)) return;

    let sidebar = null;
    try {
      sidebar = await DependencySystem?.waitFor?.('sidebar', null, 3000);
    } catch (err) {
      console.error('Sidebar waitFor failed:', err);
      // Gracefully continue without sidebar.
    }

    // toggle sidebar: `/`, `` ` ``, or `\`
    if ((e.key === '/' || e.key === '`' || e.key === '\\') && noMods(e)) {
      e.preventDefault();
      sidebar?.toggleSidebar();
      return;
    }

    // switch tabs: 1 → recent, 2 → starred, 3 → projects
    if (noMods(e) && ['1', '2', '3'].includes(e.key)) {
      e.preventDefault();
      const mapping = { '1': 'recent', '2': 'starred', '3': 'projects' };
      sidebar?.activateTab(mapping[e.key]);
      return;
    }

    // pin/unpin: `p`
    if (e.key.toLowerCase() === 'p' && noMods(e)) {
      e.preventDefault();
      sidebar?.togglePin();
      return;
    }

    // new project/conversation: `n`
    if (e.key.toLowerCase() === 'n' && noMods(e)) {
      e.preventDefault();
      document.getElementById('sidebarNewProjectBtn')?.click();
      return;
    }

    // focus search: `s`
    if (e.key.toLowerCase() === 's' && noMods(e)) {
      e.preventDefault();
      focusElement('#sidebarProjectSearch');
      return;
    }

    // toggle keyboard-help: `?`
    if (e.key === '?' && noMods(e)) {
      e.preventDefault();
      toggleKeyboardHelp();
      return;
    }

    // close keyboard-help: Escape
    if (e.key === 'Escape') {
      closeKeyboardHelpIfOpen();
      return;
    }
  };

  trackListenerWithRegister(document, 'keydown', handler, {
    description: 'Global keyboard shortcuts'
  });

  // click on close button inside help dialog
  const closeHelpHandler = function handleHelpDialogCloseClick(e) {
    if (e.target.closest('#keyboardHelp button')) {
      closeKeyboardHelpIfOpen();
    }
  };
  trackListenerWithRegister(document, 'click', closeHelpHandler, {
    description: 'Help close click'
  });
}

/**
 * Helper to ensure event has no Ctrl/Alt/Meta
 */
function noMods(e) {
  return !e.ctrlKey && !e.altKey && !e.metaKey;
}

/**
 * Toggle the keyboard-shortcut help dialog.
 * @param {boolean} [show]
 */
function toggleKeyboardHelp(show) {
  const dlg = document.getElementById('keyboardHelp');
  if (!dlg) return;

  const isShown = !dlg.classList.contains('hidden');
  const shouldShow = show === undefined ? !isShown : show;
  if (shouldShow === isShown) return;

  if (shouldShow) {
    lastFocusedElement = document.activeElement;
    dlg.classList.remove('hidden');
    trapFocus(dlg);
    focusElement(dlg.querySelector('button') || dlg);
  } else {
    dlg.classList.add('hidden');
    lastFocusedElement?.focus?.();
  }
}

/**
 * Close the keyboard-help dialog if it's open.
 */
function closeKeyboardHelpIfOpen() {
  toggleKeyboardHelp(false);
}

/**
 * Enable or disable all keyboard shortcuts.
 * @param {boolean} [enable]
 * @returns {boolean} current state
 */
function toggleKeyboardShortcuts(enable) {
  keyboardShortcutsEnabled =
    enable === undefined ? !keyboardShortcutsEnabled : !!enable;
  return keyboardShortcutsEnabled;
}

/**
 * Add real-time validation feedback to form inputs.
 */
function enhanceFormAccessibility() {
  trackListenerWithRegister(document, 'invalid', e => {
    if (e.target.classList.contains('validator')) {
      handleFormValidation(e.target, false);
    }
  }, { capture: true, description: 'Form validator invalid' });

  trackListenerWithRegister(document, 'change', e => {
    if (e.target.classList.contains('validator')) {
      handleFormValidation(e.target, e.target.validity.valid);
    }
  }, { description: 'Form validator change' });
}

function handleFormValidation(input, isValid) {
  let hint = document.querySelector(`#${input.id}-hint`);
  if (!hint) {
    hint = document.createElement('p');
    hint.id = `${input.id}-hint`;
    hint.className = 'validator-hint';
    input.insertAdjacentElement('afterend', hint);
  }

  if (isValid) {
    input.classList.add('validator-success');
    input.classList.remove('validator-error');
    hint.className = 'validator-hint validator-hint-success';
    hint.textContent = '✓ Valid input';
    hint.setAttribute('aria-live', 'polite');
  } else {
    input.classList.add('validator-error');
    input.classList.remove('validator-success');
    hint.className = 'validator-hint validator-hint-error';
    if (input.validity.valueMissing) {
      hint.textContent = 'This field is required';
    } else if (input.validity.typeMismatch) {
      hint.textContent = `Please enter a valid ${input.type}`;
    } else if (input.validity.tooShort) {
      hint.textContent = `Must be at least ${input.minLength} characters`;
    } else if (input.validity.tooLong) {
      hint.textContent = `Must be at most ${input.maxLength} characters`;
    } else if (input.validity.patternMismatch) {
      hint.textContent = input.title || 'Please match the requested format';
    } else {
      hint.textContent = 'Please enter a valid value';
    }
    hint.setAttribute('aria-live', 'assertive');
  }
}

/**
 * Observes dialog elements for 'open' attribute changes to trap focus.
 */
function improveModalAccessibility() {
  const observer = new MutationObserver(mutations => {
    mutations.forEach(m => {
      if (m.type === 'attributes' && m.attributeName === 'open' && m.target.tagName === 'DIALOG') {
        if (m.target.hasAttribute('open')) trapFocus(m.target);
      }
    });
  });

  document.querySelectorAll('dialog').forEach(d => {
    observer.observe(d, { attributes: true });
  });

  // Watch for new dialogs being added dynamically
  const bodyObserver = new MutationObserver(muts => {
    muts.forEach(m => {
      m.addedNodes.forEach(node => {
        if (node.tagName === 'DIALOG') {
          observer.observe(node, { attributes: true });
        } else if (node.querySelectorAll) {
          node.querySelectorAll('dialog').forEach(d => observer.observe(d, { attributes: true }));
        }
      });
    });
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });
}

/**
 * Setup “Skip to content” links.
 */
function setupSkipLinks() {
  const skip = document.querySelector('.skip-to-content');
  if (!skip) return;
  const skipHandler = e => {
    e.preventDefault();
    const target = document.getElementById(skip.getAttribute('href').substring(1));
    if (target) {
      target.tabIndex = -1;
      target.focus();
    }
  };
  trackListenerWithRegister(skip, 'click', skipHandler, {
    description: 'Skip to content link'
  });
}

/**
 * Trap focus within a container element.
 * @param {HTMLElement} container
 */
function trapFocus(container) {
  if (!container) return;
  const focusables = getFocusable(container);
  if (!focusables.length) return;

  const first = focusables[0];
  const last = focusables[focusables.length - 1];

  const keydownHandler = e => {
    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  container.addEventListener('keydown', keydownHandler);

  // Ensure focus is inside container
  setTimeout(() => {
    if (!container.contains(document.activeElement)) first.focus();
  }, 50);
}

/**
 * Return all focusable elements within a container.
 * @param {HTMLElement} container
 * @returns {HTMLElement[]}
 */
function getFocusable(container) {
  const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll(sel)).filter(el => {
    return !el.disabled &&
      el.offsetParent !== null &&
      getComputedStyle(el).visibility !== 'hidden';
  });
}

/**
 * Focus an element by selector or directly.
 * @param {string|HTMLElement} target
 * @param {number} [delay=0]
 * @returns {boolean}
 */
function focusElement(target, delay = 0) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el || typeof el.focus !== 'function') return false;
  if (delay) {
    setTimeout(() => el.focus(), delay);
  } else {
    el.focus();
  }
  return true;
}

/**
 * Check whether an element is an input/control.
 * @param {EventTarget} el
 * @returns {boolean}
 */
function isInput(el) {
  const name = el.tagName?.toLowerCase();
  return name === 'input' || name === 'textarea' || name === 'select' || el.isContentEditable;
}

/**
 * Announce text via ARIA live region.
 * @param {string} text
 * @param {string} [mode='polite']
 */
function announce(text, mode = 'polite') {
  let region = document.getElementById('a11y-announcer');
  if (!region) {
    region = document.createElement('div');
    region.id = 'a11y-announcer';
    region.className = 'sr-only';
    region.setAttribute('aria-live', mode);
    region.setAttribute('aria-atomic', 'true');
    document.body.appendChild(region);
  }
  region.textContent = '';
  setTimeout(() => {
    region.textContent = text;
  }, 50);
}

/**
 * Helper for registering event listeners via eventHandlers.
 * Adds each registration to 'registeredHandlers' to allow cleanup later.
 */
function trackListenerWithRegister(element, type, handler, options = {}) {
  const wrappedHandler = eventHandlers.trackListener(element, type, handler, options);
  if (!wrappedHandler) return;
  registeredHandlers.push({
    element,
    type,
    description: options.description || ''
  });
}
