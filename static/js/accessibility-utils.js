/**
 * accessibility-utils.js – Centralized accessibility + keyboard shortcut helpers, teardown-safe.
 *
 * ## Purpose
 * Modular accessibility improvement for SPA UIs: keyboard navigation, modal focus, skip links, etc.
 *
 * ## Design
 * - NO direct window/global usage: all dependencies (eventHandlers, DependencySystem, notificationHandler) must be injected.
 * - NO side-effects on import: must be explicitly initialized by calling `initAccessibilityEnhancements(opts)`.
 * - All DOM events must register via eventHandlers.trackListener (never use raw addEventListener except in wrapped helper called here via trackListener).
 * - Notification, warning, and error feedback routed via injected notificationHandler/showNotification (never console.log/error/warn).
 * - All async handlers have try/catch and propagate errors contextually via notificationHandler.
 * - All state is internal or closure-bound; nothing leaks to window or global scope.
 * - Full teardown support: all listeners cleaned via eventHandlers.cleanupListeners in destroyAccessibilityEnhancements.
 *
 * ## Exports:
 *   initAccessibilityEnhancements(opts)
 *   destroyAccessibilityEnhancements()
 *
 * ## DI requirements (all REQUIRED!):
 *   - opts.eventHandlers: { trackListener, cleanupListeners }
 *   - opts.notify: notification util (object: .info/.warn/.error from DI, required)
 *   - opts.DependencySystem: Strongly recommended for registration, but not used for global lookup.
 *
 * If any checklist item is not met, the module must be revised before deployment or merge.
 */

let keyboardShortcutsEnabled = true;
let lastFocusedElement = null;

let eventHandlers;
let DependencySystem;
let notify;

/**
 * Stores references to key event bindings so we can untrack them during teardown.
 * If your "eventHandlers" utility has thorough ways to remove events by
 * element/type/description, you may not need to store them individually here.
 */
const registeredHandlers = [];

/**
 * Initialize all accessibility enhancements.
 * Should be called once during app bootstrap.
 * @param {Object} opts - DI dependencies.
 * @param {Object} opts.eventHandlers - { trackListener, cleanupListeners } (required)
 * @param {Function|Object} opts.notify - notify util (required, from DI)
 * @param {Object} [opts.DependencySystem] - DependencySystem reference (optional, for DS.register)
 */
export function initAccessibilityEnhancements(opts = {}) {
  eventHandlers = opts.eventHandlers;
  notify = opts.notify;
  DependencySystem = opts.DependencySystem;

  if (!eventHandlers || typeof eventHandlers.trackListener !== 'function') {
    throw new Error('eventHandlers with trackListener required for accessibility-utils');
  }
  if (!notify) {
    throw new Error('notify util required for accessibility-utils');
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
      notify.warn(`[Accessibility] Failed removing listener: ${h.description || ''} (${err && err.message ? err.message : err})`, { group: true, context: "accessibility" });
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
    try {
      if (!keyboardShortcutsEnabled || isInput(e.target)) return;

      let sidebar = null;
      try {
        sidebar = await DependencySystem?.waitFor?.('sidebar', null, 3000);
      } catch (err) {
        notify.error(`Sidebar waitFor failed: ${err && err.message ? err.message : err}`, { group: true, context: "accessibility" });
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
    } catch (error) {
      notify.error('[Accessibility] Keyboard shortcut error: ' + (error && error.message ? error.message : error), { group: true, context: "accessibility" });
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
  // Register keydown via tracked/teardown-safe handler.
  trackListenerWithRegister(container, 'keydown', keydownHandler, {
    description: 'Trap focus Tab handler'
  });

  // Ensure focus is inside container.
  // Timing hack: Without setTimeout, browser may not be ready to focus immediately after dialog opens.
  // This is required to ensure focus is visible for assistive tech and keyboard navigation.
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
    // Timing hack: Required for cases where element may not be immediately focusable on DOM mutation/dialog open.
    // For accessibility, this ensures screen readers and keyboard users get expected focus behavior.
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
  // Timing hack: Needed for ARIA live region announcement (screen readers require DOM mutation separation).
  // Ensures assistive technology announces the updated string.
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
