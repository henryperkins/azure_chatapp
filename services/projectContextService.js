/**
 * Centralised Project Context Service
 * -----------------------------------
 *
 * This service provides a unified interface for managing project context state
 * across the application. It acts as a facade over the canonical `appModule.state`
 * to ensure single source of truth for project-related state management.
 *
 * Key responsibilities:
 * - Provide read-only access to current project information
 * - Centralize project ID resolution logic
 * - Manage project context changes and URL synchronization
 * - Emit standardized project change events
 *
 * This eliminates the complex project ID resolution logic scattered across
 * components (especially in chat.js lines 606-640, 706-749) by centralizing
 * all project context management in one place.
 *
 * Guard-rails compliance:
 * - Factory pattern with explicit dependency injection
 * - No top-level side-effects or local state variables
 * - Single source of truth via appModule.state
 * - Cleanup method for interface consistency
 */

export function createProjectContextService({ DependencySystem, logger, appModule, browserService, navigationService }) {
  if (!DependencySystem) {
    throw new Error('[projectContextService] Missing required DependencySystem');
  }
  if (!logger) {
    throw new Error('[projectContextService] Missing required logger');
  }

  // Fallback for backward-compatibility – resolve dependencies via DI if not supplied
  if (!appModule) {
    appModule = DependencySystem.modules?.get('appModule');
  }
  if (!browserService) {
    browserService = DependencySystem.modules?.get('browserService');
  }
  if (!navigationService) {
    navigationService = DependencySystem.modules?.get('navigationService');
  }

  if (!appModule || !appModule.state) {
    throw new Error('[projectContextService] appModule with state not available – DI order incorrect');
  }

  const MODULE = 'projectContextService';

  function _getState() {
    return appModule.state;
  }

  /**
   * Validates if a project ID is valid (non-null, non-empty string or valid number)
   */
  function isValidProjectId(projectId) {
    if (projectId === null || projectId === undefined || projectId === '') {
      return false;
    }
    
    // Accept string numbers or actual numbers
    if (typeof projectId === 'string') {
      return projectId.trim() !== '' && !isNaN(Number(projectId));
    }
    
    if (typeof projectId === 'number') {
      return !isNaN(projectId) && projectId > 0;
    }
    
    return false;
  }

  /**
   * Attempts to resolve project ID from multiple canonical sources in priority order:
   * 1. appModule.state.currentProjectId (highest priority)
   * 2. URL parameters via navigationService (fallback)
   */
  function resolveProjectIdFromSources() {
    const state = _getState();
    
    // First try: canonical app state
    if (isValidProjectId(state.currentProjectId)) {
      logger.debug(`[${MODULE}] Resolved project ID from app state: ${state.currentProjectId}`, {
        context: MODULE,
        source: 'appModule.state'
      });
      return state.currentProjectId;
    }

    // Second try: URL parameters
    if (navigationService?.getUrlParams) {
      const urlProjectId = navigationService.getUrlParams()?.project;
      if (isValidProjectId(urlProjectId)) {
        logger.debug(`[${MODULE}] Resolved project ID from URL: ${urlProjectId}`, {
          context: MODULE,
          source: 'url'
        });
        return urlProjectId;
      }
    }

    logger.warn(`[${MODULE}] Could not resolve valid project ID from any source`, {
      context: MODULE,
      appProjectId: state.currentProjectId,
      urlProjectId: navigationService?.getUrlParams?.()?.project
    });

    return null;
  }

  const api = {
    /* ------------------------------------------------------------- */
    /* Public project context methods                               */
    /* ------------------------------------------------------------- */

    getCurrentProject() {
      return _getState().currentProject || null;
    },

    getCurrentProjectId() {
      return _getState().currentProjectId || null;
    },

    /**
     * Sets the current project in the canonical app state
     * This should be the only way to change project context
     */
    setCurrentProject(project) {
      if (!appModule.setCurrentProject) {
        throw new Error(`[${MODULE}] appModule.setCurrentProject method not available`);
      }

      logger.info(`[${MODULE}] Setting current project`, {
        context: MODULE,
        projectId: project?.id,
        projectName: project?.name
      });

      appModule.setCurrentProject(project);
      
      // Emit centralized project change event
      this.emitProjectContextChanged({
        project,
        projectId: project?.id,
        source: 'setCurrentProject'
      });
    },

    /**
     * Resolves project ID from canonical sources with fallback logic
     * Replaces the complex resolution logic scattered across components
     */
    resolveProjectId() {
      return resolveProjectIdFromSources();
    },

    /**
     * Forces synchronization of project ID from canonical sources
     * Returns the resolved project ID or null if none found
     */
    syncProjectFromSources() {
      const resolvedId = resolveProjectIdFromSources();
      
      if (resolvedId && resolvedId !== this.getCurrentProjectId()) {
        logger.info(`[${MODULE}] Syncing project ID from sources: ${resolvedId}`, {
          context: MODULE,
          oldProjectId: this.getCurrentProjectId(),
          newProjectId: resolvedId
        });

        // Update the canonical state if we have the setter
        if (appModule.setCurrentProjectId) {
          appModule.setCurrentProjectId(resolvedId);
        }

        // Emit change event
        this.emitProjectContextChanged({
          projectId: resolvedId,
          source: 'sync'
        });
      }

      return resolvedId;
    },

    /**
     * Synchronizes project context with URL parameters
     * Updates canonical state if URL contains valid project ID
     */
    syncProjectFromUrl() {
      if (!navigationService?.getUrlParams) {
        logger.warn(`[${MODULE}] navigationService not available for URL sync`, {
          context: MODULE
        });
        return null;
      }

      const urlProjectId = navigationService.getUrlParams()?.project;
      
      if (isValidProjectId(urlProjectId)) {
        const currentProjectId = this.getCurrentProjectId();
        
        if (urlProjectId !== currentProjectId) {
          logger.info(`[${MODULE}] Syncing project from URL: ${urlProjectId}`, {
            context: MODULE,
            oldProjectId: currentProjectId,
            newProjectId: urlProjectId
          });

          if (appModule.setCurrentProjectId) {
            appModule.setCurrentProjectId(urlProjectId);
          }

          this.emitProjectContextChanged({
            projectId: urlProjectId,
            source: 'url'
          });
        }

        return urlProjectId;
      }

      return null;
    },

    /**
     * Emits standardized project context change event
     * Single event type that all components should listen for
     */
    emitProjectContextChanged(detail) {
      try {
        const event = new CustomEvent('projectContextChanged', { detail });
        
        // Emit on multiple buses for compatibility during transition
        if (DependencySystem.modules?.get('appModule')?.appBus) {
          DependencySystem.modules.get('appModule').appBus.dispatchEvent(event);
        }
        
        // Also emit on document for global listeners
        if (browserService?.getDocument) {
          browserService.getDocument().dispatchEvent(event);
        }

        logger.debug(`[${MODULE}] Emitted projectContextChanged event`, {
          context: MODULE,
          ...detail
        });
      } catch (error) {
        logger.error(`[${MODULE}] Failed to emit projectContextChanged event`, error, {
          context: MODULE
        });
      }
    },

    /**
     * Utility method to check if project ID is valid
     */
    isValidProjectId,

    /**
     * Gets complete project context state
     */
    getProjectContext() {
      const state = _getState();
      return {
        currentProject: state.currentProject || null,
        currentProjectId: state.currentProjectId || null,
        isValidProjectId: isValidProjectId(state.currentProjectId)
      };
    },

    /* ------------------------------------------------------------- */
    /* Cleanup method for interface consistency                     */
    /* ------------------------------------------------------------- */
    cleanup() {
      logger.debug(`[${MODULE}] cleanup() called`, {
        context: MODULE
      });
    }
  };

  return api;
}