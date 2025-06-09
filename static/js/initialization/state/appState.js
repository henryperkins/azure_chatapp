// ========================================
// FILE: /initialization/state/appState.js
// ========================================
/**
 * Application State Management
 * Extracted from appInitializer.js inline appModule
 * ~200 lines
 */

export function createAppState(deps) {
    const { DependencySystem, eventService, globalUtils } = deps;

    // Internal logger reference with setter pattern
    let _logger = deps.logger;

    if (!_logger) {
        const winConsole = DependencySystem?.modules?.get?.('browserService')?.getWindow?.()?.console;
        _logger = winConsole ?? { info() {}, warn() {}, error() {}, debug() {}, log() {} };
    }

    function setLogger(newLogger) {
        if (newLogger) _logger = newLogger;
    }

    // Application state object
    const state = {
        isAuthenticated: false,
        currentUser: null,
        currentProjectId: null,
        currentProject: null,
        isReady: false,
        disableErrorTracking: false,
        initialized: false,
        initializing: false,
        currentPhase: 'idle',
        knowledgeBaseComponentReady: false
    };

    function setAuthState(newAuthState) {
        const oldAuthState = {
            isAuthenticated: state.isAuthenticated,
            currentUser: state.currentUser
                ? { id: state.currentUser.id, username: state.currentUser.username }
                : null
        };

        const newAuthStateForLog = {
            isAuthenticated: newAuthState.isAuthenticated,
            currentUser: newAuthState.currentUser
                ? { id: newAuthState.currentUser.id, username: newAuthState.currentUser.username }
                : null
        };

        _logger.info('[appState][setAuthState] Updating auth state.', {
            oldAuthState,
            newAuthState: newAuthStateForLog,
            context: 'appState:setAuthState'
        });

        Object.assign(state, newAuthState);
    }

    function setAppLifecycleState(newLifecycleState) {
        const oldLifecycleStateForLog = {
            isReady: state.isReady,
            initialized: state.initialized,
            initializing: state.initializing,
            currentPhase: state.currentPhase
        };

        _logger.info('[appState][setAppLifecycleState] Updating app lifecycle state.', {
            oldLifecycleState: oldLifecycleStateForLog,
            newLifecycleState,
            context: 'appState:setAppLifecycleState'
        });

        Object.assign(state, newLifecycleState);

        if (newLifecycleState.initialized === true) {
            if (state.currentPhase === 'initialized_idle') {
                state.isReady = true;
            } else if (state.currentPhase === 'failed_idle') {
                state.isReady = false;
            }
        } else if (Object.prototype.hasOwnProperty.call(newLifecycleState, 'isReady')) {
            state.isReady = newLifecycleState.isReady;
        }
    }

    function setCurrentProject(projectIdOrObject) {
        const oldProjectId = state.currentProjectId;
        const oldProject = state.currentProject;

        if (projectIdOrObject === null) {
            state.currentProjectId = null;
            state.currentProject = null;
            _logger.info('[appState][setCurrentProject] Clearing current project.', {
                oldProjectId,
                context: 'appState:setCurrentProject:clear'
            });
        } else if (typeof projectIdOrObject === 'string') {
            state.currentProjectId = projectIdOrObject;
            if (state.currentProject?.id !== projectIdOrObject) {
                state.currentProject = null;
            }
            _logger.info('[appState][setCurrentProject] Updating current project ID.', {
                oldProjectId,
                newProjectId: projectIdOrObject,
                context: 'appState:setCurrentProject:id'
            });
        } else if (
            projectIdOrObject &&
            typeof projectIdOrObject === 'object' &&
            projectIdOrObject.id
        ) {
            state.currentProjectId = projectIdOrObject.id;
            state.currentProject = projectIdOrObject;
            _logger.info('[appState][setCurrentProject] Updating current project object.', {
                oldProjectId,
                newProjectId: projectIdOrObject.id,
                context: 'appState:setCurrentProject:object'
            });
        } else {
            _logger.warn('[appState][setCurrentProject] Invalid project data provided.', {
                projectIdOrObject,
                context: 'appState:setCurrentProject:invalid'
            });
            return;
        }

        // Emit project change events
        if (oldProjectId !== state.currentProjectId) {
            try {
                const detail = {
                    project: state.currentProject ? { ...state.currentProject } : null,
                    previousProject: oldProject ? { ...oldProject } : null,
                    projectId: state.currentProject?.id || null,
                    previousProjectId: oldProject?.id || null
                };

                if (eventService?.emit) {
                    eventService.emit('currentProjectChanged', detail);
                }

                // Legacy event for backward compatibility
                if (state.currentProject) {
                    _logger.debug('[appState] Dispatching legacy "projectSelected" event.', {
                        projectId: state.currentProject.id,
                        context: 'appState:projectChangeEvent:legacy'
                    });

                    if (eventService?.emit) {
                        eventService.emit('projectSelected', {
                            projectId: state.currentProject.id,
                            project: { ...state.currentProject }
                        });
                    }
                }
            } catch (error) {
                _logger.error('[appState] Failed to dispatch project change event.', {
                    error: error.message,
                    context: 'appState:projectChangeEvent:error'
                });
            }
        }
    }

    function cleanup() {
        const handlers = DependencySystem.modules.get('eventHandlers');
        if (handlers) handlers.cleanupListeners({ context: 'appState' });
        _logger.debug('[appState] Cleanup completed', { context: 'appState:cleanup' });
    }

    // Public API
    return {
        state,
        setLogger,
        setAuthState,
        setAppLifecycleState,
        setCurrentProject,
        isAuthenticated: () => state.isAuthenticated,
        getCurrentUser: () => state.currentUser,
        getCurrentProjectId: () => state.currentProjectId,
        getProjectId: () => state.currentProjectId, // Legacy alias
        validateUUID: (id) => globalUtils?.isValidProjectId?.(id) === true,
        getCurrentProject: () => state.currentProject,
        isAppReady: () => state.isReady,
        isInitialized: () => state.initialized,
        isInitializing: () => state.initializing,
        getCurrentPhase: () => state.currentPhase,
        cleanup
    };
}
