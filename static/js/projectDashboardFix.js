// Temporary fix for projectDashboard template loading race condition
// This ensures the projectListHtmlLoaded event is properly emitted even on failure

export function patchProjectDashboard(projectDashboard, { domReadinessService, logger }) {
  // Store original showProjectList
  const originalShowProjectList = projectDashboard.showProjectList;

  // Override showProjectList to ensure template is loaded
  projectDashboard.showProjectList = async function() {
    try {
      // First ensure the container exists
      await domReadinessService.dependenciesAndElements({
        domSelectors: ['#projectListView'],
        timeout: 5000,
        context: 'ProjectDashboard_showList_patch'
      });

      // Check if template already loaded
      const container = document.querySelector('#projectListView');
      if (container && !container.dataset.htmlLoaded) {
        logger.warn('[ProjectDashboardPatch] Template not loaded, manually emitting event', { context: 'projectDashboard' });

        // Emit the event that ProjectListComponent is waiting for
        domReadinessService.emitReplayable('projectListHtmlLoaded', {
          success: true,
          synthetic: true,
          reason: 'Manual emit due to race condition fix'
        });
      }

      // Call original method
      return await originalShowProjectList.apply(this, arguments);
    } catch (err) {
      logger.error('[ProjectDashboardPatch] Error in patched showProjectList', err, { context: 'projectDashboard' });

      // Always emit the event to unblock waiting components
      domReadinessService.emitReplayable('projectListHtmlLoaded', {
        success: false,
        error: err.message,
        synthetic: true
      });

      throw err;
    }
  };

  return projectDashboard;
}
