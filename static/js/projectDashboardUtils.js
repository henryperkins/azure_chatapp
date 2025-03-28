/**
 * projectDashboardUtils.js
 * -----------------------
 * Utility classes for the project dashboard
 */

// Basic utility class for UI operations
export class UIUtils {
  constructor() {
    console.log('UIUtils initialized');
  }

  /**
   * Create an HTML element with attributes and content
   */
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
  
  /**
   * Toggle visibility of an element
   */
  toggleVisibility(element, visible) {
    if (!element) return;
    
    if (visible) {
      element.classList.remove('hidden');
    } else {
      element.classList.add('hidden');
    }
  }
  
  /**
   * Format a number with commas
   */
  formatNumber(number) {
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  
  /**
   * Format a date string to a human-readable format
   */
  formatDate(dateString) {
    if (!dateString) return '';
    
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    } catch (e) {
      return dateString;
    }
  }
  
  /**
   * Format file size in bytes to human-readable format
   */
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }
  
  /**
   * Get an icon based on file type
   */
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
      'png': '🖼️'
    };
    
    return iconMap[fileType] || '📄';
  }
  
  /**
   * Show a notification
   */
  showNotification(message, type = "info") {
    const notificationArea = document.getElementById('notificationArea');
    if (!notificationArea) {
      console.error('Notification area not found');
      return;
    }
    
    const notification = document.createElement('div');
    notification.className = `p-3 mb-2 rounded shadow-md transition-all duration-300 transform translate-x-0 opacity-100 flex items-center justify-between`;
    
    // Style based on type
    switch (type) {
      case 'success':
        notification.classList.add('bg-green-100', 'text-green-800', 'border-green-300');
        break;
      case 'error':
        notification.classList.add('bg-red-100', 'text-red-800', 'border-red-300');
        break;
      case 'warning':
        notification.classList.add('bg-yellow-100', 'text-yellow-800', 'border-yellow-300');
        break;
      default:
        notification.classList.add('bg-blue-100', 'text-blue-800', 'border-blue-300');
    }
    
    notification.innerHTML = `
      <div class="mr-2">${message}</div>
      <button class="text-gray-500 hover:text-gray-700">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    `;
    
    // Add close handler
    notification.querySelector('button').addEventListener('click', () => {
      notification.classList.add('opacity-0', 'translate-x-full');
      setTimeout(() => {
        notification.remove();
      }, 300);
    });
    
    notificationArea.appendChild(notification);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.classList.add('opacity-0', 'translate-x-full');
        setTimeout(() => {
          if (notification.parentNode) {
            notification.remove();
          }
        }, 300);
      }
    }, 5000);
  }
}

// Animation utility
export class AnimationUtils {
  constructor() {
    console.log('AnimationUtils initialized');
  }
  
  /**
   * Animate a progress bar
   */
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

// Modal manager utility
export class ModalManager {
  constructor() {
    this.modals = {
      project: document.getElementById('projectFormModal'),
      instructions: document.getElementById('instructionsModal'),
      delete: document.getElementById('deleteConfirmModal'),
      knowledge: document.getElementById('knowledgeBaseSettingsModal')
    };
    
    console.log('ModalManager initialized with modals:', Object.keys(this.modals));
  }
  
  /**
   * Show a modal by ID
   */
  show(modalId) {
    const modal = this.modals[modalId];
    if (!modal) {
      console.error(`Modal with ID "${modalId}" not found`);
      return;
    }
    
    // Add modal overlay classes
    modal.classList.add('confirm-modal');
    modal.classList.remove('hidden');
  }
  
  /**
   * Hide a modal by ID
   */
  hide(modalId) {
    const modal = this.modals[modalId];
    if (!modal) return;
    
    // Remove modal overlay classes
    modal.classList.remove('confirm-modal');
    modal.classList.add('hidden');
  }
  
  /**
   * Show a confirmation dialog
   */
  static confirmAction(config) {
    const modal = document.getElementById('deleteConfirmModal');
    if (!modal) {
      console.error('Confirmation modal not found');
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
      if (config.onConfirm) config.onConfirm();
    });
    
    modal.querySelector('#cancelDeleteBtn').addEventListener('click', () => {
      modal.classList.add('hidden');
      if (config.onCancel) config.onCancel();
    });
    
    // Show modal
    modal.classList.add('confirm-modal');
    modal.classList.remove('hidden');
  }
}

// Export for usage in other modules
export default { UIUtils, AnimationUtils, ModalManager };
