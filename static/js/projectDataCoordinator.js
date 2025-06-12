/**
 * @file projectDataCoordinator.js
 * @description Coordinates data operations for the project details view, interacting
 * with services and emitting events upon completion. Contains no DOM logic.
 */

const MODULE_CONTEXT = 'ProjectDataCoordinator';

export function createProjectDataCoordinator(dependencies) {
    const {
        projectManager,
        modalManager,
        logger,
        eventService,
        sanitizer,
    } = dependencies;

    // Strict Dependency Validation
    const requiredDeps = ['projectManager', 'modalManager', 'logger', 'eventService', 'sanitizer'];
    for (const dep of requiredDeps) {
        if (!dependencies[dep]) {
            throw new Error(`[${MODULE_CONTEXT}] Missing required dependency: ${dep}`);
        }
    }

    function _logInfo(msg, meta = {}) {
        logger.info(`[${MODULE_CONTEXT}] ${msg}`, { ...meta, context: MODULE_CONTEXT });
    }

    function _logError(msg, err) {
        logger.error(`[${MODULE_CONTEXT}] ${msg}`, err, { context: MODULE_CONTEXT });
    }

    async function _fetchAndEmit(projectId, fetcher, eventName) {
        try {
            const data = await fetcher(projectId);
            eventService.emit(`project:${eventName}Loaded`, { projectId, [eventName]: data });
            return data;
        } catch (err) {
            _logError(`Failed to load ${eventName} for project ${projectId}`, err);
            eventService.emit(`project:${eventName}Error`, { projectId, error: err });
            throw err;
        }
    }

    return {
            async loadProjects(filter = 'all') {
                try {
                    _logInfo(`Loading projects with filter: ${filter}`);
                    const projects = await projectManager.loadProjects(filter);
                    eventService.emit('project:listLoaded', { projects, filter });
                    return projects;
                } catch (err) {
                    _logError('Failed to load project list', err);
                    eventService.emit('project:listError', { error: err });
                    throw err;
                }
            },

            async loadProjectData(projectId) {
            _logInfo(`Loading all data for project ${projectId}`);
            try {
                const projectData = await projectManager.loadProjectDetails(projectId);
                eventService.emit('project:dataLoaded', { projectId, projectData });
            } catch (err) {
                _logError(`Failed to load project data for ${projectId}`, err);
                eventService.emit('project:dataError', { projectId, error: err });
            }
        },

        loadProjectFiles(projectId) {
            return _fetchAndEmit(projectId, projectManager.loadProjectFiles, 'files');
        },

        loadProjectConversations(projectId) {
            return _fetchAndEmit(projectId, projectManager.loadProjectConversations, 'conversations');
        },

        async deleteFile(projectId, fileId, fileName) {
            _logInfo(`Requesting delete confirmation for file ${fileId}`);
            const confirmed = await modalManager.confirmAction({
                title: 'Confirm File Deletion',
                message: `Are you sure you want to permanently delete "${sanitizer.sanitize(fileName)}"? This action cannot be undone.`,
                confirmText: 'Delete File',
                level: 'error'
            });

            if (confirmed) {
                try {
                    _logInfo(`User confirmed deletion. Deleting file ${fileId}.`);
                    await projectManager.deleteFile(projectId, fileId);
                    eventService.emit('project:fileDeleted', { projectId, fileId });
                    // Re-fetch files to update the list
                    this.loadProjectFiles(projectId);
                } catch (err) {
                    _logError(`Failed to delete file ${fileId}`, err);
                    modalManager.show('error', { message: `Failed to delete file: ${err.message}` });
                }
            } else {
                _logInfo('File deletion cancelled by user.');
            }
        },

        async downloadFile(projectId, fileId) {
             _logInfo(`Downloading file ${fileId} for project ${projectId}`);
            try {
                await projectManager.downloadFile(projectId, fileId);
            } catch (err) {
                _logError(`Failed to download file ${fileId}`, err);
                modalManager.show('error', { message: `Failed to download file: ${err.message}` });
            }
        },

        cleanup() {
            _logInfo('Cleaning up data coordinator.');
            // This module typically doesn't hold listeners, but this is good practice.
        }
    };
}
