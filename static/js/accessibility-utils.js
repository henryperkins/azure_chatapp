/**
 * accessibility-utils.js – accessibility & keyboard-shortcut helpers.
 * Factory: createAccessibilityEnhancements({...}).
 * Core DI: domAPI, eventHandlers, logger, domReadinessService (+ optional deps).
 */

export function createAccessibilityEnhancements({
  domAPI,
  eventHandlers,
  logger,
  domReadinessService,
  DependencySystem,
  createDebugTools,
  errorReporter,
  safeHandler // ← NEW: allow explicit injection to avoid timing issues
  , htmlTemplateLoader = null
}) {
  // Factory-level dependency validation (must be at the very top)
  if (!logger) throw new Error('Missing required dependency: logger');
  if (!domReadinessService) throw new Error('Missing required dependency: domReadinessService');
  if (!domAPI) throw new Error('Missing required dependency: domAPI');
  if (!eventHandlers) throw new Error('Missing required dependency: eventHandlers');

  const MODULE_CONTEXT = 'accessibilityUtils';

  // Validate logger and domReadinessService methods
  if (typeof logger.error !== 'function' || typeof logger.info !== 'function') {
    throw new Error('DI logger with .error/.info must be provided.');
  }
  if (
    typeof domReadinessService.waitForEvent !== 'function' ||
    typeof domReadinessService.dependenciesAndElements !== 'function'
  ) {
    throw new Error('domReadinessService DI with waitForEvent/dependenciesAndElements required.');
  }
  if (
    typeof domAPI.getElementById !== 'function' ||
    typeof domAPI.getDocument !== 'function'
  ) {
    throw new Error('domAPI with core methods (getElementById, getDocument) required.');
  }
  if (
    typeof eventHandlers.trackListener !== 'function' ||
    typeof eventHandlers.cleanupListeners !== 'function'
  ) {
    throw new Error('eventHandlers with trackListener and cleanupListeners required.');
  }
  if (typeof domAPI.getComputedStyle !== 'function') {
    throw new Error('domAPI.getComputedStyle must be provided via DI; no fallback to window allowed.');
  }

  class AccessibilityUtilsModule {
    constructor(safeHandler) {
      this.domAPI = domAPI;
      this.eventHandlers = eventHandlers;
      this.DependencySystem = DependencySystem;
      this.domReadinessService = domReadinessService;
      this.errorReporter = errorReporter;
      this.logger = logger;
      this.safeHandler = safeHandler;
      this.debug =
        typeof createDebugTools === 'function'
          ? createDebugTools({ contextPrefix: MODULE_CONTEXT })
          : { start: () => null, stop: () => { }, trace: fn => fn() };
      this.keyboardShortcutsEnabled = true;
      this.lastFocusedElement = null;
      this.mutationObservers = [];
      this._destroyed = false;
    }

    async init() {
      const traceId = this.debug.start('init');
      try {
        await this.domReadinessService.waitForEvent('app:ready');
        if (this._destroyed) return;

        this._bindGlobalShortcuts();
        this._enhanceFormAccessibility();
        this._improveModalAccessibility();
        this._setupSkipLinks();

        if (
          this.DependencySystem &&
          typeof this.DependencySystem.register === 'function'
        ) {
          const already = this.DependencySystem.modules?.get?.(MODULE_CONTEXT);
          if (!already) {
            this.DependencySystem.register(MODULE_CONTEXT, {
              focusElement: this._focusElement?.bind(this),
              getFocusable: this._getFocusable?.bind(this),
              trapFocus: this._trapFocus?.bind(this),
              toggleKeyboardShortcuts: this.toggleKeyboardShortcuts.bind(this),
              announce: this.announce.bind(this),
              destroy: this.destroy.bind(this),
              cleanup: this.destroy.bind(this)
            });
          }
        }
      } catch (err) {
        logger.error('[AccessibilityUtils][init] failed', err, { context: MODULE_CONTEXT });
        if (this.errorReporter) {
          this.errorReporter.capture(err, { module: MODULE_CONTEXT, source: 'init' });
        }
        throw err;
      } finally {
        this.debug.stop(traceId, 'init');
      }
    }

    destroy() {
      const traceId = this.debug.start('destroy');
      try {
        if (this.eventHandlers && typeof this.eventHandlers.cleanupListeners === 'function') {
          this.eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
        }
        this.mutationObservers.forEach(observer => observer.disconnect());
        this.mutationObservers.length = 0;
        this.keyboardShortcutsEnabled = true;
        this.lastFocusedElement = null;
        this._destroyed = true;
      } catch (err) {
        logger.error('[AccessibilityUtils][destroy] cleanup failed', err, { context: MODULE_CONTEXT });
        if (this.errorReporter) {
          this.errorReporter.capture(err, { module: MODULE_CONTEXT, source: 'destroy.cleanupListeners' });
        }
      } finally {
        this.debug.stop(traceId, 'destroy');
      }
    }

    _trackListener(element, type, handler, options = {}) {
      if (!element) return;
      const optionsWithContext = { ...options, context: MODULE_CONTEXT };
      this.eventHandlers.trackListener(element, type, handler, optionsWithContext);
    }

    async _handleGlobalKeydown(e) {
      const traceId = this.debug.start('_handleGlobalKeydown');
      try {
        if (!this.keyboardShortcutsEnabled || this._isInput(e.target)) {
          this.debug.stop(traceId, '_handleGlobalKeydown: skipped');
          return;
        }

        let sidebar = null;
        if (this.DependencySystem && typeof this.DependencySystem.waitFor === 'function') {
          try {
            sidebar = await this.DependencySystem.waitFor('sidebar', null, 3000);
          } catch (err) {
            logger.error('[AccessibilityUtils][_handleGlobalKeydown] DependencySystem.waitFor failed', err, { context: MODULE_CONTEXT });
            if (this.errorReporter) {
              this.errorReporter.capture(err, { module: MODULE_CONTEXT, source: '_handleGlobalKeydown.DependencySystem.waitFor' });
            }
          }
        }
        // Defensive: Graceful fallback if sidebar cannot be injected
        const safeSidebar = sidebar && typeof sidebar === "object" ? sidebar : undefined;
        if (this._noMods(e)) {
          let handled = false;
          switch (e.key) {
            case '/':
            case '`':
            case '\\':
              if (typeof safeSidebar?.toggleSidebar === "function") {
                safeSidebar.toggleSidebar();
                handled = true;
              } else {
                this.announce?.('Sidebar unavailable. Cannot toggle sidebar.', 'polite');
                handled = true;
              }
              break;
            case '1':
            case '2':
            case '3': {
              const mapping = { '1': 'recent', '2': 'starred', '3': 'projects' };
              if (typeof safeSidebar?.activateTab === "function") {
                safeSidebar.activateTab(mapping[e.key]);
                handled = true;
              } else {
                this.announce?.('Sidebar unavailable. Tab shortcut disabled.', 'polite');
                handled = true;
              }
              break;
            }
            case 'p':
            case 'P':
              if (typeof safeSidebar?.togglePin === "function") {
                safeSidebar.togglePin();
                handled = true;
              } else {
                this.announce?.('Sidebar unavailable. Pin shortcut disabled.', 'polite');
                handled = true;
              }
              break;
            case 'n':
            case 'N':
              this.domAPI.getElementById('sidebarNewProjectBtn')?.click();
              handled = true;
              break;
            case 's':
            case 'S':
              this._focusElement('#sidebarProjectSearch');
              handled = true;
              break;
            case '?':
              this._toggleKeyboardHelp();
              handled = true;
              break;
            default:
              handled = false;
          }
          if (handled) e.preventDefault();
        }
        if (e.key === 'Escape') {
          if (this._closeKeyboardHelpIfOpen()) {
            e.preventDefault();
          }
        }
      } catch (err) {
        logger.error('[AccessibilityUtils][_handleGlobalKeydown] main handler failed', err, { context: MODULE_CONTEXT });
        if (this.errorReporter) {
          this.errorReporter.capture(err, { module: MODULE_CONTEXT, source: '_handleGlobalKeydown.main' });
        }
      } finally {
        this.debug.stop(traceId, '_handleGlobalKeydown: processed');
      }
    }

    _bindGlobalShortcuts() {
      this._trackListener(
        this.domAPI.getDocument(),
        'keydown',
        this.safeHandler(this._handleGlobalKeydown.bind(this), '_handleGlobalKeydown'),
        { description: 'Global keyboard shortcuts' }
      );
      const closeHelpHandler = this.safeHandler((e) => {
        const button = e.target.closest('#keyboardHelp button');
        if (button) this._closeKeyboardHelpIfOpen();
      }, 'Help dialog close button click');
      this._trackListener(
        this.domAPI.getDocument(),
        'click',
        closeHelpHandler,
        { description: 'Help dialog close button click' }
      );
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
        this._focusElement(dlg.querySelector('button') || dlg, 50);
      } else {
        dlg.classList.add('hidden');
        this.lastFocusedElement?.focus?.();
        this.lastFocusedElement = null;
      }
    }

    _closeKeyboardHelpIfOpen() {
      const dlg = this.domAPI.getElementById('keyboardHelp');
      if (dlg && !dlg.classList.contains('hidden')) {
        this._toggleKeyboardHelp(false);
        return true;
      }
      return false;
    }

    toggleKeyboardShortcuts(enable) {
      this.keyboardShortcutsEnabled =
        enable === undefined ? !this.keyboardShortcutsEnabled : !!enable;
      return this.keyboardShortcutsEnabled;
    }

    _enhanceFormAccessibility() {
      this._trackListener(
        this.domAPI.getDocument(),
        'invalid',
        this.safeHandler((e) => {
          if (e.target.classList.contains('validator')) {
            this._handleFormValidation(e.target, false);
          }
        }, 'Form validator invalid event'),
        { capture: true, description: 'Form validator invalid event' }
      );
      this._trackListener(
        this.domAPI.getDocument(),
        'change',
        this.safeHandler((e) => {
          if (e.target.classList.contains('validator')) {
            this._handleFormValidation(e.target, e.target.validity.valid);
          }
        }, 'Form validator change event'),
        { description: 'Form validator change event' }
      );
    }

    _handleFormValidation(input, isValid) {
      let hint;
      try {
        hint = this.domAPI.querySelector(`#${input.id}-hint`);
        if (!hint) {
          hint = this.domAPI.createElement('p');
          hint.id = `${input.id}-hint`;
          hint.className = 'validator-hint';
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
      } catch (err) {
        logger.error('[AccessibilityUtils][_handleFormValidation] failed', err, { context: MODULE_CONTEXT });
        if (this.errorReporter) {
          this.errorReporter.capture(err, { module: MODULE_CONTEXT, source: '_handleFormValidation' });
        }
        throw err;
      }
    }

    _improveModalAccessibility() {
      try {
        const dialogObserverCallback = mutations => {
          mutations.forEach(m => {
            if (
              m.type === 'attributes' &&
              m.attributeName === 'open' &&
              m.target.tagName === 'DIALOG'
            ) {
              if (m.target.hasAttribute('open')) {
                this.lastFocusedElement = this.domAPI.getActiveElement();
                this._trapFocus(m.target);
              } else {
                this.lastFocusedElement?.focus?.();
                this.lastFocusedElement = null;
              }
            }
          });
        };
        const dialogObserver = new MutationObserver(
          this.safeHandler(dialogObserverCallback, 'dialogObserverCallback')
        );
        this.mutationObservers.push(dialogObserver);
        this.domAPI
          .querySelectorAll('dialog')
          .forEach(d => dialogObserver.observe(d, { attributes: true }));
        const bodyObserverCallback = mutations => {
          mutations.forEach(m => {
            m.addedNodes.forEach(node => {
              if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.tagName === 'DIALOG') {
                  dialogObserver.observe(node, { attributes: true });
                } else if (typeof node.querySelectorAll === 'function') {
                  node
                    .querySelectorAll('dialog')
                    .forEach(d => dialogObserver.observe(d, { attributes: true }));
                }
              }
            });
          });
        };
        const bodyObserver = new MutationObserver(
          this.safeHandler(bodyObserverCallback, 'bodyObserverCallback')
        );
        bodyObserver.observe(this.domAPI.getBody(), { childList: true, subtree: true });
        this.mutationObservers.push(bodyObserver);
      } catch (err) {
        logger.error('[AccessibilityUtils][_improveModalAccessibility] failed', err, { context: MODULE_CONTEXT });
        if (this.errorReporter) {
          this.errorReporter.capture(err, { module: MODULE_CONTEXT, source: '_improveModalAccessibility' });
        }
        throw err;
      }
    }

    _setupSkipLinks() {
      try {
        const skipLink = this.domAPI.querySelector('.skip-to-content');
        if (!skipLink) return;
        const skipHandler = this.safeHandler(e => {
          e.preventDefault();
          const targetId = skipLink.getAttribute('href')?.substring(1);
          if (targetId) {
            const targetElement = this.domAPI.getElementById(targetId);
            if (targetElement) {
              if (!targetElement.hasAttribute('tabindex')) {
                targetElement.setAttribute('tabindex', '-1');
              }
              this._focusElement(targetElement);
            }
          }
        }, 'skip-to-content');
        this._trackListener(skipLink, 'click', skipHandler, {
          description: 'Skip to content link'
        });
      } catch (err) {
        logger.error('[AccessibilityUtils][_setupSkipLinks] failed', err, { context: MODULE_CONTEXT });
        if (this.errorReporter) {
          this.errorReporter.capture(err, { module: MODULE_CONTEXT, source: '_setupSkipLinks' });
        }
        throw err;
      }
    }

    _trapFocus(container) {
      try {
        if (!container) return;
        const focusables = this._getFocusable(container);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const keydownHandler = this.safeHandler(e => {
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
        }, 'trap-focus Tab handler');
        this._trackListener(container, 'keydown', keydownHandler, {
          description: 'Trap focus Tab handler for container'
        });
        setTimeout(() => {
          if (
            this.domAPI.getBody().contains(container) &&
            !container.contains(this.domAPI.getActiveElement())
          ) {
            first.focus();
          }
        }, 50);
      } catch (err) {
        logger.error('[AccessibilityUtils][_trapFocus] failed', err, { context: MODULE_CONTEXT });
        if (this.errorReporter) {
          this.errorReporter.capture(err, { module: MODULE_CONTEXT, source: '_trapFocus' });
        }
        throw err;
      }
    }

    _getFocusable(container) {
      if (!container || typeof container.querySelectorAll !== 'function') return [];
      const sel =
        'a[href], button, input, textarea, select, details, [tabindex]:not([tabindex="-1"])';
      return Array.from(container.querySelectorAll(sel)).filter(
        el =>
          !el.disabled &&
          !el.closest('[inert]') &&
          el.offsetParent !== null &&
          this.domAPI.getComputedStyle(el).visibility !== 'hidden' &&
          this.domAPI.getComputedStyle(el).display !== 'none'
      );
    }

    _focusElement(target, delay = 0) {
      try {
        const el = typeof target === 'string' ? this.domAPI.querySelector(target) : target;
        if (!el || typeof el.focus !== 'function') return false;
        const actuallyFocus = () => {
          if (
            this.domAPI.getBody().contains(el) &&
            typeof el.focus === 'function'
          ) {
            el.focus();
          }
        };
        if (delay > 0) {
          setTimeout(actuallyFocus, delay);
        } else {
          actuallyFocus();
        }
        return true;
      } catch (err) {
        logger.error('[AccessibilityUtils][_focusElement] failed', err, { context: MODULE_CONTEXT });
        if (this.errorReporter) {
          this.errorReporter.capture(err, { module: MODULE_CONTEXT, source: '_focusElement' });
        }
        throw err;
      }
    }

    _isInput(el) {
      if (!el || typeof el.tagName !== 'string') return false;
      const name = el.tagName.toLowerCase();
      return (
        name === 'input' ||
        name === 'textarea' ||
        name === 'select' ||
        el.isContentEditable
      );
    }

    announce(text, mode = 'polite') {
      try {
        let region = this.domAPI.getElementById('a11y-announcer');
        if (!region) {
          region = this.domAPI.createElement('div');
          region.id = 'a11y-announcer';
          Object.assign(region.style, {
            border: '0',
            clip: 'rect(0 0 0 0)',
            height: '1px',
            margin: '-1px',
            overflow: 'hidden',
            padding: '0',
            position: 'absolute',
            width: '1px',
            whiteSpace: 'nowrap'
          });
          region.setAttribute('aria-live', mode);
          region.setAttribute('aria-atomic', 'true');
          this.domAPI.getBody().appendChild(region);
        }
        if (region.getAttribute('aria-live') !== mode) {
          region.setAttribute('aria-live', mode);
        }
        region.textContent = '';
        setTimeout(() => {
          region.textContent = text;
        }, 50);
      } catch (err) {
        logger.error('[AccessibilityUtils][announce] failed', err, { context: MODULE_CONTEXT });
        if (this.errorReporter) {
          this.errorReporter.capture(err, { module: MODULE_CONTEXT, source: 'announce' });
        }
        throw err;
      }
    }

    // _safeHandler removed (DI canonical safeHandler always used)
  }

  // Resolve safeHandler: prefer explicitly injected param, fallback to DependencySystem
  const resolvedSafeHandler =
    typeof safeHandler === 'function'
      ? safeHandler
      : DependencySystem?.modules?.get?.('safeHandler');

  if (typeof resolvedSafeHandler !== 'function') {
    throw new Error(`[${MODULE_CONTEXT}] Missing required dependency: safeHandler`);
  }

  const instance = new AccessibilityUtilsModule(resolvedSafeHandler);
  function cleanup() {
    if (eventHandlers?.cleanupListeners) {
      eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
    }
    instance.destroy();
  }

  return {
    init: instance.init.bind(instance),
    destroy: instance.destroy.bind(instance),
    toggleKeyboardShortcuts: instance.toggleKeyboardShortcuts.bind(instance),
    announce: instance.announce.bind(instance),
    focusElement: instance._focusElement ? instance._focusElement.bind(instance) : undefined,
    getFocusable: instance._getFocusable ? instance._getFocusable.bind(instance) : undefined,
    trapFocus: instance._trapFocus ? instance._trapFocus.bind(instance) : undefined,
    cleanup,
    preloadTemplates: async (loader = null) => {
      loader = loader || htmlTemplateLoader;
      if (!loader?.loadTemplate) return;
      await Promise.allSettled([
        loader.loadTemplate({
          url: '/static/html/project_details.html',
          containerSelector: '#projectDetailsView',
          eventName: 'projectDetailsTemplateLoaded'
        }),
        loader.loadTemplate({
          url: '/static/html/project_list.html',
          containerSelector: '#projectListView',
          eventName: 'projectListHtmlLoaded'
        })
      ]);
    },
    _instance: instance
  };
}
