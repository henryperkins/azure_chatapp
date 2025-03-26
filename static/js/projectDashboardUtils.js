/**
 * Animation utilities for counters and progress bars
 */
class AnimationUtils {
  /**
   * Animate a counter from start to end value
   */
  animateCounter(element, start, end, duration = 500) {
    if (!element) return;
    
    const startTime = performance.now();
    const update = (timestamp) => {
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const value = Math.floor(progress * (end - start) + start);
      
      element.textContent = value.toLocaleString();
      
      if (progress < 1) requestAnimationFrame(update);
    };
    
    requestAnimationFrame(update);
  }
  
  /**
   * Animate a progress bar
   */
  animateProgress(element, start, end, duration = 500) {
    if (!element) return;
    
    const startTime = performance.now();
    const update = (timestamp) => {
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const value = start + (progress * (end - start));
      
      element.style.width = `${value}%`;
      
      if (progress < 1) requestAnimationFrame(update);
    };
    
    requestAnimationFrame(update);
  }
}

/**
 * UI utilities for common operations
 */
class UIUtils {
  /**
   * Show notification
   */
  showNotification(message, type = "info") {
    try {
      if (window.showNotification) {
        window.showNotification(message, type);
      } else {
        // Fallback implementation
        const notificationArea = document.getElementById('notificationArea');
        if (notificationArea) {
          const notification = document.createElement('div');
          notification.className = `notification ${type}`;
          notification.textContent = message;
          notification.classList.add('animate-slide-in');
          notificationArea.appendChild(notification);
          
          // Auto-remove after 5 seconds
          setTimeout(() => {
            notification.remove();
          }, 5000);
        } else {
          console.log(`[${type}] ${message}`);
        }
      }
    } catch (err) {
      console.error('Failed to show notification:', err);
      console.log(`[${type}] ${message}`);
    }
  }
  
  /**
   * Format file size
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
   * Format date
   */
  formatDate(date, includeTime = false) {
    if (!date) return '';
    
    const d = new Date(date);
    const options = {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    };
    
    if (includeTime) {
      options.hour = '2-digit';
      options.minute = '2-digit';
    }
    
    return d.toLocaleDateString(undefined, options);
  }
  
  /**
   * Format large numbers
   */
  formatNumber(num) {
    return num.toLocaleString();
  }
  
  /**
   * Create DOM element
   */
  createElement(type, attributes = {}, children = []) {
    const element = document.createElement(type);
    
    // Set attributes
    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'class' || key === 'className') {
        element.className = value;
      } else if (key === 'style' && typeof value === 'object') {
        Object.entries(value).forEach(([prop, val]) => {
          element.style[prop] = val;
        });
      } else if (key.startsWith('on') && typeof value === 'function') {
        const eventType = key.substring(2).toLowerCase();
        element.addEventListener(eventType, value);
      } else if (key === 'textContent') {
        element.textContent = value;
      } else if (key === 'innerHTML') {
        element.innerHTML = value;
      } else {
        element.setAttribute(key, value);
      }
    });
    
    // Add children
    if (typeof children === 'string') {
      element.textContent = children;
    } else if (Array.isArray(children)) {
      children.forEach(child => {
        if (typeof child === 'string') {
          element.appendChild(document.createTextNode(child));
        } else if (child instanceof HTMLElement) {
          element.appendChild(child);
        }
      });
    }
    
    return element;
  }
  
  /**
   * Get file icon based on file type
   */
  fileIcon(fileType) {
    const icons = {
      pdf: '📄',
      doc: '📝',
      docx: '📝',
      txt: '📄',
      csv: '📊',
      json: '📊',
      jpg: '🖼️',
      jpeg: '🖼️',
      png: '🖼️',
      default: '📄'
    };
    
    return icons[fileType?.toLowerCase()] || icons.default;
  }
  
  /**
   * Get artifact icon based on content type
   */
  artifactIcon(contentType) {
    const icons = {
      code: '📝',
      document: '📄',
      image: '🖼️',
      default: '📦'
    };
    
    return icons[contentType?.toLowerCase()] || icons.default;
  }
  
  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[m];
    });
  }

  /**
   * Toggle element visibility by adding/removing the 'hidden' class
   */
  toggleVisibility(elementOrId, isVisible) {
    const el = typeof elementOrId === 'string' 
      ? document.getElementById(elementOrId) 
      : elementOrId;
    if (el) {
      el.classList.toggle('hidden', !isVisible);
    }
  }
}

/**
 * Modal Manager for handling modal displays
 */
class ModalManager {
  constructor() {
    this.registry = {
      project: "projectFormModal",
      instructions: "instructionsModal",
      confirm: "deleteConfirmModal",
      content: "contentViewModal",
      knowledge: "knowledgeBaseSettingsModal"
    };
  }
  
  /**
   * Show a modal by ID
   */
  show(id, data = {}) {
    const modalId = this.registry[id] || id;
    const modal = document.getElementById(modalId);
    if (!modal) return null;
    
    // Handle specific modal types
    if (id === "project" && data.project) {
      this._populateProjectForm(data.project);
    } else if (id === "content" && data.content) {
      this._setContentModalData(data.title, data.content);
    }
    
    modal.classList.remove("hidden");
    return modal;
  }
  
  /**
   * Hide a modal by ID
   */
  hide(id) {
    const modalId = this.registry[id] || id;
    document.getElementById(modalId)?.classList.add("hidden");
  }
  
  /**
   * Show project form
   */
  showProjectForm(project = null) {
    this._populateProjectForm(project);
    this.show("project");
  }
  
  /**
   * Show a confirmation dialog
   */
  confirmAction(options) {
    const {
      title = "Confirm Action",
      message = "Are you sure you want to proceed with this action?",
      confirmText = "Confirm",
      cancelText = "Cancel",
      confirmClass = "bg-blue-600",
      onConfirm = () => {},
      onCancel = () => {}
    } = options;
    
    const modal = document.getElementById(this.registry.confirm);
    if (!modal) return;
    
    // Update content
    document.getElementById("confirmActionTitle").textContent = title;
    document.getElementById("confirmActionContent").textContent = message;
    document.getElementById("confirmActionBtn").textContent = confirmText;
    document.getElementById("confirmActionBtn").className = `px-4 py-2 rounded text-white hover:bg-opacity-90 ${confirmClass}`;
    document.getElementById("confirmCancelBtn").textContent = cancelText;
    
    // Set up event handlers
    document.getElementById("confirmActionBtn").onclick = () => {
      onConfirm();
      this.hide("confirm");
    };
    
    document.getElementById("confirmCancelBtn").onclick = () => {
      onCancel();
      this.hide("confirm");
    };
    
    modal.classList.remove("hidden");
    return modal;
  }
  
  // Helper methods
  _populateProjectForm(project) {
    const formTitle = document.getElementById("projectFormTitle");
    const idInput = document.getElementById("projectIdInput");
    const nameInput = document.getElementById("projectNameInput");
    const descInput = document.getElementById("projectDescInput");
    const goalsInput = document.getElementById("projectGoalsInput");
    const maxTokensInput = document.getElementById("projectMaxTokensInput");
    
    if (formTitle) formTitle.textContent = project ? "Edit Project" : "Create Project";
    if (idInput) idInput.value = project ? project.id : "";
    if (nameInput) nameInput.value = project ? project.name || "" : "";
    if (descInput) descInput.value = project ? project.description || "" : "";
    if (goalsInput) goalsInput.value = project ? project.goals || "" : "";
    if (maxTokensInput) maxTokensInput.value = project ? project.max_tokens || 200000 : 200000;
  }
  
  _setContentModalData(title, content) {
    const titleEl = document.getElementById("contentViewModalTitle");
    const contentEl = document.getElementById("contentViewModalContent");
    
    if (titleEl) titleEl.textContent = title || "Content";
    if (contentEl) contentEl.innerHTML = content || "";
  }
}

// Export the utility classes
export { AnimationUtils, UIUtils, ModalManager };
