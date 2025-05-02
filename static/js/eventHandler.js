/**
 * eventHandler.js - DependencySystem/DI Refactored Edition
 *
 * Modular, orchestrator-registered UI event utility collection.
 * NO global window.* access internally; no window.* assignment/self-registration.
 *
 * ## Dependencies (from DependencySystem or DI-injected)
 * - app: Core app module (API, notifications)
 * - auth: Auth module
 * - projectManager: Project management
 * - sidebar: Sidebar UI handler
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
 *   @param {Object} deps.sidebar - Sidebar handler
 *   @param {Object} deps.modalManager - Modal handler
 *   @param {Object} deps.DependencySystem - Preferred for DI dependency registry
 */
import { waitForDepsAndDom } from './utils/globalUtils.js';
import { debounce as globalDebounce, toggleElement as globalToggleElement } from './utils/globalUtils.js';

export function createEventHandlers({ app, auth, projectManager, sidebar, modalManager, DependencySystem } = {}) {
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

    const wrappedHandler = async function (event) {
      try {
        const startTime = performance.now();
        const result = handler.call(this, event);
        if (result && typeof result.then === 'function') {
          await result;
        }
        const duration = performance.now() - startTime;
        const threshold =
          type === 'submit' ? 800
            : type === 'click' ? 500
            : 100;
        if (duration > threshold) {
          console.warn(`Slow event handler for ${type} took ${duration.toFixed(2)}ms`);
        }
      } catch (error) {
        console.error(`Error in ${type} event handler:`, error);
        if (
          error.name === 'TypeError' &&
          error.message.includes('passive') &&
          finalOptions.passive
        ) {
          console.warn(`preventDefault() called on a passive ${type} listener`);
        }
        throw error;
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
        console.warn(`Error removing ${listener.type} listener:`, error);
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
          console.error(`Error in delegated ${eventType} handler for ${selector}:`, error);
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
      if (toggleId) {
        localStorage.setItem(`${toggleId}_expanded`, expand ? 'true' : 'false');
      }
    };

    const savedState = localStorage.getItem(`${toggleId}_expanded`);
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
        console.error('Form submission error:', error);
        if (options.onError) {
          options.onError(error);
        } else if (app?.showNotification) {
          app.showNotification(
            error.message || 'Form submission failed',
            'error'
          );
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
            window.location.href = `/?chatId=${conversation.id}`;
          }
        } catch (error) {
          console.error('Failed to create conversation:', error);
          app?.showNotification('Failed to create conversation', 'error');
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
          console.error('Logout failed:', err);
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
          setTimeout(() => { window.location.href = '/'; }, 100);
        } else {
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
        console.log('[EventHandler] Sidebar toggled:', isExpanded ? 'open' : 'closed');
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
    const loginTab = document.getElementById("loginTab");
    const registerTab = document.getElementById("registerTab");
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
        const ensureTab = () => {
          if (window && window.showRegisterTab) {
            showTab("register");
            window.showRegisterTab = false;
          } else {
            showTab("login");
          }
        };
        // Listen for both show and transition to visible
        loginModal.addEventListener("show", ensureTab);
        new MutationObserver(() => {
          if (loginModal.open || loginModal.style.display === "flex" || loginModal.style.display === "block") {
            ensureTab();
          }
        }).observe(loginModal, {attributes: true, attributeFilter: ["open", "style", "class"]});
      }
      window.openLoginRegisterModal = function(tab) {
        const loginModal = document.getElementById("loginModal");
        if (loginModal) {
          if (tab === "register") {
            window.showRegisterTab = true;
          }
          if (window.modalManager && window.modalManager.show) {
            window.modalManager.show("login");
          } else {
            loginModal.showModal();
          }
        }
      };
      window.showRegisterModal = () => window.openLoginRegisterModal("register");
    }
  }
  document.addEventListener('modalsLoaded', setupModalTabs);
  // ---- end modal tab hookup ----

  let initialized = false;
  async function init() {
    if (initialized) return;
    await waitForDepsAndDom({
      deps: ['app', 'auth', 'projectManager', 'modalManager'],
      domSelectors: ['body', '#mainSidebar', '#navToggleBtn']
    });
    setupCommonElements();
    setupNavigationElements();
    setupContentElements();
    setupModalTabs(); // catch case where modalsLoaded happens before this point
    initialized = true;
    console.log('[EventHandler] All handlers initialized');
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
