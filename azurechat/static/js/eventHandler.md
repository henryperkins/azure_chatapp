```javascript
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
 * @param {Object} [deps.timeAPI] - Optional timing API (defaults to performance.now).
 * @returns {Object} Event handler API { trackListener, cleanupListeners, delegate, etc. }
 */

import { waitForDepsAndDom } from './utils/globalUtils.js';
import { debounce as globalDebounce, toggleElement as globalToggleElement } from './utils/globalUtils.js';

const MODULE = 'EventHandler';

export function createEventHandlers({
  app,
  projectManager,
  modalManager,
  DependencySystem,
  domAPI,
  browserService,
  notify,
  errorReporter,
  APP_CONFIG,
  navigate,
  storage,

  // Guardrail #2: Provide fallback for performance timing
  timeAPI = { now: () => performance.now() }
} = {}) {
  // -- Dependency Validation (Guardrail #1) --
  if (!DependencySystem) throw new Error(`[${MODULE}] DependencySystem is required`);
  if (!domAPI) throw new Error(`[${MODULE}] domAPI is required`);
  if (!browserService) throw new Error(`[${MODULE}] browserService is required`);
  if (!notify) throw new Error(`[${MODULE}] notify utility is required`);
  if (!APP_CONFIG) throw new Error(`[${MODULE}] APP_CONFIG is required`);
  if (!errorReporter) {
    throw new Error(`[${MODULE}] errorReporter utility is required for guardrail-compliant error logging`);
  }

  // Guardrail #6, #15: Create a module-scoped notifier using withContext
  let handlerNotify = notify.withContext({ module: MODULE, context: 'handler' });

  // Guardrail #17: Capture error respecting user consent
  function captureError(error, meta) {
    // If user opted out of error tracking, skip
    if (app?.state?.disableErrorTracking) {
      return;
    }
    if (errorReporter?.capture) {
      errorReporter.capture(error, meta);
    }
  }

  // We allow dynamic injection/update of projectManager
  let _projectManager = projectManager;

  const debugTools = DependencySystem?.modules?.get?.('debugTools') || null;

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
    } else {
      handlerNotify.warn('No navigation function available for redirect.', {
        module: MODULE,
        source: 'redirect',
        extra: { url }
      });
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
    const localNotify = handlerNotify;

    if (!element) {
      const { description = 'Unnamed Listener', context = 'eventHandler', source = 'trackListener', module: optModule = MODULE } = options;
      localNotify.warn(`trackListener called with null/undefined element for '${description}'.`, {
        source, context, module: optModule, group: true,
        extra: { description, eventType: type, callerStack: new Error().stack }
      });
      return undefined;
    }

    if (typeof element.addEventListener !== 'function') {
      const {
        description = 'Unnamed Listener',
        context = 'eventHandler',
        source = 'trackListener',
        module: optModule = MODULE
      } = options;
      localNotify.warn(`trackListener called with invalid element type for '${description}'.`, {
        source,
        context,
        module: optModule,
        group: true,
        extra: {
          elementType: typeof element,
          elementValue: String(element).substring(0, 100),
          elementId: element?.id || null,
          elementClass: element?.className || null,
          description,
          eventType: type,
          callerStack: new Error().stack
        }
      });
      return undefined;
    }

    // Extract event options
    const { capture = false, once = false, signal, passive } = options;
    const nonPassiveEvents = ['click', 'submit', 'wheel', 'touchstart', 'touchmove', 'keydown', 'keypress', 'keyup'];
    const usePassive = typeof passive === 'boolean' ? passive : !nonPassiveEvents.includes(type);
    const finalOptions = { capture, once, signal, passive: usePassive };

    // Provide fallback description and context
    const description = options.description || 'Unnamed Listener';
    const _ctxValid = typeof options.context === 'string' && options.context.trim().length > 0;
    const listenerContext = _ctxValid ? options.context.trim() : MODULE;
    const listenerSource = options.source || 'trackListener';

    // Check if already tracked
    const elementMap = trackedListeners.get(element);
    if (elementMap) {
      const typeMap = elementMap.get(type);
      if (typeMap && typeMap.has(handler)) {
        return typeMap.get(handler).wrappedHandler;
      }
    }

    // Wrap the handler for error and performance tracking
    const wrappedHandler = function (event) {
      const startTime = timeAPI.now();
      try {
        const result = handler.call(this, event);
        if (result && typeof result.then === 'function') {
          // Async
          result.catch((error) => {
            localNotify.error(`Async error in ${description}`, {
              group: true,
              context: listenerContext,
              source: listenerSource,
              module: listenerContext,
              originalError: error,
              extra: { type }
            });
            captureError(error, { module: listenerContext, source: listenerSource, originalError: error });
            if (error.name === 'TypeError' && error.message.includes('passive') && finalOptions.passive) {
              localNotify.warn(`preventDefault() called on passive listener: ${description}`, {
                group: true,
                context: listenerContext,
                source: listenerSource,
                module: listenerContext,
                extra: { type }
              });
            }
          }).finally(() => {
            const duration = timeAPI.now() - startTime;
            const threshold = (type === 'submit') ? 800 : (type === 'click') ? 500 : 100;
            if (duration > threshold) {
              localNotify.warn(`Slow handler: ${description} took ${duration.toFixed(1)}ms`, {
                group: true,
                context: listenerContext,
                source: listenerSource,
                module: listenerContext,
                extra: { type, duration }
              });
            }
          });
        } else {
          // Sync
          const duration = timeAPI.now() - startTime;
          const threshold = (type === 'submit') ? 800 : (type === 'click') ? 500 : 100;
          if (duration > threshold) {
            localNotify.warn(`Slow handler: ${description} took ${duration.toFixed(1)}ms`, {
              group: true,
              context: listenerContext,
              source: listenerSource,
              module: listenerContext,
              extra: { type, duration }
            });
          }
        }
        return result;
      } catch (error) {
        localNotify.error(`Sync error in ${description}`, {
          group: true,
          context: listenerContext,
          source: listenerSource,
          module: listenerContext,
          originalError: error,
          extra: { type }
        });
        captureError(error, { module: listenerContext, source: listenerSource, originalError: error });
        if (error.name === 'TypeError' && error.message.includes('passive') && finalOptions.passive) {
          localNotify.warn(`preventDefault() called on passive listener: ${description}`, {
            group: true,
            context: listenerContext,
            source: listenerSource,
            module: listenerContext,
            extra: { type }
          });
        }
      }
    };

    // Attach the listener
    try {
      if (domAPI && typeof domAPI.addEventListener === 'function') {
        domAPI.addEventListener(element, type, wrappedHandler, finalOptions);
      } else {
        localNotify.warn(
          `domAPI.addEventListener unavailable in trackListener for '${description}', using direct addEventListener.`,
          {
            group: true,
            context: listenerContext,
            source: listenerSource,
            module: MODULE
          }
        );
        element.addEventListener(type, wrappedHandler, finalOptions);
      }
    } catch (err) {
      localNotify.error('Error registering event listener', {
        group: true,
        context: listenerContext,
        source: listenerSource,
        module: MODULE,
        originalError: err,
        extra: { type, description }
      });
      return undefined;
    }

    // Bookkeeping for cleanup
    let typeMap = elementMap || new Map();
    if (!elementMap) {
      trackedListeners.set(element, typeMap);
    }
    let handlerMap = typeMap.get(type);
    if (!handlerMap) {
      handlerMap = new Map();
      typeMap.set(type, handlerMap);
    }
    handlerMap.set(handler, { wrappedHandler, options: finalOptions, context: listenerContext });

    return wrappedHandler;
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
      handlerNotify.warn(`Collapsible elements not found: ${toggleId} or ${panelId}`, {
        module: MODULE,
        source: 'setupCollapsible'
      });
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
        try {
          onExpand();
        } catch (err) {
          handlerNotify.error('Error in onExpand callback for collapsible', {
            module: MODULE,
            source: 'setupCollapsible',
            group: true,
            originalError: err,
            extra: { toggleId }
          });
          captureError(err, {
            module: MODULE,
            source: 'setupCollapsible',
            originalError: err
          });
        }
      }

      if (toggleId && storageBackend?.setItem) {
        try {
          storageBackend.setItem(`${toggleId}_expanded`, String(expand));
        } catch (err) {
          handlerNotify.warn('Failed to save collapsible state', {
            module: MODULE,
            source: 'setupCollapsible',
            originalError: err,
            extra: { toggleId }
          });
          captureError(err, {
            module: MODULE,
            source: 'setupCollapsible',
            originalError: err
          });
        }
      }
    };

    let savedState = null;
    if (toggleId && storageBackend?.getItem) {
      try {
        savedState = storageBackend.getItem(`${toggleId}_expanded`);
      } catch (err) {
        captureError(err, {
          module: MODULE,
          source: 'setupCollapsible',
          originalError: err
        });
      }
    }
    togglePanel(savedState === 'true');

    trackListener(
      toggleButton,
      'click',
      () => {
        const isCurrentlyExpanded = domAPI.getAttribute(toggleButton, 'aria-expanded') === 'true';
        togglePanel(!isCurrentlyExpanded);
      },
      { description: `Toggle Collapsible ${toggleId}`, module: MODULE, context: 'collapsible' }
    );
  }

  function setupModal(modalId, openBtnId, closeBtnId, onOpen, onClose) {
    const modal = domAPI.getElementById(modalId);
    const openBtn = openBtnId ? domAPI.getElementById(openBtnId) : null;
    const closeBtn = closeBtnId ? domAPI.getElementById(closeBtnId) : null;

    if (!modal) {
      handlerNotify.warn(`Modal element not found: ${modalId}`, {
        module: MODULE,
        source: 'setupModal'
      });
      return { open: () => {}, close: () => {} };
    }

    const open = () => {
      if (typeof onOpen === 'function') {
        try {
          onOpen(modal);
        } catch (err) {
          handlerNotify.error('Error in onOpen callback for modal', {
            module: MODULE,
            source: 'setupModal',
            group: true,
            originalError: err,
            extra: { modalId }
          });
          captureError(err, {
            module: MODULE,
            source: 'setupModal',
            originalError: err
          });
        }
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
        try {
          onClose(modal);
        } catch (err) {
          handlerNotify.error('Error in onClose callback for modal', {
            module: MODULE,
            source: 'setupModal',
            group: true,
            originalError: err,
            extra: { modalId }
          });
          captureError(err, {
            module: MODULE,
            source: 'setupModal',
            originalError: err
          });
        }
      }
    };

    if (openBtn) {
      trackListener(openBtn, 'click', open, {
        description: `Open Modal ${modalId}`,
        module: MODULE,
        context: 'modal'
      });
    }
    if (closeBtn) {
      trackListener(closeBtn, 'click', close, {
        description: `Close Modal ${modalId} via Button`,
        module: MODULE,
        context: 'modal'
      });
    }

    trackListener(
      modal,
      'keydown',
      (e) => {
        if (e.key === 'Escape') close();
      },
      { description: `Modal ESC Close ${modalId}`, module: MODULE, context: 'modal' }
    );

    trackListener(
      modal,
      'click',
      (e) => {
        if (domAPI.isSameNode(e.target, modal)) close();
      },
      { description: `Modal Backdrop Close ${modalId}`, module: MODULE, context: 'modal' }
    );

    return { open, close };
  }

  function setupForm(formId, submitHandler, options = {}) {
    const form = domAPI.getElementById(formId);
    if (!form) {
      handlerNotify.warn(`Form element not found: ${formId}`, {
        module: MODULE,
        source: 'setupForm'
      });
      return;
    }

    const { validateBeforeSubmit = true, showLoadingState = true, resetOnSuccess = true } = options;

    const handleSubmit = async (e) => {
      domAPI.preventDefault(e); // Use domAPI to avoid direct event calls
      if (domAPI.hasClass(form, 'submitting')) return;

      if (validateBeforeSubmit && typeof form.checkValidity === 'function') {
        if (!form.checkValidity()) {
          if (typeof form.reportValidity === 'function') {
            form.reportValidity();
          } else {
            handlerNotify.warn('Form validation failed, reportValidity not available.', {
              module: MODULE,
              source: 'setupForm',
              extra: { formId }
            });
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
        const formData = new FormData(form);
        await submitHandler(formData, form);
        if (resetOnSuccess && typeof form.reset === 'function') {
          form.reset();
        }
        handlerNotify.info(`Form ${formId} submitted successfully.`, {
          module: MODULE,
          source: 'setupForm',
          extra: { formId }
        });
      } catch (error) {
        handlerNotify.error('Form submission failed', {
          group: true,
          context: 'formSubmission',
          module: MODULE,
          source: 'setupForm',
          originalError: error,
          extra: { formId }
        });
        captureError(error, { module: MODULE, source: 'setupForm', originalError: error });
        if (options.onError) {
          try {
            options.onError(error);
          } catch (onErrorErr) {
            handlerNotify.error('Error in form onError callback', {
              module: MODULE,
              source: 'setupForm',
              group: true,
              originalError: onErrorErr,
              extra: { formId }
            });
            captureError(onErrorErr, {
              module: MODULE,
              source: 'setupForm',
              originalError: onErrorErr
            });
          }
        }
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
      context: 'form'
    });
  }

  let initialized = false;
  async function init() {
    if (initialized) {
      handlerNotify.info('EventHandler already initialized.', { module: MODULE, source: 'init' });
      return this; // Return API object early
    }
    const _t = debugTools?.start?.('EventHandler.init');
    handlerNotify.info('Initializing event handlers...', { module: MODULE, source: 'init' });

    // Guardrail #10: wait for required modules
    await DependencySystem.waitFor?.([
      'app',
      'auth',
      'projectManager',
      'modalManager',
      'notify',
      'domAPI',
      'browserService'
    ]);

    try {
      const dependencyWaitTimeout = APP_CONFIG?.TIMEOUTS?.DEPENDENCY_WAIT ?? 10000;
      await waitForDepsAndDom({
        deps: [
          'app',
          'auth',
          'projectManager',
          'modalManager',
          'notify',
          'domAPI',
          'browserService'
        ],
        domSelectors: ['body'],
        DependencySystem,
        domAPI,
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
        trackListener(
          domAPI.getDocument(),
          'DOMContentLoaded',
          checkProjectModalForm,
          { once: true, module: MODULE, context: 'init' }
        );
      }

      // LOGIN BUTTON / MODAL HANDLING
      function bindAuthButtonDelegate() {
        if (authButtonDelegationBound) return;
        let parentNode = domAPI.getElementById('header') || domAPI.getDocument();
        const currentModalManager = modalManager || DependencySystem.modules.get('modalManager');
        if (!currentModalManager || typeof currentModalManager.show !== 'function') {
          handlerNotify.error('[EventHandler] modalManager is missing or invalid in bindAuthButtonDelegate', {
            module: MODULE,
            source: 'bindAuthButtonDelegate'
          });
          captureError(
            new Error('modalManager is missing or .show is not a function'),
            { module: MODULE, source: 'bindAuthButtonDelegate' }
          );
          return;
        }
        delegate(
          parentNode,
          'click',
          '#authButton',
          (e) => {
            domAPI.preventDefault(e);
            handlerNotify.info(
              'Login button DELEGATED click, attempting modalManager.show("login")',
              { source: 'DelegatedLoginButtonHandler', context: 'auth', module: MODULE }
            );
            try {
              const result = currentModalManager.show('login');
              handlerNotify.info(
                'modalManager.show("login") executed (delegated), result: ' + JSON.stringify(result),
                { source: 'DelegatedLoginButtonHandler', context: 'auth', module: MODULE }
              );
            } catch (error) {
              handlerNotify.error('modalManager.show("login") failed (delegated)', {
                source: 'DelegatedLoginButtonHandler',
                context: 'auth',
                module: MODULE,
                originalError: error
              });
              captureError(error, {
                module: MODULE,
                source: 'DelegatedLoginButtonHandler',
                originalError: error
              });
            }
          },
          { description: 'Delegated Login Modal Show', context: 'auth', module: MODULE }
        );
        handlerNotify.debug('Delegated click listener bound for #authButton', {
          module: MODULE,
          source: 'bindAuthButtonDelegate'
        });
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
          module: MODULE
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
          if (event?.detail?.success) {
            handlerNotify.info(
              'Rebound login button delegation and set up login tabs after successful modalsLoaded',
              { module: MODULE, context: 'auth', source: 'modalsLoaded' }
            );
          } else {
            handlerNotify.warn(
              'Modals failed to load or event detail missing. Attempted to rebind & tab setup anyway.',
              {
                module: MODULE,
                context: 'auth',
                source: 'modalsLoaded',
                eventDetail: event?.detail || 'N/A'
              }
            );
          }
        },
        {
          once: true,
          description: 'Rebind login and setup tabs after modalsLoaded',
          context: 'auth',
          module: MODULE
        }
      );

      initialized = true;
      debugTools?.stop?.(_t, 'EventHandler.init');
      handlerNotify.info('EventHandler module initialized successfully.', {
        module: MODULE,
        source: 'init'
      });
    } catch (err) {
      handlerNotify.error('EventHandler initialization failed', {
        group: true,
        context: 'initialization',
        module: MODULE,
        source: 'init',
        originalError: err
      });
      captureError(err, { module: MODULE, source: 'init', originalError: err });
      debugTools?.stop?.(_t, 'EventHandler.init-error');
      throw err;
    }
    return this;
  }

  function setupCommonElements() {
    const darkModeToggle = domAPI.getElementById('darkModeToggle');
    if (darkModeToggle) {
      trackListener(
        darkModeToggle,
        'click',
        () => {
          domAPI.toggleClass(domAPI.getDocument().documentElement, 'dark');
          const isDark = domAPI.hasClass(domAPI.getDocument().documentElement, 'dark');
          storageBackend.setItem('darkMode', isDark ? 'true' : 'false');
          handlerNotify.info(`Dark mode ${isDark ? 'enabled' : 'disabled'}`, {
            module: MODULE,
            context: 'ui'
          });
        },
        { description: 'Dark Mode Toggle', module: MODULE, context: 'ui' }
      );
      // Initial dark mode state
      if (storageBackend.getItem('darkMode') === 'true') {
        domAPI.addClass(domAPI.getDocument().documentElement, 'dark');
      }
    }
  }

  function setupProjectModalForm() {
    const pm = _projectManager || DependencySystem.modules.get('projectManager');
    if (!pm) {
      handlerNotify.warn('ProjectManager not available for projectModalForm setup.', {
        module: MODULE,
        source: 'setupProjectModalForm'
      });
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
        onError: (err) =>
          handlerNotify.error('Project save failed.', {
            module: MODULE,
            context: 'projectModal',
            originalError: err
          })
      }
    );
  }

  function setupNavigationElements() {
    const navLinks = domAPI.querySelectorAll('.nav-link');
    navLinks.forEach((link) => {
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
          context: 'navigation'
        }
      );
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
      if (domAPI && typeof domAPI.removeEventListener === 'function') {
        domAPI.removeEventListener(el, evt, details.wrappedHandler, details.options);
      } else {
        el.removeEventListener(evt, details.wrappedHandler, details.options);
      }
      typeMap.delete(handler);
      if (typeMap.size === 0) elementMap.delete(evt);
      if (elementMap.size === 0) trackedListeners.delete(el);
    } catch (error) {
      handlerNotify.warn('Error in untrackListener', {
        module: MODULE,
        source: 'untrackListener',
        originalError: error
      });
      captureError(error, { module: MODULE, source: 'untrackListener', originalError: error });
    }
  }

  function cleanupListeners(options = {}) {
    const cleanupContext = options.context;

    if (cleanupContext && typeof cleanupContext === 'string') {
      handlerNotify.debug(`Cleaning up listeners for context: "${cleanupContext}"`, {
        module: MODULE,
        source: 'cleanupListeners'
      });
    } else {
      handlerNotify.warn(
        'cleanupListeners called without a specific string context. This will remove ALL tracked listeners, which might be risky.',
        { module: MODULE, source: 'cleanupListeners', extra: { providedOptions: options } }
      );
    }

    const entriesToRemove = [];

    trackedListeners.forEach((elementMap, element) => {
      elementMap.forEach((typeMap, type) => {
        typeMap.forEach((details, originalHandler) => {
          if (!cleanupContext || details.context === cleanupContext) {
            try {
              if (domAPI && typeof domAPI.removeEventListener === 'function') {
                domAPI.removeEventListener(element, type, details.wrappedHandler, details.options);
              } else {
                element.removeEventListener(type, details.wrappedHandler, details.options);
              }
              entriesToRemove.push({ element, type, originalHandler });
            } catch (error) {
              handlerNotify.warn('Error removing listener during cleanup', {
                module: MODULE,
                source: 'cleanupListeners',
                originalError: error,
                extra: {
                  context: details.context,
                  description: details.options?.description,
                  elementId: element.id
                }
              });
              captureError(error, {
                module: MODULE,
                source: 'cleanupListeners',
                originalError: error
              });
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

    if (!cleanupContext && trackedListeners.size > 0) {
      handlerNotify.warn(
        `trackedListeners map not empty after global cleanup. Possibly listeners were added during cleanup. Size: ${trackedListeners.size}.`,
        { module: MODULE, source: 'cleanupListeners' }
      );
    }

    handlerNotify.debug(`Cleanup finished. Remaining tracked elements: ${trackedListeners.size}. Context: ${cleanupContext || 'GLOBAL'}.`, {
      module: MODULE,
      source: 'cleanupListeners'
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
      context: options.context || 'eventHandlerDelegate',
      module: options.module || MODULE,
      source: options.source || 'delegate'
    });
  }

  function setupLoginModalTabs() {
    const loginModal = domAPI.getElementById('loginModal');
    if (!loginModal) {
      handlerNotify.error('Login modal element #loginModal not found for tab setup. Tabs will not work.', {
        module: MODULE,
        source: 'setupLoginModalTabs',
        group: true
      });
      captureError(new Error('#loginModal not found for tab setup'), {
        module: MODULE,
        source: 'setupLoginModalTabs'
      });
      return;
    }

    try {
      // Preliminary checks (optional)
      let initialLoginPanel = null;
      let initialRegisterPanel = null;
      try {
        initialLoginPanel = domAPI.querySelector(loginModal, '#loginPanel');
      } catch (err) {
        handlerNotify.warn('Failed to query login panel element', {
          module: MODULE,
          source: 'setupLoginModalTabs',
          originalError: err
        });
      }
      try {
        initialRegisterPanel = domAPI.querySelector(loginModal, '#registerPanel');
      } catch (err) {
        handlerNotify.warn('Failed to query register panel element', {
          module: MODULE,
          source: 'setupLoginModalTabs',
          originalError: err
        });
      }
      if (!initialLoginPanel || !initialRegisterPanel) {
        handlerNotify.warn('Login/Register panel(s) missing during initial setup. Tab switching might fail if absent on click.', {
          module: MODULE,
          source: 'setupLoginModalTabs',
          extra: {
            loginPanelFound: !!initialLoginPanel,
            registerPanelFound: !!initialRegisterPanel
          }
        });
      }
    } catch (err) {
      handlerNotify.error('Error during login modal panels check', {
        module: MODULE,
        source: 'setupLoginModalTabs',
        error: err
      });
      captureError(err, {
        module: MODULE,
        source: 'setupLoginModalTabs',
        detail: 'Error during panel existence check'
      });
    }

    try {
      // Delegated listener for Login Tab
      delegate(
        loginModal,
        'click',
        '#modalLoginTab',
        (event, tabElement) => {
          handlerNotify.info('Login tab CLICKED (delegated)!', {
            module: MODULE,
            source: 'setupLoginModalTabs_DelegatedClick',
            context: 'authTabs'
          });
          try {
            const registerTabElement = loginModal.querySelector('#modalRegisterTab');
            const loginPanel = loginModal.querySelector('#loginPanel');
            const registerPanel = loginModal.querySelector('#registerPanel');

            if (!registerTabElement || !loginPanel || !registerPanel) {
              handlerNotify.error('Required elements for Login tab action missing at click time.', {
                module: MODULE,
                source: 'setupLoginModalTabs_DelegatedClick',
                context: 'authTabs'
              });
              captureError(new Error('Elements missing for Login tab click'), {
                module: MODULE,
                source: 'setupLoginModalTabs_DelegatedClick',
                context: 'authTabs'
              });
              return;
            }

            domAPI.addClass(tabElement, 'tab-active');
            domAPI.setAttribute(tabElement, 'aria-selected', 'true');
            domAPI.removeClass(registerTabElement, 'tab-active');
            domAPI.setAttribute(registerTabElement, 'aria-selected', 'false');
            domAPI.removeClass(loginPanel, 'hidden');
            domAPI.addClass(registerPanel, 'hidden');
          } catch (err) {
            handlerNotify.error('Error in login tab click handler', {
              module: MODULE,
              source: 'setupLoginModalTabs_DelegatedClick',
              context: 'authTabs',
              error: err
            });
            captureError(err, {
              module: MODULE,
              source: 'setupLoginModalTabs_DelegatedClick',
              context: 'authTabs'
            });
          }
        },
        { description: 'Switch to Login Tab (Delegated)', module: MODULE, context: 'authTabs' }
      );

      // Delegated listener for Register Tab
      delegate(
        loginModal,
        'click',
        '#modalRegisterTab',
        (event, tabElement) => {
          handlerNotify.info('Register tab CLICKED (delegated)!', {
            module: MODULE,
            source: 'setupLoginModalTabs_DelegatedClick',
            context: 'authTabs'
          });
          try {
            const loginTabElement = loginModal.querySelector('#modalLoginTab');
            const loginPanel = loginModal.querySelector('#loginPanel');
            const registerPanel = loginModal.querySelector('#registerPanel');

            if (!loginTabElement || !loginPanel || !registerPanel) {
              handlerNotify.error('Required elements for Register tab action missing at click time.', {
                module: MODULE,
                source: 'setupLoginModalTabs_DelegatedClick',
                context: 'authTabs'
              });
              captureError(new Error('Elements missing for Register tab click'), {
                module: MODULE,
                source: 'setupLoginModalTabs_DelegatedClick',
                context: 'authTabs'
              });
              return;
            }

            // Defensive: Only act if element is truthy and has classList/setAttribute
            if (tabElement && tabElement.classList) {
              domAPI.addClass(tabElement, 'tab-active');
              domAPI.setAttribute(tabElement, 'aria-selected', 'true');
            } else {
              handlerNotify.error('Register tabElement missing or invalid in register tab handler', { module: MODULE, context: 'authTabs' });
              return;
            }
            if (loginTabElement && loginTabElement.classList) {
              domAPI.removeClass(loginTabElement, 'tab-active');
              domAPI.setAttribute(loginTabElement, 'aria-selected', 'false');
            } else {
              handlerNotify.error('Register handler: loginTabElement missing or invalid', { module: MODULE, context: 'authTabs' });
              return;
            }
            if (registerPanel && registerPanel.classList) {
              domAPI.removeClass(registerPanel, 'hidden');
            } else {
              handlerNotify.error('Register handler: registerPanel missing or invalid', { module: MODULE, context: 'authTabs' });
              return;
            }
            if (loginPanel && loginPanel.classList) {
              domAPI.addClass(loginPanel, 'hidden');
            } else {
              handlerNotify.error('Register handler: loginPanel missing or invalid', { module: MODULE, context: 'authTabs' });
              return;
            }
          } catch (err) {
            // Attempt to print the error object as a string, including stack if available
            let extraErrorText = '';
            if (err && (typeof err === 'object' || typeof err === 'function')) {
              extraErrorText = err.stack
                ? `\nStack: ${err.stack}`
                : `\nError string: ${err.toString()}`;
            } else {
              extraErrorText = `\nRaw error: ${String(err)}`;
            }
            handlerNotify.error(`Error in register tab click handler: ${extraErrorText}`, {
              module: MODULE,
              source: 'setupLoginModalTabs_DelegatedClick',
              context: 'authTabs',
              error: err
            });
            captureError(err, {
              module: MODULE,
              source: 'setupLoginModalTabs_DelegatedClick',
              context: 'authTabs'
            });
          }
        },
        { description: 'Switch to Register Tab (Delegated)', module: MODULE, context: 'authTabs' }
      );

      handlerNotify.info('Login/Register tab switching initialized using event delegation.', {
        module: MODULE,
        source: 'setupLoginModalTabs'
      });
    } catch (err) {
      handlerNotify.error('Fatal error during login modal tab setup', {
        module: MODULE,
        source: 'setupLoginModalTabs',
        error: err
      });
      captureError(err, {
        module: MODULE,
        source: 'setupLoginModalTabs',
        detail: 'Fatal error during tab setup'
      });
    }
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
      handlerNotify = newNotify.withContext
        ? newNotify.withContext({ module: MODULE, context: 'handler' })
        : newNotify;
      handlerNotify?.debug?.('[eventHandler] Notifier updated via setNotifier', {
        module: MODULE,
        source: 'setNotifier'
      });
    },
    setProjectManager: (pm) => {
      _projectManager = pm;
    }
  };
}

```