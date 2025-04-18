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

(function() {
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
        confirm: 'confirmActionModal', // Assuming a generic confirm modal exists
        knowledge: 'knowledgeBaseSettingsModal',
        knowledgeResult: 'knowledgeResultModal',
        instructions: 'instructionsModal',
        contentView: 'contentViewModal'
        // Add other modal name -> ID mappings here
      };
      this.activeModal = null;
      console.log("[ModalManager] Initialized.");

      // Add listeners for dialog close events (e.g., pressing ESC)
      Object.values(this.modalMappings).forEach(modalId => {
        const modalEl = document.getElementById(modalId);
        if (modalEl && typeof modalEl.addEventListener === 'function') {
          modalEl.addEventListener('close', () => {
            if (this.activeModal === modalId) {
              console.log(`[ModalManager] Dialog ${modalId} closed via native event.`);
              this.activeModal = null;
              // Ensure body overflow is reset if needed, though dialog should handle this
              document.body.style.overflow = '';
            }
          });
        }
      });
    }

    /**
     * Checks if the ModalManager is available and ready.
     * @returns {boolean} True if available.
     */
    static isAvailable() {
      return typeof ModalManager !== 'undefined';
    }

    /**
     * Shows a modal dialog.
     * @param {string} modalName - The logical name of the modal (e.g., 'project', 'delete').
     * @param {object} options - Options for showing the modal.
     * @param {function} [options.updateContent] - Function to update modal content before showing.
     * @param {boolean} [options.showDuringInitialization=false] - Allow showing even if app is initializing.
     * @returns {boolean} True if the modal was shown, false otherwise.
     */
    show(modalName, options = {}) {
      // Prevent unwanted modals during initialization
      if (window.__appInitializing && !options.showDuringInitialization) {
        console.log(`[ModalManager] Skipping modal '${modalName}' during app initialization`);
        return false;
      }

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

      // Hide any currently active modal before showing a new one
      if (this.activeModal && this.activeModal !== modalId) {
        console.log(`[ModalManager] Hiding previously active modal: ${this.activeModal}`);
        this.hide(Object.keys(this.modalMappings).find(key => this.modalMappings[key] === this.activeModal));
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

      // Show the modal using the dialog's showModal method
      if (typeof modalEl.showModal === 'function') {
        modalEl.showModal();
        this.activeModal = modalId; // Track the active modal
        // Optional: Prevent body scroll while modal is open
        // document.body.style.overflow = 'hidden';
      } else {
        console.warn(`[ModalManager] .showModal() not available for ID: '${modalId}'. Cannot show modal.`);
        return false; // Indicate failure if showModal isn't available
      }

      return true;
    }

    /**
     * Hides a modal dialog.
     * @param {string} modalName - The logical name of the modal.
     * @returns {boolean} True if the modal was hidden, false otherwise.
     */
    hide(modalName) {
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

      console.log(`[ModalManager] Hiding modal: ${modalName} (#${modalId})`);

      if (typeof modalEl.close === 'function') {
        modalEl.close(); // Use the dialog's close method
      } else {
        console.warn(`[ModalManager] .close() not available for ID: '${modalId}'. Cannot hide modal properly.`);
        // Fallback: Directly hide if necessary, but less ideal
        modalEl.classList.add('hidden');
        modalEl.style.display = 'none';
      }

      // Reset active modal tracking if this was the active one
      if (this.activeModal === modalId) {
        this.activeModal = null;
        // Restore body scroll if it was modified
        document.body.style.overflow = '';
      }
      return true;
    }

    /**
     * Shows a confirmation dialog.
     * @param {object} options - Configuration for the confirmation.
     * @param {string} options.title - Modal title.
     * @param {string} options.message - Confirmation message.
     * @param {string} [options.confirmText='Confirm'] - Text for the confirm button.
     * @param {string} [options.cancelText='Cancel'] - Text for the cancel button.
     * @param {string} [options.confirmClass='btn-primary'] - CSS class for the confirm button.
     * @param {function} options.onConfirm - Callback function executed when confirmed.
     * @param {function} [options.onCancel] - Callback function executed when cancelled.
     */
    confirmAction(options) {
      const modalName = 'confirm'; // Use a generic confirm modal name
      const modalId = this.modalMappings[modalName];
      if (!modalId) {
        console.error("[ModalManager] Confirm modal ID not mapped.");
        return;
      }
      const modalEl = document.getElementById(modalId);
      if (!modalEl) {
        console.error("[ModalManager] Confirm modal element not found.");
        return;
      }

      // Update modal content
      const titleEl = modalEl.querySelector('h3');
      const messageEl = modalEl.querySelector('p'); // Assuming a <p> for the message
      const confirmBtn = modalEl.querySelector('#confirmActionBtn'); // Assuming button IDs
      const cancelBtn = modalEl.querySelector('#cancelActionBtn');

      if (titleEl) titleEl.textContent = options.title;
      if (messageEl) messageEl.textContent = options.message;
      if (confirmBtn) {
        confirmBtn.textContent = options.confirmText || 'Confirm';
        // Reset classes and add the specified one
        confirmBtn.className = `btn ${options.confirmClass || 'btn-primary'}`;
      }
      if (cancelBtn) cancelBtn.textContent = options.cancelText || 'Cancel';

      // Remove previous listeners to avoid duplicates
      const newConfirmBtn = confirmBtn.cloneNode(true);
      confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
      const newCancelBtn = cancelBtn.cloneNode(true);
      cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);


      // Add new listeners
      const confirmHandler = () => {
        this.hide(modalName);
        if (typeof options.onConfirm === 'function') {
          options.onConfirm();
        }
      };
      const cancelHandler = () => {
        this.hide(modalName);
        if (typeof options.onCancel === 'function') {
          options.onCancel();
        }
      };

      newConfirmBtn.addEventListener('click', confirmHandler);
      newCancelBtn.addEventListener('click', cancelHandler);

      // Show the confirmation modal
      this.show(modalName, { showDuringInitialization: options.showDuringInitialization }); // Allow during init if specified
    }
  }

  // Instantiate the modal manager globally if it doesn't exist
  if (!window.modalManager) {
    window.modalManager = new ModalManager();
    console.log("[projectDashboardUtils] Global ModalManager instance created.");
  } else {
    console.log("[projectDashboardUtils] Global ModalManager already exists.");
  }

  // Make class available globally as well
  window.ModalManager = ModalManager;


  // Ensure dashboardUtilsReady event is fired reliably
  function signalDashboardUtilsReady() {
    if (!window.dashboardUtilsReady) {
      window.dashboardUtilsReady = true;
      document.dispatchEvent(new CustomEvent("dashboardUtilsReady"));
      console.log("[projectDashboardUtils] dashboardUtilsReady event dispatched.");
    }
  }

  // Signal readiness after a short delay or when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(signalDashboardUtilsReady, 50));
  } else {
    setTimeout(signalDashboardUtilsReady, 50);
  }

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
  // Track all dashboard listeners
  const dashboardListeners = new Set();

  // Cleanup all dashboard listeners
  function cleanupDashboardListeners() {
    dashboardListeners.forEach(({element, type, handler}) => {
      element.removeEventListener(type, handler);
    });
    dashboardListeners.clear();
  }

  // Global error event handler
  function handleGlobalError(evt) {
    const error = evt.error || evt;
    const errorMessage = error?.message || evt.message || 'Unknown error';
    console.error('[GlobalError]', errorMessage, error?.stack || '');
    window.showNotification(`An error occurred: ${errorMessage}`, 'error');
  }

  // Global unhandled rejection handler
  function handleUnhandledRejection(evt) {
    const reason = evt.reason;
    const errorMessage = reason?.message || 'Unhandled Rejection';
    const errorStack = reason?.stack || '';

    // Check for auth errors
    const isAuthError =
      errorMessage.includes('Authentication required') ||
      errorMessage.includes('Not authenticated') ||
      errorMessage.includes('auth token') ||
      errorMessage.includes('login') ||
      (reason?.status === 401);

    // Standardize error if auth.js is available
    const stdErr = window.auth?.standardizeError?.(reason) || reason;

    if (isAuthError || stdErr?.requiresLogin || stdErr?.code === 'SESSION_EXPIRED') {
      console.warn('[GlobalRejection] Auth error:', errorMessage);
      window.showNotification('Authentication required. Please log in.', 'error', {timeout: 7000});
      evt.preventDefault();
      return;
    }

    console.error('[UnhandledRejection]', errorMessage, errorStack);
    window.showNotification(`Unhandled error: ${errorMessage}`, 'error');
    evt.preventDefault();
  }

  // Register unhandled rejection handler
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
  dashboardListeners.add({
    element: window,
    type: 'unhandledrejection',
    handler: handleUnhandledRejection
  });
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
    try {
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
    } catch (error) {
      console.error('[ProjectDashboardUtils] Error in showProjectsView:', error);
      window.showNotification && window.showNotification('Error updating UI. Please refresh the page.', 'error');
    }
  };

  // Ensure window.showProjectsView is set and not overwritten
  if (!window.showProjectsView || typeof window.showProjectsView !== 'function') {
    window.showProjectsView = ProjectDashboard.showProjectsView;
    console.log('[ProjectDashboardUtils] showProjectsView assigned to window');
  } else {
    console.warn('[ProjectDashboardUtils] showProjectsView already exists on window, preserving existing function');
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
            if (typeof projectManager.loadProjects === 'function') {
              projectManager.loadProjects();
            }
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
              if (typeof projectManager.loadProjects === 'function') {
                projectManager.loadProjects();
              }
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

    // If dashboard is already initialized, return immediately
    if (window.projectDashboard && typeof window.projectDashboard.init === 'function') {
      return window.projectDashboard.init();
    }

    // Create a minimal fallback dashboard if none exists
    if (!window.projectDashboard) {
      console.log('[ProjectDashboard] Creating fallback dashboard instance');
      window.projectDashboard = {
        init: function() {
          return Promise.resolve(this);
        },
        showNotification: function(message, type) {
          console.log(`[DashboardNotification][${type}] ${message}`);
        }
      };
    }

    // If projectDashboard.js hasn't loaded yet, proceed with fallback
    if (typeof ProjectDashboard !== 'function') {
      console.warn('[ProjectDashboard] Main dashboard class not loaded, using fallback');
      document.dispatchEvent(new CustomEvent('projectDashboardInitialized'));
      return Promise.resolve(window.projectDashboard);
    }

    // Otherwise wait for initialization (with shorter timeout)
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[ProjectDashboard] Dashboard initialization timeout (5s) - proceeding with fallback');
        document.removeEventListener('projectDashboardInitialized', onInitialized);
        resolve(window.projectDashboard);
      }, 5000); // Reduced timeout to 5 seconds

      const onInitialized = () => {
        clearTimeout(timeout);
        console.log('[ProjectDashboard] Dashboard initialized via event');
        resolve(window.projectDashboard);
      };

      document.addEventListener('projectDashboardInitialized', onInitialized, { once: true });

      // Try to initialize if possible
      if (typeof window.projectDashboard.init === 'function') {
        window.projectDashboard.init().finally(() => resolve(window.projectDashboard));
      }
    });
  };

  // Quick check for readiness
  window.isProjectDashboardUtilsReady = function () {
    return true;
  };

  // Expose the namespace globally
  window.ProjectDashboard = ProjectDashboard;

  // Create a template loading tracker
  window.templateLoadTracker = {
    templates: {
      'project_list.html': false,
      'project_details.html': false,
      'modals.html': false
    },
    allLoaded: function() {
      return Object.values(this.templates).every(loaded => loaded);
    },
    markLoaded: function(templateName) {
      if (this.templates.hasOwnProperty(templateName)) {
        this.templates[templateName] = true;
        console.log(`[TemplateTracker] ${templateName} loaded`);

        if (this.allLoaded()) {
          console.log('[TemplateTracker] All templates loaded, dispatching event');
          document.dispatchEvent(new CustomEvent('templatesLoaded'));
        }
      }
    },
    reset: function() {
      Object.keys(this.templates).forEach(key => {
        this.templates[key] = false;
      });
    }
  };

  /**
   * Wait for all templates to be loaded
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<boolean>} - Whether all templates were loaded
   */
  function waitForTemplatesLoaded(timeoutMs = 5000) {
    // If already loaded, resolve immediately
    if (window.templateLoadTracker.allLoaded()) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        document.removeEventListener('templatesLoaded', onTemplatesLoaded);
        console.warn('[TemplateWaiter] Timeout waiting for templates');
        resolve(false);
      }, timeoutMs);

      function onTemplatesLoaded() {
        clearTimeout(timeoutId);
        document.removeEventListener('templatesLoaded', onTemplatesLoaded);
        resolve(true);
      }

      document.addEventListener('templatesLoaded', onTemplatesLoaded);
    });
  }

  // Export to use in projectDashboard
  window.waitForTemplatesLoaded = waitForTemplatesLoaded;

  console.log('[ProjectDashboard] projectDashboardUtils.js loaded successfully');
