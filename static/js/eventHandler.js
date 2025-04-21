/**
 * eventHandler.js
 * A centralized event management system for tracking,
 * delegating, and cleaning up event listeners
 */

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
    const wrappedHandler = function (event) {
        try {
            // Performance measurement in development
            const startTime = performance.now();

            // Execute the original handler
            handler.call(this, event);

            // Measure execution time
            const duration = performance.now() - startTime;
            if (duration > 100) {
                console.warn(`Slow event handler for ${type} took ${duration.toFixed(2)}ms`);
            }
        } catch (error) {
            console.error(`Error in ${type} event handler:`, error);

            // If error was triggered by a passive event trying to call preventDefault
            if (error.name === 'TypeError' &&
                error.message.includes('passive') &&
                finalOptions.passive) {
                console.warn(`preventDefault() called on a passive ${type} listener. Consider setting passive: false`);
            }
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
    // Create a new set to avoid modification during iteration
    const listenersToRemove = new Set();

    // Find matching listeners
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
 * @param {string} toggleId - ID of toggle button
 * @param {string} panelId - ID of panel to collapse/expand
 * @param {string} [chevronId] - ID of chevron icon (optional)
 * @param {Function} [onExpand] - Callback on expand (optional)
 */
function setupCollapsible(toggleId, panelId, chevronId, onExpand) {
    const toggleButton = document.getElementById(toggleId);
    const panel = document.getElementById(panelId);
    const chevron = chevronId ? document.getElementById(chevronId) : null;

    if (!toggleButton || !panel) return;

    // Prepare ARIA attributes
    toggleButton.setAttribute('role', 'button');
    toggleButton.setAttribute('aria-controls', panelId);
    toggleButton.setAttribute('aria-expanded', 'false');

    // Toggle function
    const togglePanel = (expand) => {
        panel.classList.toggle('hidden', !expand);

        if (chevron) {
            chevron.style.transform = expand ? 'rotate(180deg)' : 'rotate(0deg)';
        }

        toggleButton.setAttribute('aria-expanded', expand ? 'true' : 'false');

        if (expand && typeof onExpand === 'function') {
            onExpand();
        }

        // Save state to localStorage if ID provided
        if (toggleId) {
            localStorage.setItem(`${toggleId}_expanded`, expand ? 'true' : 'false');
        }
    };

    // Initial state from localStorage
    const savedState = localStorage.getItem(`${toggleId}_expanded`);
    const initialExpand = savedState === 'true';
    togglePanel(initialExpand);

    // Add click handler
    trackListener(toggleButton, 'click', () => {
        const isCurrentlyExpanded = toggleButton.getAttribute('aria-expanded') === 'true';
        togglePanel(!isCurrentlyExpanded);
    });
}

/**
 * Set up a modal with standardized behavior
 * @param {string} modalId - ID of the modal element
 * @param {string} openBtnId - ID of button that opens modal
 * @param {string} closeBtnId - ID of button that closes modal
 * @param {Function} [onOpen] - Callback before opening
 * @param {Function} [onClose] - Callback after closing
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

    // Open button
    if (openBtn) {
        trackListener(openBtn, 'click', open);
    }

    // Close button
    if (closeBtn) {
        trackListener(closeBtn, 'click', close);
    }

    // Close on ESC key
    trackListener(modal, 'keydown', (e) => {
        if (e.key === 'Escape') {
            close();
        }
    });

    // Close on backdrop click for dialog elements
    trackListener(modal, 'click', (e) => {
        if (e.target === modal) {
            close();
        }
    });

    return { open, close };
}

/**
 * Handle form submission with standardized error handling
 * @param {string} formId - ID of the form
 * @param {Function} submitHandler - Form submission handler
 * @param {Object} [options] - Additional options
 */
function setupForm(formId, submitHandler, options = {}) {
    const form = document.getElementById(formId);
    if (!form) return;

    // Default options
    const {
        validateBeforeSubmit = true,
        showLoadingState = true,
        resetOnSuccess = true
    } = options;

    trackListener(form, 'submit', async (e) => {
        e.preventDefault();

        // Skip if already submitting
        if (form.classList.contains('submitting')) {
            return;
        }

        // Validate if requested
        if (validateBeforeSubmit && typeof form.checkValidity === 'function') {
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }
        }

        // Show loading state
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

            // Reset form on success if requested
            if (resetOnSuccess) {
                form.reset();
            }
        } catch (error) {
            console.error('Form submission error:', error);

            // Show error message if provided by handler
            if (options.onError) {
                options.onError(error);
            } else if (window.app?.showNotification) {
                window.app.showNotification(
                    error.message || 'Form submission failed',
                    'error'
                );
            }
        } finally {
            // Reset loading state
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

/**
 * Initialize all event handlers
 */
function init() {
    // Clean up existing listeners to avoid duplicates
    cleanupListeners();

    // Set up auth events
    if (window.auth?.AuthBus) {
        window.auth.AuthBus.addEventListener('authStateChanged', handleAuthStateChange);
        window.auth.AuthBus.addEventListener('backendUnavailable', handleBackendUnavailable);
    }

    // Set up global key bindings
    trackListener(document, 'keydown', handleKeyDown);

    // Set up navigation
    setupNavigation();

    // Set up common UI elements
    setupCommonElements();

    // Listen for model configuration changes
    if (window.modelConfig?.onConfigChange) {
      window.modelConfig.onConfigChange((config) => {
        // Update vision UI visibility when model changes
        if (window.uiRenderer?.setupVisionUI) {
          window.uiRenderer.setupVisionUI();
        }

        // Update max tokens display
        const tokensDisplay = document.getElementById('maxTokensValue');
        if (tokensDisplay) {
          tokensDisplay.textContent = `${config.maxTokens} tokens`;
        }
      });
    }
}

/**
 * Handle auth state changes
 */
function handleAuthStateChange(event) {
    const { authenticated, username } = event.detail || {};

    // Update UI elements
    if (authenticated) {
        // Show authenticated UI
        toggleVisible('#authButton', false);
        toggleVisible('#userMenu', true);
        toggleVisible('#loginRequiredMessage', false);
    } else {
        // Show non-authenticated UI
        toggleVisible('#authButton', true);
        toggleVisible('#userMenu', false);
        toggleVisible('#loginRequiredMessage', true);
        toggleVisible('#globalChatUI', false);
    }
}

/**
 * Handle backend unavailable events
 */
function handleBackendUnavailable(event) {
    const { reason, until } = event.detail || {};
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
        // Show help dialog if exists
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
    // Project list button
    const backToProjectsBtn = document.getElementById('backToProjectsBtn');
    if (backToProjectsBtn) {
        trackListener(backToProjectsBtn, 'click', () => {
            if (window.app?.showProjectListView) {
                window.app.showProjectListView();
            }
        });
    }

    // New conversation button
    const newConversationBtn = document.getElementById('newConversationBtn');
    if (newConversationBtn) {
        trackListener(newConversationBtn, 'click', async () => {
            try {
                const isAuthenticated = window.app?.state?.isAuthenticated;
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

    // Create project button
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
  // Logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    trackListener(logoutBtn, 'click', (e) => {
      window.auth.logout(e).catch(err => {
        console.error('Logout failed:', err);
      });
    }, { passive: false });
  }

  // Login button toggle
  const authButton = document.getElementById('authButton');
  const authDropdown = document.getElementById('authDropdown');
  if (authButton && authDropdown) {
    trackListener(authButton, 'click', (e) => {
      e.stopPropagation();
      const isExpanded = authDropdown.classList.toggle('hidden');
      authButton.setAttribute('aria-expanded', !isExpanded);
    });

    // Close dropdown when clicking outside
    trackListener(document, 'click', (e) => {
      if (!authDropdown.contains(e.target) && e.target !== authButton) {
        authDropdown.classList.add('hidden');
        authButton.setAttribute('aria-expanded', 'false');
      }
    });
  }

    // Project form
    const projectForm = document.getElementById('projectForm');
    if (projectForm) {
        setupForm('projectForm', async (formData) => {
            // Extract form data
            const projectId = formData.get('projectId');
            const projectData = {
                name: formData.get('name'),
                description: formData.get('description') || '',
                goals: formData.get('goals') || '',
                max_tokens: parseInt(formData.get('maxTokens'), 10) || null
            };

            // Validate
            if (!projectData.name) {
                throw new Error('Project name is required');
            }

            // Create or update project
            if (window.projectManager?.createOrUpdateProject) {
                await window.projectManager.createOrUpdateProject(projectId, projectData);
                window.app?.showNotification(
                    projectId ? 'Project updated' : 'Project created',
                    'success'
                );

                // Close modal
                const modal = projectForm.closest('dialog');
                if (modal && typeof modal.close === 'function') {
                    modal.close();
                }

                // Refresh projects
                if (window.projectManager?.loadProjects) {
                    window.projectManager.loadProjects('all');
                }
            }
        });
    }

    // Login form
    if (document.getElementById('loginForm')) {
        setupForm('loginForm', async (formData) => {
            const username = formData.get('username');
            const password = formData.get('password');

            if (!username || !password) {
                throw new Error('Username and password are required');
            }

            await window.auth.login(username, password);
            window.app?.showNotification('Login successful', 'success');
        });
    }

    // Register form
    if (document.getElementById('registerForm')) {
        setupForm('registerForm', async (formData) => {
            const username = formData.get('username');
            const password = formData.get('password');

            if (!username || !password) {
                throw new Error('Username and password are required');
            }

            await window.auth.register(formData);
            window.app?.showNotification('Registration successful', 'success');
        });
    }
}

// Export to window
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

export default window.eventHandlers;
