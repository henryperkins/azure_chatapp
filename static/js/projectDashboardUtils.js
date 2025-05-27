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
    sanitizer: _getDependency(opts.sanitizer, 'sanitizer', DependencySystem),
    domAPI: _getDependency(opts.domAPI, 'domAPI', DependencySystem), // Add domAPI
    // Optional formatters
    formatDate: _getDependency(opts.formatDate, 'formatDate', DependencySystem, false),
    formatBytes: _getDependency(opts.formatBytes, 'formatBytes', DependencySystem, false),
  };
}

 // --- Centralized sanitizer helper (Guideline #6) ---
function _safeSetInnerHTML(el, html, sanitizer, domAPI) {
  if (!sanitizer?.sanitize) {
    throw new Error(`[${MODULE}] sanitizer.sanitize is required for setting innerHTML`);
  }
  domAPI.setInnerHTML(el, sanitizer.sanitize(html));
}

// --- UI Utils helpers refactored (Guideline #2) ---
function applyCommonProps(element, options, domAPI, sanitizer) {
  if (options.className) element.className = options.className;
  if (options.id) element.id = options.id;
  if (options.textContent !== undefined) element.textContent = options.textContent;
  if (options.innerHTML !== undefined) {
    _safeSetInnerHTML(element, options.innerHTML, sanitizer, domAPI);
  }
  Object.entries(options).forEach(([key, value]) => {
    if (key.startsWith('data-')) element.setAttribute(key, value);
  });
  ['title', 'alt', 'src', 'href', 'placeholder', 'type', 'value', 'name'].forEach(prop => {
    if (options[prop] !== undefined) element[prop] = options[prop];
  });
  if (options.data && typeof options.data === 'object') {
    Object.entries(options.data).forEach(([k, v]) => element.dataset[k] = v);
  }
}

function wireEventHandlers(element, options, eventHandlers) { // Pass eventHandlers
  const trackListener = eventHandlers?.trackListener;
  if (!trackListener) return; // Cannot wire without trackListener
  Object.entries(options).forEach(([key, handler]) => {
    if (key.startsWith('on') && typeof handler === 'function') {
      const eventType = key.slice(2).toLowerCase();
      trackListener(element, eventType, handler, {
        description: `UIUtils createElement event (${eventType})`,
        module: MODULE,
        context: 'uiUtils'
      });
    }
  });
}

function createElementAdvanced(tag, options, domAPI, sanitizer, eventHandlers) {
  const el = domAPI.createElement(tag);
  applyCommonProps(el, options, domAPI, sanitizer);
  wireEventHandlers(el, options, eventHandlers);
  return el;
}

function createUIUtils({ eventHandlers, sanitizer, domAPI }) {
  return {
    createElement(tag, options = {}) {
      return createElementAdvanced(tag, options, domAPI, sanitizer, eventHandlers);
    }
  };
}

// The following helper function signatures and calls enforce strict DI as positional parameters, no destructuring/closure DI

function bindEditButton(eventHandlers, domAPI, projectManager, DependencySystem) {
  const editBtn = domAPI.getElementById('editProjectBtn');
  if (!editBtn) return;

  const handler = () => {
    const currentProject = projectManager?.currentProject;
    const pm = DependencySystem?.modules?.get?.('projectModal');
    if (currentProject && pm?.openModal) {
      pm.openModal(currentProject);
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
function setupEventListeners(eventHandlers, logger, domAPI, projectManager, modalManager, DependencySystem) {
  bindEditButton(eventHandlers, domAPI, projectManager, DependencySystem);
  bindPinButton(eventHandlers, logger, domAPI, projectManager);
  bindArchiveButton(eventHandlers, logger, domAPI, projectManager, modalManager);
}



// --- Factory Function (Guideline #1, #8) ---
export function createProjectDashboardUtils(options = {}) {
  const { DependencySystem } = options;
  if (!DependencySystem) throw new Error(`[${MODULE}] DependencySystem is required`);

  // Resolve all dependencies using the helper
  const deps = _resolveDependencies({ DependencySystem, ...options });
  const { eventHandlers, projectManager, modalManager, sanitizer, domAPI } = deps;
  const logger = _getDependency(options.logger, 'logger', DependencySystem, false);
  // Only use canonical bus found via DependencySystem.modules.get('eventBus')
  const eventBus = DependencySystem?.modules?.get?.("eventBus");

  let initialized = false;

  return {
    UIUtils: createUIUtils({
      eventHandlers,
      sanitizer,
      domAPI
    }),

    init: function () {
      if (initialized) return this;
      initialized = true;
      try {
        setupEventListeners(eventHandlers, logger, domAPI, projectManager, modalManager, DependencySystem);
        const doc = domAPI.getDocument();
        if (doc) {
          domAPI.dispatchEvent(doc, new CustomEvent('projectDashboardUtilsInitialized'));
        }

        // Canonical event bus usage only if present
        if (eventBus && typeof eventBus.dispatchEvent === "function") {
          eventBus.dispatchEvent(
            new CustomEvent('projectdashboardutils:initialized', { detail: { success: true } })
          );
        } else if (domAPI?.getDocument && domAPI?.dispatchEvent) {
          const eDoc = domAPI.getDocument();
          if (eDoc) {
            domAPI.dispatchEvent(eDoc, new CustomEvent('projectdashboardutils:initialized', { detail: { success: true } }));
          }
        }
      } catch(error) {
        initialized = false;
        logger && logger.error('Error in ProjectDashboardUtils.init', error, { context: 'ProjectDashboardUtils:init' });
      }
      return this;
    },

    // Factory standard: must expose cleanup directly as named API
    cleanup: function () {
      if (eventHandlers && eventHandlers.cleanupListeners) {
        eventHandlers.cleanupListeners({ context: MODULE });
      }
      initialized = false;
    },

    // Backward compatible destroy (alias)
    destroy: function () {
      if (eventHandlers && eventHandlers.cleanupListeners) {
        eventHandlers.cleanupListeners({ context: 'projectActions' });
        eventHandlers.cleanupListeners({ context: 'uiUtils' });
      }
      initialized = false;
    }
  };
}
