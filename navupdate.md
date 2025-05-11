# NavigationService Implementation

Here's a comprehensive `NavigationService` module that centralizes and replaces the scattered navigation logic in your codebase. This implementation follows the factory pattern, uses proper context-rich notifications, and provides a consistent API for all navigation operations.

```javascript
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
  notify,
  eventHandlers,
  errorReporter
} = {}) {
  // === Dependency Validation ===
  if (!domAPI) throw new Error('[NavigationService] domAPI is required');
  if (!browserService) throw new Error('[NavigationService] browserService is required');
  if (!DependencySystem) throw new Error('[NavigationService] DependencySystem is required');
  if (!notify) throw new Error('[NavigationService] notify is required');
  if (!eventHandlers) throw new Error('[NavigationService] eventHandlers is required');
  
  // Context-rich notifications
  const navNotify = notify.withContext({
    module: MODULE,
    context: MODULE_CONTEXT
  });

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
    const event = new CustomEvent(`navigation:${eventName}`, {
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
          navNotify.error(`Error in ${eventName} listener`, {
            group: true,
            source: 'emitNavigationEvent',
            originalError: err
          });
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
    const searchParams = new URLSearchParams(browserService.getLocation().search);
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
    const currentUrl = new URL(browserService.getLocation().href);
    const searchParams = currentUrl.searchParams;
    
    // Remove params with null/undefined values
    Object.entries(params).forEach(([key, value]) => {
      if (value === null || value === undefined) {
        searchParams.delete(key);
      } else {
        searchParams.set(key, value);
      }
    });
    
    const newUrl = currentUrl.toString();
    
    if (replace) {
      browserService.replaceState({}, '', newUrl);
    } else {
      browserService.pushState({}, '', newUrl);
    }
    
    navNotify.debug('URL params updated', {
      source: 'updateUrlParams',
      extra: { params, replace, newUrl }
    });
  }

  // === View Management ===
  /**
   * Register a view with the navigation service
   * @param {string} viewId - Unique identifier for the view
   * @param {Object} handlers - View handler functions (show, hide, etc.)
   */
  function registerView(viewId, handlers = {}) {
    if (!viewId) {
      navNotify.error('Cannot register view without viewId', {
        group: true,
        source: 'registerView'
      });
      return;
    }
    
    const requiredHandlers = ['show', 'hide'];
    const missingHandlers = requiredHandlers.filter(h => typeof handlers[h] !== 'function');
    
    if (missingHandlers.length > 0) {
      navNotify.error(`View ${viewId} missing required handlers: ${missingHandlers.join(', ')}`, {
        group: true,
        source: 'registerView',
        extra: { viewId, providedHandlers: Object.keys(handlers) }
      });
      return;
    }
    
    state.registeredViews.set(viewId, handlers);
    navNotify.debug(`View "${viewId}" registered`, {
      source: 'registerView',
      extra: { viewId, handlers: Object.keys(handlers) }
    });
  }

  /**
   * Activate a registered view and deactivate others
   * @param {string} viewId - View to activate
   * @param {Object} params - View parameters
   * @returns {Promise<boolean>} Success indicator
   */
  async function activateView(viewId, params = {}) {
    if (!state.registeredViews.has(viewId)) {
      navNotify.error(`Cannot activate unregistered view: ${viewId}`, {
        group: true,
        source: 'activateView',
        extra: { viewId, registeredViews: Array.from(state.registeredViews.keys()) }
      });
      return false;
    }
    
    const viewHandlers = state.registeredViews.get(viewId);
    const previousViewId = state.currentView;
    
    try {
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
      
      navNotify.debug(`View "${viewId}" activated`, {
        source: 'activateView',
        extra: { previousView: previousViewId, params }
      });
      
      return true;
    } catch (error) {
      navNotify.error(`Failed to activate view: ${viewId}`, {
        group: true,
        source: 'activateView',
        originalError: error,
        extra: { viewId, params }
      });
      
      // Report error if we have an error reporter
      if (errorReporter && typeof errorReporter.capture === 'function') {
        errorReporter.capture(error, {
          module: MODULE,
          method: 'activateView',
          viewId,
          params
        });
      }
      
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
      navNotify.warn('Navigation already in progress, aborting', {
        group: true,
        source: 'navigateTo',
        extra: { viewId, currentlyNavigatingTo: state.currentView }
      });
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
        
        navNotify.info(`Navigated to "${viewId}"`, {
          source: 'navigateTo',
          extra: { params, previousView: state.previousView }
        });
      } else {
        // Fire navigation error event
        emitNavigationEvent('navigationError', {
          from: state.currentView,
          to: viewId,
          params,
          navigationId: navId,
          error: 'View activation failed'
        });
        
        navNotify.error(`Failed to navigate to "${viewId}"`, {
          group: true,
          source: 'navigateTo',
          extra: { params }
        });
      }
      
      return success;
    } catch (error) {
      // Fire navigation error event
      emitNavigationEvent('navigationError', {
        from: state.currentView,
        to: viewId,
        params,
        navigationId: navId,
        error: error.message || 'Unknown error'
      });
      
      navNotify.error(`Navigation error: ${error.message || 'Unknown error'}`, {
        group: true,
        source: 'navigateTo',
        originalError: error,
        extra: { viewId, params }
      });
      
      // Report error if we have an error reporter
      if (errorReporter && typeof errorReporter.capture === 'function') {
        errorReporter.capture(error, {
          module: MODULE,
          method: 'navigateTo',
          viewId,
          params
        });
      }
      
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
      navNotify.error('Cannot navigate to project: Missing projectId', {
        group: true,
        source: 'navigateToProject'
      });
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
      navNotify.error('Cannot navigate to conversation: Missing projectId or conversationId', {
        group: true,
        source: 'navigateToConversation',
        extra: { projectId, conversationId }
      });
      return Promise.resolve(false);
    }
    
    return navigateTo('projectDetails', {
      projectId,
      conversationId,
      activeTab: 'chat'
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
    navNotify.debug('Popstate event detected', {
      source: 'handlePopState',
      extra: { state: event.state }
    });
    
    const params = getUrlParams();
    const projectId = params.project;
    const conversationId = params.chatId;
    
    // Determine target view based on URL parameters
    if (projectId) {
      if (conversationId) {
        navigateToConversation(projectId, conversationId, { addToHistory: false });
      } else {
        navigateToProject(projectId, { addToHistory: false });
      }
    } else {
      navigateToProjectList({ addToHistory: false });
    }
  }

  // === Initialization ===
  /**
   * Initialize the navigation service
   */
  function init() {
    // Register popstate handler
    eventHandlers.trackListener(
      browserService.getWindow(),
      'popstate',
      handlePopState,
      {
        description: 'Navigation popstate handler',
        context: MODULE_CONTEXT
      }
    );
    
    navNotify.info('NavigationService initialized', {
      source: 'init'
    });
    
    // Parse initial URL and set initial state
    const params = getUrlParams();
    if (params.project) {
      state.currentProjectId = params.project;
    }
    if (params.chatId) {
      state.currentConversationId = params.chatId;
    }
    
    navNotify.debug('Initial navigation state', {
      source: 'init',
      extra: {
        projectId: state.currentProjectId,
        conversationId: state.currentConversationId,
        allParams: params
      }
    });
    
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
    
    navNotify.info('NavigationService cleaned up', {
      source: 'cleanup'
    });
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
```

## Integration Guide

To replace existing navigation logic with this service, follow these steps:

### 1. Register the Navigation Service in app.js

```javascript
// In app.js or your orchestrator module
import { createNavigationService } from './navigationService.js';

// Add this during dependency initialization
const navigationService = createNavigationService({
  domAPI,
  browserService,
  DependencySystem,
  notify,
  eventHandlers,
  errorReporter
});
DependencySystem.register('navigationService', navigationService);
navigationService.init();
```

### 2. Register Your Views

```javascript
// In projectDashboard.js or where you initialize your views
const navigationService = DependencySystem.modules.get('navigationService');

// Register project list view
navigationService.registerView('projectList', {
  show: async (params = {}) => {
    // Show project list view logic
    // Use existing this._setView({ showList: true, showDetails: false })
    return true;
  },
  hide: async () => {
    // Hide project list view logic
    return true;
  }
});

// Register project details view
navigationService.registerView('projectDetails', {
  show: async (params = {}) => {
    const { projectId, conversationId, activeTab } = params;
    // Show project details view logic
    // Load project details if needed
    // Activate specific tab if requested
    return true;
  },
  hide: async () => {
    // Hide project details view logic
    return true;
  }
});
```

### 3. Replace Existing Navigation Calls

#### In ProjectListComponent:

```javascript
// Before:
onViewProject(projectId) {
  if (this.app && typeof this.app.setCurrentProjectId === "function") {
    this.app.setCurrentProjectId(projectId);
  }
  this.router.navigate(`/project-details-view?project=${projectId}`);
}

// After:
onViewProject(projectId) {
  const navigationService = this.DependencySystem.modules.get('navigationService');
  navigationService.navigateToProject(projectId);
}
```

#### In projectDetailsComponent.js:

```javascript
// Before:
async _openConversation(cv) {
  // ... get conversation ...
  this.switchTab("chat");
  const url = new URL(this.router.getURL());
  url.searchParams.set("chatId", cv.id);
  this.router.navigate(url.toString());
}

// After:
async _openConversation(cv) {
  const navigationService = this.DependencySystem.modules.get('navigationService');
  navigationService.navigateToConversation(this.state.currentProject.id, cv.id);
}
```

#### In app.js handleNavigationChange:

```javascript
// Before (original complex function):
async function handleNavigationChange(options = {}) {
  // ... complex logic with many edge cases ...
}

// After:
// This function is no longer needed! Let navigationService handle it.
// Just remove the event listener from registerAppListeners()
```

### 4. Listen for Navigation Events

```javascript
// For any component that needs to react to navigation:
const navigationService = DependencySystem.modules.get('navigationService');

const unsubscribe = navigationService.addTransitionListener({
  beforeNavigate: (detail) => {
    // Prepare for navigation
    console.log(`Navigating from ${detail.from} to ${detail.to}`);
  },
  afterNavigate: (detail) => {
    // Update component after navigation
    if (detail.to === 'projectDetails') {
      // Do something when navigation to project details is complete
    }
  }
});

// Remember to call unsubscribe in your cleanup function
```

### 5. Integration with Back Button

This is already handled by the navigation service through the `popstate` event listener.

## Benefits of This Approach

1. **Single Source of Truth**: All navigation state lives in one place
2. **Lifecycle Events**: Components can hook into navigation lifecycle events
3. **Consistent API**: One way to navigate throughout the app
4. **Prevents Race Conditions**: Navigation in progress is tracked
5. **Separation of Concerns**: Navigation logic separated from view logic
6. **History Management**: Properly manages browser history

By implementing this service, you'll eliminate the conflicting navigation logic that's causing bugs and race conditions in your application.