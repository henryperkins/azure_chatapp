/**
 * projectDashboardUtils.js
 * Centralized utility functions for the project dashboard.
 *
 * Strict DI, notification, and error handling patterns:
 * - All notifications are routed via the injected `notify` util.
 * - Every notification is grouped and context-tagged: `{ group: true, context: 'projectDashboard' }`.
 * - If a DI dependency is missing, an error notification is sent before throwing.
 * - No fallback or global notification handlers.
 * DI/DependencySystem-compliant: all dependencies are injected or resolved via DependencySystem.
 * No window.* references or global side effects.
 * Usage:
 *   import { createProjectDashboardUtils } from './projectDashboardUtils.js';
 *   const utils = createProjectDashboardUtils({...});
 */

const MODULE = 'ProjectDashboardUtils';

function getDependency(dep, name, DependencySystem) {
  return dep || DependencySystem?.modules?.get?.(name) || DependencySystem?.get?.(name);
}

// --- Centralized sanitizer helper ---
function _safeSetInnerHTML(el, html, sanitizer) {
  if (!sanitizer?.sanitize) throw new Error(`[${MODULE}] sanitizer missing`);
  el.innerHTML = sanitizer.sanitize(html);
}

// --- UI Utils helpers split for <40 LOC ---
function applyCommonProps(element, options, sanitizer) {
  if (options.className) element.className = options.className;
  if (options.id) element.id = options.id;
  if (options.textContent !== undefined) element.textContent = options.textContent;
  if (options.innerHTML !== undefined) {
    _safeSetInnerHTML(element, options.innerHTML, sanitizer);
  }
  // Data attributes: data-*
  Object.entries(options).forEach(([key, value]) => {
    if (key.startsWith('data-')) {
      element.setAttribute(key, value);
    }
  });
  // Common props
  ['title', 'alt', 'src', 'href', 'placeholder', 'type', 'value', 'name'].forEach(prop => {
    if (options[prop] !== undefined) element[prop] = options[prop];
  });
  // Optional: support options.data = {foo: "bar"} for dataset
  if (options.data && typeof options.data === 'object') {
    Object.entries(options.data).forEach(([k, v]) => {
      element.dataset[k] = v;
    });
  }
}

function wireEventHandlers(element, options, trackListener) {
  Object.entries(options).forEach(([key, handler]) => {
    if (key.startsWith('on') && typeof handler === 'function') {
      const eventType = key.slice(2).toLowerCase();
      trackListener(element, eventType, handler);
    }
  });
}

function createElementAdvanced(tag, options, sanitizer, trackListener) {
  const el = document.createElement(tag);
  applyCommonProps(el, options, sanitizer);
  wireEventHandlers(el, options, trackListener);
  return el;
}

function createUIUtils({ trackListener, formatDate, formatBytes, sanitizer }) {
  return {
    createElement(tag, options = {}) {
      return createElementAdvanced(tag, options, sanitizer, trackListener);
    },

    formatNumber(number) {
      if (typeof number !== 'number' || isNaN(number)) return '';
      return new Intl.NumberFormat().format(number);
    },

    formatDate(date) {
      if (formatDate) return formatDate(date);
      return date ? new Date(date).toLocaleDateString() : '';
    },

    formatBytes(num) {
      if (formatBytes) return formatBytes(num);
      if (typeof num !== 'number' || isNaN(num)) return '';
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      if (num === 0) return '0 B';
      const i = Math.min(Math.floor(Math.log(num) / Math.log(1024)), sizes.length - 1);
      return (num / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
    },

    fileIcon(fileType) {
      const icons = {
        pdf: '📄',
        doc: '📝',
        docx: '📝',
        txt: '📄',
        csv: '📊',
        json: '📋',
        md: '📄',
        py: '🐍',
        js: '📜',
        html: '🌐',
        css: '🎨',
        jpg: '🖼️',
        jpeg: '🖼️',
        png: '🖼️',
        gif: '🖼️',
        zip: '📦',
      };
      return icons[String(fileType || '').toLowerCase()] || '📄';
    },
  };
}

// --- Button binding helpers ---
function bindEditButton(editBtn, deps) {
  const { projectManager, trackListener, DependencySystem, notifyCtx } = deps;
  if (editBtn) {
    trackListener(editBtn, 'click', () => {
      const currentProject = projectManager?.currentProject;
      const pm = getDependency(undefined, 'projectModal', DependencySystem);
      if (currentProject && pm?.openModal) {
        pm.openModal(currentProject);
      } else {
        notifyCtx?.error?.('[projectDashboardUtils] projectModal.openModal not available');
      }
    });
  }
}

function bindPinButton(pinBtn, deps) {
  const { projectManager, trackListener, showNotification, notifyCtx } = deps;
  if (pinBtn) {
    trackListener(pinBtn, 'click', async () => {
      const currentProject = projectManager?.currentProject;
      if (currentProject?.id && projectManager?.togglePinProject) {
        try {
          const updatedProject = await projectManager.togglePinProject(currentProject.id);
          showNotification(
            `Project ${updatedProject.pinned ? 'pinned' : 'unpinned'}`,
            'success'
          );
        } catch (error) {
          notifyCtx?.error?.('Failed to toggle pin: ' + (error?.message || error));
        }
      }
    });
  }
}

function bindArchiveButton(archiveBtn, deps) {
  const { projectManager, modalManager, trackListener, showNotification, notifyCtx } = deps;
  if (archiveBtn) {
    trackListener(archiveBtn, 'click', async () => {
      const currentProject = projectManager?.currentProject;
      if (currentProject?.id && projectManager?.toggleArchiveProject && modalManager) {
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
              showNotification(
                `Project ${currentProject.archived ? 'unarchived' : 'archived'}`,
                'success'
              );
            } catch (error) {
              notifyCtx?.error?.('Failed to toggle archive: ' + (error?.message || error));
            }
          },
        });
      }
    });
  }
}

// --- setupEventListeners split ---
function setupEventListeners({
  projectManager,
  modalManager,
  showNotification,
  trackListener,
  DependencySystem,
  notifyCtx
}) {
  const editBtn = typeof document !== 'undefined' ? document.getElementById('editProjectBtn') : null;
  const pinBtn = typeof document !== 'undefined' ? document.getElementById('pinProjectBtn') : null;
  const archiveBtn = typeof document !== 'undefined' ? document.getElementById('archiveProjectBtn') : null;
  const deps = { projectManager, modalManager, trackListener, DependencySystem, notifyCtx, showNotification };
  bindEditButton(editBtn, deps);
  bindPinButton(pinBtn, deps);
  bindArchiveButton(archiveBtn, deps);
}

// --- Notificación canónica ---
function createShowNotification(notifyCtx) {
  return (msg, type = 'info') => {
    if (type === 'error') {
      notifyCtx.error(msg);
    } else if (type === 'success') {
      notifyCtx.success(msg);
    } else if (type === 'warning' || type === 'warn') {
      notifyCtx.warn(msg);
    } else {
      notifyCtx.info(msg);
    }
  };
}

// --- Resolver dependencias en helper dedicado ---
function resolveDependencies(opts) {
  const { DependencySystem } = opts;
  return {
    eventHandlers   : getDependency(opts.eventHandlers,   'eventHandlers',   DependencySystem),
    projectManager  : getDependency(opts.projectManager,  'projectManager',  DependencySystem),
    modalManager    : getDependency(opts.modalManager,    'modalManager',    DependencySystem),
    notify          : getDependency(opts.notify,          'notify',          DependencySystem),
    formatDate      : getDependency(opts.formatDate,      'formatDate',      DependencySystem),
    formatBytes     : getDependency(opts.formatBytes,     'formatBytes',     DependencySystem),
    sanitizer       : getDependency(opts.sanitizer,       'sanitizer',       DependencySystem)
  };
}

export function createProjectDashboardUtils() {
  const args = arguments[0] || {};
  const { DependencySystem } = args;
  if (!DependencySystem) throw new Error('DependencySystem is required');
  const deps = resolveDependencies({ DependencySystem, ...args });
  const { eventHandlers, projectManager, modalManager, notify, formatDate, formatBytes, sanitizer } = deps;
  const notifyCtx = notify.withContext({ context: 'projectDashboard', module: MODULE });

  const showNotification = createShowNotification(notifyCtx);
  const trackListener = eventHandlers?.trackListener?.bind(eventHandlers);

  const ProjectDashboard = {};

  ProjectDashboard.UIUtils = createUIUtils({
    trackListener,
    formatDate,
    formatBytes,
    sanitizer
  });

  let initialized = false;

  ProjectDashboard.setupEventListeners = () => {
    setupEventListeners({
      projectManager,
      modalManager,
      showNotification,
      trackListener,
      DependencySystem,
      notifyCtx
    });
  };

  ProjectDashboard.init = function () {
    if (initialized) return this;
    initialized = true;
    notifyCtx.info('[ProjectDashboard] Initializing...');
    ProjectDashboard.setupEventListeners();
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('projectDashboardInitialized'));
    }
    return this;
  };

  return ProjectDashboard;
}
