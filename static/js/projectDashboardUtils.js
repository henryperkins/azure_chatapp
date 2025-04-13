/**
 * @file projectDashboardUtils.js
 * @description Centralized utility classes and functions for the project dashboard.
 * @module ProjectDashboard
 *
 * This file includes:
 * - AppEventBus
 * - UIUtils
 * - ModalManager
 * - Notifications & Error Handling
 * - Initialization & Global Listeners
 *
 * Dependencies:
 * - (Optional) auth.js for session handling and authentication checks
 * - (Optional) projectManager for project CRUD operations
 * - Tailwind/DaisyUI for styling (optional but recommended)
 *
 * Notes on Remediation:
 * 1. Added checks to ensure referenced global objects exist (e.g., window.auth, window.projectManager).
 * 2. Includes a fallback if HTMLDialogElement is not supported. You may need a third-party polyfill if needed.
 * 3. Gracefully handles missing DOM elements (logs a warning instead of throwing errors).
 * 4. Any references to AnimationUtils in the original docstring have been removed.
 * 5. The code remains in the global scope but can be refactored into an ES module if desired.
 */

(function () {
  // Prevent double-initialization
  if (window.ProjectDashboard && window.ProjectDashboard._initialized) {
    console.log('[ProjectDashboard] Already initialized, skipping...');
    return;
  }

  console.log('[ProjectDashboard] Initializing projectDashboardUtils.js');

  /* =========================================================================
   *  GLOBAL NAMESPACE SETUP
   * ========================================================================= */
  const ProjectDashboard = window.ProjectDashboard || {};
  ProjectDashboard._initialized = true; // Mark as initialized

  /**
   * Check for dialog support. If not supported, you may consider dynamically loading a polyfill.
   * Example: https://github.com/GoogleChrome/dialog-polyfill
   */
  if (typeof HTMLDialogElement === 'undefined') {
    console.warn('[ProjectDashboard] HTMLDialogElement not supported in this browser. A dialog polyfill is recommended.');
  }

  /* =========================================================================
   *  1. UNIFIED EVENT BUS
   * ========================================================================= */
  class AppEventBus {
    constructor() {
      this.channels = {};
    }
    subscribe(channel, callback) {
      if (!this.channels[channel]) this.channels[channel] = [];
      this.channels[channel].push(callback);
      // Return unsubscribe function
      return () => this.unsubscribe(channel, callback);
    }
    unsubscribe(channel, callback) {
      if (!this.channels[channel]) return;
      this.channels[channel] = this.channels[channel].filter((cb) => cb !== callback);
    }
    publish(channel, data) {
      (this.channels[channel] || []).forEach((fn) => fn(data));
    }
  }
  ProjectDashboard.eventBus = new AppEventBus();

  /* =========================================================================
   *  2. UI UTILS
   * ========================================================================= */
  class UIUtils {
    constructor() {
      // Locate existing toast container or create one
      this.notificationContainer = document.getElementById('notificationContainer');
      if (!this.notificationContainer) {
        this.notificationContainer = document.createElement('div');
        this.notificationContainer.id = 'notificationContainer';
        // DaisyUI/Tailwind classes for toast placement
        this.notificationContainer.className = 'toast toast-top toast-end z-[100]';
        document.body.appendChild(this.notificationContainer);
      }
    }

    /**
     * Creates a DOM element with optional properties.
     */
    createElement(tag, options = {}) {
      const element = document.createElement(tag);

      // Common attributes
      if (options.className) element.className = options.className;
      if (options.id) element.id = options.id;
      if (typeof options.textContent !== 'undefined') element.textContent = options.textContent;
      if (typeof options.innerHTML !== 'undefined') element.innerHTML = options.innerHTML;
      if (typeof options.onclick === 'function') {
        element.addEventListener('click', options.onclick);
      }

      // Additional attributes
      for (const [attr, value] of Object.entries(options)) {
        if (!['className', 'id', 'textContent', 'innerHTML', 'onclick'].includes(attr)) {
          element.setAttribute(attr, value);
        }
      }
      return element;
    }

    /**
     * Toggles the 'hidden' class to show/hide an element.
     */
    toggleVisibility(element, visible) {
      if (!element) return;
      if (visible) element.classList.remove('hidden');
      else element.classList.add('hidden');
    }

    /**
     * Formats a number with commas (e.g. 1,234,567).
     */
    formatNumber(number) {
      if (typeof number !== 'number') return String(number);
      return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    /**
     * Formats a date string into a local date/time string.
     */
    formatDate(dateString) {
      if (!dateString) return '';
      try {
        const date = new Date(dateString);
        return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
      } catch {
        return dateString;
      }
    }

    /**
     * Formats a file size in bytes to a human-readable format (e.g. MB, GB).
     */
    formatBytes(bytes, decimals = 2) {
      if (!Number.isFinite(bytes) || bytes < 0) return '0 Bytes';
      if (bytes === 0) return '0 Bytes';

      const k = 1024;
      const dm = decimals < 0 ? 0 : decimals;
      const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      const val = parseFloat((bytes / Math.pow(k, i)).toFixed(dm));

      return `${val} ${sizes[i]}`;
    }

    /**
     * Maps a file extension to a relevant emoji icon (for display purposes).
     */
    fileIcon(fileType) {
      const iconMap = {
        pdf: '📄', doc: '📝', docx: '📝', txt: '📄',
        csv: '📊', json: '📋', md: '📄', xlsx: '📊',
        pptx: '📊', html: '🌐', jpg: '🖼️', jpeg: '🖼️',
        png: '🖼️', py: '🐍', js: '📜', css: '🎨',
        zip: '📦', xml: '🔍'
      };
      return iconMap[fileType] || '📄';
    }

    /**
     * Shortcut for document.getElementById.
     */
    getElement(id) {
      return document.getElementById(id);
    }

    /**
     * Unified notification system using DaisyUI Alert components in a Toast container.
     * Accepts message, type, and extra options for quick actions or custom timeouts.
     */
    showNotification(message, type = 'info', options = {}) {
      const alertDiv = document.createElement('div');
      let alertClass = 'alert-info';
      if (type === 'success') alertClass = 'alert-success';
      else if (type === 'warning') alertClass = 'alert-warning';
      else if (type === 'error') alertClass = 'alert-error';

      alertDiv.className = `alert ${alertClass} shadow-md`;
      alertDiv.setAttribute('role', 'alert');

      // Optional icons based on alert type
      let iconSvg = '';
      if (type === 'info') {
        iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
      } else if (type === 'success') {
        iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
      } else if (type === 'warning') {
        iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>';
      } else if (type === 'error') {
        iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
      }

      let contentHTML = `${iconSvg}<span>${message}</span>`;

      // Optional action button in the toast
      if (options.action && typeof options.onAction === 'function') {
        const actionButton = document.createElement('button');
        actionButton.className = 'btn btn-sm btn-ghost';
        actionButton.textContent = options.action;
        actionButton.onclick = (e) => {
          e.stopPropagation();
          options.onAction();
          alertDiv.remove();
        };
        contentHTML = `<div class="flex-1">${iconSvg}<span>${message}</span></div>`;
        alertDiv.innerHTML = contentHTML;
        alertDiv.appendChild(actionButton);
        alertDiv.classList.add('flex', 'justify-between', 'items-center');
      } else {
        alertDiv.innerHTML = contentHTML;
      }

      this.notificationContainer.appendChild(alertDiv);

      // Auto-remove after timeout (unless timeout=0 -> persist)
      const timeout = options.timeout === 0 ? Infinity : (options.timeout || 5000);
      if (timeout !== Infinity) {
        setTimeout(() => {
          alertDiv.style.transition = 'opacity 0.3s ease-out';
          alertDiv.style.opacity = '0';
          setTimeout(() => alertDiv.remove(), 300);
        }, timeout);
      }

      // Optional: Remove on click
      alertDiv.addEventListener('click', () => {
        alertDiv.style.transition = 'opacity 0.3s ease-out';
        alertDiv.style.opacity = '0';
        setTimeout(() => alertDiv.remove(), 300);
      });
    }

    /**
     * Confirmation Modal using a <dialog> with DaisyUI styles.
     */
    async confirmAction(config = {}) {
      return new Promise((resolve) => {
        const modalId = 'confirmActionModal';
        const modal = document.getElementById(modalId);

        // Basic check for dialog existence
        if (!modal || typeof modal.showModal !== 'function') {
          console.error('[UIUtils] confirmAction: Modal dialog not found or not supported.');
          resolve(false);
          return;
        }

        const titleEl = modal.querySelector('#confirmActionTitle');
        const messageEl = modal.querySelector('#confirmActionMessage');
        const confirmBtn = modal.querySelector('#confirmActionButton');
        const cancelBtn = modal.querySelector('#cancelActionButton');

        if (!titleEl || !messageEl || !confirmBtn || !cancelBtn) {
          console.error('[UIUtils] confirmAction: Required modal elements are missing.');
          resolve(false);
          return;
        }

        // Populate modal content
        titleEl.textContent = config.title || 'Confirm Action';
        messageEl.textContent = config.message || 'Are you sure?';
        confirmBtn.textContent = config.confirmText || 'Confirm';
        cancelBtn.textContent = config.cancelText || 'Cancel';
        confirmBtn.className = `btn ${config.confirmClass || 'btn-primary'}`;

        // Remove previous handlers to prevent duplicates
        if (confirmBtn._clickHandler) {
          confirmBtn.removeEventListener('click', confirmBtn._clickHandler);
        }

        // Define new handlers
        const handleConfirm = () => {
          if (typeof config.onConfirm === 'function') config.onConfirm();
          modal.close();
          resolve(true);
        };

        /**
         * Handle any cancel/close scenario.
         * This includes clicking Cancel or closing by ESC key or backdrop,
         * so it always resolves false except for the confirm button path.
         */
        const handleCancel = () => {
          if (typeof config.onCancel === 'function' && !confirmBtn.contains(document.activeElement)) {
            config.onCancel();
          }
          resolve(false);
        };

        // Attach listeners
        confirmBtn.addEventListener('click', handleConfirm, { once: true });
        confirmBtn._clickHandler = handleConfirm;

        modal.removeEventListener('close', handleCancel);
        modal.addEventListener('close', handleCancel, { once: true });

        // Show the modal
        modal.showModal();
      });
    }
  }

  // Create a singleton instance and assign to global
  ProjectDashboard.uiUtils = new UIUtils();
  window.uiUtilsInstance = ProjectDashboard.uiUtils;

  /* =========================================================================
   *  3. MODAL MANAGER
   *      (Simplified, uses <dialog> elements directly with DaisyUI classes)
   * ========================================================================= */
  class ModalManager {
    constructor() {
      // Hard-coded mapping: semantic names to actual dialog IDs in the HTML
      this.modalMappings = {
        project: 'projectFormModal',
        delete: 'deleteConfirmModal',
        confirm: 'confirmActionModal',
        knowledge: 'knowledgeBaseSettingsModal',
        knowledgeResult: 'knowledgeResultModal',
        customize: 'cardCustomizationModal'
      };
      console.log('[ModalManager] Initialized.');
    }

    /**
     * Shows a modal.
     */
    show(modalName, options = {}) {
      const modalId = this.modalMappings[modalName];
      if (!modalId) {
        console.error(`[ModalManager] No ID mapping found for modal name: '${modalName}'`);
        return false;
      }

      const modalEl = document.getElementById(modalId);
      if (!modalEl) {
        console.error(`[ModalManager] Dialog element not found for ID: '${modalId}'`);
        return false;
      }
      if (typeof modalEl.showModal !== 'function') {
        console.warn(`[ModalManager] .showModal() not available for ID: '${modalId}', falling back to display-based modal handling`);
        modalEl.classList.remove('hidden');
        modalEl.style.display = 'block';
      } else {
        modalEl.showModal();
      }

      console.log(`[ModalManager] Showing modal: ${modalName} (#${modalId})`);

      // If provided, update content before showing
      if (typeof options.updateContent === 'function') {
        try {
          options.updateContent(modalEl);
        } catch (err) {
          console.error(`[ModalManager] Error during updateContent for ${modalName}:`, err);
        }
      }

      modalEl.showModal();
      return true;
    }

    /**
     * Hides a modal.
     */
    hide(modalName) {
      const modalId = this.modalMappings[modalName];
      if (!modalId) {
        console.error(`[ModalManager] No ID mapping found for modal name: '${modalName}'`);
        return false;
      }

      const modalEl = document.getElementById(modalId);
      if (!modalEl || typeof modalEl.close !== 'function') {
        console.warn(`[ModalManager] Dialog element not valid or not found for ID: '${modalId}'`);
        return false;
      }

      console.log(`[ModalManager] Hiding modal: ${modalName} (#${modalId})`);
      modalEl.close();
      return true;
    }

    /**
     * Static helper to confirmAction using UIUtils instance.
     */
    static confirmAction(config = {}) {
      if (window.uiUtilsInstance?.confirmAction) {
        return window.uiUtilsInstance.confirmAction(config);
      }
      console.error('[ModalManager] UIUtils.confirmAction not available.');
      return Promise.resolve(false);
    }

    /**
     * Check if ModalManager is available (always true in this simplified version).
     */
    static isAvailable() {
      return true;
    }
  }

  // Instantiate and assign to global
  ProjectDashboard.ModalManager = ModalManager;
  ProjectDashboard.modalManager = new ModalManager();
  window.modalManager = ProjectDashboard.modalManager;
  window.ModalManager = ModalManager;

  // Provide a global showNotification
  window.showNotification = (message, type = 'info', options = {}) => {
    if (window.uiUtilsInstance) {
      window.uiUtilsInstance.showNotification(message, type, options);
    } else {
      // Fallback if UIUtils not ready
      console.log(`[Fallback Notification - ${type.toUpperCase()}]: ${message}`);
    }
  };
  ProjectDashboard.showNotification = window.showNotification;

  /* =========================================================================
   *  4. NOTIFICATION & ERROR HANDLING
   * ========================================================================= */
  // Global error event
  window.addEventListener('error', (evt) => {
    const error = evt.error || evt;
    const errorMessage = error?.message || evt.message || 'Unknown error';
    console.error('[GlobalError]', errorMessage, error?.stack || '');
    window.showNotification(`An error occurred: ${errorMessage}`, 'error');
  });

  // Global unhandled promise rejection
  window.addEventListener('unhandledrejection', (evt) => {
    const reason = evt.reason;
    const errorMessage = reason?.message || 'Unhandled Rejection';
    const errorStack = reason?.stack || '';

    // Check for any sign of auth errors
    const isAuthError =
      errorMessage.includes('Authentication required') ||
      errorMessage.includes('Not authenticated') ||
      errorMessage.includes('auth token') ||
      errorMessage.includes('login') ||
      (reason?.status === 401);

    // Attempt to standardize if auth.js is loaded
    const stdErr = window.auth?.standardizeError?.(reason) || reason;

    // If authentication is required or session expired
    if (isAuthError || stdErr?.requiresLogin || stdErr?.code === 'SESSION_EXPIRED') {
      console.warn('[GlobalRejection] Possible Auth error:', errorMessage);

      // Try to verify authentication if auth is available
      if (window.auth?.isAuthenticated) {
        window.auth
          .isAuthenticated({ forceVerify: true })
          .then((authenticated) => {
            if (!authenticated) {
              console.log('[GlobalRejection] Not authenticated, clearing session');
              window.auth?.clear?.();

              // Example: show login dialog if an #authButton exists
              const authButton = document.getElementById('authButton');
              if (authButton) {
                setTimeout(() => {
                  authButton.click();
                }, 300);
              }
            }
          })
          .catch(() => {
            window.auth?.clear?.();
          });
      }

      // Notify user
      const message = 'Authentication required. Please log in.';
      window.showNotification(message, 'error', { timeout: 7000 });
      evt.preventDefault();
      return;
    }

    // Non-auth errors
    console.error('[UnhandledRejection]', errorMessage, errorStack);
    window.showNotification(`Unhandled error: ${errorMessage}`, 'error');
    evt.preventDefault();
  });

  /* =========================================================================
   *  5. HELPER FUNCTIONS
   * ========================================================================= */
  ProjectDashboard.showProjectsView = function () {
    console.log('[ProjectDashboardUtils] showProjectsView called');
    const listView = document.getElementById('projectListView');
    const detailsView = document.getElementById('projectDetailsView');

    if (listView) {
      listView.classList.remove('hidden');
    } else {
      console.warn('[ProjectDashboardUtils] #projectListView not found');
    }

    if (detailsView) {
      detailsView.classList.add('hidden');
    } else {
      console.warn('[ProjectDashboardUtils] #projectDetailsView not found');
    }

    // Update URL without triggering a full navigation
    const currentUrl = new URL(window.location);
    currentUrl.searchParams.delete('project');
    currentUrl.searchParams.delete('chatId');
    window.history.pushState({}, '', currentUrl.pathname + currentUrl.search);
  };

  // Provide global reference if needed
  if (!window.showProjectsView) {
    window.showProjectsView = ProjectDashboard.showProjectsView;
  }

  /* =========================================================================
   *  6. FINAL SETUP & EVENT DISPATCH
   * ========================================================================= */
  function dispatchReady() {
    window.dashboardUtilsReady = true;
    document.dispatchEvent(new CustomEvent('dashboardUtilsReady'));
    console.log('[ProjectDashboard] dashboardUtilsReady event dispatched');
  }

  /**
   * Setup listeners for project detail view.
   * NOTE: This code references window.projectManager if present.
   */
  function setupProjectDetailButtonListeners() {
    const backBtn = document.getElementById('backToProjectsBtn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        ProjectDashboard.showProjectsView();
      });
    }

    const editBtn = document.getElementById('editProjectBtn');
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        const projectManager = window.projectManager;
        if (!projectManager) {
          console.warn('[ProjectDashboardUtils] No projectManager found; cannot edit project.');
          return;
        }

        const currentProjectId = projectManager.currentProject?.id;
        if (currentProjectId && window.modalManager) {
          window.modalManager.show('project', {
            updateContent: async (modalEl) => {
              try {
                const project = await projectManager.getProjectById(currentProjectId);
                const form = modalEl.querySelector('#projectForm');
                const title = modalEl.querySelector('#projectModalTitle');
                if (form && project) {
                  form.querySelector('#projectIdInput').value = project.id;
                  form.querySelector('#projectNameInput').value = project.name || '';
                  form.querySelector('#projectDescInput').value = project.description || '';
                  form.querySelector('#projectGoalsInput').value = project.goals || '';
                  form.querySelector('#projectMaxTokensInput').value = project.max_tokens || '';
                  if (title) title.textContent = 'Edit Project';
                } else if (title) {
                  title.textContent = 'Edit Project (Error loading data)';
                }
              } catch (err) {
                console.error('[ProjectDashboardUtils] Failed loading project data:', err);
              }
            }
          });
        } else {
          ProjectDashboard.showNotification('Could not open edit project form.', 'warning');
        }
      });
    }

    const pinBtn = document.getElementById('pinProjectBtn');
    if (pinBtn) {
      pinBtn.addEventListener('click', async () => {
        const projectManager = window.projectManager;
        if (!projectManager) {
          console.warn('[ProjectDashboardUtils] No projectManager found; cannot pin project.');
          return;
        }

        const currentProjectId = projectManager.currentProject?.id;
        if (currentProjectId && typeof projectManager.togglePinProject === 'function') {
          try {
            const updatedProject = await projectManager.togglePinProject(currentProjectId);
            ProjectDashboard.showNotification(
              `Project ${updatedProject.pinned ? 'pinned' : 'unpinned'}.`,
              'success'
            );
            // Optionally update any pinned-state UI
            const projectDetailsEl = ProjectDashboard.uiUtils.getElement('projectDetailsView');
            projectDetailsEl?._componentInstance?.updatePinButton?.(updatedProject.pinned);
            // Refresh list in background
            projectManager.loadProjects?.();
          } catch (error) {
            console.error('Failed to toggle pin:', error);
            ProjectDashboard.showNotification(`Error toggling pin: ${error.message}`, 'error');
          }
        }
      });
    }

    const archiveBtn = document.getElementById('archiveProjectBtn');
    if (archiveBtn) {
      archiveBtn.addEventListener('click', async () => {
        const projectManager = window.projectManager;
        if (!projectManager) {
          console.warn('[ProjectDashboardUtils] No projectManager found; cannot archive project.');
          return;
        }

        const currentProject = projectManager.currentProject;
        if (currentProject?.id && typeof projectManager.toggleArchiveProject === 'function' && window.modalManager) {
          try {
            const confirmArchive = await window.modalManager.confirmAction({
              title: currentProject.archived ? 'Unarchive Project?' : 'Archive Project?',
              message: currentProject.archived
                ? `Are you sure you want to unarchive "${currentProject.name}"?`
                : `Are you sure you want to archive "${currentProject.name}"? Archived projects are hidden by default.`,
              confirmText: currentProject.archived ? 'Unarchive' : 'Archive',
              confirmClass: currentProject.archived ? 'btn-success' : 'btn-warning'
            });
            if (confirmArchive) {
              await projectManager.toggleArchiveProject(currentProject.id);
              ProjectDashboard.showNotification(
                `Project ${currentProject.archived ? 'unarchived' : 'archived'}.`,
                'success'
              );
              ProjectDashboard.showProjectsView();
              projectManager.loadProjects?.();
            }
          } catch (error) {
            console.error('Failed to toggle archive:', error);
            ProjectDashboard.showNotification(`Error toggling archive: ${error.message}`, 'error');
          }
        }
      });
    }
  }

  // Dispatch readiness event and set up any listeners
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      dispatchReady();
      setupProjectDetailButtonListeners();
    });
  } else {
    dispatchReady();
    setupProjectDetailButtonListeners();
  }

  // Provide a proxy for initProjectDashboard in case it's called before projectDashboard.js loads
  window.initProjectDashboard = window.initProjectDashboard || function () {
    console.log('[ProjectDashboard] initProjectDashboard called from projectDashboardUtils.js');
    if (window.projectDashboard && typeof window.projectDashboard.init === 'function') {
      return window.projectDashboard.init();
    } else {
      return new Promise((resolve, reject) => {
        document.addEventListener('projectDashboardInitialized', () => {
          console.log('[ProjectDashboard] Dashboard initialization detected via event');
          resolve(window.projectDashboard);
        }, { once: true });

        // Fallback timeout
        setTimeout(() => {
          if (!window.projectDashboard) {
            console.error('[ProjectDashboard] Dashboard initialization timed out');
            reject(new Error('Dashboard initialization timed out'));
          }
        }, 10000);
      });
    }
  };

  // Quick check for readiness
  window.isProjectDashboardUtilsReady = function () {
    return true;
  };

  // Expose the namespace globally
  window.ProjectDashboard = ProjectDashboard;

  console.log('[ProjectDashboard] projectDashboardUtils.js loaded successfully');
})();
