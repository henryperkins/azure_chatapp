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
      this.notificationContainer = document.createElement('div');
      this.notificationContainer.id = 'notificationContainer';
      // Position & styling for notifications
      this.notificationContainer.className = 'fixed top-4 right-4 z-50 space-y-2 w-80';
      document.body.appendChild(this.notificationContainer);
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
     * Unified notification system
     * @param {string} message
     * @param {string} type - info | success | warning | error
     * @param {Object} options
     */
    showNotification(message, type = 'info', options = {}) {
      const notification = document.createElement('div');
      notification.className = `notification p-4 rounded shadow-lg mb-2 ${
        type === 'error'
          ? 'bg-red-100 text-red-800'
          : type === 'success'
          ? 'bg-green-100 text-green-800'
          : type === 'warning'
          ? 'bg-yellow-100 text-yellow-800'
          : 'bg-blue-100 text-blue-800'
      } transition-opacity duration-300`;

      notification.textContent = message;
      this.notificationContainer.appendChild(notification);

      setTimeout(() => {
        notification.classList.add('opacity-0');
        setTimeout(() => notification.remove(), 300);
      }, options.timeout || 5000);

      // Handle action button if specified
      if (options.action && typeof options.onAction === 'function') {
        console.log(`[UIUtils] Action: ${options.action}`);
      }
      if (options.secondaryAction && typeof options.onSecondaryAction === 'function') {
        console.log(`[UIUtils] Secondary Action: ${options.secondaryAction}`);
      }
    }
  }

  // Create a singleton instance
  ProjectDashboard.uiUtils = new UIUtils();
  window.uiUtilsInstance = ProjectDashboard.uiUtils;

  /* =========================================================================
   *  3. ANIMATION UTILS
   * ========================================================================= */
  class AnimationUtils {
    constructor() {
      console.log('[AnimationUtils] instance created');
    }

    animateProgress(element, fromPercent, toPercent, duration = 500) {
      if (!element) return;
      const start = performance.now();
      const change = toPercent - fromPercent;

      function update(timestamp) {
        const elapsed = timestamp - start;
        const progress = Math.min(elapsed / duration, 1);
        const currentValue = fromPercent + change * progress;
        element.style.width = `${currentValue}%`;
        if (progress < 1) {
          requestAnimationFrame(update);
        }
      }
      requestAnimationFrame(update);
    }
  }

  ProjectDashboard.animationUtils = new AnimationUtils();

  /* =========================================================================
   *  4. MODAL MANAGER
   * ========================================================================= */
  class ModalManager {
    constructor() {
      // Collection of named modals
      this.modals = {};
      this.eventHandlers = new Map();

      // Default semantic name -> possible DOM IDs
      this.modalMappings = {
        project: ['projectFormModal'],
        instructions: ['instructionsModal'],
        delete: ['deleteConfirmModal'],
        knowledge: ['knowledgeBaseSettingsModal', 'knowledgeSettingsModal'],
        knowledgeResult: ['knowledgeResultModal'],
        confirm: ['confirmActionModal', 'deleteConfirmModal']
      };

      // Register on DOM ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.registerAllModals());
      } else {
        this.registerAllModals();
      }

      // Re-check after a short delay to catch dynamically added modals
      setTimeout(() => this.registerAllModals(), 500);

      console.log('[ModalManager] Initialized');
    }

    registerAllModals() {
      for (const [key, ids] of Object.entries(this.modalMappings)) {
        // skip if already registered
        if (this.modals[key] && document.body.contains(this.modals[key])) continue;

        // check each possible ID
        for (const id of ids) {
          const el = document.getElementById(id);
          if (el) {
            this.modals[key] = el;
            console.log(`[ModalManager] Registered: ${key} -> #${id}`);
            break;
          }
        }
      }
    }

    registerModal(name, modalOrId) {
      let element;
      if (typeof modalOrId === 'string') {
        element = document.getElementById(modalOrId);
        if (!element) {
          console.error(`[ModalManager] Could not find modal with ID '${modalOrId}'`);
          return false;
        }
      } else if (modalOrId instanceof HTMLElement) {
        element = modalOrId;
      } else {
        console.error(`[ModalManager] Invalid modal type for '${name}'`);
        return false;
      }
      this.modals[name] = element;
      console.log(`[ModalManager] Custom modal registered: ${name}`);
      return true;
    }

    show(modalId, options = {}) {
      console.log(`[ModalManager] Attempting to show modal: ${modalId}`);
      let modalEl = this.modals[modalId];

      if (!modalEl) {
        // fallback: direct getElementById
        modalEl = document.getElementById(modalId)
          || document.getElementById(`${modalId}Modal`)
          || document.getElementById(`${modalId}SettingsModal`);
        if (modalEl) {
          this.modals[modalId] = modalEl; // auto-register
          console.log(`[ModalManager] Auto-registered modal: ${modalId}`);
        } else {
          console.error(`[ModalManager] No modal found for '${modalId}'`);
          return false;
        }
      }

      // update content if needed
      if (typeof options.updateContent === 'function') {
        options.updateContent(modalEl);
      }

      modalEl.classList.add('confirm-modal');
      modalEl.classList.remove('hidden');

      this._setupModalEvents(modalEl, modalId);
      return true;
    }

    hide(modalId) {
      console.log(`[ModalManager] Hiding modal: ${modalId}`);
      let modalEl = this.modals[modalId];
      if (!modalEl) {
        // fallback attempts
        modalEl = document.getElementById(modalId)
          || document.getElementById(`${modalId}Modal`)
          || document.getElementById(`${modalId}SettingsModal`);
        if (!modalEl) {
          console.warn(`[ModalManager] Cannot find modal to hide: '${modalId}'`);
          return false;
        }
      }
      modalEl.classList.remove('confirm-modal');
      modalEl.classList.add('hidden');
      this._cleanupModalEvents(modalEl, modalId);
      return true;
    }

    static closeActiveModal() {
      const activeModals = document.querySelectorAll('.confirm-modal:not(.hidden)');
      if (activeModals.length === 0) return false;
      activeModals.forEach(el => {
        el.classList.remove('confirm-modal');
        el.classList.add('hidden');
      });
      return true;
    }

    static confirmAction(config = {}) {
      return new Promise((resolve) => {
        const manager = ProjectDashboard.modalManager;
        let modal = manager?.modals.confirm
          || document.getElementById('deleteConfirmModal')
          || document.getElementById('confirmActionModal');

        if (!modal) {
          console.error('[ModalManager] confirmAction: No confirm modal found!');
          resolve(false);
          return;
        }

        // Set modal content
        modal.innerHTML = `
          <div class="confirm-modal-content">
            <h3 class="confirm-modal-header">${config.title || 'Confirm Action'}</h3>
            <div class="confirm-modal-body">
              ${config.message || 'Are you sure?'}
            </div>
            <div class="confirm-modal-footer">
              <button id="cancelActionBtn" class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded transition-colors dark:text-gray-300 dark:hover:bg-gray-700">
                ${config.cancelText || 'Cancel'}
              </button>
              <button id="confirmActionBtn" class="px-4 py-2 bg-red-600 text-white rounded-sm hover:bg-red-700 transition-colors ${
                config.confirmClass || ''
              }">
                ${config.confirmText || 'Confirm'}
              </button>
            </div>
          </div>
        `;

        const confirmBtn = modal.querySelector('#confirmActionBtn');
        const cancelBtn = modal.querySelector('#cancelActionBtn');

        const handleConfirm = () => {
          if (typeof config.onConfirm === 'function') config.onConfirm();
          manager?.hide('confirm') || modal.classList.add('hidden');
          cleanup();
          resolve(true);
        };

        const handleCancel = () => {
          if (typeof config.onCancel === 'function') config.onCancel();
          manager?.hide('confirm') || modal.classList.add('hidden');
          cleanup();
          resolve(false);
        };

        function cleanup() {
          confirmBtn.removeEventListener('click', handleConfirm);
          cancelBtn.removeEventListener('click', handleCancel);
        }

        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);

        // Show modal
        manager?.show('confirm') || modal.classList.remove('hidden');
      });
    }

    _setupModalEvents(modal, modalId) {
      // ESC key
      const handleKeydown = (e) => {
        if (e.key === 'Escape') {
          this.hide(modalId);
        }
      };
      document.addEventListener('keydown', handleKeydown);
      this.eventHandlers.set(`${modalId}_keydown`, handleKeydown);

      // close button
      const closeButtons = modal.querySelectorAll('[id^="close"], .modal-close, .close-btn');
      closeButtons.forEach(btn => {
        const clickHandler = () => this.hide(modalId);
        btn._clickHandler = clickHandler;
        btn.addEventListener('click', clickHandler);
      });

      // backdrop click
      if (modal.classList.contains('modal-with-backdrop')) {
        const backdropClickHandler = (e) => {
          if (e.target === modal) {
            this.hide(modalId);
          }
        };
        modal.addEventListener('click', backdropClickHandler);
        this.eventHandlers.set(`${modalId}_backdrop`, backdropClickHandler);
      }
    }

    _cleanupModalEvents(modal, modalId) {
      const keydownHandler = this.eventHandlers.get(`${modalId}_keydown`);
      if (keydownHandler) {
        document.removeEventListener('keydown', keydownHandler);
        this.eventHandlers.delete(`${modalId}_keydown`);
      }

      const backdropHandler = this.eventHandlers.get(`${modalId}_backdrop`);
      if (backdropHandler) {
        modal.removeEventListener('click', backdropHandler);
        this.eventHandlers.delete(`${modalId}_backdrop`);
      }

      // close button
      const closeButtons = modal.querySelectorAll('[id^="close"], .modal-close, .close-btn');
      closeButtons.forEach(btn => {
        if (btn._clickHandler) {
          btn.removeEventListener('click', btn._clickHandler);
          delete btn._clickHandler;
        }
      });
    }
  }

  ProjectDashboard.ModalManager = ModalManager;
  ProjectDashboard.modalManager = new ModalManager();

  /* =========================================================================
   *  5. NOTIFICATION & ERROR HANDLING
   * ========================================================================= */

  // Attach any enhanced notifications to ProjectDashboard
  ProjectDashboard.showNotification = function (message, type = 'info', options = {}) {
    if (ProjectDashboard.uiUtils) {
      ProjectDashboard.uiUtils.showNotification(message, type, options);
    } else {
      console.log(`[${type.toUpperCase()}] ${message}`);
    }
  };

  // Enhanced global error handling
  window.addEventListener('error', function (evt) {
    const error = evt.error || evt;
    const errorMessage = error?.message || evt.message || 'Unknown error';

    console.error('[GlobalError]', errorMessage, error?.stack || '');
    // If using auth.js "notify" or this file's showNotification:
    if (typeof notify === 'function') {
      notify(`An error occurred: ${errorMessage}`, 'error');
    } else {
      ProjectDashboard.showNotification(`An error occurred: ${errorMessage}`, 'error');
    }
  });

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', function (evt) {
    const reason = evt.reason;
    const errorMessage = reason?.message || 'Unhandled Rejection';
    const errorStack = reason?.stack || '';

    // Could integrate with auth.js error standardization
    const stdErr = window.auth?.standardizeError?.(reason) || reason;

    // Session expiration check
    if (stdErr.requiresLogin || stdErr.code === 'SESSION_EXPIRED') {
      console.warn('[GlobalRejection] Session expired, logging out or clearing state...');
      // handle session expiration
      window.auth?.clear?.();
      // Provide user feedback
      if (typeof notify === 'function') {
        notify(stdErr.message, 'error');
      } else {
        ProjectDashboard.showNotification(stdErr.message, 'error');
      }
      evt.preventDefault();
      return;
    }

    console.error('[UnhandledRejection]', errorMessage, errorStack);
    if (typeof notify === 'function') {
      notify(errorMessage, 'error');
    } else {
      ProjectDashboard.showNotification(errorMessage, 'error');
    }
    evt.preventDefault();
  });

  /* =========================================================================
   *  6. HELPER FUNCTIONS (SHOW/HIDE VIEWS, ETC.)
   * ========================================================================= */
  ProjectDashboard.showProjectsView = function () {
    const listView = document.getElementById('projectListView');
    const detailsView = document.getElementById('projectDetailsView');
    if (listView) listView.classList.remove('hidden');
    if (detailsView) detailsView.classList.add('hidden');
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
    document.dispatchEvent(new CustomEvent('dashboardUtilsReady'));
    console.log('[ProjectDashboard] dashboardUtilsReady event dispatched');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', dispatchReady);
  } else {
    dispatchReady();
  }

  // Attach to global window
  window.ProjectDashboard = ProjectDashboard;
  console.log('[ProjectDashboard] projectDashboardUtils.js loaded successfully');
})();
