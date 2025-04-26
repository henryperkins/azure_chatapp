/**
 * projectDashboardUtils.js
 * Centralized utility functions for the project dashboard.
 *
 * @module projectDashboardUtils
 * @requires window.DependencySystem - For module registration
 * @requires window.eventHandlers - For event management
 * @requires window.projectManager - For project operations
 * @requires window.modalManager - For modal dialogs
 * @requires window.notificationHandler - For notifications
 * @requires window.showNotification - Fallback notification system
 * @requires window.formatDate - For date formatting
 * @requires window.formatBytes - For byte formatting
 * @requires window.app - For authentication state and shared utilities
 */

// Browser APIs:
// - document (DOM access)
// - localStorage (state persistence)
// - URL (URL parsing/manipulation)
// - CustomEvent (event system)
// - Intl.NumberFormat (number formatting)

// External Dependencies (Global Scope):
// - window.eventHandlers (event management)
// - window.projectManager (project data operations)
// - window.modalManager (modal management)
// - window.notificationHandler (notification system)
// - window.showNotification (fallback notifications)
// - window.formatDate (date formatting)
// - window.formatBytes (file size formatting)
// - window.app (application state)

// Optional Dependencies:
// - Notification handlers fall back to console
// - Date/bytes formatting falls back to basic implementations if globals missing
// - Graceful degradation when components aren't available

/**
 * Factory function that creates the ProjectDashboard utils instance.
 * This follows the pattern used by other modules for consistency.
 */
function createProjectDashboardUtils() {
  // Create the ProjectDashboard namespace
  const ProjectDashboard = {};

  /* =========================================================================
   * UTILITY FUNCTIONS
   * ========================================================================= */

  /**
   * UI utility functions
   */
  ProjectDashboard.UIUtils = {
    /**
     * Create a DOM element with properties
     * @param {string} tag - Element tag name
     * @param {Object} options - Element properties
     * @returns {HTMLElement} - Created element
     */
    createElement(tag, options = {}) {
      const element = document.createElement(tag);

      // Set attributes
      if (options.className) element.className = options.className;
      if (options.id) element.id = options.id;
      if (options.textContent !== undefined) element.textContent = options.textContent;
      if (options.innerHTML !== undefined) element.innerHTML = options.innerHTML;

      // Set event handlers
      if (typeof options.onclick === 'function') {
        window.eventHandlers.trackListener(element, 'click', options.onclick);
      }

      // Set data attributes
      Object.entries(options).forEach(([key, value]) => {
        if (key.startsWith('data-')) {
          element.setAttribute(key, value);
        }
      });

      // Set other properties
      ['title', 'alt', 'src', 'href', 'placeholder', 'type', 'value', 'name'].forEach(prop => {
        if (options[prop] !== undefined) {
          element[prop] = options[prop];
        }
      });

      return element;
    },

    /**
     * Toggle element visibility
     * @param {HTMLElement|string} element - Element or selector
     * @param {boolean} visible - Whether element should be visible
     */
    toggleVisible(element, visible) {
      // Use canonical utility from eventHandlers
      window.eventHandlers.toggleVisible(element, visible);
    },

    /**
     * Format number with commas
     * @param {number} number - Number to format
     * @returns {string} - Formatted number
     */
    formatNumber(number) {
      return new Intl.NumberFormat().format(number || 0);
    },

    // We rely on window.formatDate for date formatting and window.formatBytes for byte formatting.

    /**
     * Get file icon based on type
     * @param {string} fileType - File type
     * @returns {string} - Icon
     */
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

      return icons[fileType.toLowerCase()] || '📄';
    },
  };

  /**
   * Show notification
   * @param {string} message - Notification message
   * @param {string} type - Notification type (success, error, warning, info)
   * @param {Object} options - Additional options
   */
  ProjectDashboard.showNotification = (message, type = 'info', options = {}) => {
    // Canonical: always use notificationHandler if available, fallback to window.showNotification, else console.
    if (window.notificationHandler?.show) {
      return window.notificationHandler.show(message, type, options);
    }
    if (typeof window.showNotification === 'function') {
      return window.showNotification(message, type, options);
    }
    // Last resort
    console.log(`[${type.toUpperCase()}] ${message}`);
  };

  /**
   * Set up a collapsible section
   * @param {string} toggleId - Toggle button ID
   * @param {string} panelId - Panel ID
   * @param {Function} onExpand - Callback on expand
   */
  ProjectDashboard.setupCollapsible = (toggleId, panelId, onExpand) => {
    // Use canonical helper from eventHandlers
    window.eventHandlers.setupCollapsible(toggleId, panelId, undefined, onExpand);
  };

  /**
   * Show project list view
   */
  ProjectDashboard.showProjectListView = () => {
    const listView = document.getElementById('projectListView');
    const detailsView = document.getElementById('projectDetailsView');

    if (listView) {
      listView.classList.remove('hidden');
    }

    if (detailsView) {
      detailsView.classList.add('hidden');
    }

    // Update URL
    const url = new URL(window.location);
    url.searchParams.delete('project');
    url.searchParams.delete('chatId');
    window.history.pushState({}, '', url.toString());

    // Check authentication and load projects
    Promise.resolve(window.app.state.isAuthenticated).then(isAuthenticated => {
      if (isAuthenticated && window.projectManager?.loadProjects) {
        window.projectManager.loadProjects('all');
      }
    });
  };

  /**
   * Set up event listeners for UI elements
   */
  ProjectDashboard.setupEventListeners = () => {
    // Project edit button
    const editBtn = document.getElementById('editProjectBtn');
    if (editBtn) {
      window.eventHandlers.trackListener(editBtn, 'click', () => {
        const currentProject = window.projectManager?.currentProject;
        if (currentProject && window.projectModal?.openModal) {
          window.projectModal.openModal(currentProject);
        } else {
          console.error('[projectDashboardUtils] projectModal.openModal not available');
        }
      });
    }

    // Project pin button
    const pinBtn = document.getElementById('pinProjectBtn');
    if (pinBtn) {
      window.eventHandlers.trackListener(pinBtn, 'click', async () => {
        const currentProject = window.projectManager?.currentProject;
        if (currentProject?.id && window.projectManager?.togglePinProject) {
          try {
            const updatedProject = await window.projectManager.togglePinProject(currentProject.id);
            ProjectDashboard.showNotification(
              `Project ${updatedProject.pinned ? 'pinned' : 'unpinned'}`,
              'success'
            );
          } catch (error) {
            console.error('Failed to toggle pin:', error);
            ProjectDashboard.showNotification('Failed to toggle pin', 'error');
          }
        }
      });
    }

    // Project archive button
    const archiveBtn = document.getElementById('archiveProjectBtn');
    if (archiveBtn) {
      window.eventHandlers.trackListener(archiveBtn, 'click', async () => {
        const currentProject = window.projectManager?.currentProject;
        if (currentProject?.id && window.projectManager?.toggleArchiveProject && window.modalManager) {
          window.modalManager.confirmAction({
            title: currentProject.archived ? 'Unarchive Project?' : 'Archive Project?',
            message: currentProject.archived
              ? `Are you sure you want to unarchive "${currentProject.name}"?`
              : `Are you sure you want to archive "${currentProject.name}"? Archived projects are hidden by default.`,
            confirmText: currentProject.archived ? 'Unarchive' : 'Archive',
            confirmClass: currentProject.archived ? 'btn-success' : 'btn-warning',
            onConfirm: async () => {
              try {
                await window.projectManager.toggleArchiveProject(currentProject.id);
                ProjectDashboard.showNotification(
                  `Project ${currentProject.archived ? 'unarchived' : 'archived'}`,
                  'success'
                );
                ProjectDashboard.showProjectListView();
              } catch (error) {
                console.error('Failed to toggle archive:', error);
                ProjectDashboard.showNotification('Failed to toggle archive', 'error');
              }
            },
          });
        }
      });
    }
  };

  // Initialize the dashboard
  ProjectDashboard.init = function () {
    console.log('[ProjectDashboard] Initializing...');

    // Set up event listeners
    ProjectDashboard.setupEventListeners();

    // Dispatch initialization event
    document.dispatchEvent(new CustomEvent('projectDashboardInitialized'));

    return this;
  };

  // Export to window
  window.ProjectDashboard = ProjectDashboard;

  // For backward compatibility
  window.showProjectsView = ProjectDashboard.showProjectListView;
  window.uiUtilsInstance = ProjectDashboard.UIUtils;

  return ProjectDashboard;
}

// Create and export the utils instance
const projectDashboardUtils = createProjectDashboardUtils();

// Register with dependency system
if (window.DependencySystem) {
  window.DependencySystem.register('projectDashboardUtils', projectDashboardUtils);
}

// Make factory available on window for browser consumers; avoid ES exports to prevent SyntaxError in classic scripts.
window.createProjectDashboardUtils = createProjectDashboardUtils;
window.projectDashboardUtils = projectDashboardUtils;
