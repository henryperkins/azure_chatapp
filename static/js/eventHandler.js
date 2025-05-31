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
  safeHandler,      // NEW – canonical wrapper (required)
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
  if (!logger)
    throw new Error('[eventHandler] Missing logger dependency');
  if (!errorReporter) {
    throw new Error('[eventHandler] Missing errorReporter');
  }
  // domReadinessService is optional at factory, but required at init
  // ================================================================
  const MODULE = 'EventHandler';
  let _domReadinessService = domReadinessService || null;
  function setDomReadinessService(svc) {
    _domReadinessService = svc;
    // Break circular dependency: inform domReadinessService about EventHandlers
    if (svc?.setEventHandlers) {
      svc.setEventHandlers(eventHandlerAPI);
    }
  }
  function setLogger(newLogger)      { if (newLogger) logger = newLogger; }
  function setSafeHandler(newSH)     { if (typeof newSH === 'function') SH = newSH; }

  /* allow late upgrade once the real errorReporter exists */
  function setErrorReporter(newER)   { if (newER) errorReporter = newER; }

  // --- safeHandler canonical dependency check ---
  let   SH = null;
  function resolveSafeHandler() {
    if (SH && typeof SH === 'function') return SH;
    if (typeof safeHandler === 'function') {
      SH = safeHandler;
      return SH;
    }
    SH = DependencySystem.modules.get('safeHandler');
    if (typeof SH !== 'function') {
      throw new Error('[eventHandler] Missing safeHandler dependency');
    }
    return SH;
  }

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
          browserService.setTimeout(() => untrackListener(element, type, handler), 0);
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

    return remove;                       // ← now returns the “unsubscribe” function
  }


  function toggleVisible(elementSelectorOrElement, show) {
    const element =
      typeof elementSelectorOrElement === 'string'
        ? domAPI.querySelector(elementSelectorOrElement)
        : elementSelectorOrElement;
    return globalToggleElement(element, show, domAPI);
  }

  // ---------------------- HANDLER ANONYMITY REMEDIATION: NAMED FUNCS ----------------------------------

  function togglePanelFactory({ panel, toggleButton, chevron, toggleId, storageBackend, domAPI, onExpand }) {
    return function togglePanel(expand) {
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

    const togglePanel = togglePanelFactory({ panel, toggleButton, chevron, toggleId, storageBackend, domAPI, onExpand });

    let savedState = null;
    if (toggleId && storageBackend?.getItem) {
      savedState = storageBackend.getItem(`${toggleId}_expanded`);
    }
    togglePanel(savedState === 'true');

    // Named handler for collapsible toggle
    function handleCollapsibleClick() {
      const isCurrentlyExpanded = domAPI.getAttribute(toggleButton, 'aria-expanded') === 'true';
      togglePanel(!isCurrentlyExpanded);
    }

    trackListener(
      toggleButton,
      'click',
      resolveSafeHandler()(handleCollapsibleClick, `EventHandler:Collapsible:${toggleId}`),
      { description: `Toggle Collapsible ${toggleId}`, module: MODULE, context: 'collapsible', source: 'setupCollapsible' }
    );
  }

  // MODAL HANDLERS: All moved to named functions with safeHandler wrapping

  function makeModalOpenHandler(modal, modalId, onOpen, SH, modalManager, domAPI) {
    return function open() {
      if (typeof onOpen === 'function') {
        SH(onOpen, `EventHandler:setupModal:onOpen`)(modal);
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
  }

  function makeModalCloseHandler(modal, modalId, onClose, SH, modalManager, domAPI) {
    return function close() {
      if (modalManager?.hide) {
        modalManager.hide(modalId);
      } else if (typeof modal.close === 'function') {
        modal.close();
      } else {
        domAPI.addClass(modal, 'hidden');
        domAPI.removeAttribute(modal, 'open');
      }
      if (typeof onClose === 'function') {
        SH(onClose, `EventHandler:setupModal:onClose`)(modal);
      }
    };
  }

  function setupModal(modalId, openBtnId, closeBtnId, onOpen, onClose) {
    const modal = domAPI.getElementById(modalId);
    const openBtn = openBtnId ? domAPI.getElementById(openBtnId) : null;
    const closeBtn = closeBtnId ? domAPI.getElementById(closeBtnId) : null;

    if (!modal) {
      return { open: () => { }, close: () => { } };
    }

    const open = makeModalOpenHandler(modal, modalId, onOpen, SH, modalManager, domAPI);
    const close = makeModalCloseHandler(modal, modalId, onClose, SH, modalManager, domAPI);

    // ESC close named handler
    function handleModalEscClose(e) {
      if (e.key === 'Escape') close();
    }
    // backdrop click close named handler
    function handleModalBackdropClick(e) {
      if (domAPI.isSameNode(e.target, modal)) close();
    }

    // Handlers for buttons
    if (openBtn) {
      trackListener(openBtn, 'click', resolveSafeHandler()(open, `EventHandler:setupModal:open`), {
        description: `Open Modal ${modalId}`,
        module: MODULE,
        context: 'modal',
        source: 'setupModal'
      });
    }
    if (closeBtn) {
      trackListener(closeBtn, 'click', resolveSafeHandler()(close, `EventHandler:setupModal:closeBtn`), {
        description: `Close Modal ${modalId} via Button`,
        module: MODULE,
        context: 'modal',
        source: 'setupModal'
      });
    }

    trackListener(
      modal,
      'keydown',
      resolveSafeHandler()(handleModalEscClose, `EventHandler:setupModal:keydown`),
      { description: `Modal ESC Close ${modalId}`, module: MODULE, context: 'modal', source: 'setupModal' }
    );

    trackListener(
      modal,
      'click',
      resolveSafeHandler()(handleModalBackdropClick, `EventHandler:setupModal:backdropClick`),
      { description: `Modal Backdrop Close ${modalId}`, module: MODULE, context: 'modal', source: 'setupModal' }
    );

    return { open, close };
  }

  // FORM HANDLERS

  function setupForm(formId, submitHandler, options = {}) {
    const form = domAPI.getElementById(formId);
    if (!form) {
      return;
    }

    const { validateBeforeSubmit = true, showLoadingState = true, resetOnSuccess = true } = options;

    // Named handler for form submit
    async function handleSubmit(e) {
      domAPI.preventDefault(e); // Use domAPI to avoid direct event calls
      if (domAPI.hasClass(form, 'submitting')) return;

      if (validateBeforeSubmit) {
        if (!domAPI.checkFormValidity(form)) {
          domAPI.reportFormValidity(form);
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
        if (!browserService?.FormData)
          throw new Error('[EventHandler][setupForm] browserService.FormData unavailable (strict DI)');
        const formData = new browserService.FormData(form);
        await SH(submitHandler, 'EventHandler:setupForm:submitHandler')(formData, form);
        if (resetOnSuccess) {
          domAPI.resetForm(form);
        }
      } catch (error) {
        if (options.onError) {
          try {
            SH(options.onError, 'EventHandler:setupForm:onError')(error);
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
    }

    trackListener(form, 'submit', resolveSafeHandler()(handleSubmit, 'EventHandler:setupForm:handleSubmit'), {
      passive: false,
      description: `Form Submit ${formId}`,
      module: MODULE,
      context: 'form',
      source: 'setupForm'
    });
  }

  // COMMON ELEMENTS

  function setupCommonElements() {
    const darkModeToggle = domAPI.getElementById('darkModeToggle');
    if (darkModeToggle && !domAPI.getDataAttribute(darkModeToggle, 'ehBound')) {
      function handleDarkModeToggleClick() {
        domAPI.toggleClass(domAPI.getDocument().documentElement, 'dark');
        const isDark = domAPI.hasClass(domAPI.getDocument().documentElement, 'dark');
        storageBackend.setItem('darkMode', isDark ? 'true' : 'false');
      }
      trackListener(
        darkModeToggle,
        'click',
        resolveSafeHandler()(handleDarkModeToggleClick, 'EventHandler:setupCommonElements:DarkModeToggleClick'),
        { description: 'Dark Mode Toggle', module: MODULE, context: 'ui', source: 'setupCommonElements' }
      );
      domAPI.setDataAttribute(darkModeToggle, 'ehBound', '1'); // marca como enlazado
      // Initial dark mode state
      if (storageBackend.getItem('darkMode') === 'true') {
        domAPI.addClass(domAPI.getDocument().documentElement, 'dark');
      }
    }
  }

  // NAVIGATION ELEMENTS

  function setupNavigationElements() {
    const navLinks = domAPI.querySelectorAll('.nav-link');
    navLinks.forEach((link) => {
      if (!domAPI.getDataAttribute(link, 'ehBound')) {
        function handleNavLinkClick(e) {
          domAPI.preventDefault(e);
          const href = domAPI.getAttribute(link, 'href');
          if (href) redirect(href);
        }
        trackListener(
          link,
          'click',
          resolveSafeHandler()(handleNavLinkClick, `EventHandler:setupNavigationElements:NavLink:${domAPI.getAttribute(link, 'href') || 'unknown'}`),
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

  // PROJECT MODAL FORM

  function setupProjectModalForm() {
    const pm = _projectManager || DependencySystem.modules.get('projectManager');
    if (!pm) {
      return;
    }
    async function handleProjectFormSubmit(formData) {
      const data = Object.fromEntries(formData.entries());
      if (data.max_tokens) data.max_tokens = parseInt(data.max_tokens, 10);
      if (!data.name) {
        throw new Error('Project name is required.');
      }
      await pm.saveProject(data.projectId, data);
      modalManager?.hide?.('project');
      pm.loadProjects?.('all');
    }
    function handleProjectFormError(err) {
      logger.error(`[${MODULE}][setupProjectModalForm] Error in project form submit`, err, { context: 'projectModalForm' });
    }
    setupForm(
      'projectModalForm',
      handleProjectFormSubmit,
      {
        resetOnSuccess: true,
        onError: handleProjectFormError
      }
    );
  }

  // CONTENT ELEMENTS

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

  // DELEGATE: make sure delegate handler is always a named const for remediation
  function delegate(container, eventType, selector, handler, options = {}) {
    const delegatedHandler = function delegatedEventHandler(event) {
      const target = domAPI.closest(event.target, selector);
      if (target) {
        handler.call(target, event, target);
      }
    };
    return trackListener(container, eventType, SH(delegatedHandler, `EventHandler:delegate:${eventType}:${selector}`), {
      ...options,
      description: options.description || `Delegate ${eventType} on ${selector}`,
      context: options.context || MODULE,
      module: options.module || MODULE,
      source: options.source || 'delegate'
    });
  }

  // login-modal tab handlers as named functions
  function setupLoginModalTabs() {
    const loginModal = domAPI.getElementById('loginModal');
    if (!loginModal) {
      return;
    }

    function handleLoginTabClick(event, tabElement) {
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
    }

    function handleRegisterTabClick(event, tabElement) {
      const loginTabElement = domAPI.querySelector(loginModal, '#modalLoginTab');
      const loginPanel = domAPI.querySelector(loginModal, '#loginPanel');
      const registerPanel = domAPI.querySelector(loginModal, '#registerPanel');

      if (!loginTabElement || !loginPanel || !registerPanel) {
        return;
      }

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
    }

    // Delegated listener for Login Tab
    delegate(
      loginModal,
      'click',
      '#modalLoginTab',
      handleLoginTabClick,
      { description: 'Switch to Login Tab (Delegated)', module: MODULE, context: 'authTabs' }
    );

    // Delegated listener for Register Tab
    delegate(
      loginModal,
      'click',
      '#modalRegisterTab',
      handleRegisterTabClick,
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
      throw new Error(`[${MODULE}][createCustomEvent] FATAL: windowObject.CustomEvent is not available. This will break app event dispatching. Please ensure the polyfill is loaded before any app code.`);
    }
    return new windowObject.CustomEvent(type, options);
   }

   /**
    * Dispatch a custom event in a DI-compliant way.
    *
    * @param {string}       type               Event name.
    * @param {Object}       [detail={}]        Detail payload.
    * @param {EventTarget}  [target=null]      Dispatch target (defaults to document).
    * @returns {boolean}                       True if dispatched, otherwise false.
    */
   function dispatch(type, detail = {}, target = null) {
     try {
       const evt = createCustomEvent(type, { detail, bubbles: true });
       const tgt =
         target ||
         (domAPI?.getDocument
           ? domAPI.getDocument()
           : browserService?.getWindow?.()?.document);

       if (!tgt || typeof tgt.dispatchEvent !== 'function') {
         logger.warn(`[${MODULE}][dispatch] Cannot dispatch "${type}" – invalid target`, {
           context: MODULE
         });
         return false;
       }
       domAPI.dispatchEvent(tgt, evt);
       return true;
     } catch (err) {
       logger.error(`[${MODULE}][dispatch] Failed to dispatch "${type}"`, err, {
         context: MODULE
       });
       return false;
     }
   }

  function cleanup() {
    // centralised cleanup – must reference the public API, not the
    // constructor-scope variable (rule-2 DI compliance)
    eventHandlerAPI.cleanupListeners({ context: MODULE });
    // You could add more explicit cleanup logic here if stateful singletons or intervals are added
  }

  // ─── Public API object (assembled before init) ────────────────────────────
  const eventHandlerAPI = {
    trackListener,
    cleanupListeners,
    delegate,
    dispatch,
    debounce        : globalDebounce,
    toggleVisible,
    setupCollapsible,
    setupModal,
    setupForm,
    PRIORITY,
    untrackListener,
    createCustomEvent,
    dispatchEvent,
    setProjectManager : (pm) => { _projectManager = pm; },
    setDomReadinessService,
    setLogger,
    setSafeHandler,
    setErrorReporter,      // ← NEW
    DependencySystem,
    cleanup
  };

  // ――― init becomes a method of the API object ―――
  let initialized = false;
  eventHandlerAPI.init = async function () {
    if (initialized) return eventHandlerAPI;           // ✅ return full API

    if (!_domReadinessService) {
      throw new Error('[eventHandler.init] domReadinessService must be set via setDomReadinessService before calling init()');
    }

    const dependencyWaitTimeout = APP_CONFIG?.TIMEOUTS?.DEPENDENCY_WAIT ?? 10000;

    /* --- DOM & dependency readiness --- */
    await _domReadinessService.documentReady();
    await _domReadinessService.dependenciesAndElements({
      deps        : ['app','auth','projectManager','modalManager','domAPI','browserService'],
      domSelectors: ['body'],
      timeout     : dependencyWaitTimeout,
      context     : 'eventHandler.init'
    });

    /* --- in-DOM setup formerly in the old init() --- */
    await _domReadinessService.documentReady();
    setupCommonElements();
    setupNavigationElements();
    setupContentElements();

    /* ---- project modal form wait (unchanged) ---- */
    try {
      await _domReadinessService.elementsReady('#projectModalForm', {
        timeout: 3000,
        context: 'eventHandler.init:modalForm'
      }).then(() => {
        setupProjectModalForm();
        logger.info(`[${MODULE}][init] Project modal form setup completed`,
                    { context: 'eventHandler.init:modalForm' });
      }).catch((error) => {
        logger.warn(`[${MODULE}][init] elementsReady('#projectModalForm') failed`,
                    error,
                    { context: 'eventHandler.init:modalForm' });
      });
    } catch (error) {
      logger.error(`[${MODULE}][init] Error during modal form setup`, error,
                   { context: 'eventHandler.init:modalForm' });
    }

    /* ---- login-modal delegation (logic kept verbatim) ---- */
    function bindAuthButtonDelegate() {
      if (authButtonDelegationBound) return;
      const parentNode = domAPI.getElementById('header') || domAPI.getDocument();
      const currentModalManager = modalManager || DependencySystem.modules.get('modalManager');

      logger.info('[EventHandler] bindAuthButtonDelegate', {
        parentNodeExists: !!parentNode,
        modalManagerExists: !!currentModalManager,
        modalManagerHasShow: !!(currentModalManager?.show),
        context: 'eventHandler.bindAuthButtonDelegate'
      });

      if (!currentModalManager?.show) {
        logger.warn('[EventHandler] modalManager not available for auth button', {
          context: 'eventHandler.bindAuthButtonDelegate'
        });
        return;
      }

      function handleAuthButtonClick(e, _element) {
        domAPI.preventDefault(e);
        logger.info('[EventHandler] Auth button clicked', { context: 'eventHandler.authButton' });
        try {
          currentModalManager.show('login');
          logger.info('[EventHandler] Login modal requested', { context: 'eventHandler.authButton' });
        }
        catch (error) {
          logger.error(`[${MODULE}][bindAuthButtonDelegate]`, error, { context: 'auth' });
        }
      }

      delegate(
        parentNode,
        'click',
        '#authButton',
        handleAuthButtonClick,
        { description: 'Delegated Login Modal Show', context: 'auth', module: MODULE }
      );
      authButtonDelegationBound = true;
    }

    // global requestLogin listener
    function handleRequestLogin() {
      const currentModalManager = modalManager || DependencySystem.modules.get('modalManager');
      currentModalManager?.show?.('login');
    }
    trackListener(
      domAPI.getDocument(),
      'requestLogin',
      resolveSafeHandler()(handleRequestLogin, 'EventHandler:requestLogin'),
      { description: 'Show Login Modal (Global Event)', context: 'auth', module: MODULE, source: 'requestLogin' }
    );

    function handleModalsLoaded() {
      bindAuthButtonDelegate();
      setupLoginModalTabs();
    }
    trackListener(
      domAPI.getDocument(),
      'modalsLoaded',
      SH(handleModalsLoaded, 'EventHandler:modalsLoaded'),
      { once: true, description: 'Rebind login / tabs after modalsLoaded', context: 'auth', module: MODULE, source: 'modalsLoaded' }
    );

    // fast-path if modals already present
    if (domAPI.getElementById('modalsContainer')?.childElementCount > 0) {
      setupLoginModalTabs();
    }

    initialized = true;
    return eventHandlerAPI;                             // ✅
  };

  return eventHandlerAPI;
}
