/**
 * projectDashboardUtils.js
 * Centralized utility functions for the project dashboard.
 *
 * DI/DependencySystem-compliant: all dependencies are injected or resolved via DependencySystem.
 * No window.* references or global side effects.
 * Usage:
 *   import { createProjectDashboardUtils } from './projectDashboardUtils.js';
 *   const utils = createProjectDashboardUtils({...});
 */

function getDependency(dep, name, DependencySystem) {
  return dep || DependencySystem?.modules?.get?.(name) || DependencySystem?.get?.(name);
}

/**
 * Notification util: strict DI – inject notify, use appropriate context/group.
 * @param {Function} notify - Notification util (required, from DI)
 */
function createShowNotification(notify) {
  if (!notify) throw new Error('[projectDashboardUtils] notify util required for notification');
  // Always provide grouping/context for all usage in project dashboard utils
  return (msg, type = 'info') => {
    if (type === 'error') {
      notify.error(msg, { group: true, context: "projectDashboard" });
    } else if (type === 'success') {
      notify.success(msg, { group: true, context: "projectDashboard" });
    } else if (type === 'warning' || type === 'warn') {
      notify.warn(msg, { group: true, context: "projectDashboard" });
    } else {
      notify.info(msg, { group: true, context: "projectDashboard" });
    }
  };
}

function createTrackListener(eventHandlers) {
  if (eventHandlers?.trackListener) {
    return eventHandlers.trackListener.bind(eventHandlers);
  }
  throw new Error('trackListener is required for event handling');
}

function sanitizeHTMLContent(html, sanitizeHTML) {
  if (sanitizeHTML) return sanitizeHTML(html);
  // If no sanitizer is provided, refuse to set innerHTML
  throw new Error('sanitizeHTML function is required for setting innerHTML');
}

function createUIUtils({ trackListener, formatDate, formatBytes, sanitizeHTML }) {
  return {
    createElement(tag, options = {}) {
      const element = document.createElement(tag);

      if (options.className) element.className = options.className;
      if (options.id) element.id = options.id;
      if (options.textContent !== undefined) element.textContent = options.textContent;
      if (options.innerHTML !== undefined) {
        element.innerHTML = sanitizeHTMLContent(options.innerHTML, sanitizeHTML);
      }

      // Events: onClick, onChange, etc.
      Object.entries(options).forEach(([key, handler]) => {
        if (key.startsWith('on') && typeof handler === 'function') {
          const eventType = key.slice(2).toLowerCase();
          trackListener(element, eventType, handler);
        }
      });

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

      return element;
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

function setupEventListeners({
  projectManager,
  modalManager,
  showNotification,
  trackListener,
  DependencySystem
}) {
  // Edit project
  const editBtn = typeof document !== 'undefined' ? document.getElementById('editProjectBtn') : null;
  if (editBtn) {
    trackListener(editBtn, 'click', () => {
      const currentProject = projectManager?.currentProject;
      const pm = getDependency(undefined, 'projectModal', DependencySystem);
      if (currentProject && pm?.openModal) {
        pm.openModal(currentProject);
      } else {
        showNotification('[projectDashboardUtils] projectModal.openModal not available', 'error');
      }
    });
  }

  // Pin project
  const pinBtn = typeof document !== 'undefined' ? document.getElementById('pinProjectBtn') : null;
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
          showNotification('Failed to toggle pin: ' + (error?.message || error), 'error');
        }
      }
    });
  }

  // Archive project
  const archiveBtn = typeof document !== 'undefined' ? document.getElementById('archiveProjectBtn') : null;
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
              showNotification('Failed to toggle archive: ' + (error?.message || error), 'error');
            }
          },
        });
      }
    });
  }
}

export function createProjectDashboardUtils({
  DependencySystem,
  eventHandlers,
  projectManager,
  modalManager,
  notify,
  formatDate,
  formatBytes,
  sanitizeHTML
} = {}) {
  if (!DependencySystem) throw new Error('DependencySystem is required');
  eventHandlers = getDependency(eventHandlers, 'eventHandlers', DependencySystem);
  projectManager = getDependency(projectManager, 'projectManager', DependencySystem);
  modalManager = getDependency(modalManager, 'modalManager', DependencySystem);
  notify = getDependency(notify, 'notify', DependencySystem);
  formatDate = getDependency(formatDate, 'formatDate', DependencySystem);
  formatBytes = getDependency(formatBytes, 'formatBytes', DependencySystem);
  sanitizeHTML = getDependency(sanitizeHTML, 'sanitizeHTML', DependencySystem);

  const showNotification = createShowNotification(notify);
  const trackListener = createTrackListener(eventHandlers);

  const ProjectDashboard = {};

  ProjectDashboard.UIUtils = createUIUtils({
    trackListener,
    formatDate,
    formatBytes,
    sanitizeHTML
  });

  let initialized = false;

  ProjectDashboard.setupEventListeners = () => {
    setupEventListeners({
      projectManager,
      modalManager,
      showNotification,
      trackListener,
      DependencySystem
    });
  };

  ProjectDashboard.init = function () {
    if (initialized) return this;
    initialized = true;
    showNotification('[ProjectDashboard] Initializing...', 'info');
    ProjectDashboard.setupEventListeners();
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('projectDashboardInitialized'));
    }
    return this;
  };

  return ProjectDashboard;
}
