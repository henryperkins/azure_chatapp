/**
 * @module eventHandler
 * @description DI-strict, orchestrated UI event utility collection. Manages tracked event listeners
 * and provides common UI setup helpers like forms, modals, and collapsibles.
 * All notifications use the injected `notify` utility. No direct console or global DOM/Window access.
 *
 * @param {Object} deps - Dependencies injected via DI.
 * @param {Object} deps.app - Core application reference (optional, for app-specific logic like redirects).
 * @param {Object} deps.auth - Auth module reference (optional, for auth-related handlers).
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
  app, auth, projectManager, modalManager, DependencySystem,
  domAPI, browserService, notify,
  navigate, storage
} = {}) {
  // --- Dependency Validation ---
  if (!DependencySystem) throw new Error(`[${MODULE}] DependencySystem is required`);
  if (!domAPI) throw new Error(`[${MODULE}] domAPI is required`);
  if (!browserService) throw new Error(`[${MODULE}] browserService is required`);
  if (!notify) throw new Error(`[${MODULE}] notify utility (handlerNotify) is required`);

  // Resolve optional dependencies dynamically if not passed
  function _resolveDep(name) { return DependencySystem?.modules?.get?.(name); }
  app = app || _resolveDep('app');
  auth = auth || _resolveDep('auth');
  projectManager = projectManager || _resolveDep('projectManager');
  modalManager = modalManager || _resolveDep('modalManager');

  const storageBackend = storage || browserService; // Assuming browserService provides getItem/setItem
  const handlerNotify = notify; // Use the injected notify utility

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
    { // Basic console fallback
      debug: (...args) => console.debug('[EventHandler Notify Fallback]', ...args),
      info: (...args) => console.info('[EventHandler Notify Fallback]', ...args),
      warn: (...args) => console.warn('[EventHandler Notify Fallback]', ...args),
      error: (...args) => console.error('[EventHandler Notify Fallback]', ...args),
      success: (...args) => console.info('[EventHandler Notify Fallback]', ...args)
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
          group: true, context: listenerContext, source: listenerSource, module: MODULE,
          extra: { elementId: element.id || null, eventType: type }
        });
        element.addEventListener(type, wrappedHandler, finalOptions);
      }

      if (!trackedListeners.has(element)) trackedListeners.set(element, new Map());
      const currentElementMap = trackedListeners.get(element);
      if (!currentElementMap.has(type)) currentElementMap.set(type, new Map());
      currentElementMap.get(type).set(handler, {
        wrappedHandler, originalHandler: handler, options: finalOptions, description,
        priority: options.priority || PRIORITY.NORMAL,
        context: listenerContext, module: listenerModule, // Store context and module
        addedAt: new Date().toISOString(),
        elementInfo: { id: element.id || null, tagName: element.tagName || null, className: element.className || null }
      });
      return wrappedHandler;
    } catch (err) {
      localNotify.error('Failed to attach event listener', {
        group: true, context: listenerContext, source: listenerSource, module: MODULE,
        originalError: err,
        extra: { type, description, elementId: element.id || null, errorMessage: err.message, errorStack: err.stack, callerStack: new Error().stack }
      });
      return undefined;
    }
  }

  function cleanupListeners(filter = {}) {
    const { targetElement, targetType, targetDescription, context, module: filterModule } = filter;
    let removeCount = 0;

    trackedListeners.forEach((elementMap, element) => {
      if (targetElement && element !== targetElement) return;
      elementMap.forEach((typeMap, type) => {
        if (targetType && type !== targetType) return;
        typeMap.forEach((details, originalHandler) => {
          const descMatches = !targetDescription || details.description === targetDescription;
          const contextMatches = !context || details.context === context;
          const moduleMatches = !filterModule || details.module === filterModule;

          if (descMatches && contextMatches && moduleMatches) {
            try {
              if (domAPI && typeof domAPI.removeEventListener === 'function') {
                domAPI.removeEventListener(element, type, details.wrappedHandler, details.options);
              } else {
                element.removeEventListener(type, details.wrappedHandler, details.options);
              }
              typeMap.delete(originalHandler);
              removeCount++;
            } catch (error) {
              handlerNotify.warn('Error removing listener', {
                group: true, context: 'eventHandler', module: MODULE, source: 'cleanupListeners',
                originalError: error, extra: { description: details.description, type }
              });
            }
          }
        });
        if (typeMap.size === 0) elementMap.delete(type);
      });
      if (elementMap.size === 0) trackedListeners.delete(element);
    });

    if (removeCount > 0) {
      handlerNotify.info(`Cleaned up ${removeCount} listeners.`, {
        module: MODULE, source: 'cleanupListeners',
        extra: { filter: JSON.stringify(filter) }
      });
    }
  }

  function delegate(container, eventType, selector, handler, options = {}) {
    if (!container) {
      handlerNotify.warn('Delegate called with no container.', { module: MODULE, source: 'delegate', extra: { selector } });
      return;
    }
    const delegatedHandler = function (event) {
      const target = domAPI.closest(event.target, selector); // Assuming domAPI has `closest`
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
    if (initialized) return this; // Return API object for chaining
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

      trackListener(domAPI.getDocument(), 'modalsLoaded', () => {
        handlerNotify.info('Modals loaded, setting up modal tabs.', { module: MODULE, source: 'init' });
        setupModalTabs();
      }, { once: true, description: 'Setup Modal Tabs on modalsLoaded', module: MODULE, context: 'init' });

      const checkProjectModalForm = () => {
        if (domAPI.getElementById('projectModalForm')) {
          setupProjectModalForm();
        } else {
          // This might be normal if modals are loaded asynchronously.
          // Consider if specific logging is needed or if modalsLoaded handles it.
        }
      };

      if (domAPI.getDocument().readyState !== 'loading') {
        checkProjectModalForm();
      } else {
        trackListener(domAPI.getDocument(), 'DOMContentLoaded', checkProjectModalForm, { once: true, module: MODULE, context: 'init' });
      }

      initialized = true;
      handlerNotify.info("EventHandler module initialized successfully.", { module: MODULE, source: 'init' });
    } catch (err) {
      handlerNotify.error('EventHandler initialization failed', {
        group: true, context: 'initialization', module: MODULE, source: 'init', originalError: err
      });
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
    const pm = projectManager || _resolveDep('projectManager');
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

  function setupModalTabs() {
    // Example: Setup tabs within a modal
    const tabContainers = domAPI.querySelectorAll('.modal-tabs'); // Common container for tabs
    tabContainers.forEach(container => {
      const tabs = domAPI.querySelectorAll(container, '.tab-link'); // Query relative to container
      const tabPanels = domAPI.querySelectorAll(container, '.tab-panel');

      tabs.forEach((tab, index) => {
        trackListener(tab, 'click', (e) => {
          domAPI.preventDefault(e);
          tabs.forEach(t => domAPI.removeClass(t, 'active'));
          tabPanels.forEach(p => domAPI.addClass(p, 'hidden'));

          domAPI.addClass(tab, 'active');
          if (tabPanels[index]) domAPI.removeClass(tabPanels[index], 'hidden');
        }, { description: `Modal Tab ${index}`, module: MODULE, context: 'modalTabs' });
      });
      // Activate first tab by default
      if (tabs.length > 0) domAPI.addClass(tabs[0], 'active');
      if (tabPanels.length > 0) domAPI.removeClass(tabPanels[0], 'hidden');
      for (let i = 1; i < tabPanels.length; i++) domAPI.addClass(tabPanels[i], 'hidden');

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
        el.removeEventListener(el, evt, details.wrappedHandler, details.options);
      }
      typeMap.delete(handler);
      if (typeMap.size === 0) elementMap.delete(evt);
      if (elementMap.size === 0) trackedListeners.delete(el);
    } catch (error) {
      handlerNotify.warn('Error in untrackListener', { module: MODULE, source: 'untrackListener', originalError: error });
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
    untrackListener
  };
}
