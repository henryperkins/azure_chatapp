/**
 * eventHandler.js - Centralized module for managing all event listeners across the application.
 * Provides a unified system for setting up, tracking, and cleaning up event listeners.
 * Integrates with Sentry for errors and performance metrics.
 *
 * Event Types:
 *  - DOM Events: click, keydown, submit, etc.
 *  - Custom Events: backendUnavailable, modelConfigChanged, etc.
 *  - Window Events: beforeunload, resize, etc.
 */

console.log("[eventHandler.js] Script loaded, beginning setup...");

// -------------------------------------------------------------------------------------------------
// Priority Levels
// -------------------------------------------------------------------------------------------------
const EVENT_PRIORITIES = {
    CRITICAL: 1,
    HIGH: 3,
    DEFAULT: 5,
    LOW: 7,
    BACKGROUND: 9,
};

// -------------------------------------------------------------------------------------------------
// Tracking & Utilities
// -------------------------------------------------------------------------------------------------

/**
 * Stores all registered event listeners for cleanup.
 */
const trackedListeners = new Set();

/**
 * Utility object to unify frequently reused patterns:
 *  - DOM element queries
 *  - Notifications
 *  - Auth checks
 *  - LocalStorage-based state
 *  - Error handling wrappers
 */
const Utils = {
    getElement(selector, warn = true) {
        if (!selector) return null;
        const el = typeof selector === "string" ? document.querySelector(selector) : selector;
        if (!el && warn) {
            console.warn(`[Utils.getElement] Element not found:`, selector);
        }
        return el;
    },

    notify(message, type = "info", duration) {
        if (window.showNotification) {
            window.showNotification(message, type, duration);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    },

    async verifyAuth(options = {}) {
        if (!window.auth?.isReady) {
            await window.auth?.init();
        }
        return window.auth.isAuthenticated(options);
    },

    persistentState(key, defaultValue) {
        return {
            get() {
                const stored = localStorage.getItem(key);
                return stored !== null ? JSON.parse(stored) : defaultValue;
            },
            set(value) {
                localStorage.setItem(key, JSON.stringify(value));
            },
        };
    },

    toggleClasses(element, classes, force) {
        if (!element) return;
        const clsArray = Array.isArray(classes) ? classes : [classes];
        clsArray.forEach((cls) => {
            element.classList.toggle(cls, force);
        });
    },

    withErrorHandling(fn, context = "Function") {
        return async (...args) => {
            try {
                return await fn(...args);
            } catch (error) {
                console.error(`[${context}] Error:`, error);
                Utils.notify(error.message || "Operation failed", "error");
                throw error;
            }
        };
    },
};

/**
 * Form utilities: centralize repeated input gathering and field validation.
 */
const FormUtils = {
    /**
     * Return a values object, given a form and config like:
     * { username: { required: true, trim: true }, password: { required: true } }
     */
    getFormValues(form, fieldConfig) {
        const values = {};
        for (const [name, config] of Object.entries(fieldConfig)) {
            const element =
                form.elements[name] ||
                form.querySelector(`[name="${name}"]`) ||
                null;
            let value = element?.value;

            if (config.trim) value = value?.trim();
            if (config.required && !value) {
                Utils.notify(`${name} is required`, "error");
                throw new Error(`Missing required field: ${name}`);
            }
            values[name] = value;
        }
        return values;
    },
};

/**
 * Additional UI helpers, e.g., for showing global status indicators.
 */
const UIUtils = {
    showStatusIndicator(message, until) {
        // Remove existing indicators
        document
            .querySelectorAll(".backend-unavailable-indicator")
            .forEach((el) => el.remove());

        // Create a new indicator
        const indicator = document.createElement("div");
        indicator.className =
            "backend-unavailable-indicator fixed bottom-4 right-4 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 shadow-lg rounded z-50 fade-in";
        indicator.innerHTML = `
      <div class="flex">
        <div class="flex-shrink-0">
          <svg class="h-5 w-5 text-yellow-500" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
          </svg>
        </div>
        <div class="ml-3">
          <p class="text-sm">${message}</p>
        </div>
      </div>
    `;
        document.body.appendChild(indicator);

        // Remove after circuit breaker or default
        if (until instanceof Date) {
            const timeoutMs = Math.max(100, until.getTime() - Date.now());
            setTimeout(() => {
                indicator.classList.add("fade-out");
                setTimeout(() => indicator.remove(), 1000);
            }, timeoutMs);
        }
    },
};

/**
 * Debounce function for limiting event firing frequency.
 */
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// -------------------------------------------------------------------------------------------------
// Sentry/Performance Wrapping - Additional Dedup
// -------------------------------------------------------------------------------------------------

/**
 * A helper that wraps a raw event handler to apply:
 * - Sentry transaction start/finish
 * - Performance measurement
 * - Passive listener error handling
 */
const SentryPerformance = {
    wrapHandler(type, element, handler, options = {}) {
        return function (event) {
            // If passive but event is cancelable, warn
            if (options.passive && event.cancelable === false) {
                console.warn(
                    `[EventHandler] Warning: ${type} event on ${element.id || element.tagName
                    } is passive but may need preventDefault.`
                );
            }

            // Start Sentry transaction
            const transaction = window.Sentry?.startTransaction({
                name: `event.${type}`,
                op: "ui.interaction",
                tags: {
                    element: element.id || element.className || element.tagName,
                    handler: options.description || handler.name || "(anonymous)",
                },
            });
            const startTime = performance.now();
            performance.mark(`${type}_handler_start`);

            try {
                // Execute user-provided event handler
                handler(event);

                // Add breadcrumb to Sentry
                if (window.Sentry) {
                    Sentry.addBreadcrumb({
                        category: "event",
                        message: `Handled ${type} event`,
                        level: "info",
                        data: {
                            element: element.id || element.className || element.tagName,
                            handler: options.description || handler.name || "(anonymous)",
                        },
                    });
                }
            } catch (error) {
                if (error instanceof DOMException && error.message.includes("passive")) {
                    // Handle the special passive-listener-preventDefault error
                    SentryPerformance.handlePassiveListenerError(
                        error,
                        event,
                        element,
                        type,
                        this,
                        options
                    );
                } else {
                    console.error(`Error in ${type} handler:`, error);
                    if (window.Sentry) {
                        Sentry.withScope((scope) => {
                            scope.setTag("event_type", type);
                            scope.setContext("element", {
                                id: element.id,
                                class: element.className,
                                tagName: element.tagName,
                                html: element.outerHTML.slice(0, 1000),
                            });
                            scope.setContext("handler", {
                                description: options.description || "",
                                originalName: handler.name || "(anonymous)",
                                source: handler.toString().slice(0, 500),
                            });
                            scope.setLevel("error");
                            Sentry.captureException(error);
                        });
                    }
                }
            } finally {
                const duration = performance.now() - startTime;
                performance.measure(`${type}_handler_duration`, {
                    start: `${type}_handler_start`,
                    duration,
                });

                if (duration > 100) {
                    console.warn(`Slow ${type} handler took ${duration.toFixed(2)}ms`);
                    if (window.Sentry) {
                        Sentry.captureMessage(`Slow event handler for '${type}'`, {
                            level: "warning",
                            contexts: {
                                performance: {
                                    duration_ms: duration,
                                    element: element.id || element.className || element.tagName,
                                },
                            },
                        });
                    }
                }
                transaction?.finish();
            }
        };
    },

    /**
     * Recovery logic if preventDefault() was called in a passive listener.
     */
    handlePassiveListenerError(error, event, element, type, originalFn, options) {
        console.error(
            `[EventHandler] preventDefault called within passive listener for ${type} on ${element.id || element.tagName
            }. Consider setting passive: false.`
        );
        // Attempt to remove and re-add as a non-passive listener
        if (event.cancelable) {
            console.info("[EventHandler] Removing and re-adding non-passive listener");
            element.removeEventListener(type, originalFn, options);
            const recoveryOptions = { ...options, passive: false };
            element.addEventListener(type, originalFn, recoveryOptions);
        }
    },
};

// -------------------------------------------------------------------------------------------------
// trackListener & cleanupListeners
// -------------------------------------------------------------------------------------------------

/**
 * Register an event listener, wrapping the user handler with SentryPerformance logic
 * and storing references for cleanup.
 */
function trackListener(element, type, handler, options = {}) {
    if (!element) return;

    // Some events typically need to be cancelable by default
    const eventsThatNeedCancelable = ["submit", "click"];
    if (eventsThatNeedCancelable.includes(type) && options.passive !== true) {
        options.passive = false;
    }

    const wrappedHandler = SentryPerformance.wrapHandler(type, element, handler, options);
    const finalOpts = { ...options, passive: options.passive ?? true };

    element.addEventListener(type, wrappedHandler, finalOpts);
    trackedListeners.add({
        element,
        type,
        handler: wrappedHandler,
        options: finalOpts,
        originalHandler: handler,
        description: options.description || "",
    });
}

/**
 * Remove all tracked listeners, clearing out the event system.
 */
function cleanupListeners() {
    trackedListeners.forEach(({ element, type, handler, options }) => {
        element.removeEventListener(type, handler, options);
    });
    trackedListeners.clear();
}

// -------------------------------------------------------------------------------------------------
// Additional Helper Functions (to remove duplication in collapsible or repeated notify patterns)
// -------------------------------------------------------------------------------------------------

/**
 * Toggle a collapsible panel (expand or collapse) for setupCollapsibleSection.
 */
function togglePanel(panel, chevron, toggleButton, expand, onExpand) {
    if (!panel || !chevron || !toggleButton) return;
    if (expand) {
        panel.style.maxHeight = "max-content";
        Utils.toggleClasses(panel, ["max-h-[500px]", "max-h-0"], true);
        chevron.style.transform = "rotate(180deg)";
        toggleButton.setAttribute("aria-expanded", "true");
        if (typeof onExpand === "function") {
            onExpand();
        }
    } else {
        panel.style.maxHeight = "0px";
        panel.classList.remove("max-h-[500px]");
        panel.classList.add("max-h-0");
        chevron.style.transform = "rotate(0deg)";
        toggleButton.setAttribute("aria-expanded", "false");
    }
}

/**
 * A convenience method to run an async operation with consistent user feedback.
 */
async function runAsyncWithUserFeedback(operation, { successMsg, errorContext }) {
    try {
        const result = await operation();
        if (successMsg) {
            Utils.notify(successMsg, "success");
        }
        return result;
    } catch (err) {
        console.error(`[${errorContext}]`, err);
        Utils.notify(err.message || "Operation failed", "error");
        throw err;
    }
}

// -------------------------------------------------------------------------------------------------
// Specialized Handlers
// -------------------------------------------------------------------------------------------------

function handleKeyDown(e) {
    // Example: Ctrl/Cmd + R => regenerateChat
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        if (e.key.toLowerCase() === "r") {
            e.preventDefault();
            document.dispatchEvent(new CustomEvent("regenerateChat"));
        }
        if (e.key.toLowerCase() === "c") {
            e.preventDefault();
            document.dispatchEvent(new CustomEvent("copyMessage"));
        }
    }
}

function handleAuthStateChanged(e) {
    // Merge app.js logic:
    // app.js (lines ~879-915) had a more extensive handleAuthStateChange:
    //   - updates API_CONFIG.isAuthenticated
    //   - toggles UI elements
    //   - calls refreshAppData() if newly authenticated
    //   - ensures chat UI is hidden if logged out, shows project list, etc.

    const { authenticated, username } = e.detail || {};
    // core app config
    if (window.API_CONFIG) {
        window.API_CONFIG.isAuthenticated = authenticated;
    }

    const authButton = document.getElementById("authButton");
    const userMenu = document.getElementById("userMenu");

    if (authenticated) {
        authButton?.classList.add("hidden");
        userMenu?.classList.remove("hidden");

        // Trigger a refresh if newly authenticated
        if (typeof window.refreshAppData === "function") {
            window.refreshAppData();
        }
    } else {
        authButton?.classList.remove("hidden");
        userMenu?.classList.add("hidden");

        // If user logged out, show project list & hide chat UI
        if (typeof window.showProjectListView === "function") {
            window.showProjectListView();
        }
        const chatUI = document.getElementById("globalChatUI");
        const noChatMsg = document.getElementById("noChatSelectedMessage");
        if (chatUI && noChatMsg) {
            chatUI.classList.add("hidden");
            noChatMsg.classList.remove("hidden");
        }
    }
}

function handleBackendUnavailable(event) {
    // Merge additional banner logic from app.js handleBackendUnavailable (lines ~724-754).
    const { until, reason, error } = event.detail || {};
    const untilTime = until?.toLocaleTimeString?.() || "unknown time";
    const message = `Backend service unavailable: ${reason || "unknown reason"}. Will retry after ${untilTime}.`;

    console.warn("[EventHandler] " + message);
    Utils.notify(message, "warning", 8000);
    UIUtils.showStatusIndicator(message, until);

    // Additional banner injection from app.js:
    const warningHtml = `
    <div class="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-4" role="alert">
      <p class="font-bold">⚠️ Connection Issue</p>
      <p>The backend service is currently unreachable. Please check if the server is running.</p>
    </div>
    `;

    const keySections = ["projectsSection", "recentChatsSection", "starredChatsSection"];
    keySections.forEach((sectionId) => {
      const section = document.getElementById(sectionId);
      if (section && !section.querySelector(".border-yellow-500")) {
        const container = document.createElement("div");
        container.innerHTML = warningHtml;
        section.prepend(container.firstElementChild);
      }
    });
}

async function handleNewConversationClick() {
    try {
        // Check authentication
        const isAuthenticated = await Utils.verifyAuth({ forceVerify: false });
        if (!isAuthenticated) {
            Utils.notify("Please log in to create a conversation", "error");
            return;
        }

        if (!window.projectManager?.createConversation) {
            throw new Error("Conversation creation service unavailable");
        }
        const newConversation = await window.projectManager.createConversation(null);
        window.location.href = "/?chatId=" + newConversation.id;
    } catch (err) {
        console.error("Error creating conversation:", err);
        if (err.status === 401) {
            Utils.notify("Session expired. Please log in again.", "error");
        } else {
            Utils.notify(`Failed to create conversation: ${err.message || "Unknown error"}`, "error");
        }
    }
}

function handleProjectFormSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const modalDialog = form.closest("dialog");
    const projectId = form.querySelector("#projectIdInput")?.value;
    const isEditing = !!projectId;
    const formData = {
        name: form.querySelector("#projectNameInput")?.value.trim(),
        description: form.querySelector("#projectDescInput")?.value.trim(),
        goals: form.querySelector("#projectGoalsInput")?.value.trim(),
        max_tokens: parseInt(form.querySelector("#projectMaxTokensInput")?.value, 10),
    };

    if (!formData.name) {
        Utils.notify("Project name is required", "error");
        return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    const originalButtonText = submitButton?.textContent;
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.innerHTML = `<span class="loading loading-spinner loading-xs"></span> Saving...`;
    }

    if (!window.projectManager?.createOrUpdateProject) {
        console.error("[ProjectDashboard] createOrUpdateProject not available");
        Utils.notify("Project manager service unavailable", "error");
        return;
    }

    runAsyncWithUserFeedback(() =>
        window.projectManager.createOrUpdateProject(projectId, formData),
        {
            successMsg: isEditing ? "Project updated" : "Project created",
            errorContext: "Project Creation/Update",
        }
    )
        .then(() => {
            if (modalDialog && typeof modalDialog.close === "function") {
                modalDialog.close();
            } else {
                window.modalManager?.hide("project");
            }
            window.projectManager?.loadProjects("all");
        })
        .finally(() => {
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.innerHTML = originalButtonText;
            }
        });
}

function toggleAuthDropdown() {
    console.log("[toggleAuthDropdown] fired");
    const dropdown = document.getElementById("authDropdown");
    if (!dropdown) {
        console.log("[toggleAuthDropdown] #authDropdown not found");
        return;
    }
    dropdown.classList.toggle("hidden");
}

// -------------------------------------------------------------------------------------------------
// Collapsible Sections Setup
// -------------------------------------------------------------------------------------------------

function setupCollapsibleSection(toggleId, panelId, chevronId, onExpand) {
    const toggleButton = Utils.getElement(toggleId);
    const panel = Utils.getElement(panelId);
    const chevron = Utils.getElement(chevronId);
    if (!toggleButton || !panel || !chevron) return;

    toggleButton.setAttribute("role", "button");
    toggleButton.setAttribute("aria-controls", panelId);

    const state = Utils.persistentState(`${toggleId}_expanded`, false);
    // Initialize
    panel.classList.add("collapsible-panel");

    const isExpanded = state.get();
    togglePanel(panel, chevron, toggleButton, isExpanded, onExpand);

    // Click to toggle
    trackListener(toggleButton, "click", () => {
        // Flip current state
        const expandNow = !panel.classList.contains("max-h-[500px]");
        togglePanel(panel, chevron, toggleButton, expandNow, onExpand);
        state.set(expandNow);
    });
}

// -------------------------------------------------------------------------------------------------
// Setup helpers for sidebar, searches, pinning, etc.
// -------------------------------------------------------------------------------------------------

const SetupHelpers = {
    setupCollapsibleSections() {
        const sections = [
            {
                toggleId: "toggleModelConfig",
                panelId: "modelConfigPanel",
                chevronId: "modelConfigChevron",
                onExpand: () => window.initializeModelDropdown?.(),
            },
            {
                toggleId: "toggleCustomInstructions",
                panelId: "customInstructionsPanel",
                chevronId: "customInstructionsChevron",
            },
        ];
        sections.forEach((sec) =>
            setupCollapsibleSection(sec.toggleId, sec.panelId, sec.chevronId, sec.onExpand)
        );
    },

    setupSidebarToggle() {
        const sidebar = Utils.getElement("mainSidebar");
        const toggleBtn = Utils.getElement("navToggleBtn");
        const closeBtn = Utils.getElement("closeSidebarBtn");
        if (!sidebar) {
            console.warn("Sidebar element not found");
            return false;
        }

        // Transition tracking
        trackListener(sidebar, "transitionend", () => {
            if (window.sidebar) {
                window.sidebar.isAnimating = false;
            }
        });

        // Close button
        if (closeBtn) {
            trackListener(closeBtn, "click", () => {
                window.toggleSidebar?.(false);
            });
        }

        // Touch gestures
        let touchStartX = 0;
        const threshold = 30;
        trackListener(
            document,
            "touchstart",
            (e) => {
                touchStartX = e.touches[0].clientX;
            },
            { passive: true }
        );
        trackListener(
            document,
            "touchend",
            (e) => {
                const touchEndX = e.changedTouches[0].clientX;
                const deltaX = touchEndX - touchStartX;
                const isMobile = window.innerWidth < 768;
                if (!isMobile) return;

                if (touchStartX < 50 && deltaX > threshold) {
                    window.toggleSidebar?.(true);
                    e.preventDefault();
                } else if (
                    window.sidebar?.isOpen &&
                    touchStartX > window.innerWidth - 50 &&
                    deltaX < -threshold
                ) {
                    window.toggleSidebar?.(false);
                    e.preventDefault();
                }
            },
            { passive: false }
        );

        // Toggle button
        if (toggleBtn) {
            trackListener(toggleBtn, "click", (e) => {
                e.stopPropagation();
                window.toggleSidebar?.();
            });
            trackListener(toggleBtn, "keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    window.toggleSidebar?.();
                }
            });
        }

        // Resize
        trackListener(window, "resize", () => {
            const isMobile = window.innerWidth < 768;
            if (isMobile && window.sidebar?.isOpen) {
                window.toggleSidebar?.(false);
            }
            if (!isMobile && window.sidebar) {
                window.sidebar.isOpen = true;
                window.updateSidebarState?.();
            }
        }, { passive: true });

        return true;
    },

    setupSidebarTabs() {
        if (window.sidebar && typeof window.sidebar.setupTabs === "function") {
            window.sidebar.setupTabs();
            return;
        }
        const tabIds = ["recentChatsTab", "starredChatsTab", "projectsTab"];
        tabIds.forEach((id) => {
            const button = Utils.getElement(id);
            if (button) {
                trackListener(button, "click", () => {
                    const tabName = id.replace("Tab", "").replace("Chats", "");
                    localStorage.setItem("sidebarActiveTab", tabName);
                    window.sidebar?.activateTab?.(tabName);
                });
            }
        });
    },


    setupPinningSidebar() {
        const pinButton = Utils.getElement("pinSidebarBtn");
        const sidebar = Utils.getElement("mainSidebar");
        if (!pinButton) {
            console.debug("Pin button not found - pinning disabled");
            return;
        }
        if (!sidebar) {
            console.warn("Sidebar not found - pinning disabled");
            return;
        }

        const pinnedState = Utils.persistentState("sidebarPinned", false);
        const isPinned = pinnedState.get();
        if (isPinned) {
            pinButton.classList.add("text-yellow-500");
            pinButton.querySelector("svg")?.setAttribute("fill", "currentColor");
            document.body.classList.add("pinned-sidebar");
        }

        trackListener(pinButton, "click", () => {
            const wasPinned = document.body.classList.contains("pinned-sidebar");
            if (wasPinned) {
                document.body.classList.remove("pinned-sidebar");
                pinButton.classList.remove("text-yellow-500");
                pinButton.querySelector("svg")?.setAttribute("fill", "none");
                pinnedState.set(false);
            } else {
                document.body.classList.add("pinned-sidebar");
                pinButton.classList.add("text-yellow-500");
                pinButton.querySelector("svg")?.setAttribute("fill", "currentColor");
                pinnedState.set(true);
            }
        });
    },

    setupCustomInstructions() {
        const instructionsTextarea = Utils.getElement("globalCustomInstructions");
        const saveButton = Utils.getElement("saveGlobalInstructions");
        if (!instructionsTextarea || !saveButton) {
            console.warn("Custom instructions elements not found");
            return;
        }

        instructionsTextarea.value = localStorage.getItem("globalCustomInstructions") || "";

        trackListener(saveButton, "click", () => {
            const instructions = instructionsTextarea.value;
            localStorage.setItem("globalCustomInstructions", instructions);
            if (window.MODEL_CONFIG) {
                window.MODEL_CONFIG.customInstructions = instructions;
            }
            document.dispatchEvent(
                new CustomEvent("modelConfigChanged", {
                    detail: {
                        customInstructions: instructions,
                        timestamp: Date.now(),
                    },
                })
            );
            Utils.notify("Custom instructions saved and applied to chat", "success");
        });
    },
};

// -------------------------------------------------------------------------------------------------
// Event Registry
// -------------------------------------------------------------------------------------------------
/**
 * A lookup for event delegation. We attach each as a delegated handler on 'document',
 * matching the closest element to `selector`.
 */
const eventRegistry = {
    "#loginForm": {
        handler: Utils.withErrorHandling(async (e) => {
            e.preventDefault();
            const form = e.target;
            const usernameInput = form.elements["username"] || form.querySelector("#username");
            const passwordInput = form.elements["password"] || form.querySelector("#password");
            const username = usernameInput?.value?.trim();
            const password = passwordInput?.value;

            console.debug("[LoginForm] Values:", { username, password });
            if (!username || !password) {
                console.warn("[LoginForm] Validation failed - missing fields");
                Utils.notify("Username and password are required", "error");
                return;
            }
            await Utils.verifyAuth();
            await window.auth.login(username, password);
        }, "LoginForm"),
        eventType: "submit",
        priority: EVENT_PRIORITIES.CRITICAL,
        description: "Handles login form submission",
        passive: false,
    },
    "#registerForm": {
        handler: Utils.withErrorHandling(async (e) => {
            e.preventDefault();
            await Utils.verifyAuth();
            await window.auth.register(new FormData(e.target));
        }, "RegisterForm"),
        eventType: "submit",
        priority: EVENT_PRIORITIES.CRITICAL,
        description: "Handles registration form submission",
        passive: false,
    },
    "#newConversationBtn": {
        handler: handleNewConversationClick,
        eventType: "click",
        priority: EVENT_PRIORITIES.DEFAULT,
        description: "Creates a new conversation after auth check",
    },
    "#createProjectBtn": {
        handler: () => window.modalManager?.show("project", {}),
        eventType: "click",
        priority: EVENT_PRIORITIES.DEFAULT,
        description: "Opens project creation modal",
    },
    "#backToProjectsBtn": {
        handler: () => window.ProjectDashboard?.showProjectList?.()
            || window.showProjectsView?.(),
        eventType: "click",
        priority: EVENT_PRIORITIES.DEFAULT,
        description: "Returns to projects list view",
    },
    "#editProjectBtn": {
        handler: () => {
            const currentProject = window.projectManager?.getCurrentProject();
            if (currentProject && window.modalManager?.show) {
                window.modalManager.show("project", {
                    updateContent: (modalEl) => {
                        const form = modalEl.querySelector("form");
                        if (form) {
                            form.querySelector("#projectId").value = currentProject.id;
                            form.querySelector("#projectName").value = currentProject.name;
                            form.querySelector("#projectDescription").value = currentProject.description || "";
                            const title = modalEl.querySelector(".modal-title, h3");
                            if (title) title.textContent = `Edit Project: ${currentProject.name}`;
                        }
                    },
                });
            }
        },
        eventType: "click",
        priority: EVENT_PRIORITIES.DEFAULT,
        description: "Opens project edit modal",
    },
    "#pinProjectBtn": {
        handler: () => {
            const currentProject = window.projectManager?.getCurrentProject();
            if (currentProject?.id && window.projectManager?.togglePinProject) {
                runAsyncWithUserFeedback(
                    () => window.projectManager.togglePinProject(currentProject.id),
                    { errorContext: "Toggling Pin" }
                )
                    .then((updatedProject) => {
                        Utils.notify(
                            "Project " + (updatedProject.pinned ? "pinned" : "unpinned"),
                            "success"
                        );
                        window.projectManager.loadProjectDetails(currentProject.id);
                        window.loadSidebarProjects?.();
                    });
            }
        },
        eventType: "click",
        priority: EVENT_PRIORITIES.DEFAULT,
        description: "Toggles project pinned state",
    },
    "#archiveProjectBtn": {
        handler: () => {
            const currentProject = window.projectManager?.getCurrentProject();
            if (currentProject && window.ModalManager?.confirmAction) {
                window.ModalManager.confirmAction({
                    title: "Confirm Archive",
                    message: `Are you sure you want to ${currentProject.archived ? "unarchive" : "archive"
                        } this project?`,
                    confirmText: currentProject.archived ? "Unarchive" : "Archive",
                    confirmClass: currentProject.archived
                        ? "bg-green-600 hover:bg-green-700"
                        : "bg-yellow-600 hover:bg-yellow-700",
                    onConfirm: () => {
                        runAsyncWithUserFeedback(
                            () => window.projectManager.toggleArchiveProject(currentProject.id),
                            { errorContext: "Toggling Archive" }
                        ).then((updatedProject) => {
                            Utils.notify(
                                `Project ${updatedProject.archived ? "archived" : "unarchived"}`,
                                "success"
                            );
                            window.ProjectDashboard?.showProjectList?.();
                            window.loadSidebarProjects?.();
                            window.projectManager.loadProjects("all");
                        });
                    },
                });
            }
        },
        eventType: "click",
        priority: EVENT_PRIORITIES.DEFAULT,
        description: "Toggles project archived state",
    },
    "#minimizeChatBtn": {
        handler: () => {
            const chatContainer = document.getElementById("projectChatContainer");
            if (chatContainer) {
                chatContainer.classList.toggle("hidden");
            }
        },
        eventType: "click",
        priority: EVENT_PRIORITIES.LOW,
        description: "Toggles chat container visibility",
    },
    "#authButton": {
        handler: toggleAuthDropdown,
        eventType: "click",
        priority: EVENT_PRIORITIES.DEFAULT,
        description: "Toggles the auth dropdown menu",
    },
};

// -------------------------------------------------------------------------------------------------
// Main Setup
// -------------------------------------------------------------------------------------------------

function setupEventListeners() {
    console.log("[setupEventListeners] called");
    cleanupListeners(); // avoid duplicates

    // Listen for auth & backend events on the AuthBus
    window.auth.AuthBus.addEventListener("authStateChanged", handleAuthStateChanged);
    window.auth.AuthBus.addEventListener("backendUnavailable", handleBackendUnavailable);

    // Global keydown
    trackListener(document, "keydown", handleKeyDown);

    // Initialize various UI features
    SetupHelpers.setupSidebarToggle();
    SetupHelpers.setupSidebarTabs();
    SetupHelpers.setupCollapsibleSections();
    SetupHelpers.setupPinningSidebar();
    SetupHelpers.setupCustomInstructions();

    // Project form
    const projectForm = Utils.getElement("projectForm");
    if (projectForm) {
        trackListener(projectForm, "submit", handleProjectFormSubmit);
    }

    // Sidebar project creation
    const newProjectBtn = Utils.getElement("sidebarNewProjectBtn");
    if (newProjectBtn) {
        trackListener(newProjectBtn, "click", () => {
            window.modalManager?.show("project", {});
        });
    }

    // Login button bridging
    const showLoginBtn = Utils.getElement("showLoginBtn");
    const authButton = Utils.getElement("authButton");
    if (showLoginBtn && authButton) {
        trackListener(showLoginBtn, "click", () => {
            authButton.click();
        });
    }

    // Delegate events from registry
    Object.entries(eventRegistry).forEach(([selector, config]) => {
        trackListener(
            document,
            config.eventType,
            (event) => {
                if (event.target.closest(selector)) {
                    config.handler(event);
                }
            },
            {
                priority: config.priority,
                description: config.description,
                passive: config.passive,
            }
        );
    });

    // Navigation tracking
    function recordInteraction() {
        sessionStorage.setItem("last_page_interaction", Date.now().toString());
    }
    trackListener(
        document,
        "click",
        (e) => {
            if (
                e.target.closest('a[href*="project"]') ||
                e.target.closest('button[data-action*="project"]') ||
                e.target.closest("#manageDashboardBtn") ||
                e.target.closest("#projectsNav")
            ) {
                recordInteraction();
            }
        },
        {
            priority: EVENT_PRIORITIES.BACKGROUND,
            description: "Tracks user navigation interactions",
        }
    );
    trackListener(window, "beforeunload", recordInteraction, {
        priority: EVENT_PRIORITIES.CRITICAL,
        description: "Records final interaction before page unload",
    });
    recordInteraction();
}

// -------------------------------------------------------------------------------------------------
// Exports
// -------------------------------------------------------------------------------------------------

window.eventHandlers = {
    init: setupEventListeners,
    trackListener,
    cleanupListeners,
    handleProjectFormSubmit,
    handleNewConversationClick,
    handleBackendUnavailable,
    setupCollapsibleSection,
    debounce,
};

