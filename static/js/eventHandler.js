/**
 * eventHandler.js — DI-strict, orchestrated UI event utility collection.
 *
 * All UI/system/user notifications **must** use DI notification system, never direct console:
 *   1. Prefer `app.showNotification` (if available)
 *   2. Else prefer DI `notify` util (if available)
 *   3. Only then fallback to console.* (dev only, with strict comment)
 *
 * For project architecture: see notification-system.md, custominstructions.md.
 *
 * ## Dependencies (from DependencySystem or DI-injected)
 * - app: Core app module (API, notifications)
 * - auth: Auth module
 * - projectManager: Project management
 * - modalManager: Modal UI/logic handler
 * - DependencySystem: DI registry (optional if DI provided)
 *
 * Exports:
 * - createEventHandlers: factory (see usage below)
 *
 * Usage (in app.js orchestrator):
 *   import { createEventHandlers } from './eventHandler.js';
 *   const eventHandlers = createEventHandlers({ app, auth, ... });
 *   DependencySystem.register('eventHandlers', eventHandlers);
 *   eventHandlers.init();
 */

/**
 * Factory function for event handler registration and utilities.
 * @param {Object} deps
 *   @param {Object} deps.app - App dependency (required for showNotification)
 *   @param {Object} deps.auth - Auth module (for logout, etc)
 *   @param {Object} deps.projectManager - Project management
 *   @param {Object} deps.modalManager - Modal handler
 *   @param {Object} deps.DependencySystem - Preferred for DI dependency registry
 */
import { waitForDepsAndDom } from './utils/globalUtils.js';
import { debounce as globalDebounce, toggleElement as globalToggleElement } from './utils/globalUtils.js';

export function createEventHandlers({ app, auth, projectManager, modalManager, DependencySystem, navigate, storage } = {}) {
  // Helper for optional DI from DependencySystem if not provided at construction time
  DependencySystem = DependencySystem || (typeof window !== 'undefined' && window.DependencySystem);
  function resolveDep(name) {
    if (DependencySystem?.modules?.get) return DependencySystem.modules.get(name);
    if (DependencySystem?.get) return DependencySystem.get(name);
    return undefined;
  }
  app = app || resolveDep('app');
  auth = auth || resolveDep('auth');
  projectManager = projectManager || resolveDep('projectManager');
  modalManager = modalManager || resolveDep('modalManager');

  // Storage utility: DI or fallback to window.localStorage
  const storageBackend = storage ||
    (typeof window !== "undefined" && window.localStorage) ||
    (typeof globalThis !== "undefined" && globalThis.localStorage) ||
    null;

  // Navigation utility for redirecting (modular, avoid window global)
  function redirect(url) {
    if (typeof navigate === "function") {
      navigate(url);
    } else if (app && typeof app.navigate === "function") {
      app.navigate(url);
    } else {
      // Fallback (legacy, not ideal for testability, but avoids window global assignment)
      if (typeof window !== "undefined" && window.location) {
        window.location.href = url;
      } else if (typeof document !== "undefined" && document.location) {
        document.location.href = url;
      }
    }
  }

  // --- Tracked Listeners ---
  const trackedListeners = new Set();

  const PRIORITY = {
    CRITICAL: 1,
    HIGH: 3,
    NORMAL: 5,
    LOW: 7,
    BACKGROUND: 9
  };

  function trackListener(element, type, handler, options = {}) {
    if (!element) return;
    const {
      capture = false, once = false, signal = undefined, passive
    } = options;
    const nonPassiveEvents = ['click', 'submit', 'wheel', 'touchstart', 'touchmove', 'keydown', 'keypress', 'keyup'];
    const usePassive = (typeof passive === 'boolean') ? passive : !nonPassiveEvents.includes(type);
    const finalOptions = { capture, once, signal, passive: usePassive };
    const description = options.description || '';

    for (const l of trackedListeners) {
      if (
        l.element === element &&
        l.type === type &&
        l.originalHandler === handler &&
        JSON.stringify(l.options) === JSON.stringify(finalOptions) &&
        l.description === description
      ) {
        return l.handler;
      }
    }

    const wrappedHandler = function (event) {
      const startTime = performance.now();
      try {
        const result = handler.call(this, event);

        // Handle asynchronous responses (Promise returns)
        if (result && typeof result.then === 'function') {
          // Don't return the promise directly, wrap in a proper error handler
          // to prevent "message channel closed" errors
          result.catch(error => {
            if (app && typeof app.showNotification === "function") {
              app.showNotification(`Async error in ${type} event handler: ${error && error.message ? error.message : error}`, "error");
            } else if (typeof console !== "undefined") {
              // Last-resort fallback for dev debugging only
              console.error(`[EventHandler] (fallback) Async error in ${type} event handler:`, error);
            }
            if (error.name === 'TypeError' && error.message.includes('passive') && finalOptions.passive) {
              if (app && typeof app.showNotification === "function") {
                app.showNotification(`preventDefault() called on a passive ${type} listener`, "warning");
              } else if (typeof console !== "undefined") {
                // Last-resort fallback for dev debugging only
                console.warn(`[EventHandler] (fallback) preventDefault() called on a passive ${type} listener`);
              }
            }
          }).finally(() => {
            const duration = performance.now() - startTime;
            const threshold = type === 'submit' ? 800 : type === 'click' ? 500 : 100;
            if (duration > threshold) {
              if (app && typeof app.showNotification === "function") {
                app.showNotification(`Slow event handler for ${type} took ${duration.toFixed(2)}ms`, "warning");
              } else if (typeof console !== "undefined") {
                // Last-resort fallback for dev debugging only
                console.warn(`[EventHandler] (fallback) Slow event handler for ${type} took ${duration.toFixed(2)}ms`);
              }
            }
          });

          // Return false to indicate the event is being handled synchronously
          // even though we're processing the promise asynchronously
          return false;
        }

        // Handle synchronous responses
        const duration = performance.now() - startTime;
        const threshold = type === 'submit' ? 800 : type === 'click' ? 500 : 100;
        if (duration > threshold) {
          if (app && typeof app.showNotification === "function") {
            app.showNotification(`Slow event handler for ${type} took ${duration.toFixed(2)}ms`, "warning");
            } else if (typeof console !== "undefined") {
              // Last-resort fallback for dev debugging only
              console.warn(`[EventHandler] (fallback) Slow event handler for ${type} took ${duration.toFixed(2)}ms`);
          }
        }

        return result;
      } catch (error) {
        if (app && typeof app.showNotification === "function") {
          app.showNotification(`Error in ${type} event handler: ${error && error.message ? error.message : error}`, "error");
        } else if (typeof console !== "undefined") {
          // Last-resort fallback for dev debugging only
          console.error(`[EventHandler] (fallback) Error in ${type} event handler:`, error);
        }
        if (error.name === 'TypeError' && error.message.includes('passive') && finalOptions.passive) {
          if (app && typeof app.showNotification === "function") {
            app.showNotification(`preventDefault() called on a passive ${type} listener`, "warning");
          } else if (typeof console !== "undefined") {
            // Last-resort fallback for dev debugging only
            console.warn(`[EventHandler] (fallback) preventDefault() called on a passive ${type} listener`);
          }
        }
      }
    };

    element.addEventListener(type, wrappedHandler, finalOptions);

    trackedListeners.add({
      element,
      type,
      handler: wrappedHandler,
      options: finalOptions,
      originalHandler: handler,
      description,
      priority: options.priority || PRIORITY.NORMAL
    });

    return wrappedHandler;
  }

  function listTrackedListeners(filter = {}) {
    const arr = [];
    trackedListeners.forEach(l => {
      if (
        (!filter.element || l.element === filter.element) &&
        (!filter.type || l.type === filter.type) &&
        (!filter.description || l.description === filter.description) &&
        (!filter.priority || l.priority === filter.priority)
      ) {
        arr.push({
          element: l.element,
          type: l.type,
          description: l.description,
          priority: l.priority,
          handler: l.handler,
          originalHandler: l.originalHandler,
          options: l.options
        });
      }
    });
    return arr;
  }

  function cleanupListeners(targetElement, targetType, targetDescription) {
    const listenersToRemove = new Set();
    trackedListeners.forEach(listener => {
      const elementMatches = !targetElement || listener.element === targetElement;
      const typeMatches = !targetType || listener.type === targetType;
      const descMatches = !targetDescription || listener.description === targetDescription;
      if (elementMatches && typeMatches && descMatches) {
        listenersToRemove.add(listener);
      }
    });
    listenersToRemove.forEach(listener => {
      try {
        listener.element.removeEventListener(
          listener.type,
          listener.handler,
          listener.options
        );
        trackedListeners.delete(listener);
      } catch (error) {
        if (app && typeof app.showNotification === "function") {
          app.showNotification(`Error removing ${listener.type} listener: ${error && error.message ? error.message : error}`, "warning");
        } else if (typeof console !== "undefined") {
          // Last-resort fallback for dev debugging only
          console.warn(`[EventHandler] (fallback) Error removing ${listener.type} listener:`, error);
        }
      }
    });
  }

  // No-op: use globalUtils version below

  function delegate(container, eventType, selector, handler, options = {}) {
    if (!container) return;
    const delegatedHandler = function (event) {
      const target = event.target.closest(selector);
      if (target) {
        try {
          handler.call(target, event, target);
        } catch (error) {
          if (app && typeof app.showNotification === "function") {
            app.showNotification(`Error in delegated ${eventType} handler for ${selector}: ${error && error.message ? error.message : error}`, "error");
          } else if (typeof console !== "undefined") {
            // Last-resort fallback for dev debugging only
            console.error(`[EventHandler] (fallback) Error in delegated ${eventType} handler for ${selector}:`, error);
          }
        }
      }
    };
    return trackListener(container, eventType, delegatedHandler, options);
  }

  // Forward to globalUtils.toggleElement for deduplication
  function toggleVisible(element, show) {
    // Toggle compatibility: in eventHandler, the API allows selector string or element
    // Pass through to globalUtils.toggleElement
    return globalToggleElement(element, show);
  }

  function setupCollapsible(toggleId, panelId, chevronId, onExpand) {
    const toggleButton = document.getElementById(toggleId);
    const panel = document.getElementById(panelId);
    const chevron = chevronId ? document.getElementById(chevronId) : null;

    if (!toggleButton || !panel) return;

    toggleButton.setAttribute('role', 'button');
    toggleButton.setAttribute('aria-controls', panelId);
    toggleButton.setAttribute('aria-expanded', 'false');

    const togglePanel = (expand) => {
      panel.classList.toggle('hidden', !expand);
      if (chevron) {
        chevron.style.transform = expand ? 'rotate(180deg)' : 'rotate(0deg)';
      }
      toggleButton.setAttribute('aria-expanded', expand ? 'true' : 'false');
      if (expand && typeof onExpand === 'function') {
        onExpand();
      }
      if (toggleId && storageBackend && typeof storageBackend.setItem === "function") {
        try {
          storageBackend.setItem(`${toggleId}_expanded`, expand ? 'true' : 'false');
        } catch { /* ignore */ }
      }
    };

    let savedState = null;
    if (toggleId && storageBackend && typeof storageBackend.getItem === "function") {
      try {
        savedState = storageBackend.getItem(`${toggleId}_expanded`);
      } catch { /* ignore */ }
    }
    const initialExpand = savedState === 'true';
    togglePanel(initialExpand);

    trackListener(toggleButton, 'click', () => {
      const isCurrentlyExpanded = toggleButton.getAttribute('aria-expanded') === 'true';
      togglePanel(!isCurrentlyExpanded);
    });
  }

  function setupModal(modalId, openBtnId, closeBtnId, onOpen, onClose) {
    const modal = document.getElementById(modalId);
    const openBtn = document.getElementById(openBtnId);
    const closeBtn = document.getElementById(closeBtnId);

    if (!modal) return;

    const open = () => {
      if (typeof onOpen === 'function') {
        onOpen(modal);
      }
      if (typeof modal.showModal === 'function') {
        modal.showModal();
      } else {
        modal.classList.remove('hidden');
        modal.setAttribute('open', 'true');
      }
    };

    const close = () => {
      if (typeof modal.close === 'function') {
        modal.close();
      } else {
        modal.classList.add('hidden');
        modal.removeAttribute('open');
      }
      if (typeof onClose === 'function') {
        onClose(modal);
      }
    };

    if (openBtn) {
      trackListener(openBtn, 'click', open);
    }
    if (closeBtn) {
      trackListener(closeBtn, 'click', close);
    }
    trackListener(modal, 'keydown', (e) => {
      if (e.key === 'Escape') {
        close();
      }
    });
    trackListener(modal, 'click', (e) => {
      if (e.target === modal) {
        close();
      }
    });

    return { open, close };
  }

  function setupForm(formId, submitHandler, options = {}) {
    const form = document.getElementById(formId);
    if (!form) return;

    const {
      validateBeforeSubmit = true,
      showLoadingState = true,
      resetOnSuccess = true
    } = options;

    trackListener(form, 'submit', async (e) => {
      e.preventDefault();
      if (form.classList.contains('submitting')) {
        return;
      }
      if (validateBeforeSubmit && typeof form.checkValidity === 'function') {
        if (!form.checkValidity()) {
          form.reportValidity();
          return;
        }
      }
      if (showLoadingState) {
        form.classList.add('submitting');
        const submitBtn = form.querySelector('[type="submit"]');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.dataset.originalText = submitBtn.textContent;
          submitBtn.textContent = 'Submitting...';
        }
      }

      try {
        const formData = new FormData(form);
        await submitHandler(formData, form);
        if (resetOnSuccess) {
          form.reset();
        }
      } catch (error) {
        if (app && typeof app.showNotification === "function") {
          app.showNotification(
            error.message ? `Form submission error: ${error.message}` : "Form submission failed",
            "error"
          );
        } else if (typeof console !== "undefined") {
          // Last-resort fallback for dev debugging only
          console.error('[EventHandler] (fallback) Form submission error:', error);
        }
        if (options.onError) {
          options.onError(error);
        }
      } finally {
        if (showLoadingState) {
          form.classList.remove('submitting');
          const submitBtn = form.querySelector('[type="submit"]');
          if (submitBtn) {
            submitBtn.disabled = false;
            if (submitBtn.dataset.originalText) {
              submitBtn.textContent = submitBtn.dataset.originalText;
            }
          }
        }
      }
    }, { passive: false });
  }

  function setupNavigation() {
    const newConversationBtn = document.getElementById('newConversationBtn');
    if (newConversationBtn) {
      trackListener(newConversationBtn, 'click', async () => {
        try {
          const isAuthenticated = auth?.isAuthenticated();
          if (!isAuthenticated) {
            app?.showNotification('Please log in to create a conversation', 'error');
            return;
          }
          if (projectManager?.createConversation) {
            const projectId = app?.getProjectId();
            const conversation = await projectManager.createConversation(projectId);
            redirect(`/?chatId=${conversation.id}`);
          }
        } catch (error) {
          if (app && typeof app.showNotification === "function") {
            app.showNotification(
              error.message ? `Failed to create conversation: ${error.message}` : 'Failed to create conversation',
              "error"
            );
          } else if (typeof console !== "undefined") {
            // Last-resort fallback for dev debugging only
            console.error('[EventHandler] (fallback) Failed to create conversation:', error);
          }
        }
      });
    }

    const createProjectBtn = document.getElementById('createProjectBtn');
    if (createProjectBtn && modalManager) {
      trackListener(createProjectBtn, 'click', () => {
        if (modalManager.show) {
          modalManager.show('project');
        }
      });
    }
  }

  function setupCommonElements() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn && auth) {
      trackListener(logoutBtn, 'click', (e) => {
        auth.logout(e).catch(err => {
          if (app && typeof app.showNotification === "function") {
            app.showNotification(
              err && err.message ? `Logout failed: ${err.message}` : "Logout failed",
              "error"
            );
        } else if (typeof console !== "undefined") {
          // Last-resort fallback for dev debugging only
          console.error('[EventHandler] (fallback) Logout failed:', err);
          }
        });
      }, { passive: false });
    }
    // Registration form handling...
    if (document.getElementById('registerForm')) {
      setupForm('registerForm', async (formData) => {
        const username = formData.get('username');
        const password = formData.get('password');
        if (!username || !password) {
          throw new Error('Username and password are required');
        }
        // Validate password requirements
        const validation = validatePassword(password);
        if (!validation.valid) throw new Error(validation.message);
        // Wait for auth module before proceeding
        if (!auth || typeof auth.register !== 'function') {
          throw new Error('Authentication module not loaded. Cannot register.');
        }
        const response = await auth.register({ username, password });
        app?.showNotification('Registration successful', 'success');
        // Close auth dropdown
        const authDropdown = document.getElementById('authDropdown');
        if (authDropdown) {
          authDropdown.classList.add('hidden');
        }
        if (response && response.access_token) {
          // Reason for delay: ensure notification or UI state updates before leaving page
          setTimeout(() => { redirect('/'); }, 100);
        }
      }, { resetOnSuccess: false });
    }
  }

  function validatePassword(password) {
    if (password && password.length >= 3) {
      return { valid: true };
    }
    return {
      valid: false,
      message: 'Password must be at least 3 characters long.'
    };
  }

  function setupNavigationElements() {
    const navToggleBtn = document.getElementById('navToggleBtn');
    const mainSidebar = document.getElementById('mainSidebar');
    const closeSidebarBtn = document.getElementById('closeSidebarBtn');

    if (navToggleBtn && mainSidebar) {
      trackListener(navToggleBtn, 'click', () => {
        const willShow = mainSidebar.classList.contains('-translate-x-full');
        if (!willShow) {
          if (mainSidebar.contains(document.activeElement)) {
            document.activeElement.blur();
          }
        }
        mainSidebar.classList.toggle('-translate-x-full');
        const isExpanded = !mainSidebar.classList.contains('-translate-x-full');
        navToggleBtn.setAttribute('aria-expanded', isExpanded.toString());
        mainSidebar.setAttribute('aria-hidden', (!isExpanded).toString());
        if (app && typeof app.showNotification === "function") {
          app.showNotification(`[EventHandler] Sidebar toggled: ${isExpanded ? 'open' : 'closed'}`, "info");
        } else if (DependencySystem?.modules?.get?.('notify')?.info) {
          DependencySystem.modules.get('notify').info(`[EventHandler] Sidebar toggled: ${isExpanded ? 'open' : 'closed'}`, { context: 'eventHandler' });
        } else if (typeof console !== "undefined") {
          // DEV-ONLY fallback: not user-facing
          console.log('[EventHandler] (fallback) Sidebar toggled:', isExpanded ? 'open' : 'closed');
        }
      });
    }
    if (closeSidebarBtn && mainSidebar) {
      trackListener(closeSidebarBtn, 'click', () => {
        if (mainSidebar.contains(document.activeElement)) {
          document.activeElement.blur();
        }
        mainSidebar.classList.add('-translate-x-full');
        if (navToggleBtn) navToggleBtn.setAttribute('aria-expanded', 'false');
        mainSidebar.setAttribute('aria-hidden', 'true');
      });
    }
    setupNavigation();
  }

  function setupContentElements() {
    const projectTabs = document.querySelectorAll('[role="tab"]');
    if (projectTabs.length > 0) {
      projectTabs.forEach(tab => {
        trackListener(tab, 'click', () => {
          const controlsId = tab.getAttribute('aria-controls');
          const targetPanel = document.getElementById(controlsId);
          document.querySelectorAll('[role="tabpanel"]').forEach(panel => {
            panel.classList.add('hidden');
          });
          if (targetPanel) targetPanel.classList.remove('hidden');
          projectTabs.forEach(t => {
            t.setAttribute('aria-selected', 'false');
            t.classList.remove('tab-active');
            t.tabIndex = -1;
          });
          tab.setAttribute('aria-selected', 'true');
          tab.classList.add('tab-active');
          tab.tabIndex = 0;
        });
      });
    }
    // Keyboard help modal...
    const keyboardHelpBtn = document.getElementById('keyboardHelpBtn');
    const keyboardHelp = document.getElementById('keyboardHelp');
    if (keyboardHelpBtn && keyboardHelp) {
      trackListener(keyboardHelpBtn, 'click', () => {
        keyboardHelp.classList.toggle('hidden');
      });
      const closeBtn = keyboardHelp.querySelector('.btn-ghost');
      if (closeBtn) {
        trackListener(closeBtn, 'click', () => {
          keyboardHelp.classList.add('hidden');
        });
      }
      trackListener(keyboardHelp, 'click', (e) => {
        if (e.target === keyboardHelp) keyboardHelp.classList.add('hidden');
      });
    }
    trackListener(document, 'keydown', (e) => {
      if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        keyboardHelp?.classList.toggle('hidden');
      }
      if (e.key === 'Escape') {
        keyboardHelp?.classList.add('hidden');
      }
    });
  }


  // ---- Modal login/register tab hookup ----
  function setupModalTabs() {
    const loginTab = document.getElementById("modalLoginTab");
    const registerTab = document.getElementById("modalRegisterTab");
    const loginPanel = document.getElementById("loginPanel");
    const registerPanel = document.getElementById("registerPanel");
    function showTab(tab) {
      if (!(loginTab && registerTab && loginPanel && registerPanel)) return;
      if (tab === "login") {
        loginTab.classList.add("tab-active");
        loginTab.setAttribute("aria-selected", "true");
        registerTab.classList.remove("tab-active");
        registerTab.setAttribute("aria-selected", "false");
        loginPanel.style.display = "block";
        registerPanel.style.display = "none";
      } else {
        registerTab.classList.add("tab-active");
        registerTab.setAttribute("aria-selected", "true");
        loginTab.classList.remove("tab-active");
        loginTab.setAttribute("aria-selected", "false");
        registerPanel.style.display = "block";
        loginPanel.style.display = "none";
      }
    }
    if (loginTab && registerTab && loginPanel && registerPanel) {
      // Use trackListener not addEventListener!
      trackListener(loginTab, "click", () => showTab("login"), { description: "Login modal tab" });
      trackListener(registerTab, "click", () => showTab("register"), { description: "Register modal tab" });

      // Modal open happens via showModal/show etc., so check global signal to open on register if present
      const loginModal = document.getElementById("loginModal");
      if (loginModal) {
        // Internal flag, avoid window global
        let showRegisterTabFlag = false;
        const ensureTab = () => {
          if (showRegisterTabFlag) {
            showTab("register");
            showRegisterTabFlag = false;
          } else {
            showTab("login");
          }
        };
        // Use trackListener instead of direct addEventListener
        trackListener(loginModal, "show", ensureTab, { description: "Login modal show event" });
        new MutationObserver(() => {
          if (loginModal.open || loginModal.style.display === "flex" || loginModal.style.display === "block") {
            ensureTab();
          }
        }).observe(loginModal, {attributes: true, attributeFilter: ["open", "style", "class"]});

        // Instead of exposing on window, expose on event handler instance (see below)
        loginModal._openLoginRegisterModal = function(tab) {
          if (tab === "register") {
            showRegisterTabFlag = true;
          }
          if (modalManager && modalManager.show) {
            modalManager.show("login");
          } else if (typeof loginModal.showModal === "function") {
            loginModal.showModal();
          }
        };
      }
      // Remove window property assignments. We'll expose public openLoginRegisterModal, showRegisterModal as exports later.
    }
  }
  // Use trackListener for document-level lifecycle events
  trackListener(document, 'modalsLoaded', setupModalTabs, { description: "Modals loaded event" });
  // Also ensure modal tabs init after DOMContentLoaded for static/app shell builds:
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    // UX: Give DOM pipeline a tick for modal DOM availability in static/app shell
    setTimeout(setupModalTabs, 0);
  } else {
    trackListener(document, 'DOMContentLoaded', setupModalTabs, { once: true, description: "DOMContentLoaded for modal tabs" });
  }
  // ---- end modal tab hookup ----

  let initialized = false;
  async function init() {
    if (initialized) return;
    try {
      await waitForDepsAndDom({
        deps: ['app', 'auth', 'projectManager', 'modalManager'],
        domSelectors: ['body', '#mainSidebar', '#navToggleBtn']
      });
      setupCommonElements();
      setupNavigationElements();
      setupContentElements();
      setupModalTabs(); // catch case where modalsLoaded happens before this point
      initialized = true;
      if (app && typeof app.showNotification === "function") {
        app.showNotification("[EventHandler] All handlers initialized", "info");
      } else if (typeof console !== "undefined") {
        // Last-resort fallback for dev debugging only
        console.log('[EventHandler] (fallback) All handlers initialized');
      }
    } catch (err) {
      if (app && typeof app.showNotification === "function") {
        app.showNotification(
          err && err.message ? `Failed to initialize event handlers: ${err.message}` : "Failed to initialize event handlers",
          "error"
        );
      } else if (typeof console !== "undefined") {
        // Last-resort fallback for dev debugging only
        console.error("[EventHandler] (fallback) Failed to initialize event handlers:", err);
      }
      throw err; // rethrow for orchestrator fail-fast in tests
    }
  }

  // No self-assignment! Only export for orchestrator/consumer to register.
  return {
    trackListener,
    cleanupListeners,
    listTrackedListeners,
    delegate,
    debounce: globalDebounce,
    toggleVisible,
    setupCollapsible,
    setupModal,
    setupForm,
    init,
    PRIORITY,
    // DI compatibility for consumers requiring untrackListener
    untrackListener: () => {}
  };
}

export default createEventHandlers;
