/**
 * eventHandler.js - Centralized module for managing all event listeners across the application.
 * Provides a unified system for setting up, tracking, and cleaning up event listeners.
 * Now integrates with Sentry to capture errors and performance metrics.
 *
 * Event Types:
 * - DOM Events: click, keydown, submit, etc.
 * - Custom Events: backendUnavailable, modelConfigChanged, etc.
 * - Window Events: beforeunload, resize, etc.
 */

// Priority buckets for event execution
const EVENT_PRIORITIES = {
    CRITICAL: 1,
    HIGH: 3,
    DEFAULT: 5,
    LOW: 7,
    BACKGROUND: 9
};

// Track listeners centrally to prevent memory leaks
const trackedListeners = new Set();

/**
 * Event Registry - Maps selectors to handler functions with metadata
 * Structure: {
 *   [selector]: {
 *     handler: Function,
 *     eventType: String,
 *     priority: Number (1-10, 5=default),
 *     description: String
 *   }
 * }
 */
const eventRegistry = {
    // Document-level delegated events
    '#newConversationBtn': {
        handler: handleNewConversationClick,
        eventType: 'click',
        priority: EVENT_PRIORITIES.DEFAULT,
        description: 'Creates a new conversation after auth check'
    },
    '#createProjectBtn': {
        handler: () => window.modalManager?.show('project', {}),
        eventType: 'click',
        priority: EVENT_PRIORITIES.DEFAULT,
        description: 'Opens project creation modal'
    },
    '#backToProjectsBtn': {
        handler: () => window.ProjectDashboard?.showProjectList?.() || window.showProjectsView?.(),
        eventType: 'click',
        priority: EVENT_PRIORITIES.DEFAULT,
        description: 'Returns to projects list view'
    },
    '#editProjectBtn': {
        handler: () => {
            const currentProject = window.projectManager?.getCurrentProject();
            if (currentProject && window.modalManager?.show) {
                window.modalManager.show('project', {
                    updateContent: (modalEl) => {
                        const form = modalEl.querySelector('form');
                        if (form) {
                            form.querySelector('#projectId').value = currentProject.id;
                            form.querySelector('#projectName').value = currentProject.name;
                            form.querySelector('#projectDescription').value = currentProject.description || '';
                            const title = modalEl.querySelector('.modal-title, h3');
                            if (title) title.textContent = `Edit Project: ${currentProject.name}`;
                        }
                    }
                });
            }
        },
        eventType: 'click',
        priority: EVENT_PRIORITIES.DEFAULT,
        description: 'Opens project edit modal'
    },
    '#pinProjectBtn': {
        handler: () => {
            const currentProject = window.projectManager?.getCurrentProject();
            if (currentProject?.id && window.projectManager?.togglePinProject) {
                window.projectManager
                    .togglePinProject(currentProject.id)
                    .then(updatedProject => {
                        window.showNotification?.(
                            'Project ' + (updatedProject.pinned ? 'pinned' : 'unpinned'),
                            'success'
                        );
                        window.projectManager.loadProjectDetails(currentProject.id);
                        window.loadSidebarProjects?.();
                    })
                    .catch(err => {
                        console.error('Error toggling pin:', err);
                        window.showNotification?.('Failed to update pin status', 'error');
                    });
            }
        },
        eventType: 'click',
        priority: EVENT_PRIORITIES.DEFAULT,
        description: 'Toggles project pinned state'
    },
    '#archiveProjectBtn': {
        handler: () => {
            const currentProject = window.projectManager?.getCurrentProject();
            if (currentProject && window.ModalManager?.confirmAction) {
                window.ModalManager.confirmAction({
                    title: 'Confirm Archive',
                    message: `Are you sure you want to ${currentProject.archived ? 'unarchive' : 'archive'} this project?`,
                    confirmText: currentProject.archived ? 'Unarchive' : 'Archive',
                    confirmClass: currentProject.archived
                        ? 'bg-green-600 hover:bg-green-700'
                        : 'bg-yellow-600 hover:bg-yellow-700',
                    onConfirm: () => {
                        window.projectManager
                            .toggleArchiveProject(currentProject.id)
                            .then(updatedProject => {
                                window.showNotification?.(
                                    `Project ${updatedProject.archived ? 'archived' : 'unarchived'}`,
                                    'success'
                                );
                                window.ProjectDashboard?.showProjectList?.();
                                window.loadSidebarProjects?.();
                                window.projectManager.loadProjects('all');
                            })
                            .catch(err => {
                                console.error('Error toggling archive:', err);
                                window.showNotification?.('Failed to update archive status', 'error');
                            });
                    }
                });
            }
        },
        eventType: 'click',
        priority: EVENT_PRIORITIES.DEFAULT,
        description: 'Toggles project archived state'
    },
    '#minimizeChatBtn': {
        handler: () => {
            const chatContainer = document.getElementById('projectChatContainer');
            if (chatContainer) chatContainer.classList.toggle('hidden');
        },
        eventType: 'click',
        priority: EVENT_PRIORITIES.LOW,
        description: 'Toggles chat container visibility'
    },
    '#authButton': {
        handler: toggleAuthDropdown,
        eventType: 'click',
        priority: EVENT_PRIORITIES.DEFAULT,
        description: 'Toggles the auth dropdown menu'
    }
};

/**
 * Debounce function to limit the rate at which a function is executed.
 * @param {Function} func - The function to debounce.
 * @param {number} wait - The delay in milliseconds.
 * @returns {Function} - A debounced version of the input function.
 */
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

/**
 * Track a listener for future cleanup with enhanced options.
 * Adds a Sentry transaction for performance and captures exceptions.
 *
 * @param {Element|null} element - Element to attach listener to
 * @param {string} type - Event type (e.g., 'click', 'keydown')
 * @param {Function} handler - Event handler function
 * @param {Object} [options={}] - Event listener options with extensions:
 *   - priority: Number (1-10) for execution order
 *   - description: String describing the handler's purpose
 *   - passive: Boolean for passive event listeners
 *   - capture: Boolean for capture phase
 * @returns {void}
 */
function trackListener(element, type, handler, options = {}) {
    if (!element) return;

    // Wrap handler for performance + error capturing
    const wrappedHandler = (event) => {
        const transaction = window.Sentry?.startTransaction({
            name: `event.${type}`,
            op: 'ui.interaction',
            tags: {
                element: element.id || element.className || element.tagName,
                handler: options.description || handler.name || '(anonymous)'
            }
        });
        const startTime = performance.now();

        try {
            // Add performance mark
            performance.mark(`${type}_handler_start`);

            // Execute handler
            handler(event);

            // Log successful execution
            if (window.Sentry) {
                Sentry.addBreadcrumb({
                    category: 'event',
                    message: `Handled ${type} event`,
                    level: 'info',
                    data: {
                        element: element.id || element.className || element.tagName,
                        handler: options.description || handler.name || '(anonymous)'
                    }
                });
            }
        } catch (error) {
            console.error(`Error in ${type} handler:`, error);
            if (window.Sentry) {
                Sentry.withScope(scope => {
                    scope.setTag('event_type', type);
                    scope.setContext('element', {
                        id: element.id,
                        class: element.className,
                        tagName: element.tagName,
                        html: element.outerHTML.slice(0, 1000) // Limited HTML snippet
                    });
                    scope.setContext('handler', {
                        description: options.description || '',
                        originalName: handler.name || '(anonymous)',
                        source: handler.toString().slice(0, 500) // Limited source code
                    });
                    scope.setLevel('error');
                    Sentry.captureException(error);
                });
            }
        } finally {
            const duration = performance.now() - startTime;
            performance.measure(`${type}_handler_duration`, {
                start: `${type}_handler_start`,
                duration
            });

            if (duration > 100) { // Log slow handlers
                console.warn(`Slow ${type} handler took ${duration.toFixed(2)}ms`);
                if (window.Sentry) {
                    Sentry.captureMessage(`Slow event handler for '${type}'`, {
                        level: 'warning',
                        contexts: {
                            performance: {
                                duration_ms: duration,
                                element: element.id || element.className || element.tagName
                            }
                        }
                    });
                }
            }
            transaction?.finish();
        }
    };

    const listenerOptions = {
        passive: true,
        ...options
    };

    element.addEventListener(type, wrappedHandler, listenerOptions);
    trackedListeners.add({
        element,
        type,
        handler: wrappedHandler,
        options: listenerOptions,
        originalHandler: handler,
        description: options.description || ''
    });
}

/**
 * Clean up all tracked event listeners
 * @returns {void}
 */
function cleanupListeners() {
    trackedListeners.forEach(({ element, type, handler, options }) => {
        element.removeEventListener(type, handler, options);
    });
    trackedListeners.clear();
}

/**
 * Handle keyboard shortcut events
 * @param {KeyboardEvent} e - Keyboard event
 * @returns {void}
 */
function handleKeyDown(e) {
    // Example: Ctrl/Cmd + R => regenerateChat
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        if (e.key.toLowerCase() === 'r') {
            e.preventDefault();
            document.dispatchEvent(new CustomEvent('regenerateChat'));
        }
        if (e.key.toLowerCase() === 'c') {
            e.preventDefault();
            document.dispatchEvent(new CustomEvent('copyMessage'));
        }
    }
}

/**
 * Handle backend unavailability notification from auth.js
 * @param {CustomEvent} event - The backend unavailable event with details
 * @returns {void}
 */
function handleBackendUnavailable(event) {
    const { until, reason, error } = event.detail || {};
    const untilTime = until?.toLocaleTimeString?.() || 'unknown time';

    console.warn(`[EventHandler] Backend service unavailable: ${reason || 'unknown reason'}, circuit breaker active until ${untilTime}`);

    // Show a notification to the user
    if (window.showNotification) {
        window.showNotification(
            `Backend service is unavailable. The system will retry after ${untilTime}.`,
            "warning",
            8000 // extended duration for this important message
        );
    }

    // Add global status indicator
    const statusIndicator = document.createElement('div');
    statusIndicator.className = 'backend-unavailable-indicator fixed bottom-4 right-4 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 shadow-lg rounded z-50';
    statusIndicator.innerHTML = `
        <div class="flex">
            <div class="flex-shrink-0">
                <svg class="h-5 w-5 text-yellow-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
                </svg>
            </div>
            <div class="ml-3">
                <p class="text-sm">Backend connectivity issue detected. Some features may be unavailable.</p>
                <p class="text-xs mt-1">Will retry connection after ${untilTime}</p>
            </div>
        </div>
    `;

    // Remove any existing indicators before adding a new one
    document.querySelectorAll('.backend-unavailable-indicator').forEach(el => el.remove());
    document.body.appendChild(statusIndicator);

    // Auto-remove after the circuit breaker timeout
    const now = new Date();
    const untilDate = until || new Date(now.getTime() + 30000); // default 30s if not provided
    const timeoutMs = Math.max(100, untilDate.getTime() - now.getTime());

    setTimeout(() => {
        statusIndicator.classList.add('fade-out');
        setTimeout(() => statusIndicator.remove(), 1000);
    }, timeoutMs);
}

function toggleAuthDropdown() {
  const dropdown = document.getElementById('authDropdown');
  if (!dropdown) return;
  dropdown.classList.toggle('hidden');
}

/**
 * Handle new conversation creation with authentication check
 * @returns {void}
 */
async function handleNewConversationClick() {
    try {
        // First ensure auth system is ready
        if (!window.auth?.isReady) {
            await new Promise(resolve => {
                if (window.auth?.isReady) return resolve();
                window.auth?.AuthBus?.addEventListener('authReady', resolve, { once: true });
            });
        }

        // Check authentication with proper error handling
        const isAuthenticated = await window.auth.isAuthenticated({ forceVerify: false });
        if (!isAuthenticated) {
            window.showNotification?.('Please log in to create a conversation', 'error');
            return;
        }

        // Ensure project manager is available
        if (!window.projectManager?.createConversation) {
            console.error('No project manager or conversation creation method found');
            window.showNotification?.('Conversation creation service unavailable', 'error');
            return;
        }

        // Create conversation
        const newConversation = await window.projectManager.createConversation(null);
        window.location.href = '/?chatId=' + newConversation.id;
    } catch (err) {
        console.error('Error creating conversation:', err);
        if (err.status === 401) {
            window.showNotification?.('Session expired. Please log in again.', 'error');
        } else {
            window.showNotification?.('Failed to create conversation: ' + (err.message || 'Unknown error'), 'error');
        }
    }
}

/**
 * Handle project form submission for creating or updating projects
 * @param {Event} e - Form submission event
 * @returns {void}
 */
function handleProjectFormSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const modalDialog = form.closest('dialog');
    const projectId = form.querySelector('#projectIdInput')?.value;
    const isEditing = !!projectId;
    const formData = {
        name: form.querySelector('#projectNameInput')?.value.trim(),
        description: form.querySelector('#projectDescInput')?.value.trim(),
        goals: form.querySelector('#projectGoalsInput')?.value.trim(),
        max_tokens: parseInt(form.querySelector('#projectMaxTokensInput')?.value, 10),
    };

    if (!formData.name) {
        window.showNotification?.('Project name is required', 'error');
        return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    const originalButtonText = submitButton?.textContent;
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.innerHTML = `<span class="loading loading-spinner loading-xs"></span> Saving...`;
    }

    try {
        if (!window.projectManager?.createOrUpdateProject) {
            throw new Error('Project manager service unavailable');
        }
        window.projectManager
            .createOrUpdateProject(projectId, formData)
            .then(() => {
                window.showNotification?.(isEditing ? 'Project updated' : 'Project created', 'success');
                if (modalDialog && typeof modalDialog.close === 'function') {
                    modalDialog.close();
                } else {
                    window.modalManager?.hide('project');
                }
                window.projectManager?.loadProjects('all');
            })
            .catch(err => {
                console.error('[ProjectDashboard] Error saving project:', err);
                window.showNotification?.(`Failed to save project: ${err.message || 'Unknown error'}`, 'error');
                const errorDiv = form.querySelector('.modal-error-display');
                if (errorDiv) {
                    errorDiv.textContent = `Error: ${err.message || 'Unknown error'}`;
                    errorDiv.classList.remove('hidden');
                }
            })
            .finally(() => {
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.innerHTML = originalButtonText;
                }
            });
    } catch (err) {
        console.error('[ProjectDashboard] Error saving project:', err);
        window.showNotification?.(`Failed to save project: ${err.message || 'Unknown error'}`, 'error');
    }
}

/**
 * Set up sidebar toggle functionality with touch gestures
 * @returns {boolean} - True if setup is successful, false otherwise
 */
function setupSidebarToggle() {
    const sidebar = document.getElementById('mainSidebar');
    const toggleBtn = document.getElementById('navToggleBtn');
    const closeBtn = document.getElementById('closeSidebarBtn');

    if (!sidebar) {
        console.warn('Sidebar element not found in DOM');
        return false;
    }

    // Add transition end handler to manage animation state
    function handleTransitionEnd() {
        if (window.sidebar) {
            window.sidebar.isAnimating = false;
        }
    }
    trackListener(sidebar, 'transitionend', handleTransitionEnd);

    // Track close button click - no duplicate logic
    if (closeBtn) {
        trackListener(closeBtn, 'click', () => {
            if (window.toggleSidebar) {
                window.toggleSidebar(false);
            }
        });
    }

    // Setup touch gestures for mobile
    let touchStartX = 0;
    const threshold = 30; // Minimum horizontal swipe distance

    // Track touch start position with proper passive handling
    const touchStartHandler = (e) => {
        touchStartX = e.touches[0].clientX;
    };
    trackListener(document, 'touchstart', touchStartHandler, { passive: true });

    // Handle edge swipe to open/close
    const touchEndHandler = (e) => {
        const touchEndX = e.changedTouches[0].clientX;
        const deltaX = touchEndX - touchStartX;
        const isMobile = window.innerWidth < 768;

        if (!isMobile) return;

        // Edge swipe from left to right to open sidebar
        if (touchStartX < 50 && deltaX > threshold) {
            if (window.toggleSidebar) {
                window.toggleSidebar(true);
            }
            e.preventDefault();
        } else if (window.sidebar?.isOpen && touchStartX > window.innerWidth - 50 && deltaX < -threshold) {
            // Edge swipe from right to left to close sidebar when open
            if (window.toggleSidebar) {
                window.toggleSidebar(false);
            }
            e.preventDefault();
        }
    };
    trackListener(document, 'touchend', touchEndHandler, { passive: false });

    // Handle toggle button click
    if (toggleBtn) {
        trackListener(toggleBtn, 'click', (e) => {
            e.stopPropagation();
            if (window.toggleSidebar) {
                window.toggleSidebar();
            }
        });

        // Add keyboard accessibility
        trackListener(toggleBtn, 'keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (window.toggleSidebar) {
                    window.toggleSidebar();
                }
            }
        });
    }

    // Track window resize for responsive behavior
    trackListener(window, 'resize', () => {
        const isMobile = window.innerWidth < 768;

        // Auto-close on mobile resize
        if (isMobile && window.sidebar?.isOpen) {
            if (window.toggleSidebar) {
                window.toggleSidebar(false);
            }
        }

        // Always open on desktop
        if (!isMobile && window.sidebar) {
            window.sidebar.isOpen = true;
            if (window.updateSidebarState) {
                window.updateSidebarState();
            }
        }
    });

    return true;
}

/**
 * Set up tab navigation in the sidebar
 * @returns {void}
 */
function setupSidebarTabs() {
    // Use sidebar.js tab configuration if available
    if (window.sidebar && typeof window.sidebar.setupTabs === 'function') {
        // Use sidebar's own setup if available
        window.sidebar.setupTabs();
        return;
    }

    // Fallback binding of tab click events if needed
    const tabIds = ['recentChatsTab', 'starredChatsTab', 'projectsTab'];
    tabIds.forEach(id => {
        const button = document.getElementById(id);
        if (button) {
            trackListener(button, 'click', () => {
                const tabName = id.replace('Tab', '').replace('Chats', '');
                localStorage.setItem('sidebarActiveTab', tabName);

                // Let sidebar.js handle the tab activation
                if (window.sidebar && typeof window.sidebar.activateTab === 'function') {
                    window.sidebar.activateTab(tabName);
                }
            });
        }
    });
}

/**
 * Set up search functionality for conversations and projects
 * @returns {void}
 */
function setupSearch() {
    const chatSearchInput = document.getElementById('chatSearchInput');
    if (chatSearchInput) {
        trackListener(chatSearchInput, 'input', debounce((e) => {
            // Use sidebar.js implementation
            window.sidebar?.searchSidebarConversations?.(e.target.value);
        }, 300));
    }

    const projectSearchInput = document.getElementById('sidebarProjectSearch');
    if (projectSearchInput) {
        trackListener(projectSearchInput, 'input', debounce((e) => {
            // Use sidebar.js implementation without fallback
            window.sidebar?.searchSidebarProjects?.(e.target.value);
        }, 300));
    }
}

/**
 * Set up a single collapsible section
 * @param {string} toggleId - ID of the toggle button
 * @param {string} panelId - ID of the panel to toggle
 * @param {string} chevronId - ID of the chevron icon
 * @param {Function} [onExpand] - Optional callback when panel is expanded
 * @returns {void}
 */
function setupCollapsibleSection(toggleId, panelId, chevronId, onExpand) {
    try {
        const toggleButton = document.getElementById(toggleId);
        const panel = document.getElementById(panelId);
        const chevron = document.getElementById(chevronId);

        if (!toggleButton || !panel || !chevron) {
            console.warn(`Collapsible section elements not found: ${toggleId}, ${panelId}, ${chevronId}`);
            return;
        }

        // Set up keyboard interaction
        toggleButton.setAttribute('role', 'button');
        toggleButton.setAttribute('aria-expanded', 'false');
        toggleButton.setAttribute('aria-controls', panelId);

        // Load saved state
        const isExpanded = localStorage.getItem(`${toggleId}_expanded`) === 'true';

        // Apply initial state
        panel.classList.add('collapsible-panel');

        if (isExpanded) {
            panel.classList.add('max-h-[500px]');
            panel.style.maxHeight = 'max-content';
            chevron.style.transform = 'rotate(180deg)';
            toggleButton.setAttribute('aria-expanded', 'true');

            // Call onExpand callback if provided
            if (typeof onExpand === 'function') {
                setTimeout(onExpand, 100);
            }
        } else {
            panel.classList.add('max-h-0');
            panel.style.maxHeight = '0px';
            chevron.style.transform = 'rotate(0deg)';
        }

        // Add click handler with proper tracking
        trackListener(toggleButton, 'click', () => {
            const isCurrentlyExpanded = panel.classList.contains('max-h-[500px]');

            if (isCurrentlyExpanded) {
                // Collapse
                panel.style.maxHeight = '0px';
                panel.classList.remove('max-h-[500px]');
                chevron.style.transform = 'rotate(0deg)';
                toggleButton.setAttribute('aria-expanded', 'false');
                localStorage.setItem(`${toggleId}_expanded`, 'false');
            } else {
                // Expand
                panel.style.maxHeight = 'max-content';
                panel.classList.add('max-h-[500px]');
                chevron.style.transform = 'rotate(180deg)';
                toggleButton.setAttribute('aria-expanded', 'true');
                localStorage.setItem(`${toggleId}_expanded`, 'true');

                // Call onExpand callback if provided
                if (typeof onExpand === 'function') {
                    onExpand();
                }
            }
        });
    } catch (error) {
        console.error(`Error setting up collapsible section ${toggleId}:`, error);
    }
}

/**
 * Set up multiple collapsible sections
 * @returns {void}
 */
function setupCollapsibleSections() {
    const sections = [
        {
            toggleId: 'toggleModelConfig',
            panelId: 'modelConfigPanel',
            chevronId: 'modelConfigChevron',
            onExpand: () => window.initializeModelDropdown?.(),
        },
        {
            toggleId: 'toggleCustomInstructions',
            panelId: 'customInstructionsPanel',
            chevronId: 'customInstructionsChevron',
        },
    ];

    sections.forEach(section => {
        setupCollapsibleSection(
            section.toggleId,
            section.panelId,
            section.chevronId,
            section.onExpand
        );
    });
}

/**
 * Set up sidebar pinning functionality
 * @returns {void}
 */
function setupPinningSidebar() {
    try {
        const pinButton = document.getElementById('pinSidebarBtn');
        const sidebar = document.getElementById('mainSidebar');

        if (!pinButton) {
            console.debug('Pin button element not found in DOM - pinning functionality disabled');
            return;
        }

        if (!sidebar) {
            console.warn('Sidebar element not initialized - pinning functionality disabled');
            return;
        }

        const isPinned = localStorage.getItem('sidebarPinned') === 'true';
        if (isPinned) {
            pinButton.classList.add('text-yellow-500');
            const svg = pinButton.querySelector('svg');
            if (svg) svg.setAttribute('fill', 'currentColor');
            document.body.classList.add('pinned-sidebar');
        }

        trackListener(pinButton, 'click', () => {
            const isPinnedNow = document.body.classList.contains('pinned-sidebar');
            if (isPinnedNow) {
                document.body.classList.remove('pinned-sidebar');
                pinButton.classList.remove('text-yellow-500');
                const svg = pinButton.querySelector('svg');
                if (svg) svg.setAttribute('fill', 'none');
                localStorage.setItem('sidebarPinned', 'false');
            } else {
                document.body.classList.add('pinned-sidebar');
                pinButton.classList.add('text-yellow-500');
                const svg = pinButton.querySelector('svg');
                if (svg) svg.setAttribute('fill', 'currentColor');
                localStorage.setItem('sidebarPinned', 'true');
            }
        });
    } catch (error) {
        console.error('Error initializing sidebar pinning:', error);
    }
}

/**
 * Set up custom instructions functionality
 * @returns {void}
 */
function setupCustomInstructions() {
    const instructionsTextarea = document.getElementById('globalCustomInstructions');
    const saveButton = document.getElementById('saveGlobalInstructions');

    if (!instructionsTextarea || !saveButton) {
        console.warn('Custom instructions elements not found in the DOM');
        return;
    }

    instructionsTextarea.value = localStorage.getItem('globalCustomInstructions') || '';
    trackListener(saveButton, 'click', () => {
        const instructions = instructionsTextarea.value;
        localStorage.setItem('globalCustomInstructions', instructions);
        if (window.MODEL_CONFIG) {
            window.MODEL_CONFIG.customInstructions = instructions;
        }
        document.dispatchEvent(
            new CustomEvent('modelConfigChanged', {
                detail: {
                    customInstructions: instructions,
                    timestamp: Date.now(),
                },
            })
        );
        window.showNotification?.('Custom instructions saved and applied to chat', 'success') ||
            console.log('Custom instructions saved');
    });
}

/**
 * Main function for setting up all event listeners
 * @returns {void}
 */
function handleAuthStateChanged(e) {
    const { authenticated } = e.detail;
    const authButton = document.getElementById('authButton');
    const userMenu = document.getElementById('userMenu');
    if (authenticated) {
        authButton?.classList.add('hidden');
        userMenu?.classList.remove('hidden');
    } else {
        authButton?.classList.remove('hidden');
        userMenu?.classList.add('hidden');
    }
}

function setupEventListeners() {
    cleanupListeners(); // Clean up existing listeners to prevent duplicates
    window.auth.AuthBus.addEventListener('authStateChanged', handleAuthStateChanged);

    // Prevent any knowledge base modals from auto-opening
    document.querySelectorAll('[data-kb-debug="true"]').forEach(modal => {
        if (modal.open) {
            console.warn('Knowledge base modal was auto-opened, closing it');
            modal.close();
        }
    });

    // Setup key shortcuts
    trackListener(document, 'keydown', handleKeyDown);

    // Listen for backend unavailability events from the central AuthBus
    window.auth.AuthBus.addEventListener('backendUnavailable', handleBackendUnavailable);

    // Set up sidebar components if they exist
    setupSidebarToggle();
    setupSidebarTabs();
    setupSearch();
    setupCollapsibleSections();
    setupPinningSidebar();
    setupCustomInstructions();

    // Set up additional UI interactions
    const projectForm = document.getElementById('projectForm');
    if (projectForm) {
        trackListener(projectForm, 'submit', handleProjectFormSubmit);
    }

    const newProjectBtn = document.getElementById('sidebarNewProjectBtn');
    if (newProjectBtn) {
        trackListener(newProjectBtn, 'click', () => {
            window.modalManager?.show('project', {});
        });
    }

    const showLoginBtn = document.getElementById('showLoginBtn');
    const authButton = document.getElementById('authButton');
    if (showLoginBtn && authButton) {
        trackListener(showLoginBtn, 'click', () => authButton.click());
    }

    // Register events from the registry (document-level delegation)
    Object.entries(eventRegistry).forEach(([selector, config]) => {
        trackListener(document, config.eventType, (event) => {
            if (event.target.closest(selector)) {
                config.handler(event);
            }
        }, {
            priority: config.priority,
            description: config.description
        });
    });

    // Add any non-delegated event handlers

    // Navigation tracking for page interactions
    function recordInteraction() {
        sessionStorage.setItem('last_page_interaction', Date.now().toString());
    }
    trackListener(document, 'click', (e) => {
        if (
            e.target.closest('a[href*="project"]') ||
            e.target.closest('button[data-action*="project"]') ||
            e.target.closest('#manageDashboardBtn') ||
            e.target.closest('#projectsNav')
        ) {
            recordInteraction();
        }
    }, {
        priority: EVENT_PRIORITIES.BACKGROUND,
        description: 'Tracks user navigation interactions'
    });
    trackListener(window, 'beforeunload', recordInteraction, {
        priority: EVENT_PRIORITIES.CRITICAL,
        description: 'Records final interaction before page unload'
    });
    recordInteraction();
}

// Export to window for integration with other modules
window.eventHandlers = {
    init: setupEventListeners,
    trackListener: trackListener,
    cleanupListeners: cleanupListeners,
    handleProjectFormSubmit: handleProjectFormSubmit,
    handleNewConversationClick: handleNewConversationClick,
    handleBackendUnavailable: handleBackendUnavailable,
    setupCollapsibleSection: setupCollapsibleSection,
    setupCollapsibleSections: setupCollapsibleSections,
    setupPinningSidebar: setupPinningSidebar,
    setupCustomInstructions: setupCustomInstructions,
    debounce // re‑exported debounce
};
