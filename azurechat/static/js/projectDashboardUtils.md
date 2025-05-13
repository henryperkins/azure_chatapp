```javascript
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
 * @param {Object} options.notify - Required. Context-aware notification utility.
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
    // Use notify if available, else throw
    if (DependencySystem?.modules?.get?.('notify')) {
      DependencySystem.modules.get('notify').error(`[${MODULE}] Missing required dependency: ${name}`, {
        context: MODULE,
        module: MODULE,
        source: '_getDependency',
        group: true
      });
    }
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
    notify: _getDependency(opts.notify, 'notify', DependencySystem),
    sanitizer: _getDependency(opts.sanitizer, 'sanitizer', DependencySystem),
    domAPI: _getDependency(opts.domAPI, 'domAPI', DependencySystem), // Add domAPI
    // Optional formatters
    formatDate: _getDependency(opts.formatDate, 'formatDate', DependencySystem, false),
    formatBytes: _getDependency(opts.formatBytes, 'formatBytes', DependencySystem, false),
  };
}

// --- Centralized sanitizer helper (Guideline #6) ---
function _safeSetInnerHTML(el, html, sanitizer, notify, notificationHandler) {
  if (!sanitizer?.sanitize) {
    // DI-only: Use injected notify or notificationHandler, never window globals.
    if (notify) {
      notify.error(`[${MODULE}] Sanitizer function is missing, cannot safely set innerHTML.`, {
        group: true,
        context: 'projectDashboardUtils',
        module: MODULE,
        source: 'setInnerHTMLSafe'
      });
    } else if (notificationHandler?.show) {
      notificationHandler.show(`[${MODULE}] Sanitizer function is missing, cannot safely set innerHTML.`, 'error', {
        group: true,
        context: 'projectDashboardUtils',
        module: MODULE,
        source: 'setInnerHTMLSafe'
      });
    }
    // else: fail silently per modularity rules
    throw new Error(`[${MODULE}] sanitizer.sanitize is required for setting innerHTML`);
  }
  // Guideline #6: Always sanitize before setting innerHTML.
  el.innerHTML = sanitizer.sanitize(html);
}

// --- UI Utils helpers refactored (Guideline #2) ---
function applyCommonProps(element, options, domAPI, sanitizer, notify, notificationHandler) {
  if (options.className) element.className = options.className;
  if (options.id) element.id = options.id;
  if (options.textContent !== undefined) element.textContent = options.textContent;
  if (options.innerHTML !== undefined) {
    _safeSetInnerHTML(element, options.innerHTML, sanitizer, notify, notificationHandler);
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

function createElementAdvanced(tag, options, domAPI, sanitizer, notify, notificationHandler, eventHandlers) {
  const el = domAPI.createElement(tag);
  applyCommonProps(el, options, domAPI, sanitizer, notify, notificationHandler);
  wireEventHandlers(el, options, eventHandlers);
  return el;
}

function createUIUtils({ eventHandlers, sanitizer, notify, notificationHandler, domAPI }) {
  return {
    createElement(tag, options = {}) {
      return createElementAdvanced(tag, options, domAPI, sanitizer, notify, notificationHandler, eventHandlers);
    }
  };
}

// --- Button binding helpers (Guideline #3, #4) ---
function bindEditButton(deps) {
  const { domAPI, projectManager, eventHandlers, DependencySystem, notifyCtx } = deps;
  const editBtn = domAPI.getElementById('editProjectBtn'); // Use domAPI
  if (!editBtn) return;

  const handler = () => {
    const currentProject = projectManager?.currentProject;
    // Resolve 'projectModal' via DS safely
    const pm = DependencySystem?.modules?.get?.('projectModal');
    if (currentProject && pm?.openModal) {
      pm.openModal(currentProject);
    } else {
      // Guideline #4: Structured notification
      notifyCtx.error('Cannot edit project: Project modal service is unavailable.', {
        source: 'bindEditButton',
        group: true
      });
    }
  };
  // Guideline #3: Use trackListener
  eventHandlers.trackListener(editBtn, 'click', handler, {
    description: 'Edit Project Button',
    module: MODULE,
    context: 'projectActions'
  });
}

// (Similar refactoring for bindPinButton and bindArchiveButton using domAPI and trackListener)
function bindPinButton(deps) {
  const { domAPI, projectManager, eventHandlers, notifyCtx } = deps;
  const pinBtn = domAPI.getElementById('pinProjectBtn'); // Use domAPI
  if (!pinBtn) return;

  const handler = async () => {
    const currentProject = projectManager?.currentProject;
    if (!currentProject?.id || !projectManager?.togglePinProject) {
      notifyCtx.warn('Cannot toggle pin: Missing project ID or toggle function.', { source: 'bindPinButton' });
      return;
    }
    try {
      const updatedProject = await projectManager.togglePinProject(currentProject.id);
      notifyCtx.success(`Project ${updatedProject.pinned ? 'pinned' : 'unpinned'} successfully.`, {
        source: 'bindPinButton',
        extra: { projectId: currentProject.id, pinned: updatedProject.pinned }
      });
    } catch (error) {
      notifyCtx.error('Failed to toggle project pin.', {
        source: 'bindPinButton',
        group: true,
        originalError: error,
        extra: { projectId: currentProject.id }
      });
    }
  };
  eventHandlers.trackListener(pinBtn, 'click', handler, {
    description: 'Pin Project Button',
    module: MODULE,
    context: 'projectActions'
  });
}

function bindArchiveButton(deps) {
  const { domAPI, projectManager, modalManager, eventHandlers, notifyCtx } = deps;
  const archiveBtn = domAPI.getElementById('archiveProjectBtn'); // Use domAPI
  if (!archiveBtn) return;

  const handler = async () => {
    const currentProject = projectManager?.currentProject;
    if (!currentProject?.id || !projectManager?.toggleArchiveProject || !modalManager?.confirmAction) {
      notifyCtx.warn('Cannot archive: Missing project ID, archive function, or modal manager.', { source: 'bindArchiveButton' });
      return;
    }
    // Use modalManager for confirmation (already uses notify internally)
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
          notifyCtx.success(`Project ${currentProject.archived ? 'unarchived' : 'archived'} successfully.`, {
            source: 'bindArchiveButton (onConfirm)',
            extra: { projectId: currentProject.id, archived: !currentProject.archived }
          });
          // Optionally trigger a project list refresh here via projectManager or event
          projectManager.loadProjects?.(); // Example refresh call
        } catch (error) {
          notifyCtx.error('Failed to toggle project archive status.', {
            source: 'bindArchiveButton (onConfirm)',
            group: true,
            originalError: error,
            extra: { projectId: currentProject.id }
          });
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
  eventHandlers, // Pass eventHandlers itself
  DependencySystem,
  notifyCtx,
  domAPI // Pass domAPI
}) {
  // Dependencies are now passed down correctly
  const deps = { projectManager, modalManager, eventHandlers, DependencySystem, notifyCtx, domAPI };
  bindEditButton(deps);
  bindPinButton(deps);
  bindArchiveButton(deps);
}

// --- Notification wrapper (Guideline #4) ---
function createShowNotification(notifyCtx) { // Expects context-wrapped notifier
  return (msg, type = 'info') => {
    // Use the methods directly on the context-wrapped notifier
    if (type === 'error') notifyCtx.error(msg);
    else if (type === 'success') notifyCtx.success(msg);
    else if (type === 'warning' || type === 'warn') notifyCtx.warn(msg);
    else notifyCtx.info(msg);
    // No need for group: true, as notifyCtx likely handles default grouping/context
  };
}


// --- Factory Function (Guideline #1, #8) ---
export function createProjectDashboardUtils(options = {}) {
  const { DependencySystem } = options;
  if (!DependencySystem) throw new Error(`[${MODULE}] DependencySystem is required`);

  // Resolve all dependencies using the helper
  const deps = _resolveDependencies({ DependencySystem, ...options });
  const { eventHandlers, projectManager, modalManager, notify, sanitizer, domAPI } = deps;

  // Create context-aware notifier (Guideline #4)
  const notifyCtx = notify.withContext({ context: 'projectDashboard', module: MODULE });

  const showNotification = createShowNotification(notifyCtx);

  const ProjectDashboardUtilsAPI = {};

  // Create UIUtils with necessary dependencies (Guideline #2)
  ProjectDashboardUtilsAPI.UIUtils = createUIUtils({
    eventHandlers,
    sanitizer,
    notify,
    notificationHandler: options.notificationHandler,
    domAPI
  });

  let initialized = false;

  // Make setupEventListeners part of the returned API if needed externally,
  // otherwise keep it internal and call it from init.
  const _setupEventListenersInternal = () => { // Rename if internal
    setupEventListeners({ // Pass all required dependencies
      projectManager,
      modalManager,
      eventHandlers, // Pass handler object
      DependencySystem,
      notifyCtx,
      domAPI,
      showNotification // Pass the created wrapper
    });
  };

  ProjectDashboardUtilsAPI.init = function () {
    if (initialized) return this;
    initialized = true;
    notifyCtx.info('Initializing ProjectDashboard Utilities...', { source: 'init' });
    try {
        _setupEventListenersInternal(); // Call the internal setup
        const doc = domAPI.getDocument();
        if (doc) {
            domAPI.dispatchEvent(doc, new CustomEvent('projectDashboardUtilsInitialized'));
        }
        notifyCtx.info('ProjectDashboard Utilities Initialized.', { source: 'init' });

        // --- Standardized "projectdashboardutils:initialized" event ---
        const d = typeof document !== "undefined" ? document : null;
        if (d) d.dispatchEvent(new CustomEvent('projectdashboardutils:initialized', { detail: { success: true } }));

    } catch(error) {
        notifyCtx.error('Initialization failed.', { source: 'init', originalError: error, group: true });
        initialized = false;
    }
    return this; // Return the API object
  };

   ProjectDashboardUtilsAPI.destroy = function() {
       notifyCtx.info('Destroying ProjectDashboard Utilities.', { source: 'destroy' });
       // Use central cleanup with context
       eventHandlers.cleanupListeners?.({ context: 'projectActions' }); // Use context added in binding
       eventHandlers.cleanupListeners?.({ context: 'uiUtils' });      // Use context added in binding
       initialized = false;
   }

  // Return the constructed API object (Guideline #1)
  return ProjectDashboardUtilsAPI;
}

```