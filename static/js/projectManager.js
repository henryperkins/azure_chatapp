/**
 * @file projectManager.js
 * @description Aligned service-layer module.  Handles high-level project business
 *              logic while delegating HTTP work to apiClient and global state to
 *              appModule.  NO DOM, NO event listeners, NO direct state caches.
 */

const MODULE_CONTEXT = 'ProjectManager';

/* ------------------------------------------------------------------------- */
/*  Utility – kept for legacy callers                                        */
/* ------------------------------------------------------------------------- */
export function isValidProjectId(id) {
    if (typeof id === 'number') return id > 0;
    if (typeof id !== 'string') return false;
    const trimmed = id.trim();
    const UUID_REGEX =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return UUID_REGEX.test(trimmed);
}

/* ------------------------------------------------------------------------- */
/*  Factory                                                                  */
/* ------------------------------------------------------------------------- */
export function createProjectManager(dependencies = {}) {
    const {
        logger,
        projectAPIService,
        projectContextService,
        chatManager: initialChatManager
    } = dependencies;

    // --- DI validation ------------------------------------------------------
    const required = [
        'logger',
        'projectAPIService',
        'projectContextService'
    ];
    for (const dep of required) {
        if (!dependencies[dep]) {
            throw new Error(`[${MODULE_CONTEXT}] Missing required dependency: ${dep}`);
        }
    }

    // ChatManager is optional and can be injected later
    let chatManager = initialChatManager;

    /* --------------------------- helpers ---------------------------------- */
    function _logInfo(msg, meta = {}) {
        logger.info(`[${MODULE_CONTEXT}] ${msg}`, { ...meta, context: MODULE_CONTEXT });
    }

    function _logError(msg, err) {
        logger.error(`[${MODULE_CONTEXT}] ${msg}`, err, { context: MODULE_CONTEXT });
    }


    /* ----------------------- public service API --------------------------- */
    return {
        /* ------------------ Queries / fetch -------------------------------- */
        async loadProjects(filter = 'all') {
            try {
                return await projectAPIService.loadProjects(filter);
            } catch (err) {
                _logError('loadProjects failed', err);
                throw err;
            }
        },

        async loadProjectDetails(projectId) {
            if (!isValidProjectId(projectId)) {
                throw new Error('Invalid project ID');
            }

            try {
                return await projectAPIService.loadProjectDetails(projectId);
            } catch (err) {
                _logError('loadProjectDetails failed', err);
                throw err;
            }
        },

        async loadProjectFiles(projectId) {
            try {
                return await projectAPIService.loadProjectFiles(projectId);
            } catch (err) {
                _logError('loadProjectFiles failed', err);
                throw err;
            }
        },

        async loadProjectConversations(projectId) {
            try {
                return await projectAPIService.loadProjectConversations(projectId);
            } catch (err) {
                _logError('loadProjectConversations failed', err);
                throw err;
            }
        },

        /* ------------------ Mutations -------------------------------------- */
        async saveProject(projectData) {
            try {
                return await projectAPIService.saveProject(projectData);
            } catch (err) {
                _logError('saveProject failed', err);
                throw err;
            }
        },

        async deleteProject(projectId) {
            try {
                return await projectAPIService.deleteProject(projectId);
            } catch (err) {
                _logError('deleteProject failed', err);
                throw err;
            }
        },

        async deleteFile(projectId, fileId) {
            try {
                return await projectAPIService.deleteFile(projectId, fileId);
            } catch (err) {
                _logError('deleteFile failed', err);
                throw err;
            }
        },

        async downloadFile(projectId, fileId) {
            try {
                const blob = await projectAPIService.downloadFileBlob(projectId, fileId);

                const blobUrl = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = blobUrl;
                link.download = `file_${fileId}`;
                link.click();
                URL.revokeObjectURL(blobUrl);
            } catch (err) {
                _logError('downloadFile failed', err);
                throw err;
            }
        },

        /* ------------- Higher-order orchestration workflows --------------- */
        async createProjectAndDefaultConversation(projectData) {
            _logInfo('Creating project + default conversation');
            try {
                const newProject = await this.saveProject(projectData);
                // Update project context via service
                projectContextService.setCurrentProject(newProject);

                // Create first conversation if chatManager is available
                if (chatManager && typeof chatManager.createNewConversation === 'function') {
                    await chatManager.createNewConversation(newProject.id);
                } else {
                    _logInfo('ChatManager not available - skipping default conversation creation');
                }

                return newProject;
            } catch (err) {
                _logError('createProjectAndDefaultConversation failed', err);
                throw err;
            }
        },

        /* ---------------------- Chat Manager Injection -------------------- */
        setChatManager(newChatManager) {
            if (newChatManager) {
                chatManager = newChatManager;
                _logInfo('ChatManager injected successfully');
            }
        },

        /* ---------------------- Lifecycle ---------------------------------- */
        cleanup() {
            _logInfo('Cleanup complete.');
        }
    };
}
