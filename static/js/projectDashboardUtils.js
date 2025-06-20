/**
 * @module projectDashboardUtils
 * @description Centralized utility functions for the project dashboard, adhering to strict DI.
 * Provides UI helpers and event listener setup for project detail actions.
 *
 * @param {Object} options - Dependency Injection options.
 * @param {Object} options.DependencySystem - Required. Central orchestrator.
 * @param {Object} options.eventHandlers - Required. Event listener management.
 * @param {Object} options.projectManager - Required. Project data and actions.
 * @param {Object} options.modalManager - Required. Modal interaction handler.
 * @param {Object} options.sanitizer - Required. HTML sanitization utility.
 * @param {Object} options.domAPI - Required. DOM manipulation abstraction.
 * @param {Function} [options.formatDate] - Optional date formatter.
 * @param {Function} [options.formatBytes] - Optional byte formatter.
 * @param {Object} options.globalUtils - Required. Global utility functions.
 * @param {Object} options.eventService - Required. Unified event service for publish/subscribe.
 * @returns {Object} Public API for the dashboard utilities.
 */
const MODULE = 'ProjectDashboardUtils';

// --- DI Helpers (Keep internal, no export needed) ---
function _getDependency(dep, name, DependencySystem, isRequired = true) {
  const resolved = dep || DependencySystem?.modules?.get?.(name) || DependencySystem?.get?.(name);
  if (isRequired && !resolved) {
    throw new Error(`[${MODULE}] Missing required dependency: ${name}`);
  }
  return resolved;
}

function _resolveDependencies(opts) {
  const { DependencySystem } = opts;
  if (!DependencySystem) throw new Error(`[${MODULE}] DependencySystem is required`);
  return {
    eventHandlers: _getDependency(opts.eventHandlers, 'eventHandlers', DependencySystem),
    projectManager: _getDependency(opts.projectManager, 'projectManager', DependencySystem),
    modalManager: _getDependency(opts.modalManager, 'modalManager', DependencySystem),
    projectModal: _getDependency(opts.projectModal, 'projectModal', DependencySystem, false),
    sanitizer: _getDependency(opts.sanitizer, 'sanitizer', DependencySystem),
    domAPI: _getDependency(opts.domAPI, 'domAPI', DependencySystem), // Add domAPI
    // Optional formatters
    formatDate: _getDependency(opts.formatDate, 'formatDate', DependencySystem, false),
    formatBytes: _getDependency(opts.formatBytes, 'formatBytes', DependencySystem, false),
  };
}


function createUIUtils({ eventHandlers, _sanitizer, domAPI, gUtils }) {
  return {
    createElement: (...a) =>
      gUtils.createElement(...a, eventHandlers.trackListener, domAPI)
  };
}

// The following helper function signatures and calls enforce strict DI as positional parameters, no destructuring/closure DI

function bindEditButton(eventHandlers, domAPI, projectManager, projectModal, logger) {
  const editBtn = domAPI.getElementById('editProjectBtn');
  if (!editBtn) return;

  const handler = () => {
    const currentProject = projectManager?.currentProject;
    if (currentProject && projectModal?.openModal) {
      projectModal.openModal(currentProject);
    } else {
      logger && logger.warn?.('[ProjectDashboardUtils] projectModal not available – cannot open edit modal', { context: MODULE });
    }
  };
  eventHandlers.trackListener(editBtn, 'click', handler, {
    description: 'Edit Project Button',
    module: MODULE,
    context: 'projectActions'
  });
}

function bindPinButton(eventHandlers, logger, domAPI, projectManager) {
  const pinBtn = domAPI.getElementById('pinProjectBtn');
  if (!pinBtn) return;

  const handler = async () => {
    const currentProject = projectManager?.currentProject;
    if (!currentProject?.id || !projectManager?.togglePinProject) {
      return;
    }
    try {
      await projectManager.togglePinProject(currentProject.id);
    } catch (error) {
      logger.error('Error toggling project pin', error, { context: 'ProjectDashboardUtils:pinBtn' });
    }
  };
  eventHandlers.trackListener(pinBtn, 'click', handler, {
    description: 'Pin Project Button',
    module: MODULE,
    context: 'projectActions'
  });
}

function bindArchiveButton(eventHandlers, logger, domAPI, projectManager, modalManager) {
  const archiveBtn = domAPI.getElementById('archiveProjectBtn');
  if (!archiveBtn) return;

  const handler = async () => {
    const currentProject = projectManager?.currentProject;
    if (!currentProject?.id || !projectManager?.toggleArchiveProject || !modalManager?.confirmAction) {
      return;
    }
    modalManager.confirmAction({
      title: currentProject.archived ? 'Unarchive Project?' : 'Archive Project?',
      message: currentProject.archived
        ? `Are you sure you want to unarchive "${currentProject.name}"?`
        : `Are you sure you want to archive "${currentProject.name}"? Archived projects are hidden by default.`,
      confirmText: currentProject.archived ? 'Unarchive' : 'Archive',
      confirmClass: currentProject.archived ? 'btn-success' : 'btn-warning',
      onConfirm: async () => {
        try {
          await projectManager.toggleArchiveProject(currentProject.id);
          projectManager.loadProjects?.();
        } catch (error) {
          logger.error('Error toggling project archive', error, { context: 'ProjectDashboardUtils:archiveBtn' });
        }
      },
    });
  };
  eventHandlers.trackListener(archiveBtn, 'click', handler, {
    description: 'Archive Project Button',
    module: MODULE,
    context: 'projectActions'
  });
}


// --- setupEventListeners refactored (Guideline #2) ---
function setupEventListeners(eventHandlers, logger, domAPI, projectManager, modalManager, projectModal) {
  bindEditButton(eventHandlers, domAPI, projectManager, projectModal, logger);
  bindPinButton(eventHandlers, logger, domAPI, projectManager);
  bindArchiveButton(eventHandlers, logger, domAPI, projectManager, modalManager);
}



// --- Factory Function (Guideline #1, #8) ---
export function createProjectDashboardUtils(options = {}) {
  const { DependencySystem } = options;
  if (!DependencySystem) throw new Error(`[${MODULE}] DependencySystem is required`);

  // Resolve all dependencies using the helper
  const deps = _resolveDependencies({ DependencySystem, ...options });
  const { eventHandlers, projectManager, modalManager, sanitizer, domAPI, projectModal } = deps;
  const logger = _getDependency(options.logger, 'logger', DependencySystem, false);
  const gUtils = options.globalUtils || null;
  if (!gUtils) {
    throw new Error(`[${MODULE}] globalUtils dependency is required`);
  }
  // Require the unified eventService via DI
  const eventService = options.eventService;
  if (!eventService) {
    throw new Error(`[${MODULE}] eventService dependency is required`);
  }

  return {
    UIUtils: createUIUtils({
      eventHandlers,
      _sanitizer: sanitizer,
      domAPI,
      gUtils
    }),

    init: function () {
      try {
        setupEventListeners(eventHandlers, logger, domAPI, projectManager, modalManager, projectModal);
        const doc = domAPI.getDocument();
        if (doc) {
          domAPI.dispatchEvent(doc, new CustomEvent('projectDashboardUtilsInitialized'));
        }

        // Emit initialization event via the unified eventService
        eventService.emit('projectdashboardutils:initialized', { success: true });
      } catch (error) {
        logger && logger.error('Error in ProjectDashboardUtils.init', error, { context: 'ProjectDashboardUtils:init' });
      }
      return this;
    },

    // Factory standard: must expose cleanup directly as named API
    cleanup: function () {
      if (eventHandlers && eventHandlers.cleanupListeners) {
        eventHandlers.cleanupListeners({ context: MODULE });
      }
    },

    // Backward compatible destroy (alias)
    destroy: function () {
      if (eventHandlers && eventHandlers.cleanupListeners) {
        eventHandlers.cleanupListeners({ context: 'projectActions' });
        eventHandlers.cleanupListeners({ context: 'uiUtils' });
      }
    }
  };
}
