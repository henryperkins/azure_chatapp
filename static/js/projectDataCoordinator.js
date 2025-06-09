/**
 * ProjectDataCoordinator – extracted data-layer helpers (Phase-2)
 * -------------------------------------------------------------
 * Handles all data operations for project details: loading project data,
 * managing files, conversations, and artifacts. Extracted from oversized
 * ProjectDetailsComponent to enforce separation of concerns.
 */

export function createProjectDataCoordinator({
  projectManager: initialProjectManager,
  logger,
  eventService
} = {}) {
  if (!logger) {
    throw new Error('[ProjectDataCoordinator] logger dependency missing');
  }

  const MODULE = 'ProjectDataCoordinator';

  // Store project manager reference (can be updated later)
  let projectManager = initialProjectManager;

  const _log = (msg, extra = {}) => logger?.debug?.(`[${MODULE}] ${msg}`, {
    context: MODULE,
    ...extra
  });

  const _logError = (msg, err, extra = {}) => {
    logger?.error?.(`[${MODULE}] ${msg}`, err?.stack || err, {
      context: MODULE,
      ...extra
    });
  };

  async function loadProjectData(projectId) {
    _log('loadProjectData()', { projectId });

    try {
      if (!projectId) {
        throw new Error('Project ID is required');
      }

      const projectData = await projectManager.loadProject?.(projectId);
      if (!projectData) {
        throw new Error('Failed to load project data');
      }

      // Emit event for UI updates
      eventService?.emit?.('project:dataLoaded', { projectId, projectData });

      return projectData;
    } catch (err) {
      _logError('Failed to load project data', err, { projectId });
      throw err;
    }
  }

  async function loadProjectFiles(projectId) {
    _log('loadProjectFiles()', { projectId });

    try {
      if (!projectId) {
        throw new Error('Project ID is required');
      }

      const files = await projectManager.loadProjectFiles?.(projectId);

      // Emit event for UI updates
      eventService?.emit?.('project:filesLoaded', { projectId, files });

      return files || [];
    } catch (err) {
      _logError('Failed to load project files', err, { projectId });
      throw err;
    }
  }

  async function loadProjectConversations(projectId) {
    _log('loadProjectConversations()', { projectId });

    try {
      if (!projectId) {
        throw new Error('Project ID is required');
      }

      const conversations = await projectManager.loadProjectConversations?.(projectId);

      // Emit event for UI updates
      eventService?.emit?.('project:conversationsLoaded', { projectId, conversations });

      return conversations || [];
    } catch (err) {
      _logError('Failed to load project conversations', err, { projectId });
      throw err;
    }
  }

  async function loadProjectArtifacts(projectId) {
    _log('loadProjectArtifacts()', { projectId });

    try {
      if (!projectId) {
        throw new Error('Project ID is required');
      }

      const artifacts = await projectManager.loadProjectArtifacts?.(projectId);

      // Emit event for UI updates
      eventService?.emit?.('project:artifactsLoaded', { projectId, artifacts });

      return artifacts || [];
    } catch (err) {
      _logError('Failed to load project artifacts', err, { projectId });
      throw err;
    }
  }

  async function deleteFile(projectId, fileId) {
    _log('deleteFile()', { projectId, fileId });

    try {
      if (!projectId || !fileId) {
        throw new Error('Project ID and file ID are required');
      }

      const result = await projectManager.deleteFile?.(projectId, fileId);

      // Reload files after deletion
      await loadProjectFiles(projectId);

      // Emit event for UI updates
      eventService?.emit?.('project:fileDeleted', { projectId, fileId });

      return result;
    } catch (err) {
      _logError('Failed to delete file', err, { projectId, fileId });
      throw err;
    }
  }

  async function downloadFile(projectId, fileId, fileName) {
    _log('downloadFile()', { projectId, fileId, fileName });

    try {
      if (!projectId || !fileId) {
        throw new Error('Project ID and file ID are required');
      }

      const result = await projectManager.downloadFile?.(projectId, fileId);

      // Emit event for tracking
      eventService?.emit?.('project:fileDownloaded', { projectId, fileId, fileName });

      return result;
    } catch (err) {
      _logError('Failed to download file', err, { projectId, fileId, fileName });
      throw err;
    }
  }

  async function downloadArtifact(projectId, artifactId) {
    _log('downloadArtifact()', { projectId, artifactId });

    try {
      if (!projectId || !artifactId) {
        throw new Error('Project ID and artifact ID are required');
      }

      const result = await projectManager.downloadArtifact?.(projectId, artifactId);

      // Emit event for tracking
      eventService?.emit?.('project:artifactDownloaded', { projectId, artifactId });

      return result;
    } catch (err) {
      _logError('Failed to download artifact', err, { projectId, artifactId });
      throw err;
    }
  }

  async function updateProject(projectId, updates) {
    _log('updateProject()', { projectId, updates });

    try {
      if (!projectId) {
        throw new Error('Project ID is required');
      }

      const result = await projectManager.updateProject?.(projectId, updates);

      // Reload project data after update
      await loadProjectData(projectId);

      // Emit event for UI updates
      eventService?.emit?.('project:updated', { projectId, updates });

      return result;
    } catch (err) {
      _logError('Failed to update project', err, { projectId, updates });
      throw err;
    }
  }

  async function archiveProject(projectId, archived = true) {
    _log('archiveProject()', { projectId, archived });

    try {
      if (!projectId) {
        throw new Error('Project ID is required');
      }

      const result = await projectManager.archiveProject?.(projectId, archived);

      // Reload project data after archiving
      await loadProjectData(projectId);

      // Emit event for UI updates
      eventService?.emit?.('project:archiveStatusChanged', { projectId, archived });

      return result;
    } catch (err) {
      _logError('Failed to archive project', err, { projectId, archived });
      throw err;
    }
  }

  async function deleteProject(projectId) {
    _log('deleteProject()', { projectId });

    try {
      if (!projectId) {
        throw new Error('Project ID is required');
      }

      const result = await projectManager.deleteProject?.(projectId);

      // Emit event for UI updates (navigation might be needed)
      eventService?.emit?.('project:deleted', { projectId });

      return result;
    } catch (err) {
      _logError('Failed to delete project', err, { projectId });
      throw err;
    }
  }

  // Legacy method aliases for backward compatibility during migration
  async function refreshFileList(projectId) {
    return loadProjectFiles(projectId);
  }

  // Setter method to inject project manager after creation
  function setProjectManager(pm) {
    _log('setProjectManager()', { hasProjectManager: !!pm });
    projectManager = pm;
  }

  return {
    // Primary data operations
    loadProjectData,
    loadProjectFiles,
    loadProjectConversations,
    loadProjectArtifacts,

    // File operations
    deleteFile,
    downloadFile,

    // Artifact operations
    downloadArtifact,

    // Project operations
    updateProject,
    archiveProject,
    deleteProject,

    // Legacy aliases
    refreshFileList,

    // Project manager setter
    setProjectManager,

    cleanup() {
      _log('cleanup()');
      // No specific cleanup needed for data coordinator
    }
  };
}

export default createProjectDataCoordinator;
