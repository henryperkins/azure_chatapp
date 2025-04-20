/**
 * projectDashboardUtils.js
 * Centralized utility functions for the project dashboard.
 * Simplified to focus on core utilities and eliminate duplication.
 */

// Create the ProjectDashboard namespace
const ProjectDashboard = window.ProjectDashboard || {};

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
    const el = typeof element === 'string' ? document.querySelector(element) : element;
    if (!el) return;

    el.classList.toggle('hidden', !visible);
  },

  /**
   * Format number with commas
   * @param {number} number - Number to format
   * @returns {string} - Formatted number
   */
  formatNumber(number) {
    return new Intl.NumberFormat().format(number || 0);
  },

  /**
   * Format date
   * @param {string} dateString - Date string
   * @param {boolean} includeTime - Whether to include time
   * @returns {string} - Formatted date
   */
  formatDate(dateString, includeTime = false) {
    if (!dateString) return '';

    try {
      const date = new Date(dateString);
      const options = {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      };

      if (includeTime) {
        options.hour = '2-digit';
        options.minute = '2-digit';
      }

      return date.toLocaleString(undefined, options);
    } catch (e) {
      return dateString;
    }
  },

  /**
   * Format bytes to human-readable format
   * @param {number} bytes - Bytes to format
   * @param {number} decimals - Decimal places
   * @returns {string} - Formatted size
   */
  formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
  },

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
      zip: '📦'
    };

    return icons[fileType.toLowerCase()] || '📄';
  }
};

/**
 * Show notification
 * @param {string} message - Notification message
 * @param {string} type - Notification type (success, error, warning, info)
 * @param {Object} options - Additional options
 */
ProjectDashboard.showNotification = (message, type = 'info', options = {}) => {
  // Use global notification handler if available
  if (window.notificationHandler?.show) {
    return window.notificationHandler.show(message, type, options);
  }

  // Fallback to window.showNotification
  if (window.showNotification) {
    return window.showNotification(message, type, options);
  }

  // Last resort: console
  console.log(`[${type.toUpperCase()}] ${message}`);
};

/**
 * Set up a collapsible section
 * @param {string} toggleId - Toggle button ID
 * @param {string} panelId - Panel ID
 * @param {Function} onExpand - Callback on expand
 */
ProjectDashboard.setupCollapsible = (toggleId, panelId, onExpand) => {
  const toggleBtn = document.getElementById(toggleId);
  const panel = document.getElementById(panelId);

  if (!toggleBtn || !panel) return;

  // Set initial state
  const initialState = localStorage.getItem(`${toggleId}_expanded`) === 'true';
  panel.classList.toggle('hidden', !initialState);
  toggleBtn.setAttribute('aria-expanded', initialState ? 'true' : 'false');

  // Add click handler
  window.eventHandlers.trackListener(toggleBtn, 'click', () => {
    const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
    const newState = !isExpanded;

    panel.classList.toggle('hidden', !newState);
    toggleBtn.setAttribute('aria-expanded', newState ? 'true' : 'false');

    // Save state
    localStorage.setItem(`${toggleId}_expanded`, newState ? 'true' : 'false');

    // Callback
    if (newState && typeof onExpand === 'function') {
      onExpand();
    }
  });
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
  window.auth.checkAuth().then(isAuthenticated => {
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
      if (currentProject?.id && window.modalManager) {
        window.modalManager.show('project', {
          updateContent: (modal) => {
            const form = modal.querySelector('#projectForm');
            const title = modal.querySelector('#projectModalTitle');

            if (form) {
              form.reset();
              form.querySelector('#projectIdInput').value = currentProject.id;
              form.querySelector('#projectNameInput').value = currentProject.name || '';
              form.querySelector('#projectDescInput').value = currentProject.description || '';
            }

            if (title) title.textContent = 'Edit Project';
          }
        });
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
          }
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
