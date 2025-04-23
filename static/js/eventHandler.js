// eventHandler.js
/**
 * Dependencies:
 * - window.auth (external dependency, for authentication)
 * - window.app (external dependency, for notifications and UI management)
 * - window.projectManager (external dependency, for project operations)
 * - window.sidebar (external dependency, for sidebar control)
 * - window.modalManager (external dependency, for modal control)
 * - window.DependencySystem (external dependency, for module registration)
 * - document (browser built-in, for DOM access)
 * - localStorage (browser built-in, for persistent state)
 * - Set (JavaScript built-in, for tracking listeners)
 * - performance (browser built-in, for performance measurement)
 */

// Browser APIs:
// - document (DOM manipulation and event handling)
// - localStorage (persistent state storage)
// - performance (performance timing)
// - Set (data structure for tracking listeners)

// External Dependencies (Global Scope):
// - window.auth (authentication system)
// - window.app (application core)
// - window.projectManager (project management)
// - window.sidebar (sidebar control)
// - window.modalManager (modal dialogs)
// - window.DependencySystem (module registration)

// Optional Dependencies:
// - Gracefully falls back if certain globals aren't available
// - Handles missing notification system with console fallbacks

// A centralized event management system for tracking, delegating, and cleaning up event listeners

// Set of tracked event listeners for cleanup
const trackedListeners = new Set();

// Event priority levels
const PRIORITY = {
  CRITICAL: 1,
  HIGH: 3,
  NORMAL: 5,
  LOW: 7,
  BACKGROUND: 9
};

/**
 * Track an event listener with proper wrapping and cleanup
 * @param {EventTarget} element - DOM element to attach the listener to
 * @param {string} type - Event type (e.g. 'click', 'submit')
 * @param {Function} handler - Event handler function
 * @param {Object} options - Additional options including passive, capture, etc.
 */
function trackListener(element, type, handler, options = {}) {
  if (!element) return;

  // Set appropriate defaults for passive option
  let usePassive = options.passive;
  if (usePassive === undefined) {
    // Events that typically need preventDefault()
    const nonPassiveEvents = ['submit', 'wheel', 'touchstart', 'touchmove'];
    usePassive = !nonPassiveEvents.includes(type);
  }

  const finalOptions = {
    ...options,
    passive: usePassive
  };

  // Create wrapped handler with error handling
  const wrappedHandler = async function (event) {
    try {
      const startTime = performance.now();

      // Handle potential async handlers
      const result = handler.call(this, event);
      if (result && typeof result.then === 'function') {
        await result; // Wait for async handlers
      }

      const duration = performance.now() - startTime;
      // Higher threshold for submit events since they often involve network calls
      const threshold = type === 'submit' ? 500 : 100;
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
      throw error; // Re-throw to maintain behavior
    }
  };

  // Add the listener
  element.addEventListener(type, wrappedHandler, finalOptions);

  // Store for later cleanup
  trackedListeners.add({
    element,
    type,
    handler: wrappedHandler,
    options: finalOptions,
    originalHandler: handler,
    description: options.description || '',
    priority: options.priority || PRIORITY.NORMAL
  });

  return wrappedHandler;
}

/**
 * Remove all tracked listeners
 * @param {Element} [targetElement] - Optional element to limit cleanup to
 * @param {string} [targetType] - Optional event type to limit cleanup to
 */
function cleanupListeners(targetElement, targetType) {
  const listenersToRemove = new Set();
  trackedListeners.forEach(listener => {
    const elementMatches = !targetElement || listener.element === targetElement;
    const typeMatches = !targetType || listener.type === targetType;
    if (elementMatches && typeMatches) {
      listenersToRemove.add(listener);
    }
  });

  // Remove the matched listeners
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

/**
 * Simple debounce function
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(func, wait = 250) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      func.apply(this, args);
    }, wait);
  };
}

/**
 * Set up a delegated event listener
 * @param {Element} container - Container element to attach listener to
 * @param {string} eventType - Event type to listen for
 * @param {string} selector - CSS selector to match target elements
 * @param {Function} handler - Event handler
 * @param {Object} options - Event listener options
 */
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

/**
 * Utility to toggle visibility of one or more elements
 * @param {Element|string} element - Element or CSS selector
 * @param {boolean} show - Whether to show the element
 */
function toggleVisible(element, show) {
  if (typeof element === 'string') {
    document.querySelectorAll(element).forEach(el => {
      el.classList.toggle('hidden', !show);
    });
  } else if (element) {
    element.classList.toggle('hidden', !show);
  }
}

/**
 * Set up a collapsible section
 */
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

/**
 * Set up a modal with standardized behavior
 */
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

/**
 * Handle form submission with standardized error handling
 */
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
      } else if (window.app?.showNotification) {
        window.app.showNotification(
          error.message || 'Form submission failed',
          'error'
        );
      }
    } finally {
      if (showLoadingState) {
        form.classList.remove('submitting');
        const submitBtn = form.querySelector('[type=\"submit\"]');
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

/**
 * Internal helper to retry the init process multiple times if needed.
 */
async function attemptInit(retries = 0) {
  const maxRetries = 5;
  // Wait until DOM is at least ready
  if (document.readyState === 'loading') {
    if (retries < maxRetries) {
      console.log('[eventHandler] DOM not fully loaded, retrying in 300ms...');
      setTimeout(() => attemptInit(retries + 1), 300);
      return;
    } else {
      console.warn('[eventHandler] DOM not ready after multiple attempts');
      return;
    }
  }

  // Clean up existing listeners to avoid duplicates
  cleanupListeners();

  // Set up any global event logic here, if needed
  if (window.auth?.AuthBus) {
    window.auth.AuthBus.addEventListener('authStateChanged', handleAuthStateChange);
    window.auth.AuthBus.addEventListener('backendUnavailable', handleBackendUnavailable);
  }

  // Set up global key bindings with passive:false to allow preventDefault()
  trackListener(document, 'keydown', handleKeyDown, { passive: false });

  // Set up navigation
  setupNavigation();

  // Set up common UI elements
  setupCommonElements();

  console.log('[eventHandler] Initialization complete.');
}

/**
 * Initialize all event handlers
 */
function init() {
  attemptInit();
}

/**
 * Handle auth state changes
 */
function handleAuthStateChange(event) {
  const { authenticated } = event.detail || {};

  // Close auth dropdown
  const authDropdown = document.getElementById('authDropdown');
  if (authDropdown) authDropdown.classList.add('hidden');

  // Update UI visibility
  toggleVisible('#authButton', !authenticated);
  toggleVisible('#userMenu', authenticated);
  toggleVisible('#loginRequiredMessage', !authenticated);
  toggleVisible('#globalChatUI', authenticated);

  // Handle project view state
  const projectListView = document.getElementById('projectListView');
  if (projectListView) {
    projectListView.classList.toggle('opacity-0', !authenticated);
  }

  // Redirect if on login page
  if (authenticated && window.location.pathname === '/login') {
    window.location.href = '/';
  }
}

/**
 * Handle backend unavailable events
 */
function handleBackendUnavailable(event) {
  const { reason } = event.detail || {};
  const message = `Backend service unavailable: ${reason || 'unknown reason'}. Will retry later.`;
  if (window.app?.showNotification) {
    window.app.showNotification(message, 'warning', 8000);
  }
}

/**
 * Handle global keyboard shortcuts
 */
function handleKeyDown(e) {
  // Ctrl/Cmd + / => Show help
  if ((e.ctrlKey || e.metaKey) && e.key === '/') {
    e.preventDefault();
    const helpModal = document.getElementById('helpModal');
    if (helpModal && typeof helpModal.showModal === 'function') {
      helpModal.showModal();
    }
  }

  // Ctrl/Cmd + . => Toggle sidebar
  if ((e.ctrlKey || e.metaKey) && e.key === '.') {
    e.preventDefault();
    if (window.sidebar) {
      window.sidebar.toggle();
    }
  }
}

/**
 * Set up navigation-related events
 */
function setupNavigation() {
  const backToProjectsBtn = document.getElementById('backToProjectsBtn');
  if (backToProjectsBtn) {
    trackListener(backToProjectsBtn, 'click', () => {
      if (window.app?.showProjectListView) {
        window.app.showProjectListView();
      }
    });
  }

  const newConversationBtn = document.getElementById('newConversationBtn');
  if (newConversationBtn) {
    trackListener(newConversationBtn, 'click', async () => {
      try {
        const isAuthenticated = window.auth?.isAuthenticated();
        if (!isAuthenticated) {
          window.app?.showNotification('Please log in to create a conversation', 'error');
          return;
        }

        if (window.projectManager?.createConversation) {
          const projectId = window.app?.getProjectId();
          const conversation = await window.projectManager.createConversation(projectId);
          window.location.href = `/?chatId=${conversation.id}`;
        }
      } catch (error) {
        console.error('Failed to create conversation:', error);
        window.app?.showNotification('Failed to create conversation', 'error');
      }
    });
  }

  const createProjectBtn = document.getElementById('createProjectBtn');
  if (createProjectBtn) {
    trackListener(createProjectBtn, 'click', () => {
      if (window.modalManager?.show) {
        window.modalManager.show('project');
      }
    });
  }
}

/**
 * Set up common UI elements
 */
function setupCommonElements() {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    trackListener(logoutBtn, 'click', (e) => {
      window.auth.logout(e).catch(err => {
        console.error('Logout failed:', err);
      });
    }, { passive: false });
  }

  const authButton = document.getElementById('authButton');
  const authDropdown = document.getElementById('authDropdown');

  if (authButton && authDropdown) {
    window.eventHandlers.trackListener(authButton, 'click', (e) => {
      e.preventDefault();
      authDropdown.classList.toggle('hidden');
      const isHidden = authDropdown.classList.contains('hidden');
      if (isHidden) {
        authDropdown.setAttribute('inert', '');
      } else {
        authDropdown.removeAttribute('inert');
      }
      authButton.setAttribute('aria-expanded', isHidden ? 'false' : 'true');
    });

    // Close dropdown when clicking outside
    window.eventHandlers.trackListener(document, 'click', (e) => {
      if (!authDropdown.contains(e.target) && e.target !== authButton) {
        authDropdown.classList.add('hidden');
        authButton.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // NOTE: Login form handling is managed in base.html and auth.js.
  // Duplicate event handler removed to prevent multiple POSTs and 422 errors.

  // Register form
  if (document.getElementById('registerForm')) {
    setupForm('registerForm', async (formData) => {
      const username = formData.get('username');
      const password = formData.get('password');
      if (!username || !password) {
        throw new Error('Username and password are required');
      }

      // Ensure window.auth and register method exist
      if (!window.auth || typeof window.auth.register !== 'function') {
        throw new Error('Authentication module not loaded. Cannot register.');
      }

      try {
        // Validate password requirements
        const validation = validatePassword(password);
        if (!validation.valid) {
          throw new Error(validation.message);
        }

        // Register and get response
        const response = await window.auth.register(formData);
        window.app?.showNotification('Registration successful', 'success');

        // Close auth dropdown
        const authDropdown = document.getElementById('authDropdown');
        if (authDropdown) {
          authDropdown.classList.add('hidden');
        }

        // If we got a token back, ensure cookies are set before redirect
        if (response && response.access_token) {
          setTimeout(() => {
            // Redirect to homepage
            window.location.href = '/';
          }, 100);
        } else {
          // Switch to login tab if no auto-login
          switchAuthTab('login');
        }
      } catch (error) {
        console.error('Registration error:', error);
        let errorMsg = 'Registration failed';

        if (error.data && error.data.detail) {
          errorMsg = error.data.detail;
        } else if (error.message) {
          errorMsg = error.message;
        }

        window.app?.showNotification(errorMsg, 'error');
        throw error; // Re-throw to prevent form reset
      }
    }, {
      resetOnSuccess: false
    });
  }
}

/**
 * Validate password (dummy version, user can replace with actual checks)
 */
function validatePassword(password) {
  if (password && password.length >= 3) {
    return { valid: true };
  }
  return {
    valid: false,
    message: 'Password must be at least 3 characters long.'
  };
}

// Handle dynamic element reinitialization
function reinitializeAuthElements() {
  const authButton = document.getElementById('authButton');
  const authDropdown = document.getElementById('authDropdown');

  if (authButton && authDropdown && !authButton._listenerAttached) {
    setupCommonElements();
    authButton._listenerAttached = true;
    console.log('[eventHandler] Re-initialized auth elements');
  }
}

// Set up event listeners for dynamic content
document.addEventListener('modalsLoaded', reinitializeAuthElements);
document.addEventListener('authStateChanged', reinitializeAuthElements);

// Export to window and as a module
window.eventHandlers = {
  trackListener,
  cleanupListeners,
  delegate,
  debounce,
  toggleVisible,
  setupCollapsible,
  setupModal,
  setupForm,
  init,
  PRIORITY
};

// Register with DependencySystem when it becomes available
if (window.DependencySystem) {
  window.DependencySystem.register('eventHandlers', window.eventHandlers);
} else {
  // Wait for DependencySystem to be available
  Object.defineProperty(window, 'DependencySystem', {
    configurable: true,
    set: function(value) {
      Object.defineProperty(window, 'DependencySystem', {
        value: value,
        configurable: true,
        writable: true
      });
      value.register('eventHandlers', window.eventHandlers);
    }
  });
}

export default window.eventHandlers;
