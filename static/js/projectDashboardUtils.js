/**
 * @file projectDashboardUtils.js
 * @description Centralized utility classes and functions for the project dashboard.
 * @module ProjectDashboard
 *
 * This file includes:
 * - AppEventBus
 * - UIUtils
 * - AnimationUtils
 * - ModalManager
 * - Notifications & Error Handling
 * - Initialization & Global Listeners
 *
 * Dependencies:
 * - auth.js (for session handling, broadcastAuth, notify, etc.)
 */

// Set the global flag immediately at the top level to avoid race conditions
window.dashboardUtilsReady = true;

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
      this.channels[channel] = this.channels[channel].filter(cb => cb !== callback);
    }
    publish(channel, data) {
      (this.channels[channel] || []).forEach(fn => fn(data));
    }
  }

  ProjectDashboard.eventBus = new AppEventBus();

  /* =========================================================================
   *  2. UI UTILS
   * ========================================================================= */
  class UIUtils {
    constructor() {
      console.log('[UIUtils] instance created');
      this.notificationContainer = document.getElementById('notificationContainer');
      if (!this.notificationContainer) {
         this.notificationContainer = document.createElement('div');
         this.notificationContainer.id = 'notificationContainer';
         // Use DaisyUI toast container classes
         this.notificationContainer.className = 'toast toast-top toast-end z-[100]'; // Position top-right
         document.body.appendChild(this.notificationContainer);
      }
    }

    createElement(tag, options = {}) {
      const element = document.createElement(tag);

      // Common attributes
      if (options.className) element.className = options.className;
      if (options.id) element.id = options.id;
      if (options.textContent !== undefined) element.textContent = options.textContent;
      if (options.innerHTML !== undefined) element.innerHTML = options.innerHTML;
      if (options.onclick) element.addEventListener('click', options.onclick);

      // Additional attributes
      for (const [attr, value] of Object.entries(options)) {
        if (!['className', 'id', 'textContent', 'innerHTML', 'onclick'].includes(attr)) {
          element.setAttribute(attr, value);
        }
      }
      return element;
    }

    toggleVisibility(element, visible) {
      if (!element) return;
      if (visible) {
        element.classList.remove('hidden');
      } else {
        element.classList.add('hidden');
      }
    }

    formatNumber(number) {
      return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    formatDate(dateString) {
      if (!dateString) return '';
      try {
        const date = new Date(dateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
      } catch (e) {
        return dateString;
      }
    }

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

    fileIcon(fileType) {
      const iconMap = {
        pdf: '📄',
        doc: '📝',
        docx: '📝',
        txt: '📄',
        csv: '📊',
        json: '📋',
        md: '📄',
        xlsx: '📊',
        pptx: '📊',
        html: '🌐',
        jpg: '🖼️',
        jpeg: '🖼️',
        png: '🖼️',
        py: '🐍',
        js: '📜',
        css: '🎨',
        zip: '📦',
        xml: '🔍'
      };
      return iconMap[fileType] || '📄';
    }

    getElement(id) {
      return document.getElementById(id);
    }

    /**
     * Unified notification system using DaisyUI Alert component within a Toast container
     * @param {string} message
     * @param {string} type - info | success | warning | error
     * @param {Object} options - { timeout: ms, action: 'Action Text', onAction: callback }
     */
    showNotification(message, type = 'info', options = {}) {
      const alertDiv = document.createElement('div');
      // Base alert classes + color modifier
      let alertClass = 'alert-info';
      if (type === 'success') alertClass = 'alert-success';
      else if (type === 'warning') alertClass = 'alert-warning';
      else if (type === 'error') alertClass = 'alert-error';

      alertDiv.className = `alert ${alertClass} shadow-md`; // Add shadow
      alertDiv.setAttribute('role', 'alert');

      // Add icon based on type
      let iconSvg = '';
      if (type === 'info') iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
      else if (type === 'success') iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
      else if (type === 'warning') iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>';
      else if (type === 'error') iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';

      let contentHTML = `${iconSvg}<span>${message}</span>`;

      // Add action button if specified
      if (options.action && typeof options.onAction === 'function') {
         const actionButton = document.createElement('button');
         actionButton.className = 'btn btn-sm btn-ghost'; // Simple ghost button
         actionButton.textContent = options.action;
         actionButton.onclick = (e) => {
            e.stopPropagation(); // Prevent toast removal if clicked
            options.onAction();
            alertDiv.remove(); // Remove toast after action
         };
         // Wrap content and button for layout
         contentHTML = `<div class="flex-1">${iconSvg}<span>${message}</span></div>`;
         alertDiv.innerHTML = contentHTML;
         alertDiv.appendChild(actionButton);
         alertDiv.classList.add('flex', 'justify-between', 'items-center'); // Adjust layout
      } else {
         alertDiv.innerHTML = contentHTML;
      }


      this.notificationContainer.appendChild(alertDiv);

      // Auto-remove after timeout
      const timeout = options.timeout === 0 ? Infinity : (options.timeout || 5000); // Allow timeout 0 to persist
      if (timeout !== Infinity) {
         setTimeout(() => {
           // Add fade-out effect (optional)
           alertDiv.style.transition = 'opacity 0.3s ease-out';
           alertDiv.style.opacity = '0';
           setTimeout(() => alertDiv.remove(), 300);
         }, timeout);
      }

      // Allow manual closing by clicking the toast itself (optional)
      alertDiv.addEventListener('click', () => {
         alertDiv.style.transition = 'opacity 0.3s ease-out';
         alertDiv.style.opacity = '0';
         setTimeout(() => alertDiv.remove(), 300);
      });
    }

     /**
      * Confirmation Modal using DaisyUI Dialog
      * @param {Object} config - { title, message, confirmText, cancelText, confirmClass, onConfirm, onCancel }
      * @returns {Promise<boolean>} - Resolves true if confirmed, false otherwise
      */
     async confirmAction(config = {}) {
       return new Promise((resolve) => {
         const modalId = 'confirmActionModal'; // Use the ID from index.html
         const modal = document.getElementById(modalId);

         if (!modal || typeof modal.showModal !== 'function') {
           console.error('[UIUtils] confirmAction: Confirm modal dialog not found or invalid!');
           resolve(false); // Indicate failure
           return;
         }

         // Get elements within the modal
         const titleEl = modal.querySelector('#confirmActionTitle');
         const messageEl = modal.querySelector('#confirmActionMessage');
         const confirmBtn = modal.querySelector('#confirmActionButton');
         const cancelBtn = modal.querySelector('#cancelActionButton'); // Assumes button inside <form method="dialog">

         if (!titleEl || !messageEl || !confirmBtn || !cancelBtn) {
            console.error('[UIUtils] confirmAction: Missing elements inside confirm modal!');
            resolve(false);
            return;
         }

         // Update modal content
         titleEl.textContent = config.title || 'Confirm Action';
         messageEl.textContent = config.message || 'Are you sure?';
         confirmBtn.textContent = config.confirmText || 'Confirm';
         cancelBtn.textContent = config.cancelText || 'Cancel';

         // Apply custom confirm button class (e.g., btn-error, btn-warning)
         confirmBtn.className = `btn ${config.confirmClass || 'btn-primary'}`; // Reset and apply

         // Remove previous listeners to avoid duplicates
         const oldConfirmHandler = confirmBtn._clickHandler;
         if (oldConfirmHandler) confirmBtn.removeEventListener('click', oldConfirmHandler);
         // Cancel button closes dialog via form method="dialog", no listener needed unless onCancel callback exists

         // Define new handlers
         const handleConfirm = () => {
           if (typeof config.onConfirm === 'function') config.onConfirm();
           modal.close();
           resolve(true);
         };

         const handleCancel = () => {
             // This handler is called when the dialog is closed by the cancel button or ESC
             // Check if the confirm button was the one clicked to trigger close
             // This check is imperfect but helps differentiate explicit cancel vs confirm->close
             if (typeof config.onCancel === 'function' && !confirmBtn.contains(document.activeElement)) {
                 config.onCancel();
             }
             resolve(false); // Resolve false on any close other than confirm click
         };


         // Attach new listeners
         confirmBtn.addEventListener('click', handleConfirm, { once: true }); // Run confirm logic only once
         confirmBtn._clickHandler = handleConfirm; // Store for potential removal

         // Listen for the dialog's close event for cancellation
         modal.removeEventListener('close', handleCancel); // Remove previous listener
         modal.addEventListener('close', handleCancel, { once: true });


         // Show the modal
         modal.showModal();
       });
     }
  }

  // Create a singleton instance and assign to global scope
  ProjectDashboard.uiUtils = new UIUtils();
  window.uiUtilsInstance = ProjectDashboard.uiUtils; // Make it globally accessible


  /* =========================================================================
   *  4. MODAL MANAGER (Simplified - Relying on Dialog Elements)
   * ========================================================================= */
  class ModalManager {
    constructor() {
      this.modalMappings = { // Map semantic names to actual IDs in index.html
        project: 'projectFormModal',
        delete: 'deleteConfirmModal',
        confirm: 'confirmActionModal',
        knowledge: 'knowledgeBaseSettingsModal',
        knowledgeResult: 'knowledgeResultModal',
        customize: 'cardCustomizationModal'
        // Add other modals here if needed
      };
      console.log('[ModalManager] Initialized (using dialog elements)');
    }

    /**
     * Shows a modal dialog.
     * @param {string} modalName - Semantic name (e.g., 'project', 'delete')
     * @param {Object} options - Optional: { updateContent: (modalElement) => {} }
     * @returns {boolean} - True if modal was found and shown, false otherwise.
     */
    show(modalName, options = {}) {
      const modalId = this.modalMappings[modalName];
      if (!modalId) {
        console.error(`[ModalManager] No ID mapping found for modal name: '${modalName}'`);
        return false;
      }

      const modalEl = document.getElementById(modalId);
      if (!modalEl || typeof modalEl.showModal !== 'function') {
        console.error(`[ModalManager] Dialog element not found or invalid for ID: '${modalId}'`);
        return false;
      }

      console.log(`[ModalManager] Showing modal: ${modalName} (#${modalId})`);

      // Update content if needed before showing
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
     * Hides a modal dialog.
     * @param {string} modalName - Semantic name (e.g., 'project', 'delete')
     * @returns {boolean} - True if modal was found and closed, false otherwise.
     */
    hide(modalName) {
      const modalId = this.modalMappings[modalName];
      if (!modalId) {
        console.error(`[ModalManager] No ID mapping found for modal name: '${modalName}'`);
        return false;
      }

      const modalEl = document.getElementById(modalId);
      if (!modalEl || typeof modalEl.close !== 'function') {
        // Don't error if already closed or not found, just warn
        console.warn(`[ModalManager] Dialog element not found or invalid for hiding: '${modalId}'`);
        return false;
      }

      console.log(`[ModalManager] Hiding modal: ${modalName} (#${modalId})`);
      modalEl.close();
      return true;
    }

    // Static method remains useful for simple confirmations
    static confirmAction(config = {}) {
       // Delegate to the UIUtils instance method
       if (window.uiUtilsInstance?.confirmAction) {
          return window.uiUtilsInstance.confirmAction(config);
       } else {
          console.error("[ModalManager] UIUtils.confirmAction not available.");
          return Promise.resolve(false); // Fallback: auto-cancel
       }
    }

     // Check if available (useful for conditional logic elsewhere)
     static isAvailable() {
        return true; // Always available when using dialog elements
     }
  }

  // Instantiate and assign to global scope
  ProjectDashboard.ModalManager = ModalManager;
  ProjectDashboard.modalManager = new ModalManager();
  window.modalManager = ProjectDashboard.modalManager;
  window.ModalManager = ModalManager; // Keep static access if needed


  // Create a global showNotification function pointing to the UIUtils method
  window.showNotification = function(message, type = 'info', options = {}) {
    if (window.uiUtilsInstance) {
      window.uiUtilsInstance.showNotification(message, type, options);
    } else {
      // Fallback if utils aren't ready (shouldn't happen with correct init order)
      console.log(`[${type.toUpperCase()}] ${message}`);
    }
  };

  /* =========================================================================
   *  5. NOTIFICATION & ERROR HANDLING (Updated for DaisyUI)
   * ========================================================================= */

  // Attach the UIUtils notification function directly
  ProjectDashboard.showNotification = window.showNotification;

  // Enhanced global error handling
  window.addEventListener('error', function (evt) {
    const error = evt.error || evt;
    const errorMessage = error?.message || evt.message || 'Unknown error';

    console.error('[GlobalError]', errorMessage, error?.stack || '');
    window.showNotification(`An error occurred: ${errorMessage}`, 'error');
  });

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', function (evt) {
    const reason = evt.reason;
    const errorMessage = reason?.message || 'Unhandled Rejection';
    const errorStack = reason?.stack || '';

    // Enhanced auth error detection pattern
    const isAuthError =
      errorMessage.includes('Authentication required') ||
      errorMessage.includes('Not authenticated') ||
      errorMessage.includes('auth token') ||
      errorMessage.includes('login') ||
      (reason?.status === 401);

    // Integrate with auth.js error standardization if available
    const stdErr = window.auth?.standardizeError?.(reason) || reason;

    // Session expiration check with improved detection
    if (isAuthError || stdErr.requiresLogin || stdErr.code === 'SESSION_EXPIRED') {
      console.warn('[GlobalRejection] Auth error detected:', errorMessage);

      // Try to recover - check if auth module exists
      if (window.auth) {
        // Try to verify authentication state
        window.auth.isAuthenticated({forceVerify: true}).then(authenticated => {
          if (!authenticated) {
            console.log('[GlobalRejection] Confirmed not authenticated, clearing state');
            window.auth.clear();

            // Show login dialog if not already showing
            const authButton = document.getElementById('authButton');
            if (authButton) {
              setTimeout(() => {
                authButton.click();
              }, 300); // Small delay to avoid UI glitches
            }
          }
        }).catch(() => {
          // On verification error, clear anyway as a safety measure
          window.auth?.clear?.();
        });
      }

      // Provide user feedback
      const message = "Authentication required. Please log in and try again.";
      window.showNotification(message, 'error', { timeout: 7000 }); // Longer timeout for auth errors
      evt.preventDefault();
      return;
    }

    // For non-auth errors, just log and display
    console.error('[UnhandledRejection]', errorMessage, errorStack);
    window.showNotification(`Unhandled error: ${errorMessage}`, 'error');
    evt.preventDefault();
  });

  /* =========================================================================
   *  6. HELPER FUNCTIONS (SHOW/HIDE VIEWS, ETC.)
   * ========================================================================= */
  ProjectDashboard.showProjectsView = function () {
    console.log('[ProjectDashboardUtils] Executing showProjectsView');
    const listView = document.getElementById('projectListView');
    const detailsView = document.getElementById('projectDetailsView');

    if (listView) {
      listView.classList.remove('hidden');
      // Ensure flex-1 is added if needed for layout when visible
      // listView.classList.add('flex-1'); // Handled by parent drawer-content
      console.log('[ProjectDashboardUtils] projectListView made visible');
    } else {
      console.warn('[ProjectDashboardUtils] projectListView not found');
    }

    if (detailsView) {
      detailsView.classList.add('hidden');
      console.log('[ProjectDashboardUtils] projectDetailsView hidden');
    } else {
      console.warn('[ProjectDashboardUtils] projectDetailsView not found');
    }

    // Update URL without triggering popstate
    const currentUrl = new URL(window.location);
    currentUrl.searchParams.delete('project');
    currentUrl.searchParams.delete('chatId'); // Clear chat ID too
    window.history.pushState({}, '', currentUrl.pathname + currentUrl.search); // Update state
  };

  // Provide a global reference if needed:
  if (!window.showProjectsView) {
    window.showProjectsView = ProjectDashboard.showProjectsView;
  }

  /* =========================================================================
   *  7. FINAL SETUP & EXPORT
   * ========================================================================= */
  // Dispatch event indicating the dashboard utils are ready
  function dispatchReady() {
    // Set a global flag that can be checked directly
    window.dashboardUtilsReady = true;
    document.dispatchEvent(new CustomEvent('dashboardUtilsReady'));
    console.log('[ProjectDashboard] dashboardUtilsReady event dispatched');
  }

  // Add event listeners for project detail buttons (using DaisyUI structure)
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
        const currentProjectId = window.projectManager?.currentProject?.id;
        if (currentProjectId && window.modalManager) {
           // Show the project modal and pass data via updateContent
           window.modalManager.show('project', {
              updateContent: async (modalEl) => {
                 const project = await window.projectManager?.getProjectById(currentProjectId);
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
              }
           });
        } else {
          console.warn('Cannot edit project: No current project ID or modalManager not available.');
          ProjectDashboard.showNotification('Could not open edit project form.', 'warning');
        }
      });
    }

    const pinBtn = document.getElementById('pinProjectBtn');
    if (pinBtn) {
      pinBtn.addEventListener('click', async () => {
        const currentProjectId = window.projectManager?.currentProject?.id;
        if (currentProjectId && window.projectManager?.togglePinProject) {
          try {
            const updatedProject = await window.projectManager.togglePinProject(currentProjectId);
            ProjectDashboard.showNotification(`Project ${updatedProject.pinned ? 'pinned' : 'unpinned'}.`, 'success');
            // Update button state directly
            ProjectDashboard.uiUtils.getElement('projectDetailsView')._componentInstance?.updatePinButton(updatedProject.pinned); // Assuming instance is stored
            window.projectManager.loadProjects(); // Refresh list in background
          } catch (error) {
            console.error('Failed to toggle pin:', error);
            ProjectDashboard.showNotification(`Error toggling pin: ${error.message}`, 'error');
          }
        } else {
          console.warn('Cannot toggle pin: No current project ID or togglePinProject function.');
        }
      });
    }

    const archiveBtn = document.getElementById('archiveProjectBtn');
    if (archiveBtn) {
      archiveBtn.addEventListener('click', async () => {
        const currentProject = window.projectManager?.currentProject;
        if (currentProject?.id && window.projectManager?.toggleArchiveProject && window.modalManager) {
           const confirmArchive = await window.modalManager.confirmAction({
              title: currentProject.archived ? 'Unarchive Project?' : 'Archive Project?',
              message: `Are you sure you want to ${currentProject.archived ? 'unarchive' : 'archive'} "${currentProject.name}"? ${currentProject.archived ? '' : 'Archived projects are hidden by default.'}`,
              confirmText: currentProject.archived ? 'Unarchive' : 'Archive',
              confirmClass: currentProject.archived ? 'btn-success' : 'btn-warning', // Use appropriate colors
           });

           if (confirmArchive) {
             try {
               await window.projectManager.toggleArchiveProject(currentProject.id);
               ProjectDashboard.showNotification(`Project ${currentProject.archived ? 'unarchived' : 'archived'}.`, 'success');
               ProjectDashboard.showProjectsView(); // Go back to list
               window.projectManager.loadProjects(); // Refresh list
             } catch (error) {
               console.error('Failed to toggle archive:', error);
               ProjectDashboard.showNotification(`Error toggling archive: ${error.message}`, 'error');
             }
           }
        } else {
          console.warn('Cannot toggle archive: Missing project, function, or modal manager.');
        }
      });
    }
  }

  // Ensure the ready flag is set immediately and the event is dispatched
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        dispatchReady();
        setupProjectDetailButtonListeners(); // Setup listeners after DOM is ready
    });
  } else {
    dispatchReady();
    setupProjectDetailButtonListeners(); // Setup listeners immediately if DOM already ready
  }

  // Add a proxy for initProjectDashboard in case it's called before projectDashboard.js loads
  window.initProjectDashboard = window.initProjectDashboard || function() {
    console.log('[ProjectDashboard] initProjectDashboard called from projectDashboardUtils.js');
    // Check if the real function exists in projectDashboard.js
    if (window.projectDashboard && typeof window.projectDashboard.init === 'function') {
      return window.projectDashboard.init();
    } else {
      console.warn('[ProjectDashboard] projectDashboard.js not loaded yet, dashboard initialization deferred');
      // Return a promise that will be resolved when projectDashboard is initialized
      return new Promise((resolve, reject) => {
        document.addEventListener('projectDashboardInitialized', () => {
          console.log('[ProjectDashboard] Dashboard initialization completed via event');
          resolve(window.projectDashboard);
        }, { once: true });

        // Add a timeout to reject the promise if initialization takes too long
        setTimeout(() => {
          if (!window.projectDashboard) {
            console.error('[ProjectDashboard] Dashboard initialization timed out');
            reject(new Error('Dashboard initialization timed out'));
          }
        }, 10000); // 10 seconds timeout
      });
    }
  };

  // Function to check if dashboard utils are ready
  window.isProjectDashboardUtilsReady = function() {
    return true;
  };

  // Attach to global window
  window.ProjectDashboard = ProjectDashboard;
  console.log('[ProjectDashboard] projectDashboardUtils.js loaded successfully');
})();
