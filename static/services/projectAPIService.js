/**
 * @file projectAPIService.js
 * @description Thin wrapper around apiClient for project-related API operations.
 *              Provides a clean, consistent interface for all project CRUD operations
 *              without any state management or business logic.
 */

const MODULE_CONTEXT = 'ProjectAPIService';

/**
 * Normalize heterogeneous API list envelopes → array
 * @param {*} resp - API response that might be array or wrapped object
 * @returns {Array} - Normalized array of projects
 */
function normalizeProjectList(resp) {
    if (Array.isArray(resp)) return resp;
    if (resp?.projects && Array.isArray(resp.projects)) return resp.projects;
    if (resp?.data && Array.isArray(resp.data)) return resp.data;
    return [];
}

export function createProjectAPIService(dependencies = {}) {
    const {
        apiClient,
        apiEndpoints,
        logger
    } = dependencies;

    // DI validation
    const required = ['apiClient', 'apiEndpoints', 'logger'];
    for (const dep of required) {
        if (!dependencies[dep]) {
            throw new Error(`[${MODULE_CONTEXT}] Missing required dependency: ${dep}`);
        }
    }

    function logInfo(msg, meta = {}) {
        logger.info(`[${MODULE_CONTEXT}] ${msg}`, { ...meta, context: MODULE_CONTEXT });
    }

    function logError(msg, err) {
        logger.error(`[${MODULE_CONTEXT}] ${msg}`, err, { context: MODULE_CONTEXT });
    }

    return {
        /**
         * Load projects with optional filtering
         * @param {string} filter - Filter type ('all', 'active', etc.)
         * @returns {Promise<Array>} - Array of projects
         */
        async loadProjects(filter = 'all') {
            // Use injected browserService for origin, not window global
            const origin = (typeof dependencies.browserService?.getWindow === 'function')
                ? dependencies.browserService.getWindow()?.location?.origin
                : '';
            const url = new URL(apiEndpoints.PROJECTS(), origin);
            url.searchParams.set('filter', filter);

            try {
                const resp = await apiClient.get(url.pathname + url.search);
                return normalizeProjectList(resp);
            } catch (err) {
                logError('loadProjects failed', err);
                throw err;
            }
        },

        /**
         * Load detailed project information
         * @param {string|number} projectId - Project identifier
         * @returns {Promise<Object>} - Project details
         */
        async loadProjectDetails(projectId) {
            try {
                return await apiClient.get(apiEndpoints.PROJECT_DETAIL(projectId));
            } catch (err) {
                logError('loadProjectDetails failed', err);
                throw err;
            }
        },

        /**
         * Load files for a project
         * @param {string|number} projectId - Project identifier
         * @returns {Promise<Array>} - Array of project files
         */
        async loadProjectFiles(projectId) {
            try {
                return await apiClient.get(apiEndpoints.PROJECT_FILES(projectId));
            } catch (err) {
                logError('loadProjectFiles failed', err);
                throw err;
            }
        },

        /**
         * Load conversations for a project
         * @param {string|number} projectId - Project identifier
         * @returns {Promise<Array>} - Array of conversations
         */
        async loadProjectConversations(projectId) {
            try {
                return await apiClient.get(apiEndpoints.CONVERSATIONS(projectId));
            } catch (err) {
                logError('loadProjectConversations failed', err);
                throw err;
            }
        },

        /**
         * Save project (create or update)
         * @param {Object} projectData - Project data to save
         * @returns {Promise<Object>} - Saved project
         */
        async saveProject(projectData) {
            const isUpdate = Boolean(projectData.id);
            const url = isUpdate
                ? apiEndpoints.PROJECT_DETAIL(projectData.id)
                : apiEndpoints.PROJECTS();
            const method = isUpdate ? 'put' : 'post';

            try {
                return await apiClient[method](url, projectData);
            } catch (err) {
                logError('saveProject failed', err);
                throw err;
            }
        },

        /**
         * Delete a project
         * @param {string|number} projectId - Project identifier
         * @returns {Promise<void>}
         */
        async deleteProject(projectId) {
            try {
                return await apiClient.delete(apiEndpoints.PROJECT_DETAIL(projectId));
            } catch (err) {
                logError('deleteProject failed', err);
                throw err;
            }
        },

        /**
         * Delete a file from a project
         * @param {string|number} projectId - Project identifier
         * @param {string|number} fileId - File identifier
         * @returns {Promise<void>}
         */
        async deleteFile(projectId, fileId) {
            try {
                return await apiClient.delete(
                    apiEndpoints.FILE_DETAIL(projectId, fileId)
                );
            } catch (err) {
                logError('deleteFile failed', err);
                throw err;
            }
        },

        /**
         * Download a file from a project
         * @param {string|number} projectId - Project identifier
         * @param {string|number} fileId - File identifier
         * @returns {Promise<Blob>} - File blob for download
         */
        async downloadFileBlob(projectId, fileId) {
            try {
                return await apiClient.get(
                    apiEndpoints.FILE_DOWNLOAD(projectId, fileId),
                    {},
                    { responseType: 'blob' }
                );
            } catch (err) {
                logError('downloadFileBlob failed', err);
                throw err;
            }
        },

        cleanup() {
            logInfo('Cleanup complete.');
        }
    };
}
