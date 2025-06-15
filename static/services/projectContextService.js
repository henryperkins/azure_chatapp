/**
 * @file projectContextService.js
 * @description Sole owner of currentProject state management with event emission.
 *              Centralized project context management with proper DI compliance.
 *              Combines the comprehensive functionality with clean DI patterns.
 */

export function createProjectContextService(dependencies = {}) {
    const {
        eventService,
        logger,
        appModule,
        navigationService,
        _browserService,
        _DependencySystem
    } = dependencies;

    // DI validation for required dependencies
    const required = ['eventService', 'logger', 'appModule'];
    for (const dep of required) {
        if (!dependencies[dep]) {
            throw new Error(`[projectContextService] Missing required dependency: ${dep}`);
        }
    }

    const MODULE_CONTEXT = 'projectContextService';

    function logInfo(msg, meta = {}) {
        logger.info(`[${MODULE_CONTEXT}] ${msg}`, { ...meta, context: MODULE_CONTEXT });
    }

    function logError(msg, err) {
        logger.error(`[${MODULE_CONTEXT}] ${msg}`, err, { context: MODULE_CONTEXT });
    }

    function logDebug(msg, meta = {}) {
        logger.debug(`[${MODULE_CONTEXT}] ${msg}`, { ...meta, context: MODULE_CONTEXT });
    }

    /**
     * Validates if a project ID is valid (non-null, non-empty string or valid number)
     */
    function isValidProjectId(id) {
        if (typeof id === 'number') return id > 0;
        if (typeof id !== 'string') return false;
        const trimmed = id.trim();
        const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return UUID_REGEX.test(trimmed);
    }

    return {
        /**
         * Get current project ID
         * @returns {string|null} - Current project ID or null
         */
        getCurrentProjectId() {
            return appModule.state.currentProjectId;
        },

        /**
         * Get current project object
         * @returns {Object|null} - Current project object or null
         */
        getCurrentProject() {
            return appModule.state.currentProject;
        },

        /**
         * Set current project - delegates to appModule to maintain consistency
         * with existing state management while providing a cleaner interface
         * @param {string|Object|null} projectIdOrObject - Project ID, project object, or null to clear
         */
        setCurrentProject(projectIdOrObject) {
            try {
                // Delegate to appModule's existing setCurrentProject method
                // This ensures all existing event emission and state management logic is preserved
                if (typeof appModule.setCurrentProject === 'function') {
                    appModule.setCurrentProject(projectIdOrObject);
                    logInfo('Project context updated', {
                        projectId: appModule.state.currentProjectId,
                        hasProjectObject: !!appModule.state.currentProject
                    });
                } else {
                    logError('appModule.setCurrentProject is not available');
                    throw new Error('appModule.setCurrentProject method not available');
                }
            } catch (error) {
                logError('Failed to set current project', error);
                throw error;
            }
        },

        /**
         * Clear current project context
         */
        clearCurrentProject() {
            this.setCurrentProject(null);
        },

        /**
         * Check if a project is currently selected
         * @returns {boolean} - True if a project is selected
         */
        hasCurrentProject() {
            return !!(appModule.state.currentProjectId && appModule.state.currentProject);
        },

        /**
         * Check if the given project ID matches the current project
         * @param {string} projectId - Project ID to check
         * @returns {boolean} - True if it matches current project
         */
        isCurrentProject(projectId) {
            return appModule.state.currentProjectId === projectId;
        },

        /**
         * Validate project ID format
         * @param {*} id - ID to validate
         * @returns {boolean} - True if valid
         */
        isValidProjectId,

        /**
         * Get current project context summary for logging/debugging
         * @returns {Object} - Context summary
         */
        getContextSummary() {
            return {
                hasProject: this.hasCurrentProject(),
                projectId: appModule.state.currentProjectId,
                projectName: appModule.state.currentProject?.name || null,
                timestamp: new Date().toISOString()
            };
        },

        /**
         * Sync project context from URL if available and valid
         * @returns {string|null} - Project ID from URL or null
         */
        syncFromUrl() {
            if (!navigationService?.getUrlParams) {
                logDebug('navigationService not available for URL sync');
                return null;
            }

            try {
                const urlProjectId = navigationService.getUrlParams()?.project;
                
                if (isValidProjectId(urlProjectId)) {
                    const currentProjectId = this.getCurrentProjectId();
                    
                    if (urlProjectId !== currentProjectId) {
                        logInfo(`Syncing project from URL: ${urlProjectId}`, {
                            oldProjectId: currentProjectId,
                            newProjectId: urlProjectId
                        });

                        // Use setCurrentProject to ensure proper event emission
                        this.setCurrentProject(urlProjectId);
                    }

                    return urlProjectId;
                }
            } catch (error) {
                logError('Failed to sync project from URL', error);
            }

            return null;
        },

        /**
         * Emit a custom project context event via eventService
         * @param {string} eventName - Event name to emit
         * @param {Object} detail - Event detail data
         */
        emitProjectContextEvent(eventName, detail = {}) {
            try {
                const eventDetail = {
                    ...detail,
                    projectId: this.getCurrentProjectId(),
                    project: this.getCurrentProject(),
                    contextSummary: this.getContextSummary()
                };

                if (eventService?.emit) {
                    eventService.emit(eventName, eventDetail);
                    logDebug(`Emitted project context event: ${eventName}`, {
                        eventName,
                        projectId: eventDetail.projectId
                    });
                } else {
                    logError('eventService not available for event emission');
                }
            } catch (error) {
                logError(`Failed to emit project context event: ${eventName}`, error);
            }
        },

        /**
         * Get project context change handler for event listeners
         * @param {Function} callback - Function to call when project changes
         * @returns {Function} - Event handler function
         */
        createProjectChangeHandler(callback) {
            if (typeof callback !== 'function') {
                throw new Error('Callback must be a function');
            }

            return (event) => {
                try {
                    const detail = event.detail || {};
                    const contextSummary = this.getContextSummary();
                    callback({
                        ...detail,
                        contextSummary
                    });
                } catch (error) {
                    logError('Project change handler failed', error);
                }
            };
        },

        cleanup() {
            logInfo('Cleanup complete.');
        }
    };
}