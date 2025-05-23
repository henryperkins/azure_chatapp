/**
 * Creates an application state manager for centralized control of authentication, user information, and app lifecycle state.
 *
 * The returned module provides methods to update and query authentication status, user data, initialization progress, and lifecycle phase. All state changes are logged using the injected logger.
 *
 * @param {Object} options - Options object.
 * @param {Object} options.DependencySystem - Dependency injection system (required).
 * @param {Object} options.logger - Logger instance for structured logging (required).
 * @returns {Object} Application state manager with state properties and helper methods.
 *
 * @throws {Error} If either {@link DependencySystem} or {@link logger} is missing.
 */

export function createAppStateManager({ DependencySystem, logger }) {
  if (!DependencySystem || !logger) {
    throw new Error('[appState] Missing required dependencies for app state management.');
  }

  const appModule = {
    state: {
      isAuthenticated: false,
      currentUser: null,
      currentProjectId: null, // Track currently selected project
      isReady: false, // True when app is fully initialized and safe for interaction
      disableErrorTracking: false,
      initialized: false, // True when the main init() sequence has completed (success or fail)
      initializing: false, // True if init() is currently executing
      currentPhase: 'idle' // e.g., 'idle', 'starting_init_process', 'initialized_idle', 'failed_idle'
    },

    // Method to update authentication-related state
    setAuthState(newAuthState) {
      const oldAuthState = {
        isAuthenticated: this.state.isAuthenticated,
        currentUser: this.state.currentUser ? { id: this.state.currentUser.id, username: this.state.currentUser.username } : null
      };
      const newAuthStateForLog = {
        isAuthenticated: newAuthState.isAuthenticated,
        currentUser: newAuthState.currentUser ? { id: newAuthState.currentUser.id, username: newAuthState.currentUser.username } : null
      };
      logger.info('[appState][setAuthState] Updating auth state.', {
        oldAuthState,
        newAuthState: newAuthStateForLog,
        context: 'appState:setAuthState'
      });
      Object.assign(this.state, newAuthState);
    },

    // Method to update general app lifecycle state
    setAppLifecycleState(newLifecycleState) {
      const oldLifecycleStateForLog = {
        isReady: this.state.isReady,
        initialized: this.state.initialized,
        initializing: this.state.initializing,
        currentPhase: this.state.currentPhase
      };
      logger.info('[appState][setAppLifecycleState] Updating app lifecycle state.', {
        oldLifecycleState: oldLifecycleStateForLog,
        newLifecycleState,
        context: 'appState:setAppLifecycleState'
      });
      Object.assign(this.state, newLifecycleState);

      // If 'initialized' becomes true, set 'isReady' based on success/failure
      if (newLifecycleState.initialized === true) {
        if (this.state.currentPhase === 'initialized_idle') {
          this.state.isReady = true;
        } else if (this.state.currentPhase === 'failed_idle') {
          this.state.isReady = false; // Explicitly false if init failed
        }
      } else if (Object.prototype.hasOwnProperty.call(newLifecycleState, 'isReady')) {
        // Allow direct setting of isReady if needed
        this.state.isReady = newLifecycleState.isReady;
      }
    },

    // Helper method to get current authentication status
    isAuthenticated() {
      return this.state.isAuthenticated;
    },

    // Helper method to get current user
    getCurrentUser() {
      return this.state.currentUser;
    },

    // Method to update current project
    setCurrentProject(projectId) {
      logger.info('[appState][setCurrentProject] Updating current project.', {
        oldProjectId: this.state.currentProjectId,
        newProjectId: projectId,
        context: 'appState:setCurrentProject'
      });
      this.state.currentProjectId = projectId;
    },

    // Helper method to get current project ID
    getCurrentProjectId() {
      return this.state.currentProjectId;
    },

    // Helper method to check if app is ready
    isAppReady() {
      return this.state.isReady;
    },

    // Helper method to check if app is initialized
    isInitialized() {
      return this.state.initialized;
    },

    // Helper method to check if app is initializing
    isInitializing() {
      return this.state.initializing;
    },

    // Helper method to get current phase
    getCurrentPhase() {
      return this.state.currentPhase;
    }
  };

  return appModule;
}
