import { getSafeHandler } from './utils/getSafeHandler.js';

export function createNavigationService({
  domAPI,
  browserService,
  DependencySystem,
  eventHandlers,
  logger: providedLogger
} = {}) {
  /**
   * Dependency/Guard checks
   */
  if (!domAPI) throw new Error('[NavigationService] domAPI is required');
  if (!browserService) throw new Error('[NavigationService] browserService is required');
  if (!DependencySystem) throw new Error('[NavigationService] DependencySystem is required');
  if (!eventHandlers) throw new Error('[NavigationService] eventHandlers is required');
  if (!providedLogger) throw new Error('[NavigationService] logger is required');

  const logger = providedLogger;
  const MODULE = 'NavigationService';
  const MODULE_CONTEXT = 'navigationService';

  // Resolve safeHandler at factory time
  const safeHandler = getSafeHandler(DependencySystem);

  // === Navigation State ===
  const state = {
    currentView: null,
    currentProjectId: null,
    currentConversationId: null,
    previousView: null,
    navigationInProgress: false,
    navigationStack: [],
    registeredViews: new Map(),
    transitionListeners: [],
    viewParams: new Map()
  };

  /**
   * Emit a navigation lifecycle event
   */
  function emitNavigationEvent(eventName, detail = {}) {
    const CustomEventCtor = browserService.getWindow()?.CustomEvent;
    if (!CustomEventCtor) return;
    const event = new CustomEventCtor(`navigation:${eventName}`, {
      detail: {
        ...detail,
        timestamp: Date.now(),
        source: MODULE
      }
    });

    const doc = domAPI.getDocument();
    if (doc) {
      domAPI.dispatchEvent(doc, event);
    }

    // Call registered transition listeners
    state.transitionListeners.forEach(listener => {
      if (typeof listener[eventName] === 'function') {
        try {
          listener[eventName](detail);
        } catch (err) {
          logger.error('[NavigationService] transition listener failed', err, {
            context: 'navigationService:transitionListener'
          });
        }
      }
    });
  }

  /**
   * Register navigation lifecycle listeners
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
  function getUrlParams() {
    const searchParams = new browserService.URLSearchParams(
      browserService.getLocation().search
    );
    const params = {};
    for (const [key, value] of searchParams.entries()) {
      params[key] = value;
    }
    return params;
  }

  function updateUrlParams(params = {}, replace = false) {
    try {
      const newUrl = browserService.buildUrl(params);
      replace
        ? browserService.replaceState({}, '', newUrl)
        : browserService.pushState({}, '', newUrl);
    } catch (err) {
      logger.error('[NavigationService] updateUrlParams failed', err, {
        context: MODULE_CONTEXT
      });
    }
  }

  function getLocationSearch() {
    return browserService.getLocation().search;
  }
  function getCurrentHref() {
    return browserService.getLocation().href;
  }
  function getCurrentPathname() {
    return browserService.getLocation().pathname;
  }
  function pushState(url, title = '') {
    browserService.pushState({}, title, url);
  }
  function replaceState(url, title = '') {
    browserService.replaceState({}, title, url);
  }

  const navAPI = {
    getSearch: getLocationSearch,
    getHref: getCurrentHref,
    getPathname: getCurrentPathname,
    pushState,
    replaceState,
    activateView: (...args) => activateView(...args),
    deactivateView
  };

  // ───────────────────────────────────────────────────────────
  // View Deactivation Lifecycle (Week-1 requirement)
  // ───────────────────────────────────────────────────────────

  function deactivateView (viewId = state.currentView) {
    if (!viewId || !state.registeredViews.has(viewId)) return false;

    logger.debug('[NavigationService] Deactivating view', { viewId, context: MODULE_CONTEXT });

    const handlers = state.registeredViews.get(viewId);

    // Call optional hooks on the view handlers
    safeHandler(handlers.hide ?? (() => {}))();
    safeHandler(handlers.destroy ?? (() => {}))();

    state.previousView = viewId;
    if (state.currentView === viewId) state.currentView = null;

    emitNavigationEvent('deactivateView', { viewId });
    return true;
  }


  // === View Management ===
  function registerView(viewId, handlers = {}) {
    if (!viewId) {
      logger.error('[NavigationService] registerView validation failed',
        new Error('Missing viewId'), { context: MODULE_CONTEXT });
      return false;
    }

    const requiredHandlers = ['show', 'hide'];
    const missingHandlers = requiredHandlers.filter(h => typeof handlers[h] !== 'function');
    if (missingHandlers.length > 0) {
      logger.error('[NavigationService] registerView validation failed',
        new Error('Missing handlers: ' + missingHandlers.join(',')), { context: MODULE_CONTEXT });
      return false;
    }
    state.registeredViews.set(viewId, handlers);
    return true;
  }

  function hasView(viewId) {
    return state.registeredViews.has(viewId);
  }

  async function activateView(viewId, params = {}) {
    // Auto-deactivate current view before switching
    if (state.currentView && state.currentView !== viewId) {
      deactivateView(state.currentView);
    }
    if (!state.registeredViews.has(viewId)) {
      return false;
    }
    const viewHandlers = state.registeredViews.get(viewId);
    const previousViewId = state.currentView;
    try {
      // Hide #loginRequiredMessage, show #mainContent if present
      const loginMessage = domAPI.getElementById('loginRequiredMessage');
      const mainContent = domAPI.getElementById('mainContent');
      if (loginMessage) domAPI.addClass(loginMessage, 'hidden');
      if (mainContent) domAPI.removeClass(mainContent, 'hidden');

      // Hide previous view
      if (previousViewId && previousViewId !== viewId) {
        const prevHandlers = state.registeredViews.get(previousViewId);
        if (prevHandlers?.hide) {
          await prevHandlers.hide();
        }
      }

      // Store params
      state.viewParams.set(viewId, params);

      // Show new view
      await viewHandlers.show(params);

      state.previousView = previousViewId;
      state.currentView = viewId;
      return true;
    } catch (error) {
      logger.error('[NavigationService] activateView failed', error, {
        context: 'navigationService:activateView'
      });
      return false;
    }
  }

  // === Core Navigation Functions ===
  async function navigateTo(viewId, params = {}, options = {}) {
    const { updateUrl = true, addToHistory = true, replace = false } = options;

    if (state.navigationInProgress) {
      return false;
    }
    state.navigationInProgress = true;
    const navId = Date.now();

    try {
      emitNavigationEvent('beforeNavigate', {
        from: state.currentView,
        to: viewId,
        params,
        navigationId: navId
      });

      const projectId = params.projectId || params.project || null;
      const conversationId = params.conversationId || params.chatId || null;

      if (updateUrl) {
        const urlParams = {};
        if (viewId === 'projectDetails' && projectId) {
          urlParams.project = projectId;
          if (conversationId) {
            urlParams.chatId = conversationId;
          }
        }
        updateUrlParams(urlParams, replace);
      }

      if (projectId) {
        state.currentProjectId = projectId;
      }
      if (conversationId) {
        state.currentConversationId = conversationId;
      }

      emitNavigationEvent('navigating', {
        from: state.currentView,
        to: viewId,
        params,
        navigationId: navId
      });

      const success = await activateView(viewId, params);
      if (success) {
        if (addToHistory) {
          state.navigationStack.push({ viewId, params, timestamp: Date.now() });
        }
        emitNavigationEvent('afterNavigate', {
          from: state.previousView,
          to: viewId,
          params,
          navigationId: navId,
          success: true
        });
      } else {
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
      logger.error('[NavigationService][navigateTo] before-navigate error', error, {
        context: 'navigationService:navigateTo'
      });
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

  function navigateToProjectList(options = {}) {
    return navigateTo('projectList', {}, options);
  }

  function navigateToProject(projectId, options = {}) {
    if (!projectId) {
      return Promise.resolve(false);
    }
    return navigateTo('projectDetails', { projectId }, options);
  }

  function navigateToConversation(projectId, conversationId, options = {}) {
    if (!projectId || !conversationId) {
      return Promise.resolve(false);
    }
    return navigateTo(
      'projectDetails',
      { projectId, conversationId, activeTab: 'conversations' },
      options
    );
  }

  async function goBack() {
    try {
      if (state.navigationStack.length <= 1) {
        return navigateToProjectList({ replace: true });
      }
      state.navigationStack.pop();
      const previous = state.navigationStack[state.navigationStack.length - 1];
      return navigateTo(previous.viewId, previous.params, { replace: true });
    } catch (err) {
      logger.error('[NavigationService] goBack failed', err, { context: MODULE_CONTEXT });
      return false;
    }
  }

  function handlePopState(/* event */) {
    const params = getUrlParams();
    const projectId = params.project;
    const conversationId = params.chatId;
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
      logger.error('[NavigationService] handlePopState failed', err, { context: MODULE_CONTEXT });
    }
  }

  function init() {
    // Register popstate handler using safeHandler
    eventHandlers.trackListener(
      browserService.getWindow(),
      'popstate',
      safeHandler(handlePopState, 'NavigationService:popstate'),
      { context: MODULE_CONTEXT, description: 'popstate' }
    );

    // Parse initial URL
    const params = getUrlParams();
    if (params.project) {
      state.currentProjectId = params.project;
    }
    if (params.chatId) {
      state.currentConversationId = params.chatId;
    }

    emitNavigationEvent('ready', {
      currentProjectId: state.currentProjectId,
      currentConversationId: state.currentConversationId
    });

    return true;
  }

  function cleanup() {
    eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
    state.registeredViews.clear();
    state.transitionListeners.length = 0;
    state.navigationStack.length = 0;
    state.viewParams.clear();
  }

  return {
    // Core navigation
    navigateTo,
    navigateToProjectList,
    navigateToProject,
    navigateToConversation,
    goBack,

    // View management
    registerView,
    hasView,

    // URL management
    updateUrlParams,
    getUrlParams,

    // State access
    getCurrentView: () => state.currentView,
    getCurrentProjectId: () => state.currentProjectId,
    getCurrentConversationId: () => state.currentConversationId,
    isNavigating: () => state.navigationInProgress,

    // Lifecycle
    addTransitionListener,

    // Initialization & cleanup
    init,
    cleanup,

    // Consolidated navigation helpers
    getLocationSearch,
    getCurrentHref,
    getCurrentPathname,
    pushState,
    replaceState,
    navAPI
  };
}
