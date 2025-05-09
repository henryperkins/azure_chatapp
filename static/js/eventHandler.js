/* global APP_CONFIG */
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
 * @param {Function} [deps.navigate] - Optional navigation function override.
 * @param {Object} [deps.storage] - Optional storage abstraction override (usually from browserService).
 * @returns {Object} Event handler API { trackListener, cleanupListeners, delegate, etc. }
 */
import { waitForDepsAndDom } from './utils/globalUtils.js';
import { debounce as globalDebounce, toggleElement as globalToggleElement } from './utils/globalUtils.js';

const MODULE = 'EventHandler';

export function createEventHandlers({
  app, projectManager, modalManager, DependencySystem,
  domAPI, browserService, notify,
  navigate, storage
} = {}) {
  // Permite inyectar/actualizar projectManager más tarde
  let _projectManager = projectManager;
  const debugTools = DependencySystem?.modules?.get?.('debugTools') || null;
  // --- Dependency Validation ---
  if (!DependencySystem) throw new Error(`[${MODULE}] DependencySystem is required`);
  if (!domAPI) throw new Error(`[${MODULE}] domAPI is required`);
  if (!browserService) throw new Error(`[${MODULE}] browserService is required`);
  if (!notify) throw new Error(`[${MODULE}] notify utility (handlerNotify) is required`);

  // Primary notifier reference (may be replaced by setNotifier)
  let handlerNotify = notify;

  // Removed implicit dep resolution – all deps must be injected explicitly.

  // ---- singleton flags ---------------------------------------------------
  let authButtonDelegationBound = false;   // prevents duplicate binding

  const storageBackend = storage || browserService; // Assuming browserService provides getItem/setItem

  function redirect(url) {
    if (typeof navigate === "function") navigate(url);
    else if (app && typeof app.navigate === "function") app.navigate(url);
    else if (browserService && typeof browserService.setLocation === 'function') {
      browserService.setLocation(url);
    } else {
      handlerNotify.warn('No navigation function available for redirect.', { module: MODULE, source: 'redirect', extra: { url } });
    }
  }

  const trackedListeners = new Map();
  const PRIORITY = { HIGH: 1, NORMAL: 5, LOW: 10 }; // Example priorities

  function trackListener(element, type, handler, options = {}) {
    // Use injected handlerNotify, fallback to DependencySystem then console for early/critical logs
    const localNotify = handlerNotify ||
      (DependencySystem?.modules?.get?.('notify')) ||
      {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        success: () => {}
      };

    if (!element) {
      const { description = 'Unnamed Listener', context = 'eventHandler', source = 'trackListener', module: optModule = MODULE } = options;
      localNotify.warn(`trackListener called with null/undefined element for '${description}'.`, {
        source, context, module: optModule, group: true,
        extra: { description, eventType: type, callerStack: new Error().stack }
      });
      return undefined;
    }

    if (typeof element.addEventListener !== 'function') {
      const { description = 'Unnamed Listener', context = 'eventHandler', source = 'trackListener', module: optModule = MODULE } = options;
      localNotify.warn(`trackListener called with invalid element type for '${description}'.`, {
        source, context, module: optModule, group: true,
        extra: {
          elementType: typeof element, elementValue: String(element).substring(0, 100),
          elementId: element && typeof element === 'object' ? element.id : null,
          elementClass: element && typeof element === 'object' ? element.className : null,
          description, eventType: type, callerStack: new Error().stack
        }
      });
      return undefined;
    }

    const { capture = false, once = false, signal, passive } = options;
    const nonPassiveEvents = ['click', 'submit', 'wheel', 'touchstart', 'touchmove', 'keydown', 'keypress', 'keyup'];
    const usePassive = (typeof passive === 'boolean') ? passive : !nonPassiveEvents.includes(type);
    const finalOptions = { capture, once, signal, passive: usePassive };
    const description = options.description || 'Unnamed Listener';
    const listenerContext = options.context || 'eventHandler';
    const listenerSource = options.source || 'trackListener';
    const listenerModule = options.module || MODULE;

    const elementMap = trackedListeners.get(element);
    if (elementMap) {
      const typeMap = elementMap.get(type);
      if (typeMap && typeMap.has(handler)) {
        return typeMap.get(handler).wrappedHandler;
      }
    }

    const wrappedHandler = function (event) {
      const startTime = performance.now();
      try {
        const result = handler.call(this, event);
        if (result && typeof result.then === 'function') {
          result.catch(error => {
            localNotify.error(`Async error in ${description}`, {
              group: true, context: listenerContext, source: listenerSource, module: listenerModule,
              originalError: error, extra: { type }
            });
            if (error.name === 'TypeError' && error.message.includes('passive') && finalOptions.passive) {
              localNotify.warn(`preventDefault() called on passive listener: ${description}`, {
                group: true, context: listenerContext, source: listenerSource, module: listenerModule, extra: { type }
              });
            }
          }).finally(() => {
            const duration = performance.now() - startTime;
            const threshold = type === 'submit' ? 800 : type === 'click' ? 500 : 100;
            if (duration > threshold) {
              localNotify.warn(`Slow handler: ${description} took ${duration.toFixed(1)}ms`, {
                group: true, context: listenerContext, source: listenerSource, module: listenerModule, extra: { type, duration }
              });
            }
          });
        } else {
          const duration = performance.now() - startTime;
          const threshold = type === 'submit' ? 800 : type === 'click' ? 500 : 100;
          if (duration > threshold) {
            localNotify.warn(`Slow handler: ${description} took ${duration.toFixed(1)}ms`, {
              group: true, context: listenerContext, source: listenerSource, module: listenerModule, extra: { type, duration }
            });
          }
        }
        return result;
      } catch (error) {
        localNotify.error(`Sync error in ${description}`, {
          group: true, context: listenerContext, source: listenerSource, module: listenerModule,
          originalError: error, extra: { type }
        });
        if (error.name === 'TypeError' && error.message.includes('passive') && finalOptions.passive) {
          localNotify.warn(`preventDefault() called on passive listener: ${description}`, {
            group: true, context: listenerContext, source: listenerSource, module: listenerModule, extra: { type }
          });
        }
      }
    };

    try {
      if (domAPI && typeof domAPI.addEventListener === 'function') {
        domAPI.addEventListener(element, type, wrappedHandler, finalOptions);
      } else {
        localNotify.warn(`domAPI.addEventListener unavailable in trackListener for '${description}', using direct addEventListener.`, {
          group: true, context: listenerContext, source: listenerSource, module: MODULE
        });
        element.addEventListener(type, wrappedHandler, finalOptions);
      }
    } catch (err) {
      localNotify.error('Error registering event listener', {
        group: true, context: listenerContext, source: listenerSource, module: listenerModule,
        originalError: err, extra: { type, description }
      });
      return undefined;
    }

    // Bookkeeping for cleanup
    let typeMap = trackedListeners.get(element);
    if (!typeMap) {
      typeMap = new Map();
      trackedListeners.set(element, typeMap);
    }
    let handlerMap = typeMap.get(type);
    if (!handlerMap) {
      handlerMap = new Map();
      typeMap.set(type, handlerMap);
    }
    handlerMap.set(handler, { wrappedHandler, options: finalOptions });

    return wrappedHandler;
  }

  function toggleVisible(elementSelectorOrElement, show) {
    const element = typeof elementSelectorOrElement === 'string'
      ? domAPI.querySelector(elementSelectorOrElement)
      : elementSelectorOrElement;
    return globalToggleElement(element, show); // globalToggleElement should use domAPI or be pure
  }

  function setupCollapsible(toggleId, panelId, chevronId, onExpand) {
    const toggleButton = domAPI.getElementById(toggleId);
    const panel = domAPI.getElementById(panelId);
    const chevron = chevronId ? domAPI.getElementById(chevronId) : null;

    if (!toggleButton || !panel) {
      handlerNotify.warn(`Collapsible elements not found: ${toggleId} or ${panelId}`, { module: MODULE, source: 'setupCollapsible' });
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
        try { onExpand(); }
        catch (err) { handlerNotify.error('Error in onExpand callback for collapsible', { module: MODULE, source: 'setupCollapsible', group: true, originalError: err, extra: { toggleId } }); }
      }
      if (toggleId && storageBackend?.setItem) {
        try { storageBackend.setItem(`${toggleId}_expanded`, String(expand)); }
        catch (err) { handlerNotify.warn('Failed to save collapsible state', { module: MODULE, source: 'setupCollapsible', originalError: err, extra: { toggleId } }); }
      }
    };

    let savedState = null;
    if (toggleId && storageBackend?.getItem) {
      try { savedState = storageBackend.getItem(`${toggleId}_expanded`); } catch { /* ignore */ }
    }
    togglePanel(savedState === 'true');

    trackListener(toggleButton, 'click', () => {
      const isCurrentlyExpanded = domAPI.getAttribute(toggleButton, 'aria-expanded') === 'true';
      togglePanel(!isCurrentlyExpanded);
    }, { description: `Toggle Collapsible ${toggleId}`, module: MODULE, context: 'collapsible' });
  }

  function setupModal(modalId, openBtnId, closeBtnId, onOpen, onClose) {
    const modal = domAPI.getElementById(modalId);
    const openBtn = openBtnId ? domAPI.getElementById(openBtnId) : null;
    const closeBtn = closeBtnId ? domAPI.getElementById(closeBtnId) : null;

    if (!modal) {
      handlerNotify.warn(`Modal element not found: ${modalId}`, { module: MODULE, source: 'setupModal' });
      return { open: () => { }, close: () => { } };
    }

    const open = () => {
      if (typeof onOpen === 'function') {
        try { onOpen(modal); }
        catch (err) { handlerNotify.error('Error in onOpen callback for modal', { module: MODULE, source: 'setupModal', group: true, originalError: err, extra: { modalId } }); }
      }
      if (modalManager?.show) modalManager.show(modalId);
      else if (typeof modal.showModal === 'function') modal.showModal();
      else { domAPI.removeClass(modal, 'hidden'); domAPI.setAttribute(modal, 'open', 'true'); }
    };

    const close = () => {
      if (modalManager?.hide) modalManager.hide(modalId);
      else if (typeof modal.close === 'function') modal.close();
      else { domAPI.addClass(modal, 'hidden'); domAPI.removeAttribute(modal, 'open'); }
      if (typeof onClose === 'function') {
        try { onClose(modal); }
        catch (err) { handlerNotify.error('Error in onClose callback for modal', { module: MODULE, source: 'setupModal', group: true, originalError: err, extra: { modalId } }); }
      }
    };

    if (openBtn) trackListener(openBtn, 'click', open, { description: `Open Modal ${modalId}`, module: MODULE, context: 'modal' });
    if (closeBtn) trackListener(closeBtn, 'click', close, { description: `Close Modal ${modalId} via Button`, module: MODULE, context: 'modal' });
    trackListener(modal, 'keydown', (e) => { if (e.key === 'Escape') close(); }, { description: `Modal ESC Close ${modalId}`, module: MODULE, context: 'modal' });
    trackListener(modal, 'click', (e) => { if (domAPI.isSameNode(e.target, modal)) close(); }, { description: `Modal Backdrop Close ${modalId}`, module: MODULE, context: 'modal' }); // isSameNode from domAPI

    return { open, close };
  }

  function setupForm(formId, submitHandler, options = {}) {
    const form = domAPI.getElementById(formId);
    if (!form) {
      handlerNotify.warn(`Form element not found: ${formId}`, { module: MODULE, source: 'setupForm' });
      return;
    }

    const { validateBeforeSubmit = true, showLoadingState = true, resetOnSuccess = true } = options;

    const handleSubmit = async (e) => {
      domAPI.preventDefault(e); // Use domAPI.preventDefault
      if (domAPI.hasClass(form, 'submitting')) return;

      if (validateBeforeSubmit && typeof form.checkValidity === 'function') {
        if (!form.checkValidity()) {
          if (typeof form.reportValidity === 'function') form.reportValidity();
          else handlerNotify.warn('Form validation failed, reportValidity not available.', { module: MODULE, source: 'setupForm', extra: { formId } });
          return;
        }
      }

      const submitBtn = domAPI.querySelector(form, '[type="submit"]'); // Query relative to form via domAPI
      if (showLoadingState && submitBtn) {
        domAPI.addClass(form, 'submitting');
        domAPI.setProperty(submitBtn, 'disabled', true);
        domAPI.setDataAttribute(submitBtn, 'original-text', domAPI.getTextContent(submitBtn));
        domAPI.setTextContent(submitBtn, 'Submitting...');
      }

      try {
        const formData = new FormData(form); // FormData is a standard API, less need to abstract unless for testing
        await submitHandler(formData, form);
        if (resetOnSuccess && typeof form.reset === 'function') form.reset();
        handlerNotify.info(`Form ${formId} submitted successfully.`, { module: MODULE, source: 'setupForm', extra: { formId } });
      } catch (error) {
        handlerNotify.error('Form submission failed', {
          group: true, context: 'formSubmission', module: MODULE, source: 'setupForm',
          originalError: error, extra: { formId }
        });
        if (options.onError) {
          try { options.onError(error); }
          catch (onErrorErr) { handlerNotify.error('Error in form onError callback', { module: MODULE, source: 'setupForm', group: true, originalError: onErrorErr, extra: { formId } }); }
        }
      } finally {
        if (showLoadingState) {
          domAPI.removeClass(form, 'submitting');
          if (submitBtn) {
            domAPI.setProperty(submitBtn, 'disabled', false);
            const originalText = domAPI.getDataAttribute(submitBtn, 'original-text');
            if (originalText) {
              domAPI.setTextContent(submitBtn, originalText);
              domAPI.removeDataAttribute(submitBtn, 'original-text');
            }
          }
        }
      }
    };

    trackListener(form, 'submit', handleSubmit, {
      passive: false, description: `Form Submit ${formId}`, module: MODULE, context: 'form'
    });
  }

  let initialized = false;
  async function init() {
    if (initialized) {
      handlerNotify.info("EventHandler already initialized.", { module: MODULE, source: 'init' });
      return this; // Return API object early
    }
    const _t = debugTools?.start?.('EventHandler.init');
    handlerNotify.info('Initializing event handlers...', { module: MODULE, source: 'init' });
    try {
      // APP_CONFIG assumed to be globally available for TIMEOUTS.
      // Ideally, specific timeout values would be injected.
      const dependencyWaitTimeout = typeof APP_CONFIG !== 'undefined' && APP_CONFIG.TIMEOUTS?.DEPENDENCY_WAIT
        ? APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT
        : 10000;
      await waitForDepsAndDom({
        deps: ['app', 'auth', 'projectManager', 'modalManager', 'notify', 'domAPI', 'browserService'],
        domSelectors: ['body'],
        DependencySystem,
        timeout: dependencyWaitTimeout
      });

      setupCommonElements();
      setupNavigationElements();
      setupContentElements();

      const checkProjectModalForm = () => {
        if (domAPI.getElementById('projectModalForm')) {
          setupProjectModalForm();
        }
      };

      if (domAPI.getDocument().readyState !== 'loading') {
        checkProjectModalForm();
      } else {
        trackListener(domAPI.getDocument(), 'DOMContentLoaded', checkProjectModalForm, { once: true, module: MODULE, context: 'init' });
      }
      // --- BEGIN: LOGIN BUTTON/MODAL HANDLING ---
      // Header Login Button
      // Direct event handler for Login button
      /**
       * Robust login button delegation using event delegation.
       * Attaches a click handler to a stable parent (header or document) that listens for #authButton clicks,
       * ensuring handler works even if #authButton is dynamically replaced.
       */
      function bindAuthButtonDelegate() {
        if (authButtonDelegationBound) return;          // already bound
        // Use a stable parent for delegation: header (if present), otherwise fallback to document.
        let parentNode = domAPI.getElementById('header') || domAPI.getDocument();
        // Ensure modalManager dependency is met before binding (try DI if not injected)
        const currentModalManager = modalManager || DependencySystem.modules.get('modalManager');
        if (!currentModalManager || typeof currentModalManager.show !== 'function') {
            handlerNotify.error("[EventHandler] modalManager is missing or .show is not a function during bindAuthButtonDelegate", { module: MODULE, source: 'bindAuthButtonDelegate' });
            return;
        }
        // Remove any previous delegate to avoid duplicate binding (optional: could track and cleanup if needed)
        // Attach delegated listener for #authButton click
        delegate(
          parentNode,
          'click',
          '#authButton',
          function(e) {
            domAPI.preventDefault(e);
            handlerNotify.info('Login button DELEGATED click, attempting modalManager.show("login")', { source: 'DelegatedLoginButtonHandler', context: 'auth', module: MODULE });
            try {
              const result = currentModalManager.show('login');
              handlerNotify.info('modalManager.show("login") executed (delegated), result: ' + JSON.stringify(result), { source: 'DelegatedLoginButtonHandler', context: 'auth', module: MODULE });
            } catch (error) {
              handlerNotify.error('modalManager.show("login") failed (delegated)', { source: 'DelegatedLoginButtonHandler', context: 'auth', module: MODULE, originalError: error });
            }
          },
          { description: 'Delegated Login Modal Show', context: 'auth', module: MODULE }
        );
        handlerNotify.debug('Delegated click listener bound for #authButton', { module: MODULE, source: 'bindAuthButtonDelegate' });
        authButtonDelegationBound = true;               // mark as bound
      }

      // Listen for requestLogin event (used by project list and others)
      trackListener(domAPI.getDocument(), 'requestLogin', () => {
        // Attempt to retrieve modalManager via DI if not injected
        const currentModalManager = modalManager || DependencySystem.modules.get('modalManager');
        if (currentModalManager && typeof currentModalManager.show === 'function') {
          currentModalManager.show('login');
        }
      }, { description: 'Show Login Modal (Global Event)', context: 'auth', module: MODULE });

      // Bind immediately so we don’t miss an already-fired modalsLoaded
      bindAuthButtonDelegate();

      // --- END: LOGIN BUTTON/MODAL HANDLING ---

      // --- BEGIN: LOGIN BUTTON REBIND AFTER MODALSLOADED ---
      // After modalsLoaded, rebind but ensure only one handler exists.
      trackListener(domAPI.getDocument(), 'modalsLoaded', (event) => {
        bindAuthButtonDelegate();

        setupLoginModalTabs(); // Call setup for login modal tabs here

        if (event && event.detail && event.detail.success) {
          handlerNotify.info('Rebound login button delegation and set up login tabs after successful modalsLoaded', {
            module: MODULE,
            context: 'auth',
            source: 'modalsLoaded'
          });
        } else {
          handlerNotify.warn('Modals failed to load or event detail missing. Login button delegation rebound and tab setup attempted anyway.', {
            module: MODULE,
            context: 'auth',
            source: 'modalsLoaded',
            eventDetail: event && event.detail ? event.detail : 'N/A'
          });
        }
      }, {
        once: true,
        description: 'Rebind login and setup tabs after modalsLoaded',
        context: 'auth',
        module: MODULE
      });
      // --- END: LOGIN BUTTON REBIND AFTER MODALSLOADED ---

      // setupLoginModalTabs(); // Moved into modalsLoaded listener

      initialized = true;
      debugTools?.stop?.(_t,'EventHandler.init');
      handlerNotify.info("EventHandler module initialized successfully.", { module: MODULE, source: 'init' });

      // --- Standardized "eventhandler:initialized" event ---
      const doc = domAPI?.getDocument?.() || (typeof document !== "undefined" ? document : null);
      if (doc) {
        if (domAPI?.dispatchEvent) {
          domAPI.dispatchEvent(doc, new CustomEvent('eventhandler:initialized',
            { detail: { success: true } }));
        } else {
          doc.dispatchEvent(new CustomEvent('eventhandler:initialized',
            { detail: { success: true } }));
        }
      }

    } catch (err) {
      handlerNotify.error('EventHandler initialization failed', {
        group: true, context: 'initialization', module: MODULE, source: 'init', originalError: err
      });
      debugTools?.stop?.(_t,'EventHandler.init-error');
      throw err;
    }
    return this; // Return API object
  }

  function setupCommonElements() {
    const darkModeToggle = domAPI.getElementById('darkModeToggle');
    if (darkModeToggle) {
      trackListener(darkModeToggle, 'click', () => {
        domAPI.toggleClass(domAPI.getDocument().documentElement, 'dark');
        const isDark = domAPI.hasClass(domAPI.getDocument().documentElement, 'dark');
        storageBackend.setItem('darkMode', isDark ? 'true' : 'false');
        handlerNotify.info(`Dark mode ${isDark ? 'enabled' : 'disabled'}`, { module: MODULE, context: 'ui' });
      }, { description: 'Dark Mode Toggle', module: MODULE, context: 'ui' });
      // Initial state
      if (storageBackend.getItem('darkMode') === 'true') {
        domAPI.addClass(domAPI.getDocument().documentElement, 'dark');
      }
    }
  }

  function setupProjectModalForm() {
    // Assuming projectManager is resolved and available if this form exists
    const pm = _projectManager || DependencySystem.modules.get('projectManager');
    if (!pm) {
      handlerNotify.warn('ProjectManager not available for projectModalForm setup.', { module: MODULE, source: 'setupProjectModalForm' });
      return;
    }
    setupForm('projectModalForm', async (formData) => {
      const data = Object.fromEntries(formData.entries());
      // Basic validation or transformation
      if (data.max_tokens) data.max_tokens = parseInt(data.max_tokens, 10);
      if (!data.name) {
        throw new Error('Project name is required.'); // setupForm's error handler will catch this
      }
      await pm.saveProject(data.projectId, data); // Assuming saveProject handles create/update
      modalManager?.hide?.('project'); // Assuming modalManager is resolved
      pm.loadProjects?.('all');
    }, {
      // Form options
      resetOnSuccess: true,
      onError: (err) => handlerNotify.error('Project save failed.', { module: MODULE, context: 'projectModal', originalError: err })
    });
  }

  function setupNavigationElements() {
    const navLinks = domAPI.querySelectorAll('.nav-link'); // Example selector
    navLinks.forEach(link => {
      trackListener(link, 'click', (e) => {
        domAPI.preventDefault(e);
        const href = domAPI.getAttribute(link, 'href');
        if (href) redirect(href);
      }, { description: `Navigation Link: ${domAPI.getAttribute(link, 'href') || 'unknown'}`, module: MODULE, context: 'navigation' });
    });
  }

  function setupContentElements() {
    // Example: Setup all elements with 'data-collapsible-toggle'
    const collapsibleToggles = domAPI.querySelectorAll('[data-collapsible-toggle]');
    collapsibleToggles.forEach(toggle => {
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
      if (domAPI && typeof domAPI.removeEventListener === 'function') {
        domAPI.removeEventListener(el, evt, details.wrappedHandler, details.options);
      } else {
        el.removeEventListener(evt, details.wrappedHandler, details.options);
      }
      typeMap.delete(handler);
      if (typeMap.size === 0) elementMap.delete(evt);
      if (elementMap.size === 0) trackedListeners.delete(el);
    } catch (error) {
      handlerNotify.warn('Error in untrackListener', { module: MODULE, source: 'untrackListener', originalError: error });
    }
  }

  function cleanupListeners() {
    trackedListeners.forEach((typeMap, element) => {
      typeMap.forEach((handlerMap, type) => {
        handlerMap.forEach(({ wrappedHandler, options }) => {
          if (domAPI && typeof domAPI.removeEventListener === 'function') {
            domAPI.removeEventListener(element, type, wrappedHandler, options);
          } else {
            element.removeEventListener(type, wrappedHandler, options);
          }
        });
      });
    });
    trackedListeners.clear();
  }

  function delegate(container, eventType, selector, handler, options = {}) {
    const delegatedHandler = function(event) {
      const target = domAPI.closest(event.target, selector);
      if (target) {
        handler.call(target, event, target);
      }
    };
    return trackListener(container, eventType, delegatedHandler, {
      ...options,
      description: options.description || `Delegate ${eventType} on ${selector}`,
      context: options.context || 'eventHandlerDelegate',
      module: options.module || MODULE,
      source: options.source || 'delegate'
    });
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
    setNotifier: (newNotify) => {
      handlerNotify = newNotify;
      handlerNotify?.debug?.('[eventHandler] Notifier updated via setNotifier', { module: MODULE, source: 'setNotifier' });
    },
    setProjectManager: (pm) => { _projectManager = pm; }
  };

  // Function to set up login/register tab switching
  function setupLoginModalTabs() {
    // Defer DOM access until the next animation frame to ensure elements are ready
    domAPI.window.requestAnimationFrame(() => {
      const loginModal = domAPI.getElementById('loginModal');
      if (!loginModal) {
        handlerNotify.warn('Login modal element not found for tab setup (after rAF).', { module: MODULE, source: 'setupLoginModalTabs' });
        return;
      }

      const loginTab = domAPI.querySelector(loginModal, '#modalLoginTab');
      const registerTab = domAPI.querySelector(loginModal, '#modalRegisterTab');
      const loginPanel = domAPI.querySelector(loginModal, '#loginPanel');
      const registerPanel = domAPI.querySelector(loginModal, '#registerPanel');

      if (!loginTab || !registerTab || !loginPanel || !registerPanel) {
        handlerNotify.warn('One or more elements for login/register tabs not found (after rAF).', {
          module: MODULE,
          source: 'setupLoginModalTabs',
          extra: {
            loginTabFound: !!loginTab,
            registerTabFound: !!registerTab,
            loginPanelFound: !!loginPanel,
            registerPanelFound: !!registerPanel,
          }
        });
        return;
      }

      trackListener(loginTab, 'click', () => {
        domAPI.addClass(loginTab, 'tab-active');
        domAPI.setAttribute(loginTab, 'aria-selected', 'true');
        domAPI.removeClass(registerTab, 'tab-active');
        domAPI.setAttribute(registerTab, 'aria-selected', 'false');
        domAPI.setStyle(loginPanel, 'display', 'block');
        domAPI.setStyle(registerPanel, 'display', 'none');
      }, { description: 'Switch to Login Tab', module: MODULE, context: 'authTabs' });

      trackListener(registerTab, 'click', () => {
        handlerNotify.info('Register tab CLICKED!', { module: MODULE, source: 'setupLoginModalTabs_Click', context: 'authTabs' });

        domAPI.addClass(registerTab, 'tab-active');
        handlerNotify.info('Register tab: Added tab-active. Has class now: ' + domAPI.hasClass(registerTab, 'tab-active'), { module: MODULE, source: 'setupLoginModalTabs_Click', context: 'authTabs' });

        domAPI.setAttribute(registerTab, 'aria-selected', 'true');
        handlerNotify.info('Register tab: Set aria-selected to true. Value: ' + domAPI.getAttribute(registerTab, 'aria-selected'), { module: MODULE, source: 'setupLoginModalTabs_Click', context: 'authTabs' });

        domAPI.removeClass(loginTab, 'tab-active');
        handlerNotify.info('Login tab: Removed tab-active. Has class now: ' + domAPI.hasClass(loginTab, 'tab-active'), { module: MODULE, source: 'setupLoginModalTabs_Click', context: 'authTabs' });

        domAPI.setAttribute(loginTab, 'aria-selected', 'false');
        handlerNotify.info('Login tab: Set aria-selected to false. Value: ' + domAPI.getAttribute(loginTab, 'aria-selected'), { module: MODULE, source: 'setupLoginModalTabs_Click', context: 'authTabs' });

        domAPI.removeClass(registerPanel, 'hidden'); // Show register panel
        handlerNotify.info('Register panel: Removed hidden class. Has hidden class now: ' + domAPI.hasClass(registerPanel, 'hidden'), { module: MODULE, source: 'setupLoginModalTabs_Click', context: 'authTabs' });

        domAPI.addClass(loginPanel, 'hidden'); // Hide login panel
        handlerNotify.info('Login panel: Added hidden class. Has hidden class now: ' + domAPI.hasClass(loginPanel, 'hidden'), { module: MODULE, source: 'setupLoginModalTabs_Click', context: 'authTabs' });
      }, { description: 'Switch to Register Tab', module: MODULE, context: 'authTabs' });

      // Also update the loginTab click handler to use hidden class
      trackListener(loginTab, 'click', () => {
        handlerNotify.info('Login tab CLICKED!', { module: MODULE, source: 'setupLoginModalTabs_Click', context: 'authTabs' });

        domAPI.addClass(loginTab, 'tab-active');
        handlerNotify.info('Login tab: Added tab-active. Has class now: ' + domAPI.hasClass(loginTab, 'tab-active'), { module: MODULE, source: 'setupLoginModalTabs_Click', context: 'authTabs' });

        domAPI.setAttribute(loginTab, 'aria-selected', 'true');
        handlerNotify.info('Login tab: Set aria-selected to true. Value: ' + domAPI.getAttribute(loginTab, 'aria-selected'), { module: MODULE, source: 'setupLoginModalTabs_Click', context: 'authTabs' });

        domAPI.removeClass(registerTab, 'tab-active');
        handlerNotify.info('Register tab: Removed tab-active. Has class now: ' + domAPI.hasClass(registerTab, 'tab-active'), { module: MODULE, source: 'setupLoginModalTabs_Click', context: 'authTabs' });

        domAPI.setAttribute(registerTab, 'aria-selected', 'false');
        handlerNotify.info('Register tab: Set aria-selected to false. Value: ' + domAPI.getAttribute(registerTab, 'aria-selected'), { module: MODULE, source: 'setupLoginModalTabs_Click', context: 'authTabs' });

        domAPI.removeClass(loginPanel, 'hidden'); // Show login panel
        handlerNotify.info('Login panel: Removed hidden class. Has hidden class now: ' + domAPI.hasClass(loginPanel, 'hidden'), { module: MODULE, source: 'setupLoginModalTabs_Click', context: 'authTabs' });

        domAPI.addClass(registerPanel, 'hidden'); // Hide register panel
        handlerNotify.info('Register panel: Added hidden class. Has hidden class now: ' + domAPI.hasClass(registerPanel, 'hidden'), { module: MODULE, source: 'setupLoginModalTabs_Click', context: 'authTabs' });
      }, { description: 'Switch to Login Tab', module: MODULE, context: 'authTabs' });

      handlerNotify.info('Login/Register tab switching initialized (after rAF, using hidden class).', { module: MODULE, source: 'setupLoginModalTabs' });
    });
  }
}
