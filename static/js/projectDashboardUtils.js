/**
 * @file projectDashboardUtils.js
 * @description Centralized utility classes for the project dashboard
 * @module DashboardUtils
 * 
 * This module provides:
 * - UI utilities (UIUtils class)
 * - Animation utilities (AnimationUtils class)
 * projectDashboardUtils.js
 * -----------------------
 * Centralized utility classes for the project dashboard
 */

// Unified Event Bus
class AppEventBus {
  constructor() {
    this.channels = {};
  }
  
  subscribe(channel, callback) {
    if(!this.channels[channel]) this.channels[channel] = [];
    this.channels[channel].push(callback);
  }
  
  publish(channel, data) {
    (this.channels[channel] || []).forEach(fn => fn(data));
  }
}

window.bus = new AppEventBus();

(function() {
  // Global initialization flag to prevent double initialization
  if (window._dashboardUtilsInitialized) {
    console.log('Dashboard utils already initialized, skipping');
    return;
  }
  window._dashboardUtilsInitialized = true;
  
  console.log('Initializing projectDashboardUtils.js');
  
  /* ===========================
     INITIALIZE CORE DEPENDENCIES
     =========================== */
  
  // Define base Notifications object if not defined
  if (!window.Notifications) {
    console.log('Creating base Notifications object');
    window.Notifications = {
      apiError: (msg) => console.error('API Error:', msg),
      apiSuccess: (msg) => console.log('Success:', msg),
      projectNotFound: (msg) => console.warn('Project Not Found:', msg)
    };
  }
  
  /* ===========================
     UI UTILITY CLASS
     =========================== */

  /**
   * UI Utility Class
   * @class UIUtils
   * @description Provides DOM manipulation and UI helper methods
   * 
   * Features:
   * - Element creation with comprehensive options
   */
  if (typeof window.UIUtils === 'undefined') {
    console.log('Creating UIUtils class');
    window.UIUtils = class UIUtils {
      constructor() {
        console.log('UIUtils instance created');
        this.notificationContainer = document.createElement('div');
        this.notificationContainer.id = 'notificationContainer';
        this.notificationContainer.className = 'fixed top-4 right-4 z-50 space-y-2 w-80';
        document.body.appendChild(this.notificationContainer);
      }
      
      createElement(tag, options = {}) {
        const element = document.createElement(tag);
        
        // Set attributes
        if (options.className) element.className = options.className;
        if (options.id) element.id = options.id;
        if (options.textContent !== undefined) element.textContent = options.textContent;
        if (options.innerHTML !== undefined) element.innerHTML = options.innerHTML;
        if (options.onclick) element.addEventListener('click', options.onclick);
        
        // Set any other attributes
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
        return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
      }
      
      fileIcon(fileType) {
        const iconMap = {
          'pdf': '📄',
          'doc': '📝',
          'docx': '📝',
          'txt': '📄',
          'csv': '📊',
          'json': '📋',
          'md': '📄',
          'xlsx': '📊',
          'pptx': '📊',
          'html': '🌐',
          'jpg': '🖼️',
          'jpeg': '🖼️',
          'png': '🖼️',
          'py': '🐍',
          'js': '📜',
          'css': '🎨',
          'zip': '📦',
          'xml': '🔍'
        };
      
        return iconMap[fileType] || '📄';
      }
      
      getElement(id) {
        return document.getElementById(id);
      }
      
      // Add a static method for availability checking
      static isAvailable() {
        return typeof window.UIUtils !== 'undefined';
      }

      /**
       * Unified notification system - core implementation
       * @param {string} message - The notification message
       * @param {string} type - The notification type (info, success, warning, error)
       * @param {Object} options - Additional options (action, timeout, etc.)
       */
      showNotification(message, type = "info", options = {}) {
          // Create notification element
          const notification = document.createElement('div');
          notification.className = `notification p-4 rounded shadow-lg ${
            type === 'error' ? 'bg-red-100 text-red-800' :
            type === 'success' ? 'bg-green-100 text-green-800' :
            type === 'warning' ? 'bg-yellow-100 text-yellow-800' :
            'bg-blue-100 text-blue-800'
          }`;
          notification.textContent = message;
          
          // Add to container
          this.notificationContainer.appendChild(notification);
          
          // Auto-remove after timeout
          setTimeout(() => {
            notification.classList.add('opacity-0', 'transition-opacity', 'duration-300');
            setTimeout(() => notification.remove(), 300);
          }, options.timeout || 5000);
          
          // Handle action button if specified in options
          if (options.action && options.onAction) {
            // Implementation for notification with action button
            console.log(`Action ${options.action} available for: ${message}`);
            
            // If a second action is available
            if (options.secondaryAction && options.onSecondaryAction) {
              console.log(`Secondary action ${options.secondaryAction} available for: ${message}`);
            }
          }
          
          // Handle auto-timeout if specified
          if (options.timeout && typeof options.timeout === 'number') {
            setTimeout(() => {
              // Find and remove notification if DOM manipulation is supported
              const notifications = document.querySelectorAll('.notification');
              for (const notif of notifications) {
                if (notif.textContent.includes(message)) {
                  notif.remove();
                  break;
                }
              }
            }, options.timeout);
          }
      }
    };
    
    // Create instance immediately
    window.uiUtilsInstance = new window.UIUtils();
  } else {
    console.log('UIUtils already exists, using existing definition');
    // Ensure instance exists
    if (!window.uiUtilsInstance) {
      window.uiUtilsInstance = new window.UIUtils();
    }
  }

  /* ===========================
     ANIMATION UTILITY CLASS
     =========================== */

  /**
   * Animation Utility Class
   * @class AnimationUtils
   * @description Provides animation helper methods
   * @property {Object} animations - Active animations tracker
   */

  // Define AnimationUtils safely
  if (typeof window.AnimationUtils === 'undefined') {
    console.log('Creating AnimationUtils class');
    window.AnimationUtils = class AnimationUtils {
      constructor() {
        console.log('AnimationUtils instance created');
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
    };
    
    // Create instance immediately
    window.animationUtilsInstance = new window.AnimationUtils();
  } else {
    console.log('AnimationUtils already exists, using existing definition');
    // Ensure instance exists if class was already defined
    if (!window.animationUtilsInstance) {
      window.animationUtilsInstance = new window.AnimationUtils();
    }
  }

  /* ===========================
     UNIFIED MODAL MANAGER CLASS
     =========================== */

  /**
   * Unified Modal Manager Class
   * @class ModalManager
   * @description Provides centralized modal management for the entire application
   * @property {Object} modals - Registered modals collection
   */

  // Define ModalManager safely to avoid duplicate creation
  if (typeof window.ModalManager === 'undefined') {
    console.log('Creating Unified ModalManager class');
    window.ModalManager = class ModalManager {
      constructor() {
        // Initialize modal collection
        this.modals = {};
        this.eventHandlers = new Map();
        
        // Standard modal mappings (semantic name -> possible DOM IDs)
        this.modalMappings = {
          'project': ['projectFormModal'],
          'instructions': ['instructionsModal'],
          'delete': ['deleteConfirmModal'],
          'knowledge': ['knowledgeBaseSettingsModal', 'knowledgeSettingsModal'],
          'knowledgeResult': ['knowledgeResultModal'],
          'confirm': ['confirmActionModal', 'deleteConfirmModal']
        };
        
        // Wait for DOM to be ready before first registration
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => this.registerAllModals());
        } else {
          this.registerAllModals();
        }
        
        // Register modals again after a short delay to catch any late DOM updates
        setTimeout(() => this.registerAllModals(), 500);
        
        console.log('ModalManager initialized with modals:', Object.keys(this.modals));
      }
      
      /**
       * Register all known modals from DOM
       * @public
       */
      registerAllModals() {
        // Register each modal with flexible matching
        for (const [key, ids] of Object.entries(this.modalMappings)) {
          // Skip if already registered and valid
          if (this.modals[key] && document.body.contains(this.modals[key])) continue;
          
          // Try all possible IDs for this modal
          for (const id of ids) {
            const element = document.getElementById(id);
            if (element) {
              this.modals[key] = element;
              console.log(`Modal registered: ${key} -> #${id}`);
              break;
            }
          }
        }
      }

      /**
       * Register a custom modal
       * @public
       * @param {string} name - Semantic name for the modal
       * @param {string|HTMLElement} modal - Modal element or its ID
       */
      registerModal(name, modal) {
        if (typeof modal === 'string') {
          const element = document.getElementById(modal);
          if (!element) {
            console.error(`Cannot register modal "${name}": Element with ID "${modal}" not found`);
            return false;
          }
          this.modals[name] = element;
        } else if (modal instanceof HTMLElement) {
          this.modals[name] = modal;
        } else {
          console.error(`Cannot register modal "${name}": Invalid modal type`);
          return false;
        }
        
        console.log(`Custom modal registered: ${name}`);
        return true;
      }
      
      /**
       * Show a modal by its semantic name
       * @public
       * @param {string} modalId - Semantic name of the modal to show
       * @param {Object} [options] - Optional configuration for the modal
       * @returns {boolean} Whether the modal was successfully shown
       */
      show(modalId, options = {}) {
        console.log(`[ModalManager] Attempting to show modal: ${modalId}`);
        
        // Try to find the modal element
        let modalElement = this.modals[modalId];
        
        if (!modalElement) {
          console.warn(`Modal "${modalId}" not found in registered modals, trying fallbacks...`);
          
          // Try direct ID match first
          modalElement = document.getElementById(modalId);
          
          // Try standard naming patterns if direct match fails
          if (!modalElement) {
            modalElement = document.getElementById(`${modalId}Modal`) ||
                         document.getElementById(`${modalId}SettingsModal`);
          }
          
          // Register this modal for future use if found
          if (modalElement) {
            this.modals[modalId] = modalElement;
            console.log(`Auto-registered modal: ${modalId}`);
          } else {
            console.error(`Could not find a modal for "${modalId}"`);
            return false;
          }
        }
        
        // If modal content update function is provided in options, call it
        if (options.updateContent && typeof options.updateContent === 'function') {
          options.updateContent(modalElement);
        }
        
        // Add modal overlay classes and show
        modalElement.classList.add('confirm-modal');
        modalElement.classList.remove('hidden');
        
        // Set up event handlers (ESC key, close buttons)
        this._setupModalEvents(modalElement, modalId);
        
        console.log(`Modal "${modalId}" shown successfully`);
        return true;
      }
      
      /**
       * Hide a modal by its semantic name
       * @public
       * @param {string} modalId - Semantic name of the modal to hide
       * @returns {boolean} Whether the modal was successfully hidden
       */
      hide(modalId) {
        console.log(`[ModalManager] Hiding modal: ${modalId}`);
        
        // Try to find the modal element
        let modalElement = this.modals[modalId];
        
        if (!modalElement) {
          console.warn(`Modal "${modalId}" not registered, trying fallbacks...`);
          
          // Try direct ID match first
          modalElement = document.getElementById(modalId);
          
          // Try standard naming patterns if direct match fails
          if (!modalElement) {
            modalElement = document.getElementById(`${modalId}Modal`) ||
                         document.getElementById(`${modalId}SettingsModal`);
          }
          
          if (!modalElement) {
            console.warn(`Could not find a modal for "${modalId}" to hide`);
            return false;
          }
        }
        
        // Remove modal overlay classes and hide
        modalElement.classList.remove('confirm-modal');
        modalElement.classList.add('hidden');
        
        // Clean up event handlers
        this._cleanupModalEvents(modalElement, modalId);
        
        return true;
      }
      
      /**
       * Close any currently active modals
       * @public
       * @static
       * @returns {boolean} Whether a modal was closed
       */
      static closeActiveModal() {
        const modalElements = document.querySelectorAll('.confirm-modal:not(.hidden)');
        if (modalElements.length === 0) return false;
        
        modalElements.forEach(modal => {
          modal.classList.remove('confirm-modal');
          modal.classList.add('hidden');
        });
        
        return true;
      }

      /**
       * Show a confirmation dialog with customizable options
       * @public
       * @static
       * @param {Object} config - Configuration for the confirmation dialog
       * @returns {Promise<boolean>} Promise resolving to true if confirmed, false otherwise
       */
      static confirmAction(config) {
        return new Promise((resolve) => {
          const modalManager = window.modalManager;
          let modal;
          
          // Try to get the modal element
          if (modalManager && modalManager.modals.confirm) {
            modal = modalManager.modals.confirm;
          } else {
            modal = document.getElementById('deleteConfirmModal') ||
                   document.getElementById('confirmActionModal');
          }
          
          if (!modal) {
            console.error('Confirmation modal not found');
            resolve(false);
            return;
          }

          // Update modal structure
          modal.innerHTML = `
            <div class="confirm-modal-content">
              <h3 class="confirm-modal-header">${config.title || 'Confirm Action'}</h3>
              <div class="confirm-modal-body">
                ${config.message || 'Are you sure you want to perform this action?'}
              </div>
              <div class="confirm-modal-footer">
                <button id="cancelActionBtn" class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded transition-colors dark:text-gray-300 dark:hover:bg-gray-700">
                  ${config.cancelText || 'Cancel'}
                </button>
                <button id="confirmActionBtn" class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors ${config.confirmClass || ''}">
                  ${config.confirmText || 'Confirm'}
                </button>
              </div>
            </div>
          `;

          // Set up event handlers
          const confirmBtn = modal.querySelector('#confirmActionBtn');
          const cancelBtn = modal.querySelector('#cancelActionBtn');
          
          const handleConfirm = () => {
            if (typeof config.onConfirm === 'function') config.onConfirm();
            
            if (modalManager) {
              modalManager.hide('confirm');
            } else {
              modal.classList.add('hidden');
            }
            
            // Clean up handlers
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            
            resolve(true);
          };
          
          const handleCancel = () => {
            if (typeof config.onCancel === 'function') config.onCancel();
            
            if (modalManager) {
              modalManager.hide('confirm');
            } else {
              modal.classList.add('hidden');
            }
            
            // Clean up handlers
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            
            resolve(false);
          };
          
          confirmBtn.addEventListener('click', handleConfirm);
          cancelBtn.addEventListener('click', handleCancel);
          
          // Show modal
          if (modalManager) {
            modalManager.show('confirm');
          } else {
            modal.classList.add('confirm-modal');
            modal.classList.remove('hidden');
          }
        });
      }

      /**
       * Set up event handlers for a modal
       * @private
       * @param {HTMLElement} modal - Modal element to set up
       * @param {string} modalId - Semantic name of the modal
       */
      _setupModalEvents(modal, modalId) {
        // Handle ESC key
        const handleKeyDown = (e) => {
          if (e.key === 'Escape') {
            this.hide(modalId);
          }
        };
        
        // Store reference to handler for cleanup
        this.eventHandlers.set(`${modalId}_keydown`, handleKeyDown);
        document.addEventListener('keydown', handleKeyDown);

        // Handle close button click with proper listener management
        const closeButtons = modal.querySelectorAll('[id^="close"], .modal-close, .close-btn');
        closeButtons.forEach(closeBtn => {
          const clickHandler = () => this.hide(modalId);
          
          // Remove existing handler if present
          if (closeBtn._clickHandler) {
            closeBtn.removeEventListener('click', closeBtn._clickHandler);
          }
          
          // Save and attach new handler
          closeBtn._clickHandler = clickHandler;
          closeBtn.addEventListener('click', clickHandler);
        });
        
        // Handle backdrop click if modal has backdrop class
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

      /**
       * Clean up event handlers for a modal
       * @private
       * @param {HTMLElement} modal - Modal element to clean up
       * @param {string} modalId - Semantic name of the modal
       */
      _cleanupModalEvents(modal, modalId) {
        // Clean up keydown handler
        const keydownHandler = this.eventHandlers.get(`${modalId}_keydown`);
        if (keydownHandler) {
          document.removeEventListener('keydown', keydownHandler);
          this.eventHandlers.delete(`${modalId}_keydown`);
        }
        
        // Clean up backdrop click handler
        const backdropHandler = this.eventHandlers.get(`${modalId}_backdrop`);
        if (backdropHandler) {
          modal.removeEventListener('click', backdropHandler);
          this.eventHandlers.delete(`${modalId}_backdrop`);
        }
        
        // Clean up close button handlers
        const closeButtons = modal.querySelectorAll('[id^="close"], .modal-close, .close-btn');
        closeButtons.forEach(closeBtn => {
          if (closeBtn._clickHandler) {
            closeBtn.removeEventListener('click', closeBtn._clickHandler);
            delete closeBtn._clickHandler;
          }
        });
      }
      
      /**
       * Check if the ModalManager is available
       * @public
       * @static
       * @returns {boolean} Whether the ModalManager is available
       */
      static isAvailable() {
        return typeof window.ModalManager !== 'undefined' && window.modalManager instanceof window.ModalManager;
      }
    };
    
    // Create global instance
    window.modalManager = new window.ModalManager();
    
    // For backwards compatibility
    if (!window.showModal) {
      window.showModal = function(id, options) {
        if (window.modalManager) {
          return window.modalManager.show(id, options);
        }
        return false;
      };
    }
    
    if (!window.hideModal) {
      window.hideModal = function(id) {
        if (window.modalManager) {
          return window.modalManager.hide(id);
        }
        return false;
      };
    }
  } else {
    console.log('ModalManager already exists, using existing definition');
    if (!window.modalManager) {
      window.modalManager = new window.ModalManager();
    }
  }

  /* ===========================
     GLOBAL EVENT HANDLING & NOTIFICATIONS
     =========================== */
  
  // Unified notification function
  window.showNotification = function(message, type = "info", options = {}) {
    if (window.uiUtilsInstance && window.uiUtilsInstance.showNotification) {
      window.uiUtilsInstance.showNotification(message, type, options);
    } else {
      console.log(`[${type.toUpperCase()}] ${message}`);
    }
  };

  // Enhanced error handling utilities
  window.ErrorUtils = {
    // Safe error extraction from any type
    getErrorMessage: function(error) {
      if (typeof error === 'string') return error;
      if (!error) return 'Unknown error';
      
      // Handle Error objects or objects with message property
      if (error.message) return error.message;
      
      // Handle response objects
      if (error.statusText) return `${error.status || ''} ${error.statusText}`;
      
      // Last resort - stringify if possible
      try {
        return JSON.stringify(error);
      } catch (e) {
        return 'Unspecified error';
      }
    },
    
    // Safe stack extraction
    getErrorStack: function(error) {
      return (error && error.stack) ? error.stack : '';
    }
  };

  // Centralized global error handler
  window.addEventListener('error', function(event) {
    // Safely extract error information
    const errorMessage = event.error ? window.ErrorUtils.getErrorMessage(event.error) : event.message;
    const stack = event.error ? window.ErrorUtils.getErrorStack(event.error) : '';
    
    console.error('Global error:', errorMessage);
    console.debug('Error details:', event.error || event);
    if (stack) console.debug('Stack trace:', stack);
    
    if (window.showNotification) {
      window.showNotification('An error occurred: ' + errorMessage, 'error');
    }
  });
  
  // Handle promise rejections with better error details
  window.addEventListener('unhandledrejection', function(event) {
    // Safely extract information from the rejection
    const reason = event.reason;
    const errorMessage = window.ErrorUtils.getErrorMessage(reason);
    const errorStack = window.ErrorUtils.getErrorStack(reason);
    
    // Handle specific error types
    if (errorMessage.includes('No project selected')) {
      // Already handled by the component, just prevent default logging
      event.preventDefault();
      return;
    }
    
    // Handle session expiration specifically
    if (errorMessage.includes('Session expired')) {
      event.preventDefault();
      console.warn('[Dashboard] Handling session expiration gracefully');
      
      // Show loading state
      const loadingEl = document.getElementById('dashboardLoading');
      if (loadingEl) {
        loadingEl.textContent = 'Session expired - redirecting to login...';
        loadingEl.classList.remove('hidden');
      }
      
      // Clear any sensitive dashboard data
      if (window.dashboardState) {
        window.dashboardState.clearSensitiveData();
      }
      
      // Let auth.js handle the redirect
      return;
    }
    
    // Log details for debugging
    console.error('Unhandled promise rejection:', errorMessage);
    console.debug('Error details:', reason);
    if (errorStack) console.debug('Stack trace:', errorStack);
    
    // Add source information when available
    const sourceInfo = event.promise && event.promise._source ? event.promise._source : '';
    if (sourceInfo) console.debug('Promise source:', sourceInfo);
    
    // Guard against undefined properties to prevent "Cannot read property of undefined" errors
    try {
      // Provide more helpful notification with context if available
      if (window.showNotification) {
        // Check for known error patterns
        if (errorMessage.includes('Knowledge base not configured')) {
          window.showNotification(
            'Please setup a knowledge base before performing this operation',
            'warning',
            { action: "Setup KB", onAction: () => {
              if (window.modalManager && typeof window.modalManager.show === 'function') {
                window.modalManager.show("knowledge");
              }
            }}
          );
        } else if (errorMessage.includes('Network Error') || errorMessage.includes('Failed to fetch')) {
          window.showNotification('Network connection issue. Please check your connection.', 'error');
        } else if (errorMessage.includes('No project selected')) {
          // Silently ignore "No project selected" errors as they're handled elsewhere
          event.preventDefault(); // Prevent default error handling
        } else if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
          window.showNotification('Operation timed out. Please try again.', 'error');
        } else if (errorMessage.includes('Authentication') || errorMessage.includes('auth')) {
          window.showNotification('Authentication error: ' + errorMessage, 'error');
        } else {
          window.showNotification('Operation failed: ' + errorMessage, 'error');
        }
      }
    } catch (handlerError) {
      // If error handler itself has an error, log it but don't crash
      console.error('Error while handling rejection:', handlerError);
    }
    
    // Mark event as handled to prevent double-logging in console
    event.preventDefault();
  });

  /* ===========================
     INITIALIZATION & READINESS
     =========================== */

  // Helper function to dispatch ready event
  function dispatchReady() {
    document.dispatchEvent(new CustomEvent('dashboardUtilsReady'));
    window.dashboardUtilsReady = true;
    console.log('Dashboard utils ready event dispatched');
  }

  // Centralized initialization event
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', dispatchReady);
  } else {
    dispatchReady();
  }

  // Helper functions to check readiness
  window.isProjectDashboardUtilsReady = function() {
    return window.UIUtils && window.ModalManager && window.uiUtilsInstance;
  };
  
  window.areDashboardComponentsReady = function() {
    return (
      window.UIUtils && 
      window.ModalManager && 
      window.ProjectListComponent && 
      window.ProjectDetailsComponent && 
      window.KnowledgeBaseComponent
    );
  };

  console.log('projectDashboardUtils.js loaded successfully');
})();

/**
 * Project Dashboard Utilities
 * Helper functions for the project dashboard interface
 */

window.projectDashboardUtils = window.projectDashboardUtils || {};

/**
 * Enhanced notification system for the project dashboard
 */
window.projectDashboardUtils.notifications = {
  /**
   * Show an error notification
   * @param {string} message - Error message
   * @param {Object} [options] - Additional options
   */
  apiError: function(message, options = {}) {
    // Check if it's an AI error
    const isAIError = message.includes('AI') || 
                      message.includes('generate') || 
                      (options.code && options.code.startsWith('AI_'));
    
    // Get notification container
    const container = document.getElementById('notificationArea') || 
                     document.createElement('div');
    
    if (!document.body.contains(container)) {
      container.id = 'notificationArea';
      container.className = 'fixed top-4 right-4 z-50 flex flex-col gap-2';
      document.body.appendChild(container);
    }
    
    // Create notification
    const notification = document.createElement('div');
    notification.className = `p-3 rounded shadow-lg transition-all transform duration-300 flex items-start ${
      isAIError ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
    }`;
    
    // Add icon
    const icon = document.createElement('div');
    icon.className = 'mr-2 flex-shrink-0';
    icon.innerHTML = isAIError 
      ? `<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
         </svg>`
      : `<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
         </svg>`;
    
    // Add content
    const content = document.createElement('div');
    content.className = 'flex-1';
    
    const title = document.createElement('div');
    title.className = 'font-medium';
    title.textContent = isAIError ? 'AI Response Issue' : 'Error';
    
    const messageEl = document.createElement('div');
    messageEl.className = 'text-sm';
    messageEl.textContent = message;
    
    content.appendChild(title);
    content.appendChild(messageEl);
    
    // If it's an AI error, add help text
    if (isAIError && options.helpText) {
      const helpEl = document.createElement('div');
      helpEl.className = 'text-xs mt-1 italic';
      helpEl.textContent = options.helpText;
      content.appendChild(helpEl);
    }
    
    // Add close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'ml-4 text-gray-500 hover:text-gray-800';
    closeBtn.innerHTML = `<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>`;
    closeBtn.onclick = () => {
      notification.classList.add('opacity-0', 'translate-x-full');
      setTimeout(() => notification.remove(), 300);
    };
    
    // Assemble notification
    notification.appendChild(icon);
    notification.appendChild(content);
    notification.appendChild(closeBtn);
    
    // Add to container
    container.appendChild(notification);
    
    // Auto-dismiss
    setTimeout(() => {
      notification.classList.add('opacity-0', 'translate-x-full');
      setTimeout(() => notification.remove(), 300);
    }, isAIError ? 7000 : 5000);  // AI errors stay longer
    
    return notification;
  },
  
  // Other notification methods can be added here
};

// Replace the simple API error function with our enhanced version
window.Notifications = window.Notifications || {};
window.Notifications.apiError = window.projectDashboardUtils.notifications.apiError;
