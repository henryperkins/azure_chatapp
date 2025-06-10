/**
 * Application State Module
 * Manages the central application state and lifecycle flags
 */

export function createAppState({ DependencySystem, logger, eventService, globalUtils }) {
    if (!DependencySystem || !logger || !eventService || !globalUtils) {
        throw new Error('[appState] Missing required dependencies');
    }

    // Application state container
    const state = {
        // Lifecycle flags - only managed here per guardrails
        initializing: false,
        initialized: false,
        isReady: false,
        currentPhase: 'idle',
        
        // Application data
        user: null,
        project: null,
        ui: {
            activeView: null,
            sidebarCollapsed: false,
            theme: 'light'
        }
    };

    function setAppLifecycleState(updates) {
        Object.assign(state, updates);
        logger.info('[appState] Lifecycle state updated', { 
            context: 'appState.setLifecycleState',
            state: { ...state }
        });
        
        // Emit state change event
        eventService.emit('app:state:changed', { state: { ...state } });
    }

    function getState() {
        return { ...state };
    }

    function updateState(updates) {
        Object.assign(state, updates);
        eventService.emit('app:state:changed', { state: { ...state } });
    }

    function cleanup() {
        state.initializing = false;
        state.initialized = false;
        state.isReady = false;
        state.currentPhase = 'cleanup';
        logger.info('[appState] State cleaned up');
    }

    return {
        state,
        setAppLifecycleState,
        getState,
        updateState,
        cleanup
    };
}