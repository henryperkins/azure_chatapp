/**
 * @module NavigationService
 * Provides centralized navigation management to prevent conflicts,
 * race conditions, and ensure consistent navigation behavior.
 */

const MODULE = "NavigationService";
const MODULE_CONTEXT = "navigationService";

export function createNavigationService({
  domAPI,
  browserService,
  DependencySystem,
  eventHandlers,
  logger: providedLogger            // NEW
} = {}) {
  // === Dependency Validation ===
  if (!domAPI) throw new Error('[NavigationService] domAPI is required');
  if (!browserService) throw new Error('[NavigationService] browserService is required');
  if (!DependencySystem) throw new Error('[NavigationService] DependencySystem is required');
  if (!eventHandlers) throw new Error('[NavigationService] eventHandlers is required');
  const NOOP_LOGGER = ['error', 'warn', 'info', 'debug', 'log']
    .reduce((acc, m) => { acc[m] = () => {}; return acc; }, {});

  let logger = providedLogger
    || DependencySystem?.modules?.get?.('logger')
    || NOOP_LOGGER;

  // === Navigation State ===
  const state = {
    currentView: null,            // 'projectList', 'projectDetails', etc.
    currentProjectId: null,
    currentConversationId: null,
    previousView: null,
    navigationInProgress: false,
    navigationStack: [],          // History of navigation states
    registeredViews: new Map(),   // Map of view IDs to handler functions
    transitionListeners: [],      // Navigation lifecycle listeners
    viewParams: new Map()         // Additional params for each view
  };

  // === Navigation Lifecycle Events ===
  /**
   * Emit a navigation lifecycle event
   * @param {string} eventName - Name of the lifecycle event
   * @param {Object} detail - Event details
   */
  function emitNavigationEvent(eventName, detail = {}) {
    const CustomEventCtor = browserService.getWindow?.()?.CustomEvent;
    if (!CustomEventCtor) return;
    const event = new CustomEventCtor(`navigation:${eventName}`, {
      detail: {
        ...detail,
        timestamp: Date.now(),
        source: MODULE
      }
    });

    // Emit on document for global subscribers
    if (domAPI && typeof domAPI.dispatchEvent === 'function') {
      const doc = domAPI.getDocument();
      if (doc) {
        domAPI.dispatchEvent(doc, event);
      }
    }

    // Call registered transition listeners
    state.transitionListeners.forEach(listener => {
      if (typeof listener[eventName] === 'function') {
        try {
          listener[eventName](detail);
        } catch (err) {
          logger.error(
            '[NavigationService] transition listener failed',
            { status: err?.status ?? 500, data: err, message: err?.message ?? String(err) },
            { context: MODULE }
          );
        }
      }
    });
  }

  /**
   * Register navigation lifecycle listeners
   * @param {Object} listener - Object with lifecycle methods
   * @returns {Function} Unsubscribe function
   */
  function addTransitionListener(listener) {
    state.transitionListeners.push(listener);
    return () => {
      const index = state.transitionListeners.indexOf(listener);
      if (index !== -1) {
        state.transitionListeners.splice(index, 1);
      }
    };
  }

  // === URL Management ===
  /**
   * Get current URL parameters
   * @returns {Object} Parameter object
   */
  function getUrlParams() {
    const searchParams = new browserService.URLSearchParams(
      browserService.getLocation().search
    );
    const params = {};

    // Convert searchParams to plain object
    for (const [key, value] of searchParams.entries()) {
      params[key] = value;
    }

    return params;
  }

  /**
   * Update URL without triggering navigation
   * @param {Object} params - URL parameters to set
   * @param {boolean} replace - Whether to replace current history entry
   */
  function updateUrlParams(params = {}, replace = false) {
    // delegate to the central implementation to keep behaviour consistent
    const newUrl = browserService.buildUrl(params);
    replace
      ? browserService.replaceState({}, '', newUrl)
      : browserService.pushState   ({}, '', newUrl);
  }

  // === View Management ===
  /**
   * Register a view with the navigation service
   * @param {string} viewId - Unique identifier for the view
   * @param {Object} handlers - View handler functions (show, hide, etc.)
   */
  function registerView(viewId, handlers = {}) {
    if (!viewId) {
      return;
    }

    const requiredHandlers = ['show', 'hide'];
    const missingHandlers = requiredHandlers.filter(h => typeof handlers[h] !== 'function');

    if (missingHandlers.length > 0) {
      return;
    }

    state.registeredViews.set(viewId, handlers);
  }

  function hasView(viewId){ return state.registeredViews.has(viewId); }

  /**
   * Activate a registered view and deactivate others
   * @param {string} viewId - View to activate
   * @param {Object} params - View parameters
   * @returns {Promise<boolean>} Success indicator
   */
  async function activateView(viewId, params = {}) {
    if (!state.registeredViews.has(viewId)) {
      return false;
    }

    const viewHandlers = state.registeredViews.get(viewId);
    const previousViewId = state.currentView;

    try {
      // First, ensure login message is hidden and main content is visible
      const domAPI = DependencySystem?.modules?.get('domAPI');
      if (domAPI) {
        const loginMessage = domAPI.getElementById('loginRequiredMessage');
        const mainContent = domAPI.getElementById('mainContent');

        if (loginMessage) domAPI.addClass(loginMessage, 'hidden');
        if (mainContent) domAPI.removeClass(mainContent, 'hidden');
      }

      // Hide previous view if different
      if (previousViewId && previousViewId !== viewId) {
        const prevHandlers = state.registeredViews.get(previousViewId);
        if (prevHandlers && typeof prevHandlers.hide === 'function') {
          await prevHandlers.hide();
        }
      }

      // Store params for the view
      state.viewParams.set(viewId, params);

      // Show the new view
      await viewHandlers.show(params);

      // Update state
      state.previousView = previousViewId;
      state.currentView = viewId;

      return true;
    } catch (error) {
      logger.error(
        '[NavigationService] activateView failed',
        { status: error?.status ?? 500, data: error, message: error?.message ?? String(error) },
        { context: MODULE }
      );
      return false;
    }
  }

  // === Core Navigation Functions ===
  /**
   * Navigate to a specific view with parameters
   * @param {string} viewId - Target view ID
   * @param {Object} params - Navigation parameters
   * @param {Object} options - Navigation options
   * @returns {Promise<boolean>} Success indicator
   */
  async function navigateTo(viewId, params = {}, options = {}) {
    const {
      updateUrl = true,
      addToHistory = true,
      replace = false
    } = options;

    // Prevent navigation during another navigation
    if (state.navigationInProgress) {
      return false;
    }

    state.navigationInProgress = true;
    const navId = Date.now();

    try {
      // Fire beforeNavigate event
      emitNavigationEvent('beforeNavigate', {
        from: state.currentView,
        to: viewId,
        params,
        navigationId: navId
      });

      // Get view-specific parameters
      const projectId = params.projectId || params.project || null;
      const conversationId = params.conversationId || params.chatId || null;

      // Update URL if needed
      if (updateUrl) {
        const urlParams = {};

        // Add parameters to URL as needed
        if (viewId === 'projectDetails' && projectId) {
          urlParams.project = projectId;

          if (conversationId) {
            urlParams.chatId = conversationId;
          }
        }

        updateUrlParams(urlParams, replace);
      }

      // Update state before view activation
      if (projectId) {
        state.currentProjectId = projectId;
      }

      if (conversationId) {
        state.currentConversationId = conversationId;
      }

      // Fire navigating event
      emitNavigationEvent('navigating', {
        from: state.currentView,
        to: viewId,
        params,
        navigationId: navId
      });

      // Activate the view
      const success = await activateView(viewId, params);

      if (success) {
        // Add to navigation stack if successful and addToHistory is true
        if (addToHistory) {
          state.navigationStack.push({
            viewId,
            params,
            timestamp: Date.now()
          });
        }

        // Fire afterNavigate event
        emitNavigationEvent('afterNavigate', {
          from: state.previousView,
          to: viewId,
          params,
          navigationId: navId,
          success: true
        });
      } else {
        // Fire navigation error event
        emitNavigationEvent('navigationError', {
          from: state.currentView,
          to: viewId,
          params,
          navigationId: navId,
          status: 500,
          data: null,
          message: 'View activation failed'
        });
      }

      return success;
    } catch (error) {
      logger.error('[NavigationService][navigateTo] before-navigate error',
        { status: error?.status ?? 500, data: error, message: error?.message ?? String(error) },
        { context: MODULE }
      );
      // Fire navigation error event
      emitNavigationEvent('navigationError', {
        from: state.currentView,
        to: viewId,
        params,
        navigationId: navId,
        status: error?.status ?? 500,
        data: error,
        message: error?.message ?? 'Unknown error'
      });
      return false;
    } finally {
      state.navigationInProgress = false;
    }
  }

  /**
   * Navigate to project list view
   * @param {Object} options - Navigation options
   * @returns {Promise<boolean>} Success indicator
   */
  function navigateToProjectList(options = {}) {
    return navigateTo('projectList', {}, options);
  }

  /**
   * Navigate to project details view
   * @param {string} projectId - Project ID
   * @param {Object} options - Navigation options
   * @returns {Promise<boolean>} Success indicator
   */
  function navigateToProject(projectId, options = {}) {
    if (!projectId) {
      return Promise.resolve(false);
    }

    return navigateTo('projectDetails', { projectId }, options);
  }

  /**
   * Navigate to conversation within a project
   * @param {string} projectId - Project ID
   * @param {string} conversationId - Conversation ID
   * @param {Object} options - Navigation options
   * @returns {Promise<boolean>} Success indicator
   */
  function navigateToConversation(projectId, conversationId, options = {}) {
    if (!projectId || !conversationId) {
      return Promise.resolve(false);
    }

    return navigateTo('projectDetails', {
      projectId,
      conversationId,
      activeTab: 'conversations'
    }, options);
  }

  /**
   * Go back in navigation history
   * @returns {Promise<boolean>} Success indicator
   */
  async function goBack() {
    if (state.navigationStack.length <= 1) {
      // If no previous entries, go to project list
      return navigateToProjectList({ replace: true });
    }

    // Remove current state
    state.navigationStack.pop();

    // Get previous state
    const previous = state.navigationStack[state.navigationStack.length - 1];

    // Navigate to previous state, replacing current history entry
    return navigateTo(previous.viewId, previous.params, { replace: true });
  }

  // === Event Handlers ===
  /**
   * Handle browser popstate event (back/forward buttons)
   * @param {Event} event - Popstate event
   */
  function handlePopState(event) {
    const params = getUrlParams();
    const projectId = params.project;
    const conversationId = params.chatId;

    // Determine target view based on URL parameters
    try {
      if (projectId) {
        if (conversationId) {
          navigateToConversation(projectId, conversationId, { addToHistory: false });
        } else {
          navigateToProject(projectId, { addToHistory: false });
        }
      } else {
        navigateToProjectList({ addToHistory: false });
      }
    } catch (err) {
      logger.error('[NavigationService][handlePopState] failure',
        { status: err?.status ?? 500, data: err, message: err?.message ?? String(err) },
        { context: MODULE }
      );
      return;
    }
  }

  // === Initialization ===
  /**
   * Initialize the navigation service
   */
  function init() {
    // Register popstate handler
    const safeHandler = DependencySystem.modules.get('safeHandler');
    eventHandlers.trackListener(
      browserService.getWindow(),
      'popstate',
      safeHandler(handlePopState, 'NavigationService:popstate'),
      { context: MODULE_CONTEXT, description: 'popstate' }
    );

    // Notification removed (NavigationService initialized)

    // Parse initial URL and set initial state
    const params = getUrlParams();
    if (params.project) {
      state.currentProjectId = params.project;
    }
    if (params.chatId) {
      state.currentConversationId = params.chatId;
    }

    // Notification removed (initial navigation state)

    // Notify ready
    emitNavigationEvent('ready', {
      currentProjectId: state.currentProjectId,
      currentConversationId: state.currentConversationId
    });

    return true;
  }

  /**
   * Clean up event listeners and state
   */
  function cleanup() {
    // Clean up event listeners
    eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });

    // Clear state
    state.registeredViews.clear();
    state.transitionListeners.length = 0;
    state.navigationStack.length = 0;
    state.viewParams.clear();
  }

  // === Public API ===
  return {
    // Core navigation
    navigateTo,
    navigateToProjectList,
    navigateToProject,
    navigateToConversation,
    goBack,

    // View management
    registerView,

    // URL management
    updateUrlParams,
    getUrlParams,

    // State access
    getCurrentView: () => state.currentView,
    hasView,
    getCurrentProjectId: () => state.currentProjectId,
    getCurrentConversationId: () => state.currentConversationId,
    isNavigating: () => state.navigationInProgress,

    // Lifecycle
    addTransitionListener,

    // Initialization & cleanup
    init,
    cleanup
  };
}
