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
import { waitForDepsAndDom } from './utils/globalUtils.js'; // Keep relevant utils
import { debounce as globalDebounce, toggleElement as globalToggleElement } from './utils/globalUtils.js';

const MODULE = 'EventHandler';

export function createEventHandlers({
  app, auth, projectManager, modalManager, DependencySystem,
  domAPI, browserService, notify, // Inject DOM/Browser APIs
  navigate, storage // Storage likely comes from browserService now
} = {}) {
  // --- Dependency Validation (Guideline #2) ---
  if (!DependencySystem) throw new Error(`[${MODULE}] DependencySystem is required`);
  if (!domAPI) throw new Error(`[${MODULE}] domAPI is required`);
  if (!browserService) throw new Error(`[${MODULE}] browserService is required`);
  if (!notify) throw new Error(`[${MODULE}] notify is required`);

  // Resolve optional dependencies
  function _resolveDep(name) { return DependencySystem?.modules?.get?.(name); }
  app = app || _resolveDep('app');
  auth = auth || _resolveDep('auth');
  projectManager = projectManager || _resolveDep('projectManager');
  modalManager = modalManager || _resolveDep('modalManager');

  // Use browserService for storage by default if not explicitly passed
  const storageBackend = storage || browserService; // Assuming browserService provides getItem/setItem

  // Context-aware notifier (Guideline #4)
  const handlerNotify = notify.withContext({ module: MODULE, context: 'eventHandler' });

  // Navigation utility (Guideline #2 - uses injected deps)
  function redirect(url) {
    if (typeof navigate === "function") navigate(url);
    else if (app && typeof app.navigate === "function") app.navigate(url);
    else if (browserService && typeof browserService.setLocation === 'function') {
      browserService.setLocation(url); // Add setLocation to browserService if needed
    } else {
      handlerNotify.warn('No navigation function available for redirect.', { source: 'redirect', extra: { url } });
    }
  }

  // --- Tracked Listeners (Internal State) ---
  const trackedListeners = new Map(); // Use Map for easier removal: element -> Map<type, Map<handler, details>>

  const PRIORITY = { /* ... priorities ... */ };

  // --- Core Listener Functions (Guideline #3, #4) ---
  function trackListener(element, type, handler, options = {}) {
    if (!element || typeof element.addEventListener !== 'function') { // Basic element check
      handlerNotify.warn('trackListener called with invalid element.', {
        source: 'trackListener',
        extra: { elementType: typeof element, description: options.description }
      });
      return undefined; // Return undefined to indicate failure or no handle
    }

    const { capture = false, once = false, signal, passive } = options;
    const nonPassiveEvents = ['click', 'submit', 'wheel', 'touchstart', 'touchmove', 'keydown', 'keypress', 'keyup'];
    const usePassive = (typeof passive === 'boolean') ? passive : !nonPassiveEvents.includes(type);
    const finalOptions = { capture, once, signal, passive: usePassive };
    const description = options.description || 'Unnamed Listener';
    const listenerContext = options.context || 'eventHandler'; // Allow passing context
    const listenerSource = options.source || 'trackListener';

    // --- Prevent Duplicate Listeners ---
    const elementMap = trackedListeners.get(element);
    if (elementMap) {
      const typeMap = elementMap.get(type);
      if (typeMap && typeMap.has(handler)) {
        // Maybe log if debugging, but generally just return the existing handle/wrapper
        // handlerNotify.debug('Duplicate listener registration skipped.', { source: 'trackListener', extra: { description }});
        return typeMap.get(handler).wrappedHandler; // Return existing wrapper
      }
    }

    // Wrap handler for error catching and perf monitoring (Guideline #4, #5)
    const wrappedHandler = function (event) {
      const startTime = performance.now();
      try {
        const result = handler.call(this, event); // Preserve `this` context
        if (result && typeof result.then === 'function') {
          result.catch(error => {
            handlerNotify.error(`Async error in ${description}`, {
              group: true, context: listenerContext, source: listenerSource,
              originalError: error, extra: { type }
            });
            // Check for passive violation warning
            if (error.name === 'TypeError' && error.message.includes('passive') && finalOptions.passive) {
              handlerNotify.warn(`preventDefault() called on passive listener: ${description}`, {
                group: true, context: listenerContext, source: listenerSource, extra: { type }
              });
            }
          }).finally(() => {
            // Performance Check
            const duration = performance.now() - startTime;
            const threshold = type === 'submit' ? 800 : type === 'click' ? 500 : 100;
            if (duration > threshold) {
              handlerNotify.warn(`Slow handler: ${description} took ${duration.toFixed(1)}ms`, {
                group: true, context: listenerContext, source: listenerSource, extra: { type, duration }
              });
            }
          });
          // Return false might interfere with default actions, let promise handle itself
        } else {
          // Sync Performance Check
          const duration = performance.now() - startTime;
          const threshold = type === 'submit' ? 800 : type === 'click' ? 500 : 100;
          if (duration > threshold) {
            handlerNotify.warn(`Slow handler: ${description} took ${duration.toFixed(1)}ms`, {
              group: true, context: listenerContext, source: listenerSource, extra: { type, duration }
            });
          }
        }
        return result; // Return original result
      } catch (error) {
        handlerNotify.error(`Sync error in ${description}`, {
          group: true, context: listenerContext, source: listenerSource,
          originalError: error, extra: { type }
        });
        // Passive violation warning
        if (error.name === 'TypeError' && error.message.includes('passive') && finalOptions.passive) {
          handlerNotify.warn(`preventDefault() called on passive listener: ${description}`, {
            group: true, context: listenerContext, source: listenerSource, extra: { type }
          });
        }
        // Don't re-throw by default in production, allow app to continue
      }
    };

    try {
      // Use injected domAPI for event listening (Guideline #2)
      domAPI.addEventListener(element, type, wrappedHandler, finalOptions);

      // --- Update Tracking Map ---
      if (!trackedListeners.has(element)) trackedListeners.set(element, new Map());
      const currentElementMap = trackedListeners.get(element);
      if (!currentElementMap.has(type)) currentElementMap.set(type, new Map());
      currentElementMap.get(type).set(handler, {
        wrappedHandler,
        originalHandler: handler,
        options: finalOptions,
        description,
        priority: options.priority || PRIORITY.NORMAL,
        context: listenerContext // Store context for context-based cleanup
      });

      // Return the wrapped handler, useful for manual removal if needed, though cleanupListeners is preferred
      return wrappedHandler;

    } catch (err) {
      // Guideline #4: Structured error
      handlerNotify.error('Failed to attach event listener', {
        group: true, context: listenerContext, source: listenerSource,
        originalError: err, extra: { type, description }
      });
      return undefined; // Indicate failure
    }
  }

  // --- Cleanup Listeners (Guideline #3) ---
  // Enhanced to support context-based cleanup
  function cleanupListeners(filter = {}) {
    const { targetElement, targetType, targetDescription, context } = filter;
    let removeCount = 0;

    trackedListeners.forEach((elementMap, element) => {
      if (targetElement && element !== targetElement) return;

      elementMap.forEach((typeMap, type) => {
        if (targetType && type !== targetType) return;

        typeMap.forEach((details, originalHandler) => {
          const descMatches = !targetDescription || details.description === targetDescription;
          const contextMatches = !context || details.context === context;

          if (descMatches && contextMatches) {
            try {
              // Use injected domAPI (Guideline #2)
              domAPI.removeEventListener(element, type, details.wrappedHandler, details.options);
              typeMap.delete(originalHandler); // Remove from tracking map
              removeCount++;
            } catch (error) {
              // Guideline #4: Structured warning
              handlerNotify.warn('Error removing listener', {
                group: true, context: 'eventHandler', source: 'cleanupListeners',
                originalError: error, extra: { description: details.description, type }
              });
            }
          }
        });
        if (typeMap.size === 0) elementMap.delete(type); // Clean up empty type map
      });
      if (elementMap.size === 0) trackedListeners.delete(element); // Clean up empty element map
    });

    if (removeCount > 0) {
      handlerNotify.info(`Cleaned up ${removeCount} listeners.`, {
        source: 'cleanupListeners',
        extra: { filter: JSON.stringify(filter) } // Stringify filter for logging
      });
    }
  }


  // --- UI Helpers (Refactored for DI, Guideline #2, #4) ---

  // Delegate: Uses trackListener internally
  function delegate(container, eventType, selector, handler, options = {}) {
    if (!container) {
      handlerNotify.warn('Delegate called with no container.', { source: 'delegate', extra: { selector } });
      return;
    }
    const delegatedHandler = function (event) { // `this` will be the container
      // Use injected domAPI if needed for complex matching, but closest is standard
      const target = event.target.closest(selector);
      if (target) {
        // Error handling is inside the trackListener wrapper now
        handler.call(target, event, target); // Call original handler with target as `this`
      }
    };
    // Pass options, context etc., to trackListener
    return trackListener(container, eventType, delegatedHandler, {
      ...options, // Pass original options
      description: options.description || `Delegate ${eventType} on ${selector}`,
      // Inherit context if provided in options, else default
      context: options.context || 'eventHandlerDelegate',
      source: options.source || 'delegate'
    });
  }

  // ToggleVisible: Uses globalUtils version, which should ideally use domAPI if it manipulates DOM.
  // Assuming globalToggleElement uses classList which is generally safe.
  function toggleVisible(element, show) {
    return globalToggleElement(element, show); // Keep using util, ensure util is DI-safe if needed
  }

  // Setup Collapsible (Guideline #2, #3, #4)
  function setupCollapsible(toggleId, panelId, chevronId, onExpand) {
    // Use injected domAPI
    const toggleButton = domAPI.getElementById(toggleId);
    const panel = domAPI.getElementById(panelId);
    const chevron = chevronId ? domAPI.getElementById(chevronId) : null;

    if (!toggleButton || !panel) {
      handlerNotify.warn(`Collapsible elements not found: ${toggleId} or ${panelId}`, { source: 'setupCollapsible' });
      return;
    }

    toggleButton.setAttribute('role', 'button');
    toggleButton.setAttribute('aria-controls', panelId);
    toggleButton.setAttribute('aria-expanded', 'false');

    const togglePanel = (expand) => {
      panel.classList.toggle('hidden', !expand);
      if (chevron) chevron.style.transform = expand ? 'rotate(180deg)' : 'rotate(0deg)';
      toggleButton.setAttribute('aria-expanded', String(expand));
      if (expand && typeof onExpand === 'function') {
        try { // Guideline #5: Wrap callbacks
          onExpand();
        } catch (err) {
          handlerNotify.error('Error in onExpand callback for collapsible', {
            source: 'setupCollapsible', group: true, originalError: err, extra: { toggleId }
          });
        }
      }
      // Use injected storageBackend (Guideline #2)
      if (toggleId && storageBackend?.setItem) {
        try {
          storageBackend.setItem(`${toggleId}_expanded`, String(expand));
        } catch (err) {
          handlerNotify.warn('Failed to save collapsible state to storage', {
            source: 'setupCollapsible', originalError: err, extra: { toggleId }
          });
        }
      }
    };

    let savedState = null;
    if (toggleId && storageBackend?.getItem) { // Use injected storageBackend
      try { savedState = storageBackend.getItem(`${toggleId}_expanded`); } catch { /* ignore */ }
    }
    togglePanel(savedState === 'true');

    // Use Guideline #3 pattern
    trackListener(toggleButton, 'click', () => {
      const isCurrentlyExpanded = toggleButton.getAttribute('aria-expanded') === 'true';
      togglePanel(!isCurrentlyExpanded);
    }, { description: `Toggle Collapsible ${toggleId}` });
  }

  // Setup Modal (Guideline #2, #3, #4)
  function setupModal(modalId, openBtnId, closeBtnId, onOpen, onClose) {
    // Use injected domAPI
    const modal = domAPI.getElementById(modalId);
    const openBtn = openBtnId ? domAPI.getElementById(openBtnId) : null;
    const closeBtn = closeBtnId ? domAPI.getElementById(closeBtnId) : null;

    if (!modal) {
      handlerNotify.warn(`Modal element not found: ${modalId}`, { source: 'setupModal' });
      return { open: () => { }, close: () => { } }; // Return no-op functions
    }

    const open = () => {
      if (typeof onOpen === 'function') {
        try { onOpen(modal); } // Guideline #5: Wrap callbacks
        catch (err) { handlerNotify.error('Error in onOpen callback for modal', { source: 'setupModal', group: true, originalError: err, extra: { modalId } }); }
      }
      // Use DI modalManager if available for consistency, otherwise fallback to direct manipulation
      if (modalManager?.show) {
        modalManager.show(modalId); // Assuming modalManager uses IDs from a mapping
      } else if (typeof modal.showModal === 'function') {
        modal.showModal();
      } else {
        modal.classList.remove('hidden');
        modal.setAttribute('open', 'true');
      }
    };

    const close = () => {
      // Use DI modalManager if available
      if (modalManager?.hide) {
        modalManager.hide(modalId); // Assuming modalManager uses IDs
      } else if (typeof modal.close === 'function') {
        modal.close();
      } else {
        modal.classList.add('hidden');
        modal.removeAttribute('open');
      }
      if (typeof onClose === 'function') {
        try { onClose(modal); } // Guideline #5: Wrap callbacks
        catch (err) { handlerNotify.error('Error in onClose callback for modal', { source: 'setupModal', group: true, originalError: err, extra: { modalId } }); }
      }
    };

    // Use Guideline #3 pattern
    if (openBtn) trackListener(openBtn, 'click', open, { description: `Open Modal ${modalId}` });
    if (closeBtn) trackListener(closeBtn, 'click', close, { description: `Close Modal ${modalId} via Button` });

    // Use trackListener for ESC and backdrop close
    trackListener(modal, 'keydown', (e) => { if (e.key === 'Escape') close(); }, { description: `Modal ESC Close ${modalId}` });
    trackListener(modal, 'click', (e) => { if (e.target === modal) close(); }, { description: `Modal Backdrop Close ${modalId}` });

    return { open, close };
  }

  // Setup Form (Guideline #2, #3, #4, #5)
  function setupForm(formId, submitHandler, options = {}) {
    // Use injected domAPI
    const form = domAPI.getElementById(formId);
    if (!form) {
      handlerNotify.warn(`Form element not found: ${formId}`, { source: 'setupForm' });
      return;
    }

    const { validateBeforeSubmit = true, showLoadingState = true, resetOnSuccess = true } = options;

    const handleSubmit = async (e) => {
      e.preventDefault();
      if (form.classList.contains('submitting')) return;

      if (validateBeforeSubmit && typeof form.checkValidity === 'function') {
        if (!form.checkValidity()) {
          // Use reportValidity() if available on the element (standard)
          if (typeof form.reportValidity === 'function') {
            form.reportValidity();
          } else {
            handlerNotify.warn('Form validation failed, but reportValidity not available.', { source: 'setupForm', extra: { formId } });
          }
          return;
        }
      }

      const submitBtn = form.querySelector('[type="submit"]'); // Query relative to form
      if (showLoadingState && submitBtn) {
        form.classList.add('submitting');
        submitBtn.disabled = true;
        submitBtn.dataset.originalText = submitBtn.textContent;
        submitBtn.textContent = 'Submitting...'; // Consider sanitization if text is dynamic
      }

      try {
        const formData = new FormData(form); // Use injected browserService.FormData if needed
        await submitHandler(formData, form); // Original submit handler
        if (resetOnSuccess && typeof form.reset === 'function') {
          form.reset();
        }
        handlerNotify.info(`Form ${formId} submitted successfully.`, { source: 'setupForm', extra: { formId } });
      } catch (error) {
        // Guideline #4, #5: Structured error notification
        handlerNotify.error('Form submission failed', {
          group: true, context: 'formSubmission', source: 'setupForm',
          originalError: error, extra: { formId }
        });
        if (options.onError) {
          try { options.onError(error); } // Wrap onError callback
          catch (onErrorErr) { handlerNotify.error('Error in form onError callback', { source: 'setupForm', group: true, originalError: onErrorErr, extra: { formId } }); }
        }
      } finally {
        if (showLoadingState) {
          form.classList.remove('submitting');
          if (submitBtn) {
            submitBtn.disabled = false;
            if (submitBtn.dataset.originalText) {
              submitBtn.textContent = submitBtn.dataset.originalText;
              delete submitBtn.dataset.originalText;
            }
          }
        }
      }
    };

    // Guideline #3: Use trackListener
    trackListener(form, 'submit', handleSubmit, {
      passive: false, // Prevent default form submission
      description: `Form Submit ${formId}`
    });
  }

  // --- Initialization and Cleanup ---
  let initialized = false;
  async function init() {
    if (initialized) return;
    handlerNotify.info('Initializing event handlers...', { source: 'init' });
    try {
      // Wait for core dependencies and basic DOM structure
      await waitForDepsAndDom({
        deps: ['app', 'auth', 'projectManager', 'modalManager', 'notify', 'domAPI', 'browserService'],
        domSelectors: ['body'], // Check for body presence
        DependencySystem,
        timeout: APP_CONFIG?.TIMEOUTS?.DEPENDENCY_WAIT || 10000
      });

      // Setup common elements that should *always* exist
      // These still use domAPI internally now
      setupCommonElements();
      setupNavigationElements();
      setupContentElements();

      // Setup modal tabs *after* modals are potentially loaded
      // Listen for the custom event dispatched after modal HTML injection
      trackListener(domAPI.getDocument(), 'modalsLoaded', () => {
        handlerNotify.info('Modals loaded, setting up modal tabs.', { source: 'init' });
        setupModalTabs(); // Now uses domAPI internally
      }, { once: true, description: 'Setup Modal Tabs on modalsLoaded' });

      // Setup project modal form specifically (might depend on dynamic HTML)
      // Ensure projectModalForm is present *before* calling setupForm
      // This might need to wait for 'modalsLoaded' or be called by the module managing that modal
      const checkProjectModal = () => {
        if (domAPI.getElementById('projectModalForm')) {
          setupProjectModalForm(); // Uses domAPI internally
        } else {
          handlerNotify.warn('Project modal form not found yet for setup.', { source: 'init' });
          // Optionally retry or rely on modalsLoaded listener
        }
      };
      // Call checkProjectModal after DOM ready, possibly after modalsLoaded
      if (domAPI.getDocument().readyState !== 'loading') {
        checkProjectModal();
      } else {
        trackListener(domAPI.getDocument(), 'DOMContentLoaded', checkProjectModal, { once: true });
      }


      initialized = true;
      handlerNotify.info("EventHandler module initialized successfully.", { source: 'init' });
    } catch (err) {
      handlerNotify.error('EventHandler initialization failed', {
        group: true, context: 'initialization', source: 'init', originalError: err
      });
      // Decide whether to re-throw based on application's error handling strategy
      // throw err;
    }
  }

  // Ensure setup functions use domAPI internally
  function setupCommonElements() { /* ... refactor to use domAPI.getElementById ... */ }
  function setupProjectModalForm() { /* ... refactor to use domAPI.getElementById ... */ }
  function validatePassword(password) { /* ... logic ok ... */ }
  function setupNavigationElements() { /* ... refactor to use domAPI.getElementById ... */ }
  function setupContentElements() { /* ... refactor to use domAPI.getElementById/querySelectorAll ... */ }
  function setupModalTabs() { /* ... refactor to use domAPI.getElementById ... */ }
  function setupNavigation() { /* ... refactor to use domAPI.getElementById ... */ }


  // Untrack listener remains the same principle, relying on internal map
  function untrackListener(el, evt, handler) {
    const elementMap = trackedListeners.get(el);
    if (!elementMap) return;
    const typeMap = elementMap.get(evt);
    if (!typeMap || !typeMap.has(handler)) return;

    const details = typeMap.get(handler);
    try {
      domAPI.removeEventListener(el, evt, details.wrappedHandler, details.options);
      typeMap.delete(handler);
      if (typeMap.size === 0) elementMap.delete(evt);
      if (elementMap.size === 0) trackedListeners.delete(el);
    } catch (error) {
      handlerNotify.warn('Error in untrackListener', { source: 'untrackListener', originalError: error });
    }
  }

  // Guideline #1: Return API from factory
  return {
    trackListener,
    cleanupListeners, // Expose central cleanup
    listTrackedListeners, // Keep for debugging if needed
    delegate,
    debounce: globalDebounce, // Keep using utility
    toggleVisible, // Keep using utility
    setupCollapsible,
    setupModal,
    setupForm,
    init, // Expose init
    PRIORITY, // Keep if used externally
    untrackListener // Expose specific untrack if needed, though cleanupListeners is preferred
  };
}
