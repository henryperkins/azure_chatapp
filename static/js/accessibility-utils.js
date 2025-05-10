/**
 * accessibility-utils.js – Centralized accessibility + keyboard shortcut helpers, teardown-safe.
 *
 * ## Purpose
 * Modular accessibility improvement for SPA UIs: keyboard navigation, modal focus, skip links, etc.
 *
 * ## Design
 * - Exported via a factory function `createAccessibilityEnhancements(deps)`.
 * - NO direct window/global usage: all dependencies (domAPI, eventHandlers, DependencySystem, notify, errorReporter, createDebugTools) must be injected.
 * - NO side-effects on import: must be explicitly initialized by calling `accessibilityModule.init()`.
 * - All DOM events must register via eventHandlers.trackListener with a module context.
 * - User-facing notification, warning, and error feedback routed via injected notify.
 * - Internal errors logged via injected errorReporter.capture.
 * - All async handlers have try/catch and propagate errors contextually via errorReporter.
 * - All state is internal to the class instance; nothing leaks to window or global scope.
 * - Full teardown support: all listeners cleaned via eventHandlers.cleanupListeners({ context: MODULE_CONTEXT }) in destroy().
 *
 * ## Exports:
 *   createAccessibilityEnhancements(deps)
 *
 * ## DI requirements for createAccessibilityEnhancements(deps):
 *   - deps.domAPI: { getElementById, querySelector, querySelectorAll, createElement, getDocument, getBody, getActiveElement, etc. } (required)
 *   - deps.eventHandlers: { trackListener, cleanupListeners } (required)
 *   - deps.notify: Notification utility { info, warn, error } (required)
 *   - deps.errorReporter: Error reporting utility { capture } (required)
 *   - [deps.DependencySystem]: Strongly recommended for registration.
 *   - [deps.createDebugTools]: Optional, for performance tracing.
 */

const MODULE_CONTEXT = 'accessibilityUtils';

class AccessibilityUtilsModule {
  constructor(deps) {
    // Store dependencies
    this.domAPI = deps.domAPI;
    this.eventHandlers = deps.eventHandlers;
    this.notify = deps.notify;
    this.errorReporter = deps.errorReporter;
    this.DependencySystem = deps.DependencySystem; // Optional

    // Validate required dependencies
    if (!this.domAPI || typeof this.domAPI.getElementById !== 'function' || typeof this.domAPI.getDocument !== 'function') {
      throw new Error('domAPI with core methods (getElementById, getDocument) required for AccessibilityUtilsModule');
    }
    if (!this.eventHandlers || typeof this.eventHandlers.trackListener !== 'function' || typeof this.eventHandlers.cleanupListeners !== 'function') {
      throw new Error('eventHandlers with trackListener and cleanupListeners required for AccessibilityUtilsModule');
    }
    if (!this.notify || typeof this.notify.error !== 'function') {
      throw new Error('notify util with error method required for AccessibilityUtilsModule');
    }
    if (!this.errorReporter || typeof this.errorReporter.capture !== 'function') {
      throw new Error('errorReporter util with capture method required for AccessibilityUtilsModule');
    }

    // Initialize internal state
    this.keyboardShortcutsEnabled = true;
    this.lastFocusedElement = null;
    this.mutationObservers = []; // To keep track of observers for cleanup

    // Initialize debug tools if createDebugTools is provided
    if (deps.createDebugTools && typeof deps.createDebugTools === 'function') {
      this.debug = deps.createDebugTools({ notify: this.notify, contextPrefix: MODULE_CONTEXT });
    } else {
      // Provide a stub if not available, so calls don't break
      this.debug = { start: () => null, stop: () => { }, trace: (fn) => fn() };
    }
  }

  init() {
    const traceId = this.debug.start('init');
    this._bindGlobalShortcuts();
    this._enhanceFormAccessibility();
    this._improveModalAccessibility();
    this._setupSkipLinks();

    if (this.DependencySystem && typeof this.DependencySystem.register === 'function') {
      // avoid double-registration
      const already = this.DependencySystem.modules?.get?.(MODULE_CONTEXT);
      if (!already) {
        this.DependencySystem.register(MODULE_CONTEXT, {
          focusElement: this._focusElement.bind(this),
          getFocusable: this._getFocusable.bind(this),
          trapFocus: this._trapFocus.bind(this),
          toggleKeyboardShortcuts: this.toggleKeyboardShortcuts.bind(this),
          announce: this.announce.bind(this),
          destroy: this.destroy.bind(this), // Allow external destruction if needed
        });
      }
    }
    this.debug.stop(traceId, 'init');
  }

  destroy() {
    const traceId = this.debug.start('destroy');
    if (this.eventHandlers && typeof this.eventHandlers.cleanupListeners === 'function') {
      try {
        this.eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
      } catch (err) {
        // Use errorReporter for internal system issues
        this.errorReporter.capture(err, {
          module: MODULE_CONTEXT,
          method: 'destroy',
          reason: 'Failed cleaning up event listeners',
        });
        // Fallback to notify.warn if errorReporter itself fails or for broader visibility of critical cleanup failure
        this.notify.warn(`[Accessibility] Critical: Failed cleaning up listeners for context '${MODULE_CONTEXT}'. See error logs.`, { group: true, context: MODULE_CONTEXT });
      }
    }

    // Disconnect any MutationObservers
    this.mutationObservers.forEach(observer => observer.disconnect());
    this.mutationObservers.length = 0;

    // Reset internal state
    this.keyboardShortcutsEnabled = true;
    this.lastFocusedElement = null;
    this.debug.stop(traceId, 'destroy');
  }

  _trackListener(element, type, handler, options = {}) {
    if (!element) {
      this.errorReporter.capture(new Error('Attempted to track listener on null element'), {
        module: MODULE_CONTEXT,
        method: '_trackListener',
        type,
        description: options.description,
      });
      return;
    }
    const optionsWithContext = { ...options, context: MODULE_CONTEXT };
    this.eventHandlers.trackListener(element, type, handler, optionsWithContext);
  }

  async _handleGlobalKeydown(e) {
    const traceId = this.debug.start('_handleGlobalKeydown');
    try {
      if (!this.keyboardShortcutsEnabled || this._isInput(e.target)) {
        this.debug.stop(traceId, '_handleGlobalKeydown: skipped (shortcuts disabled or input focus)');
        return;
      }

      let sidebar = null;
      if (this.DependencySystem && typeof this.DependencySystem.waitFor === 'function') {
        try {
          sidebar = await this.DependencySystem.waitFor('sidebar', null, 3000);
        } catch (err) {
          this.errorReporter.capture(err, {
            module: MODULE_CONTEXT,
            method: '_handleGlobalKeydown',
            dependency: 'sidebar',
            reason: 'waitFor timed out or failed',
          });
          // Gracefully continue without sidebar.
        }
      }

      if (this._noMods(e)) {
        let handled = true;
        switch (e.key) {
          case '/':
          case '`':
          case '\\':
            sidebar?.toggleSidebar();
            break;
          case '1':
          case '2':
          case '3': {
            const mapping = { '1': 'recent', '2': 'starred', '3': 'projects' };
            sidebar?.activateTab(mapping[e.key]);
            break;
          }
          case 'p':
          case 'P': // Consider case for key matching
            sidebar?.togglePin();
            break;
          case 'n':
          case 'N':
            this.domAPI.getElementById('sidebarNewProjectBtn')?.click();
            break;
          case 's':
          case 'S':
            this._focusElement('#sidebarProjectSearch');
            break;
          case '?':
            this._toggleKeyboardHelp();
            break;
          default:
            handled = false; // Not one of our shortcuts
        }
        if (handled) e.preventDefault();
      }

      // Escape specifically for closing help (even with modifiers sometimes, depending on UX goals)
      if (e.key === 'Escape') {
        if (this._closeKeyboardHelpIfOpen()) { // If help was open and now closed
          e.preventDefault(); // Prevent other escape actions if help was closed
        }
      }

    } catch (error) {
      this.errorReporter.capture(error, {
        module: MODULE_CONTEXT,
        method: '_handleGlobalKeydown',
        keyEvent: { key: e.key, code: e.code, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey },
      });
    } finally {
      this.debug.stop(traceId, '_handleGlobalKeydown: processed');
    }
  }

  _bindGlobalShortcuts() {
    this._trackListener(this.domAPI.getDocument(), 'keydown', (e) => this._handleGlobalKeydown(e), {
      description: 'Global keyboard shortcuts',
    });

    const closeHelpHandler = (e) => {
      const button = e.target.closest('#keyboardHelp button');
      if (button) {
        this._closeKeyboardHelpIfOpen();
      }
    };
    this._trackListener(this.domAPI.getDocument(), 'click', closeHelpHandler, {
      description: 'Help dialog close button click',
    });
  }

  _noMods(e) {
    return !e.ctrlKey && !e.altKey && !e.metaKey;
  }

  _toggleKeyboardHelp(show) {
    const dlg = this.domAPI.getElementById('keyboardHelp');
    if (!dlg) return;

    const isShown = !dlg.classList.contains('hidden');
    const shouldShow = show === undefined ? !isShown : show;

    if (shouldShow === isShown) return;

    if (shouldShow) {
      this.lastFocusedElement = this.domAPI.getActiveElement();
      dlg.classList.remove('hidden');
      this._trapFocus(dlg);
      // Focus first button or the dialog itself after a short delay for rendering
      this._focusElement(dlg.querySelector('button') || dlg, 50);
    } else {
      dlg.classList.add('hidden');
      this.lastFocusedElement?.focus?.();
      this.lastFocusedElement = null; // Clear reference
    }
  }

  _closeKeyboardHelpIfOpen() {
    const dlg = this.domAPI.getElementById('keyboardHelp');
    if (dlg && !dlg.classList.contains('hidden')) {
      this._toggleKeyboardHelp(false);
      return true; // Was open and action was taken
    }
    return false; // Was not open
  }

  toggleKeyboardShortcuts(enable) {
    this.keyboardShortcutsEnabled = enable === undefined ? !this.keyboardShortcutsEnabled : !!enable;
    this.notify.info(`Keyboard shortcuts ${this.keyboardShortcutsEnabled ? 'enabled' : 'disabled'}.`, { context: MODULE_CONTEXT });
    return this.keyboardShortcutsEnabled;
  }

  _enhanceFormAccessibility() {
    this._trackListener(this.domAPI.getDocument(), 'invalid', (e) => {
      if (e.target.classList.contains('validator')) {
        this._handleFormValidation(e.target, false);
      }
    }, { capture: true, description: 'Form validator invalid event' });

    this._trackListener(this.domAPI.getDocument(), 'change', (e) => {
      if (e.target.classList.contains('validator')) {
        this._handleFormValidation(e.target, e.target.validity.valid);
      }
    }, { description: 'Form validator change event' });
  }

  _handleFormValidation(input, isValid) {
    let hint = this.domAPI.querySelector(`#${input.id}-hint`);
    if (!hint) {
      hint = this.domAPI.createElement('p');
      hint.id = `${input.id}-hint`;
      hint.className = 'validator-hint';
      // Ensure insertAdjacentElement is available on domAPI or use alternative
      if (typeof input.insertAdjacentElement === 'function') {
        input.insertAdjacentElement('afterend', hint);
      } else {
        input.parentNode?.insertBefore(hint, input.nextSibling);
      }
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

  _improveModalAccessibility() {
    const dialogObserverCallback = (mutations) => {
      mutations.forEach(m => {
        if (m.type === 'attributes' && m.attributeName === 'open' && m.target.tagName === 'DIALOG') {
          if (m.target.hasAttribute('open')) {
            this.lastFocusedElement = this.domAPI.getActiveElement();
            this._trapFocus(m.target);
          } else {
            // When dialog closes, try to return focus.
            this.lastFocusedElement?.focus?.();
            this.lastFocusedElement = null;
          }
        }
      });
    };
    const dialogObserver = new MutationObserver(dialogObserverCallback);
    this.mutationObservers.push(dialogObserver);

    this.domAPI.querySelectorAll('dialog').forEach(d => {
      dialogObserver.observe(d, { attributes: true });
    });

    const bodyObserverCallback = (mutations) => {
      mutations.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) { // Check if it's an element
            if (node.tagName === 'DIALOG') {
              dialogObserver.observe(node, { attributes: true });
            } else if (typeof node.querySelectorAll === 'function') {
              node.querySelectorAll('dialog').forEach(d => dialogObserver.observe(d, { attributes: true }));
            }
          }
        });
      });
    };
    const bodyObserver = new MutationObserver(bodyObserverCallback);
    bodyObserver.observe(this.domAPI.getBody(), { childList: true, subtree: true });
    this.mutationObservers.push(bodyObserver);
  }

  _setupSkipLinks() {
    const skipLink = this.domAPI.querySelector('.skip-to-content');
    if (!skipLink) return;

    const skipHandler = (e) => {
      e.preventDefault();
      const targetId = skipLink.getAttribute('href')?.substring(1);
      if (targetId) {
        const targetElement = this.domAPI.getElementById(targetId);
        if (targetElement) {
          if (!targetElement.hasAttribute('tabindex')) {
            targetElement.setAttribute('tabindex', '-1');
          }
          this._focusElement(targetElement); // Use internal focus helper
        }
      }
    };
    this._trackListener(skipLink, 'click', skipHandler, {
      description: 'Skip to content link',
    });
  }

  _trapFocus(container) {
    if (!container) return;
    const focusables = this._getFocusable(container);
    if (!focusables.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    const keydownHandler = (e) => {
      if (e.key === 'Tab') {
        const currentActiveElement = this.domAPI.getActiveElement();
        if (e.shiftKey && currentActiveElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && currentActiveElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    // This listener is specific to the container being trapped.
    // It should be cleaned up if the container is removed or trapping stops.
    // For now, it's cleaned up with the rest of MODULE_CONTEXT listeners.
    this._trackListener(container, 'keydown', keydownHandler, {
      description: 'Trap focus Tab handler for container', // Context will ensure it's cleaned up
    });

    // Ensure first element is focused if focus is not already within the container
    setTimeout(() => {
      // Check if container still exists and is part of the document
      if (this.domAPI.getBody().contains(container) && !container.contains(this.domAPI.getActiveElement())) {
        first.focus();
      }
    }, 50); // Accessibility timing
  }

  _getFocusable(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return [];
    const sel = 'a[href], button, input, textarea, select, details, [tabindex]:not([tabindex="-1"])';
    return Array.from(container.querySelectorAll(sel)).filter(el =>
      !el.disabled &&
      !el.closest('[inert]') && // Respect inert attribute
      el.offsetParent !== null && // Element is visible
      this.domAPI.getComputedStyle(el).visibility !== 'hidden' &&
      this.domAPI.getComputedStyle(el).display !== 'none'
    );
  }

  _focusElement(target, delay = 0) {
    const el = typeof target === 'string' ? this.domAPI.querySelector(target) : target;
    if (!el || typeof el.focus !== 'function') return false;

    const actuallyFocus = () => {
      // Check if element is still in DOM and focusable before focusing
      if (this.domAPI.getBody().contains(el) && typeof el.focus === 'function') {
        el.focus();
      } else {
        this.errorReporter.capture(new Error('Element to focus is no longer valid or focusable'), {
          module: MODULE_CONTEXT,
          method: '_focusElement',
          target: typeof target === 'string' ? target : el.tagName,
        });
      }
    };

    if (delay > 0) {
      setTimeout(actuallyFocus, delay); // Accessibility timing
    } else {
      actuallyFocus();
    }
    return true;
  }

  _isInput(el) {
    if (!el || typeof el.tagName !== 'string') return false;
    const name = el.tagName.toLowerCase();
    return name === 'input' || name === 'textarea' || name === 'select' || el.isContentEditable;
  }

  announce(text, mode = 'polite') {
    let region = this.domAPI.getElementById('a11y-announcer');
    if (!region) {
      region = this.domAPI.createElement('div');
      region.id = 'a11y-announcer';
      // Standard visually hidden styles:
      Object.assign(region.style, {
        border: '0',
        clip: 'rect(0 0 0 0)',
        height: '1px',
        margin: '-1px',
        overflow: 'hidden',
        padding: '0',
        position: 'absolute',
        width: '1px',
        whiteSpace: 'nowrap', // Avoid line breaks reading as spaces
      });
      region.setAttribute('aria-live', mode);
      region.setAttribute('aria-atomic', 'true');
      this.domAPI.getBody().appendChild(region);
    }
    // Update mode if different
    if (region.getAttribute('aria-live') !== mode) {
      region.setAttribute('aria-live', mode);
    }

    // Clear previous content before setting new, helps some SRs re-announce.
    region.textContent = '';

    // Accessibility timing: Use setTimeout to ensure ARIA live region updates are reliably announced.
    setTimeout(() => {
      region.textContent = text;
    }, 50);
  }
}

export function createAccessibilityEnhancements(deps) {
  // Basic check for essential dependencies at factory level
  if (!deps || !deps.domAPI || !deps.eventHandlers || !deps.notify || !deps.errorReporter) {
    console.error('AccessibilityUtils: Missing one or more core dependencies (domAPI, eventHandlers, notify, errorReporter). Cannot initialize.');
    // Return a non-functional stub or throw, depending on desired strictness
    return {
      init: () => console.error("AccessibilityUtils not initialized due to missing core dependencies."),
      destroy: () => { },
      // Stub other public methods if necessary
      toggleKeyboardShortcuts: () => false,
      announce: () => { },
    };
  }
  return new AccessibilityUtilsModule(deps);
}
