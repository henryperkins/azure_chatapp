/**
 * projectDashboardUtils.js
 * -----------------------
 * Centralized utility classes for the project dashboard
 */

// IIFE to prevent global scope pollution
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
  
  // Define UIUtils safely with more robust error checking
  if (typeof window.UIUtils === 'undefined') {
    console.log('Creating UIUtils class');
    window.UIUtils = class UIUtils {
      constructor() {
        console.log('UIUtils instance created');
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
        if (window.Notifications) {
          switch(type) {
            case 'error':
              window.Notifications.apiError(message);
              break;
            case 'success':
              window.Notifications.apiSuccess?.(message) || 
                console.log(`[SUCCESS] ${message}`);
              break;
            case 'warning':
              window.Notifications.projectNotFound?.(message) || 
                console.warn(`[WARNING] ${message}`);
              break;
            default:
              console.log(`[INFO] ${message}`);
          }
          
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
        } else {
          console.log(`[${type.toUpperCase()}] ${message}`);
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
     MODAL MANAGER CLASS
     =========================== */

  // Define ModalManager safely
  if (typeof window.ModalManager === 'undefined') {
    console.log('Creating ModalManager class');
    window.ModalManager = class ModalManager {
      constructor() {
        // Initialize modal collection
        this.modals = {};
        
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
      
      registerAllModals() {
        // Register all known modals with resilient error handling
        const modalMappings = {
          'project': ['projectFormModal'],
          'instructions': ['instructionsModal'],
          'delete': ['deleteConfirmModal'],
          'knowledge': ['knowledgeBaseSettingsModal', 'knowledgeSettingsModal'] // Multiple possible IDs
        };
        
        // Register each modal with flexible matching
        for (const [key, ids] of Object.entries(modalMappings)) {
          // Skip if already registered
          if (this.modals[key]) continue;
          
          // Try all possible IDs for this modal
          for (const id of ids) {
            const element = document.getElementById(id);
            if (element) {
              this.modals[key] = element;
              console.log(`Modal registered: ${key} -> #${id}`);
              break;
            }
          }
          
          // Don't warn if not found - may be conditionally rendered
          if (!this.modals[key]) {
            console.debug(`Modal not currently available: ${key}`);
          }
        }
      }
      
      show(modalId) {
        console.log(`[ModalManager] Attempting to show modal: ${modalId}`);
        const modal = this.modals[modalId];
        
        if (!modal) {
          console.error(`Modal with ID "${modalId}" not found in registered modals`);
          // Try to find it directly in the DOM as fallback
          const fallbackModal = document.getElementById(`${modalId}Modal`) ||
                               document.getElementById(`${modalId}SettingsModal`);
          
          if (fallbackModal) {
            console.log(`Found fallback modal for "${modalId}" via direct DOM query`);
            fallbackModal.classList.remove('hidden');
            return;
          }
          
          console.error(`Could not find a fallback modal for "${modalId}"`);
          return;
        }
        
        // Add modal overlay classes
        modal.classList.add('confirm-modal');
        modal.classList.remove('hidden');
        console.log(`Modal "${modalId}" shown successfully`);
      }
      
      hide(modalId) {
        console.log(`[ModalManager] Hiding modal: ${modalId}`);
        const modal = this.modals[modalId];
        
        if (!modal) {
          console.warn(`Modal with ID "${modalId}" not found for hiding`);
          // Try to find it directly
          const fallbackModal = document.getElementById(`${modalId}Modal`) ||
                               document.getElementById(`${modalId}SettingsModal`);
          
          if (fallbackModal) {
            fallbackModal.classList.add('hidden');
            return;
          }
          return;
        }
        
        // Remove modal overlay classes
        modal.classList.remove('confirm-modal');
        modal.classList.add('hidden');
      }
      
      static closeActiveModal() {
        const modal = document.getElementById('deleteConfirmModal');
        if (modal) {
          modal.classList.remove('confirm-modal');
          modal.classList.add('hidden');
        }
      }
      
      // Add static isAvailable method
      static isAvailable() {
        return typeof window.ModalManager !== 'undefined';
      }
    };

    // Add the static confirmAction method
    window.ModalManager.confirmAction = function(config) {
      return new Promise((resolve) => {
        const modal = document.getElementById('deleteConfirmModal');
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
              <button id="cancelDeleteBtn" class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded transition-colors dark:text-gray-300 dark:hover:bg-gray-700">
                ${config.cancelText || 'Cancel'}
              </button>
              <button id="confirmDeleteBtn" class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors ${config.confirmClass || ''}">
                ${config.confirmText || 'Confirm'}
              </button>
            </div>
          </div>
        `;

        // Set up event handlers
        modal.querySelector('#confirmDeleteBtn').addEventListener('click', () => {
          modal.classList.add('hidden');
          if (typeof config.onConfirm === 'function') config.onConfirm();
          resolve(true);
        });
        
        modal.querySelector('#cancelDeleteBtn').addEventListener('click', () => {
          modal.classList.add('hidden');
          if (typeof config.onCancel === 'function') config.onCancel();
          resolve(false);
        });
        
        // Show modal
        modal.classList.add('confirm-modal');
        modal.classList.remove('hidden');
      });
    };
    
    // Create global instance
    window.modalManager = new window.ModalManager();
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

  // Centralized global error handler
  window.addEventListener('error', function(event) {
    console.error('Global error:', event.error?.message || event.message);
    if (window.showNotification) {
      window.showNotification('An error occurred: ' + (event.error?.message || event.message), 'error');
    }
  });
  
  // Handle promise rejections with better error details
  window.addEventListener('unhandledrejection', function(event) {
    const reason = event.reason;
    const errorMessage = typeof reason === 'string' ? reason : reason?.message || 'Unknown error';
    const errorStack = reason?.stack || '';
    
    // Log details for debugging
    console.error('Unhandled promise rejection:', errorMessage);
    console.debug('Error details:', reason);
    if (errorStack) console.debug('Stack trace:', errorStack);
    
    // Add source information when available
    const sourceInfo = event.promise?._source || '';
    if (sourceInfo) console.debug('Promise source:', sourceInfo);
    
    // Provide more helpful notification with context if available
    if (window.showNotification) {
      // Check for known error patterns
      if (errorMessage.includes('Knowledge base not configured')) {
        window.showNotification(
          'Please setup a knowledge base before performing this operation',
          'warning',
          { action: "Setup KB", onAction: () => window.modalManager?.show("knowledge") }
        );
      } else if (errorMessage.includes('Network Error')) {
        window.showNotification('Network connection issue. Please check your connection.', 'error');
      } else if (errorMessage.includes('No project selected')) {
        // Silently ignore "No project selected" errors as they're handled elsewhere
        event.preventDefault(); // Prevent default error handling
      } else {
        window.showNotification('Operation failed: ' + errorMessage, 'error');
      }
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
