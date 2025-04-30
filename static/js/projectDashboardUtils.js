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

export function createProjectDashboardUtils({ DependencySystem, eventHandlers, projectManager, modalManager, notificationHandler, app, formatDate, formatBytes } = {}) {
  // Dependency resolution
  DependencySystem = DependencySystem || (typeof window !== "undefined" ? window.DependencySystem : undefined);

  eventHandlers = eventHandlers || (DependencySystem?.modules?.get?.('eventHandlers') || DependencySystem?.get?.('eventHandlers'));
  projectManager = projectManager || (DependencySystem?.modules?.get?.('projectManager') || DependencySystem?.get?.('projectManager'));
  modalManager = modalManager || (DependencySystem?.modules?.get?.('modalManager') || DependencySystem?.get?.('modalManager'));
  notificationHandler = notificationHandler || (DependencySystem?.modules?.get?.('notificationHandler') || DependencySystem?.get?.('notificationHandler'));
  app = app || (DependencySystem?.modules?.get?.('app') || DependencySystem?.get?.('app'));

  formatDate = formatDate || (DependencySystem?.modules?.get?.('formatDate') || DependencySystem?.get?.('formatDate'));
  formatBytes = formatBytes || (DependencySystem?.modules?.get?.('formatBytes') || DependencySystem?.get?.('formatBytes'));

  // Notification utility fallback
  const showNotification = notificationHandler?.show
    || app?.showNotification
    || ((msg, type) => console.log(`[${type||'info'}] ${msg}`));

  // Event handler fallback
  const trackListener = eventHandlers?.trackListener
    ? eventHandlers.trackListener.bind(eventHandlers)
    : (el, evt, fn, opts) => el.addEventListener(evt, fn, opts);

  // Dashboard utilities namespace
  const ProjectDashboard = {};

  ProjectDashboard.UIUtils = {
    createElement(tag, options = {}) {
      const element = document.createElement(tag);

      if (options.className) element.className = options.className;
      if (options.id) element.id = options.id;
      if (options.textContent !== undefined) element.textContent = options.textContent;
      if (options.innerHTML !== undefined) element.innerHTML = options.innerHTML;

      // Events
      Object.entries(options).forEach(([key, handler]) => {
        if (key.startsWith('on') && typeof handler === 'function') {
          const eventType = key.slice(2).toLowerCase();
          trackListener(element, eventType, handler);
        }
      });

      // Data attributes
      Object.entries(options).forEach(([key, value]) => {
        if (key.startsWith('data-')) {
          element.setAttribute(key, value);
        }
      });

      // Common props
      ['title', 'alt', 'src', 'href', 'placeholder', 'type', 'value', 'name'].forEach(prop => {
        if (options[prop] !== undefined) element[prop] = options[prop];
      });

      return element;
    },

    formatNumber(number) {
      return new Intl.NumberFormat().format(number || 0);
    },

    formatDate(date) {
      if (formatDate) return formatDate(date);
      return date ? new Date(date).toLocaleDateString() : '';
    },

    formatBytes(num) {
      if (formatBytes) return formatBytes(num);
      if (!num && num !== 0) return '';
      // Simple fallback
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      if (num === 0) return '0 B';
      const i = Math.floor(Math.log(num) / Math.log(1024));
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
      return icons[String(fileType||'').toLowerCase()] || '📄';
    },
  };

  ProjectDashboard.setupEventListeners = () => {
    // Edit project
    const editBtn = document.getElementById('editProjectBtn');
    if (editBtn) {
      trackListener(editBtn, 'click', () => {
        const currentProject = projectManager?.currentProject;
        const pm = (DependencySystem?.modules?.get?.('projectModal') || DependencySystem?.get?.('projectModal') || undefined);
        if (currentProject && pm?.openModal) {
          pm.openModal(currentProject);
        } else {
          console.error('[projectDashboardUtils] projectModal.openModal not available');
        }
      });
    }

    // Pin project
    const pinBtn = document.getElementById('pinProjectBtn');
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
            console.error('Failed to toggle pin:', error);
            showNotification('Failed to toggle pin', 'error');
          }
        }
      });
    }

    // Archive project
    const archiveBtn = document.getElementById('archiveProjectBtn');
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
                console.error('Failed to toggle archive:', error);
                showNotification('Failed to toggle archive', 'error');
              }
            },
          });
        }
      });
    }
  };

  ProjectDashboard.init = function () {
    if (app?.config?.debug) console.log('[ProjectDashboard] Initializing...');
    ProjectDashboard.setupEventListeners();
    document.dispatchEvent(new CustomEvent('projectDashboardInitialized'));
    return this;
  };

  return ProjectDashboard;
}
