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
function _safeSetInnerHTML(el, html, sanitizer) {
  if (!sanitizer?.sanitize) {
    throw new Error(`[${MODULE}] sanitizer.sanitize is required for setting innerHTML`);
  }
  el.innerHTML = sanitizer.sanitize(html);
}

// --- UI Utils helpers refactored (Guideline #2) ---
function applyCommonProps(element, options, domAPI, sanitizer) {
  if (options.className) element.className = options.className;
  if (options.id) element.id = options.id;
  if (options.textContent !== undefined) element.textContent = options.textContent;
  if (options.innerHTML !== undefined) {
    _safeSetInnerHTML(element, options.innerHTML, sanitizer);
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

function bindEditButton(deps) {
  const { domAPI, projectManager, eventHandlers, DependencySystem } = deps;
  const editBtn = domAPI.getElementById('editProjectBtn');
  if (!editBtn) return;

  const handler = () => {
    const currentProject = projectManager?.currentProject;
    const pm = DependencySystem?.modules?.get?.('projectModal');
    if (currentProject && pm?.openModal) {
      pm.openModal(currentProject);
    } else {
      // silently ignore
    }
  };
  eventHandlers.trackListener(editBtn, 'click', handler, {
    description: 'Edit Project Button',
    module: MODULE,
    context: 'projectActions'
  });
}

function bindPinButton(deps) {
  const { domAPI, projectManager, eventHandlers } = deps;
  const pinBtn = domAPI.getElementById('pinProjectBtn');
  if (!pinBtn) return;

  const handler = async () => {
    const currentProject = projectManager?.currentProject;
    if (!currentProject?.id || !projectManager?.togglePinProject) {
      // silently ignore
      return;
    }
    try {
      await projectManager.togglePinProject(currentProject.id);
      // silently ignore success
    } catch (error) {
      // silently ignore error
    }
  };
  eventHandlers.trackListener(pinBtn, 'click', handler, {
    description: 'Pin Project Button',
    module: MODULE,
    context: 'projectActions'
  });
}

function bindArchiveButton(deps) {
  const { domAPI, projectManager, modalManager, eventHandlers } = deps;
  const archiveBtn = domAPI.getElementById('archiveProjectBtn');
  if (!archiveBtn) return;

  const handler = async () => {
    const currentProject = projectManager?.currentProject;
    if (!currentProject?.id || !projectManager?.toggleArchiveProject || !modalManager?.confirmAction) {
      // silently ignore
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
          // silently ignore error
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
function setupEventListeners({
  projectManager,
  modalManager,
  eventHandlers,
  DependencySystem,
  domAPI
}) {
  const deps = { projectManager, modalManager, eventHandlers, DependencySystem, domAPI };
  bindEditButton(deps);
  bindPinButton(deps);
  bindArchiveButton(deps);
}



// --- Factory Function (Guideline #1, #8) ---
export function createProjectDashboardUtils(options = {}) {
  const { DependencySystem } = options;
  if (!DependencySystem) throw new Error(`[${MODULE}] DependencySystem is required`);

  // Resolve all dependencies using the helper
  const deps = _resolveDependencies({ DependencySystem, ...options });
  const { eventHandlers, projectManager, modalManager, sanitizer, domAPI } = deps;

  const ProjectDashboardUtilsAPI = {};

  // Create UIUtils with necessary dependencies (Guideline #2)
  ProjectDashboardUtilsAPI.UIUtils = createUIUtils({
    eventHandlers,
    sanitizer,
    domAPI
  });

  let initialized = false;

  // Make setupEventListeners part of the returned API if needed externally,
  // otherwise keep it internal and call it from init.
  const _setupEventListenersInternal = () => {
    setupEventListeners({
      projectManager,
      modalManager,
      eventHandlers,
      DependencySystem,
      domAPI
    });
  };

  ProjectDashboardUtilsAPI.init = function () {
    if (initialized) return this;
    initialized = true;
    try {
        _setupEventListenersInternal();
        const doc = domAPI.getDocument();
        if (doc) {
            domAPI.dispatchEvent(doc, new CustomEvent('projectDashboardUtilsInitialized'));
        }

        // --- Standardized "projectdashboardutils:initialized" event ---
        const d = typeof document !== "undefined" ? document : null;
        if (d) d.dispatchEvent(new CustomEvent('projectdashboardutils:initialized', { detail: { success: true } }));

    } catch(error) {
        initialized = false;
    }
    return this;
  };

   ProjectDashboardUtilsAPI.destroy = function() {
       eventHandlers.cleanupListeners?.({ context: 'projectActions' });
       eventHandlers.cleanupListeners?.({ context: 'uiUtils' });
       initialized = false;
   }

  // Return the constructed API object (Guideline #1)
  return ProjectDashboardUtilsAPI;
}
