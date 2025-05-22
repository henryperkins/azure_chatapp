/**
 * @module eventHandler
 * @description DI-strict, orchestrated UI event utility collection. Manages tracked event listeners
 * and provides common UI setup helpers like forms, modals, and collapsibles.
 * All notifications use the injected `notify` utility. No direct console or global DOM/Window access.
 *
 * @param {Object} deps - Dependencies injected via DI.
 * @param {Object} deps.app - Core application reference (optional, for app-specific logic like redirects).
 * @param {Object} deps.projectManager - Project Manager reference (optional, for project actions).
 * @param {Object} deps.modalManager - Modal Manager reference (optional, for modal actions).
 * @param {Object} deps.DependencySystem - Required. DI registry.
 * @param {Object} deps.domAPI - Required. DOM abstraction layer.
 * @param {Object} deps.browserService - Required. Browser abstraction (URL, storage, etc.).
 * @param {Object} deps.notify - Required. Context-aware notification utility.
 * @param {Object} deps.APP_CONFIG - Required. Application configuration object.
 * @param {Function} [deps.navigate] - Optional navigation function override.
 * @param {Object} [deps.storage] - Optional storage abstraction override (usually from browserService).
 * @param {Object} deps.errorReporter - Required error logging utility.
 * @param {Object} deps.logger - Required logging utility.
 * @param {Object} [deps.domReadinessService] - Readiness service (use setter for DI circularity).
 * @param {Object} [deps.timeAPI] - Optional timing API (defaults to performance.now).
 * @returns {Object} Event handler API { trackListener, cleanupListeners, delegate, etc. }
 */

import { debounce as globalDebounce, toggleElement as globalToggleElement } from './utils/globalUtils.js';

export function createEventHandlers({
  app,
  projectManager,
  modalManager,
  DependencySystem,
  domAPI,
  browserService,
  APP_CONFIG,
  navigate,
  storage,
  logger,           // STRICT: must be provided via DI
  errorReporter,    // STRICT: must be provided via DI
  domReadinessService // Optional, but if provided, must be validated
} = {}) {
  // === Dependency validation block (must be at the very top for pattern checker) ===
  if (!DependencySystem) {
    throw new Error('[eventHandler] Missing DependencySystem');
  }
  if (!domAPI) {
    throw new Error('[eventHandler] Missing domAPI');
  }
  if (!browserService) {
    throw new Error('[eventHandler] Missing browserService');
  }
  if (!APP_CONFIG) {
    throw new Error('[eventHandler] Missing APP_CONFIG');
  }
  if (!logger) {
    throw new Error('[eventHandler] Missing logger');
  }
  if (!errorReporter) {
    throw new Error('[eventHandler] Missing errorReporter');
  }
  // domReadinessService is optional at factory, but required at init
  // ================================================================
  const MODULE = 'EventHandler';
  let _domReadinessService = domReadinessService || null;
  function setDomReadinessService(svc) { _domReadinessService = svc; }

  logger.debug('[EventHandler] Factory initialized', {
    MODULE,
    version: '1.0',
    appInjected: !!app,
    context: MODULE
  });
  // We allow dynamic injection/update of projectManager
  let _projectManager = projectManager;

  // Singleton flags, preventing duplicate setup
  let authButtonDelegationBound = false;

  // Storage fallback
  const storageBackend = storage || browserService;

  function redirect(url) {
    if (typeof navigate === 'function') {
      navigate(url);
    } else if (app && typeof app.navigate === 'function') {
      app.navigate(url);
    } else if (browserService && typeof browserService.setLocation === 'function') {
      browserService.setLocation(url);
    }
  }

  const trackedListeners = new Map();
  const PRIORITY = { HIGH: 1, NORMAL: 5, LOW: 10 };

  /**
   * Central method to attach an event listener with bookkeeping for cleanup.
   * @param {HTMLElement} element
   * @param {string} type
   * @param {Function} handler
   * @param {Object} options
   * @returns {Function|undefined} The wrapped handler, or undefined on failure
   */
  function trackListener(element, type, handler, options = {}) {
    if (!element || typeof element.addEventListener !== 'function') return undefined;

    const { capture = false, once = false, signal, passive } = options;
    const nonPassive = ['click', 'submit', 'wheel', 'touchstart', 'touchmove', 'keydown', 'keypress', 'keyup'];
    const finalOpts = { capture, once, signal, passive: typeof passive === 'boolean' ? passive : !nonPassive.includes(type) };

    // bookkeeping (prevents duplicates)
    const elMap = trackedListeners.get(element) || new Map();
    const typeMap = elMap.get(type) || new Map();
    if (!trackedListeners.has(element)) trackedListeners.set(element, elMap);
    if (!elMap.has(type)) elMap.set(type, typeMap);
    if (typeMap.has(handler))
      return typeMap.get(handler).remove;        // always hand back the “unsubscribe”

    let wrapped = (evt) => handler.call(element, evt);

    if (finalOpts.once) {
      // make sure our internal maps don’t leak after the handler fires
      const _wrappedOnce = wrapped;
      wrapped = (...a) => {
        try { _wrappedOnce(...a); } finally {
          // remove record from bookkeeping maps
          setTimeout(() => untrackListener(element, type, handler), 0);
        }
      };
    }

    // domAPI is a required dependency, so domAPI.addEventListener should always be used.
    domAPI.addEventListener(element, type, wrapped, finalOpts);

    const remove = () => {               // función de des-registro
      try {
        untrackListener(element, type, handler);
      } catch (err) {
        logger.error(`[${MODULE}][trackListener][remove] Failed to untrackListener`, err, { context: MODULE, element, type });
      }
    };

    typeMap.set(handler, {
      wrappedHandler: wrapped,
      options: finalOpts,
      context: options.context,
      remove: remove          // <- new
    });

    return remove;                       // ← ahora devolvemos la función “unsubscribe”
  }

  function toggleVisible(elementSelectorOrElement, show) {
    const element =
      typeof elementSelectorOrElement === 'string'
        ? domAPI.querySelector(elementSelectorOrElement)
        : elementSelectorOrElement;
    return globalToggleElement(element, show); // This utility can remain as is
  }

  function setupCollapsible(toggleId, panelId, chevronId, onExpand) {
    const toggleButton = domAPI.getElementById(toggleId);
    const panel = domAPI.getElementById(panelId);
    const chevron = chevronId ? domAPI.getElementById(chevronId) : null;

    if (!toggleButton || !panel) {
      return;
    }

    domAPI.setAttribute(toggleButton, 'role', 'button');
    domAPI.setAttribute(toggleButton, 'aria-controls', panelId);
    domAPI.setAttribute(toggleButton, 'aria-expanded', 'false');

    const togglePanel = (expand) => {
      domAPI.toggleClass(panel, 'hidden', !expand);
      if (chevron) domAPI.setStyle(chevron, 'transform', expand ? 'rotate(180deg)' : 'rotate(0deg)');
      domAPI.setAttribute(toggleButton, 'aria-expanded', String(expand));

      if (expand && typeof onExpand === 'function') {
        onExpand();
      }

      if (toggleId && storageBackend?.setItem) {
        storageBackend.setItem(`${toggleId}_expanded`, String(expand));
      }
    };

    let savedState = null;
    if (toggleId && storageBackend?.getItem) {
      savedState = storageBackend.getItem(`${toggleId}_expanded`);
    }
    togglePanel(savedState === 'true');

    trackListener(
      toggleButton,
      'click',
      () => {
        const isCurrentlyExpanded = domAPI.getAttribute(toggleButton, 'aria-expanded') === 'true';
        togglePanel(!isCurrentlyExpanded);
      },
      { description: `Toggle Collapsible ${toggleId}`, module: MODULE, context: 'collapsible', source: 'setupCollapsible' }
    );
  }

  function setupModal(modalId, openBtnId, closeBtnId, onOpen, onClose) {
    const modal = domAPI.getElementById(modalId);
    const openBtn = openBtnId ? domAPI.getElementById(openBtnId) : null;
    const closeBtn = closeBtnId ? domAPI.getElementById(closeBtnId) : null;

    if (!modal) {
      return { open: () => { }, close: () => { } };
    }

    const open = () => {
      if (typeof onOpen === 'function') {
        onOpen(modal);
      }
      if (modalManager?.show) {
        modalManager.show(modalId);
      } else if (typeof modal.showModal === 'function') {
        modal.showModal();
      } else {
        domAPI.removeClass(modal, 'hidden');
        domAPI.setAttribute(modal, 'open', 'true');
      }
    };

    const close = () => {
      if (modalManager?.hide) {
        modalManager.hide(modalId);
      } else if (typeof modal.close === 'function') {
        modal.close();
      } else {
        domAPI.addClass(modal, 'hidden');
        domAPI.removeAttribute(modal, 'open');
      }
      if (typeof onClose === 'function') {
        onClose(modal);
      }
    };

    if (openBtn) {
      trackListener(openBtn, 'click', open, {
        description: `Open Modal ${modalId}`,
        module: MODULE,
        context: 'modal',
        source: 'setupModal'
      });
    }
    if (closeBtn) {
      trackListener(closeBtn, 'click', close, {
        description: `Close Modal ${modalId} via Button`,
        module: MODULE,
        context: 'modal',
        source: 'setupModal'
      });
    }

    trackListener(
      modal,
      'keydown',
      (e) => {
        if (e.key === 'Escape') close();
      },
      { description: `Modal ESC Close ${modalId}`, module: MODULE, context: 'modal', source: 'setupModal' }
    );

    trackListener(
      modal,
      'click',
      (e) => {
        if (domAPI.isSameNode(e.target, modal)) close();
      },
      { description: `Modal Backdrop Close ${modalId}`, module: MODULE, context: 'modal', source: 'setupModal' }
    );

    return { open, close };
  }

  function setupForm(formId, submitHandler, options = {}) {
    const form = domAPI.getElementById(formId);
    if (!form) {
      return;
    }

    const { validateBeforeSubmit = true, showLoadingState = true, resetOnSuccess = true } = options;

    const handleSubmit = async (e) => {
      domAPI.preventDefault(e); // Use domAPI to avoid direct event calls
      if (domAPI.hasClass(form, 'submitting')) return;

      // To be fully DI-compliant, form-specific methods should also be called via domAPI.
      // This assumes domAPI is extended or provides a generic way to call element methods.
      // e.g., domAPI.callMethod(form, 'checkValidity') or specific domAPI.checkFormValidity(form)
      if (validateBeforeSubmit && typeof form.checkValidity === 'function') { // form.checkValidity is a direct DOM call
        if (!domAPI.callMethod(form, 'checkValidity')) { // Assumed domAPI.callMethod or similar
          if (typeof form.reportValidity === 'function') { // form.reportValidity is a direct DOM call
            domAPI.callMethod(form, 'reportValidity'); // Assumed domAPI.callMethod or similar
          }
          return;
        }
      }

      const submitBtn = domAPI.querySelector('[type="submit"]', form);
      if (showLoadingState && submitBtn) {
        domAPI.addClass(form, 'submitting');
        domAPI.setProperty(submitBtn, 'disabled', true);
        domAPI.setDataAttribute(submitBtn, 'originalText', domAPI.getTextContent(submitBtn));
        domAPI.setTextContent(submitBtn, 'Submitting...');
      }

      try {
        // Use browserService.FormData if available (it's a required dep)
        const formData = browserService.FormData ? new browserService.FormData(form) : new FormData(form);
        await submitHandler(formData, form);
        if (resetOnSuccess && typeof form.reset === 'function') { // form.reset is a direct DOM call
          domAPI.callMethod(form, 'reset'); // Assumed domAPI.callMethod or similar
        }
      } catch (error) {
        if (options.onError) {
          try {
            options.onError(error);
          } catch (err) {
            logger.error(`[${MODULE}][setupForm][handleSubmit][onError]`, err, {
              context: 'form-submit',
              formId: form?.id || formId
            });
          }
        }
        logger.error(`[${MODULE}][setupForm][handleSubmit]`, error, {
          context: 'form-submit',
          formId: form?.id || formId
        });
      } finally {
        if (showLoadingState) {
          domAPI.removeClass(form, 'submitting');
          if (submitBtn) {
            domAPI.setProperty(submitBtn, 'disabled', false);
            const originalText = domAPI.getDataAttribute(submitBtn, 'originalText');
            if (originalText) {
              domAPI.setTextContent(submitBtn, originalText);
              domAPI.removeDataAttribute(submitBtn, 'originalText');
            }
          }
        }
      }
    };

    trackListener(form, 'submit', handleSubmit, {
      passive: false,
      description: `Form Submit ${formId}`,
      module: MODULE,
      context: 'form',
      source: 'setupForm'
    });
  }

  let initialized = false;
  async function init() {
    if (initialized) {
      return this; // Return API object early
    }

    if (!_domReadinessService) {
      throw new Error('[eventHandler.init] domReadinessService must be set via setDomReadinessService before calling init()');
    }
    const dependencyWaitTimeout = APP_CONFIG?.TIMEOUTS?.DEPENDENCY_WAIT ?? 10000;

    // Ensure the DOM is fully loaded before initialization
    await _domReadinessService.documentReady();

    // Wait for core dependencies and the body to exist
    await _domReadinessService.dependenciesAndElements({
      deps: [
        'app',
        'auth',
        'projectManager',
        'modalManager',
        'domAPI',
        'browserService'
      ],
      domSelectors: ['body'],
      timeout: dependencyWaitTimeout,
      context: 'eventHandler.init'
    });

    // -- Strict document/body readiness
    await _domReadinessService.documentReady();

    // -- DOM event-dependent setup
    const runDomDependentSetup = () => {
      setupCommonElements();
      setupNavigationElements();
      setupContentElements();
    };

    runDomDependentSetup();

    // -- Project modal form (wait for element to exist)
    await _domReadinessService.elementsReady('#projectModalForm', {
      timeout: dependencyWaitTimeout,
      context: 'eventHandler.init:modalForm'
    }).then(() => {
      setupProjectModalForm();
    }).catch((error) => {
      logger.error(`[${MODULE}][init] elementsReady('#projectModalForm') failed`, error, { context: 'eventHandler.init:modalForm' });
    });

    // LOGIN BUTTON / MODAL HANDLING
    function bindAuthButtonDelegate() {
      if (authButtonDelegationBound) return;
      let parentNode = domAPI.getElementById('header') || domAPI.getDocument();
      const currentModalManager = modalManager || DependencySystem.modules.get('modalManager');
      if (!currentModalManager || typeof currentModalManager.show !== 'function') {
        return;
      }
      delegate(
        parentNode,
        'click',
        '#authButton',
        (e) => {
          domAPI.preventDefault(e);
          try {
            currentModalManager.show('login');
          } catch (error) {
            logger.error(`[${MODULE}][bindAuthButtonDelegate]`, error, {
              context: 'auth'
            });
          }
        },
        { description: 'Delegated Login Modal Show', context: 'auth', module: MODULE }
      );
      authButtonDelegationBound = true;
    }

    // Listen for requestLogin event
    trackListener(
      domAPI.getDocument(),
      'requestLogin',
      () => {
        const currentModalManager = modalManager || DependencySystem.modules.get('modalManager');
        if (currentModalManager && typeof currentModalManager.show === 'function') {
          currentModalManager.show('login');
        }
      },
      {
        description: 'Show Login Modal (Global Event)',
        context: 'auth',
        module: MODULE,
        source: 'requestLogin'
      }
    );

    bindAuthButtonDelegate();

    // Rebind after modalsLoaded
    trackListener(
      domAPI.getDocument(),
      'modalsLoaded',
      (event) => {
        bindAuthButtonDelegate();
        setupLoginModalTabs();
      },
      {
        once: true,
        description: 'Rebind login and setup tabs after modalsLoaded',
        context: 'auth',
        module: MODULE,
        source: 'modalsLoaded'
      }
    );

    // --- FAST-PATH: modals may already be injected before this listener is registered
    if (domAPI.getElementById('modalsContainer')?.childElementCount > 0) {
      setupLoginModalTabs();
    }

    initialized = true;
    return this;
  }

  function setupCommonElements() {
    const darkModeToggle = domAPI.getElementById('darkModeToggle');
    if (darkModeToggle && !domAPI.getDataAttribute(darkModeToggle, 'ehBound')) {
      trackListener(
        darkModeToggle,
        'click',
        () => {
          domAPI.toggleClass(domAPI.getDocument().documentElement, 'dark');
          const isDark = domAPI.hasClass(domAPI.getDocument().documentElement, 'dark');
          storageBackend.setItem('darkMode', isDark ? 'true' : 'false');
        },
        { description: 'Dark Mode Toggle', module: MODULE, context: 'ui', source: 'setupCommonElements' }
      );
      domAPI.setDataAttribute(darkModeToggle, 'ehBound', '1'); // marca como enlazado
      // Initial dark mode state
      if (storageBackend.getItem('darkMode') === 'true') {
        domAPI.addClass(domAPI.getDocument().documentElement, 'dark');
      }
    }
  }

  function setupProjectModalForm() {
    const pm = _projectManager || DependencySystem.modules.get('projectManager');
    if (!pm) {
      return;
    }
    setupForm(
      'projectModalForm',
      async (formData) => {
        const data = Object.fromEntries(formData.entries());
        if (data.max_tokens) data.max_tokens = parseInt(data.max_tokens, 10);
        if (!data.name) {
          throw new Error('Project name is required.');
        }
        await pm.saveProject(data.projectId, data);
        modalManager?.hide?.('project');
        pm.loadProjects?.('all');
      },
      {
        resetOnSuccess: true,
        onError: (err) => {
          logger.error(`[${MODULE}][setupProjectModalForm] Error in project form submit`, err, { context: 'projectModalForm' });
        }
      }
    );
  }

  function setupNavigationElements() {
    const navLinks = domAPI.querySelectorAll('.nav-link');
    navLinks.forEach((link) => {
      if (!domAPI.getDataAttribute(link, 'ehBound')) {
        trackListener(
          link,
          'click',
          (e) => {
            domAPI.preventDefault(e);
            const href = domAPI.getAttribute(link, 'href');
            if (href) redirect(href);
          },
          {
            description: `Navigation Link: ${domAPI.getAttribute(link, 'href') || 'unknown'}`,
            module: MODULE,
            context: 'navigation',
            source: 'setupNavigationElements'
          }
        );
        domAPI.setDataAttribute(link, 'ehBound', '1');
      }
    });
  }

  function setupContentElements() {
    const collapsibleToggles = domAPI.querySelectorAll('[data-collapsible-toggle]');
    collapsibleToggles.forEach((toggle) => {
      const panelId = domAPI.getDataAttribute(toggle, 'collapsible-toggle');
      const chevronId = domAPI.getDataAttribute(toggle, 'collapsible-chevron');
      if (panelId) {
        setupCollapsible(domAPI.getId(toggle) || `gen-toggle-${panelId}`, panelId, chevronId);
      }
    });
  }

  function untrackListener(el, evt, handler) {
    const elementMap = trackedListeners.get(el);
    if (!elementMap) return;
    const typeMap = elementMap.get(evt);
    if (!typeMap || !typeMap.has(handler)) return;

    const details = typeMap.get(handler);
    try {
      if (details.options.once &&
        !(el && el.removeEventListener)) {
        /* already auto-removed by the browser – just delete maps */
        typeMap.delete(handler);
        if (typeMap.size === 0) elementMap.delete(evt);
        if (elementMap.size === 0) trackedListeners.delete(el);
        return;
      }
      // domAPI is a required dependency, so domAPI.removeEventListener should always be used.
      domAPI.removeEventListener(el, evt, details.wrappedHandler, details.options);
      typeMap.delete(handler);
      if (typeMap.size === 0) elementMap.delete(evt);
      if (elementMap.size === 0) trackedListeners.delete(el);
    } catch (error) {
      logger.error(`[${MODULE}][untrackListener] Failed to remove event listener`, error, {
        element: el,
        evt,
        handler,
        context: details.context
      });
      errorReporter.report?.(error, { module: MODULE, evt, fn: 'untrackListener' });
    }
  }

  function cleanupListeners(options = {}) {
    const { context: cleanupContext, target: targetFilter } = options;

    const entriesToRemove = [];

    trackedListeners.forEach((elementMap, element) => {
      if (targetFilter && element !== targetFilter) return;
      elementMap.forEach((typeMap, type) => {
        typeMap.forEach((details, originalHandler) => {
          if (!cleanupContext || details.context === cleanupContext) {
            try {
              // domAPI is a required dependency, so domAPI.removeEventListener should always be used.
              domAPI.removeEventListener(element, type, details.wrappedHandler, details.options);
              entriesToRemove.push({ element, type, originalHandler });
            } catch (error) {
              logger.error(`[${MODULE}][cleanupListeners] Error removing event listener`, error, {
                element, type, details, context: cleanupContext
              });
              errorReporter.report?.(error, { module: MODULE, evt: type, fn: 'cleanupListeners', context: cleanupContext });
            }
          }
        });
      });
    });

    // Remove them from the map
    entriesToRemove.forEach(({ element, type, originalHandler }) => {
      const elementMap = trackedListeners.get(element);
      if (elementMap) {
        const typeMap = elementMap.get(type);
        if (typeMap) {
          typeMap.delete(originalHandler);
          if (typeMap.size === 0) {
            elementMap.delete(type);
          }
        }
        if (elementMap.size === 0) {
          trackedListeners.delete(element);
        }
      }
    });
  }

  function delegate(container, eventType, selector, handler, options = {}) {
    const delegatedHandler = function (event) {
      const target = domAPI.closest(event.target, selector);
      if (target) {
        handler.call(target, event, target);
      }
    };
    return trackListener(container, eventType, delegatedHandler, {
      ...options,
      description: options.description || `Delegate ${eventType} on ${selector}`,
      context: options.context || MODULE,
      module: options.module || MODULE,
      source: options.source || 'delegate'
    });
  }

  function setupLoginModalTabs() {
    const loginModal = domAPI.getElementById('loginModal');
    if (!loginModal) {
      return;
    }

    // Delegated listener for Login Tab
    delegate(
      loginModal,
      'click',
      '#modalLoginTab',
      (event, tabElement) => {
        const registerTabElement = domAPI.querySelector(loginModal, '#modalRegisterTab');
        const loginPanel = domAPI.querySelector(loginModal, '#loginPanel');
        const registerPanel = domAPI.querySelector(loginModal, '#registerPanel');

        if (!registerTabElement || !loginPanel || !registerPanel) {
          return;
        }

        domAPI.addClass(tabElement, 'tab-active');
        domAPI.setAttribute(tabElement, 'aria-selected', 'true');
        domAPI.removeClass(registerTabElement, 'tab-active');
        domAPI.setAttribute(registerTabElement, 'aria-selected', 'false');
        domAPI.removeClass(loginPanel, 'hidden');
        domAPI.addClass(registerPanel, 'hidden');
      },
      { description: 'Switch to Login Tab (Delegated)', module: MODULE, context: 'authTabs' }
    );

    // Delegated listener for Register Tab
    delegate(
      loginModal,
      'click',
      '#modalRegisterTab',
      (event, tabElement) => {
        const loginTabElement = domAPI.querySelector(loginModal, '#modalLoginTab');
        const loginPanel = domAPI.querySelector(loginModal, '#loginPanel');
        const registerPanel = domAPI.querySelector(loginModal, '#registerPanel');

        if (!loginTabElement || !loginPanel || !registerPanel) {
          return;
        }

        // Defensive: Only act if element is truthy and has classList/setAttribute
        if (tabElement && tabElement.classList) {
          domAPI.addClass(tabElement, 'tab-active');
          domAPI.setAttribute(tabElement, 'aria-selected', 'true');
        }
        if (loginTabElement && loginTabElement.classList) {
          domAPI.removeClass(loginTabElement, 'tab-active');
          domAPI.setAttribute(loginTabElement, 'aria-selected', 'false');
        }
        if (registerPanel && registerPanel.classList) {
          domAPI.removeClass(registerPanel, 'hidden');
        }
        if (loginPanel && loginPanel.classList) {
          domAPI.addClass(loginPanel, 'hidden');
        }
      },
      { description: 'Switch to Register Tab (Delegated)', module: MODULE, context: 'authTabs' }
    );
  }

  /**
   * Creates a CustomEvent in a DI-compliant way.
   * @param {string} type - The name of the event.
   * @param {Object} [options={}] - Options for the CustomEvent (e.g., detail, bubbles, cancelable).
   * @returns {CustomEvent|null} The created CustomEvent, or null if windowObject or CustomEvent API is not available.
   */
  function createCustomEvent(type, options = {}) {
    const windowObject = browserService?.getWindow?.(); // browserService is in the factory's scope
    if (!windowObject || typeof windowObject.CustomEvent !== 'function') {
      // Depending on strictness, could throw an error or log via an injected logger if available
      // For now, returning null or a simple object if CustomEvent is not polyfilled/available.
      logger.warn(`[${MODULE}][createCustomEvent] Cannot create CustomEvent: windowObject or window.CustomEvent is not available.`, { context: MODULE });
      return { type, detail: options.detail }; // Fallback to a plain object
    }
    return new windowObject.CustomEvent(type, options);
  }

  function cleanup() {
    // Cleans up all event listeners and module state
    cleanupListeners();
    // You could add more explicit cleanup logic here if stateful singletons or intervals are added
  }

  return {
    trackListener,
    cleanupListeners,
    delegate,
    debounce: globalDebounce,
    toggleVisible,
    setupCollapsible,
    setupModal,
    setupForm,
    init,
    PRIORITY,
    untrackListener,
    createCustomEvent,
    setProjectManager: (pm) => {
      _projectManager = pm;
    },
    setDomReadinessService, // <-- add to API
    DependencySystem,
    cleanup, // Expose cleanup API per guardrail
  };
}
