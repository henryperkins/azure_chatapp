/**
 * @file projectModal.js
 * @description Project Modal Controller with form handling
 * @module ProjectModal
 *
 * Features:
 * - Form validation and auto-saving
 * - Accessibility compliant
 * - Multiple exit paths with confirmation
 */

if (typeof window.ProjectModal === 'undefined') {
  window.ProjectModal = class ProjectModal {
  constructor() {
    // Initialize the modal without auto-opening it
    this.initializeModal();

    // Add a fallback initialization attempt with MutationObserver
    this._setupModalObserver();
  }

  initializeModal() {
    // Get modal elements
    this.modalId = 'project';
    this.modalElement = document.getElementById('projectFormModal');
    if (!this.modalElement) {
      console.warn('Project form modal element not found, will retry when needed');
      return;
    }
    
    // Ensure the dialog is closed by default
    if (this.modalElement.nodeName === 'DIALOG' && this.modalElement.hasAttribute('open')) {
      this.modalElement.close();
    }

    // Try to find form elements with multiple possible IDs
    this.form = document.getElementById('projectForm');
    this.nameInput = document.getElementById('projectForm-nameInput') ||
                     document.getElementById('projectNameInput');
    this.nameError = document.getElementById('projectForm-nameError') ||
                     document.getElementById('projectNameError');
    this.submitBtn = document.getElementById('submitProjectFormBtn') ||
                     document.querySelector('#projectForm button[type="submit"]');

    // More resilient handling of missing elements
    if (!this.form || !this.nameInput || !this.submitBtn) {
      console.warn('Some modal form elements not found, will retry when modal is opened');
      // Don't return early, still register with modal manager
    }

    // Register with the unified ModalManager if available
    this._registerWithModalManager();

    // Initialize event listeners, load draft values
    this.initEventListeners();
    this.loadDraft();
    this.initialized = true;
  }

  /**
   * Register this modal with the unified ModalManager
   * @private
   */
  _registerWithModalManager() {
    // First try global manager instance
    if (window.modalManager) {
      this._completeRegistration(window.modalManager);
    }
    // Then try ProjectDashboard namespace
    else if (window.ProjectDashboard && window.ProjectDashboard.modalManager) {
      this._completeRegistration(window.ProjectDashboard.modalManager);
    }
    // If not available yet, set up a retry with a delay
    else {
      console.log('ModalManager not yet available, will retry registration in 500ms');
      setTimeout(() => {
        if (window.modalManager || (window.ProjectDashboard && window.ProjectDashboard.modalManager)) {
          const manager = window.modalManager || window.ProjectDashboard.modalManager;
          this._completeRegistration(manager);
        } else {
          console.warn('ModalManager not available for ProjectModal registration after retry');
        }
      }, 500);
    }
  }

  /**
   * Complete the registration with the modal manager
   * @private
   * @param {Object} manager - The modal manager instance
   */
  _completeRegistration(manager) {
    try {
      // Check if manager exists
      if (!manager) {
        console.error('Modal manager is undefined or null');
        return;
      }

      // Check if manager has registerModal method (backward compatibility)
      if (typeof manager.registerModal === 'function') {
        manager.registerModal(this.modalId, this.modalElement);
        console.log(`ProjectModal registered with ModalManager using registerModal for ID: ${this.modalId}`);
      } else {
        // For new ModalManager implementation that doesn't have registerModal
        // Just ensure the modalId is in the mappings
        if (manager.modalMappings || manager.modals) {
          const mappingsObj = manager.modalMappings || manager.modals;
          if (!mappingsObj[this.modalId]) {
            console.log(`Adding '${this.modalId}' to ModalManager mappings`);
            mappingsObj[this.modalId] = this.modalElement.id || this.modalElement;
          }
          console.log(`ProjectModal registered with ModalManager for ID: ${this.modalId}`);
        } else {
          // Create mappings if they don't exist
          console.log('Creating modalMappings property on manager');
          manager.modalMappings = manager.modalMappings || {};
          manager.modalMappings[this.modalId] = this.modalElement.id || this.modalElement;
        }
      }
      
      // Ensure the modal is not shown automatically after registration
      if (manager.hide && typeof manager.hide === 'function') {
        manager.hide(this.modalId);
      } else if (this.modalElement.nodeName === 'DIALOG') {
        this.modalElement.close();
      } else {
        this.modalElement.classList.add('hidden');
      }
    } catch (err) {
      console.error('Error registering modal with manager:', err);
    }

    // Add a special handler for cleanup when hiding
    if (manager.hide && typeof manager.hide === 'function') {
      const originalHide = manager.hide;
      // Only modify if not already modified
      if (!manager._hideOverridden) {
        manager.hide = (modalId, ...args) => {
          if (modalId === this.modalId) {
            document.body.style.overflow = ''; // Reset body overflow
          }
          return originalHide.call(manager, modalId, ...args);
        };
        manager._hideOverridden = true;
      }
    }
  }

  initEventListeners() {
    // Form submission
    this.form.addEventListener('submit', (e) => this.handleSubmit(e));

    // Auto-save on input changes
    this.nameInput.addEventListener('input', () => this.saveDraft());

    const descInput = document.getElementById('projectDescInput');
    if (descInput) {
      descInput.addEventListener('input', () => this.saveDraft());
    }

    const goalsInput = document.getElementById('projectGoalsInput');
    if (goalsInput) {
      goalsInput.addEventListener('input', () => this.saveDraft());
    }
  }

  async handleSubmit(e) {
    e.preventDefault();

    // Validate form
    if (!this.validateForm()) return;

    // Disable submit button during request
    this.submitBtn.disabled = true;
    this.submitBtn.innerHTML = `
      <svg class="animate-spin h-4 w-4 mx-auto text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
    `;

    try {
      const formData = {
        name: this.nameInput.value.trim(),
        description: document.getElementById('projectDescInput')?.value.trim() || '',
        goals: document.getElementById('projectGoalsInput')?.value.trim() || '',
        max_tokens: parseInt(document.getElementById('projectMaxTokensInput')?.value || '0', 10)
      };

      const projectId = document.getElementById('projectIdInput')?.value || null;
      const response = await window.projectManager.createOrUpdateProject(projectId, formData);

      this.showNotification(
        projectId ? 'Project updated' : 'Project created',
        'success'
      );

      this.clearDraft();
      this.closeModal();

      // Refresh project list
      if (window.projectDashboard) {
        window.projectDashboard.loadProjects();
      }
    } catch (error) {
      console.error('Project save failed:', error);
      this.showNotification(
        error.message || 'Failed to save project',
        'error'
      );
    } finally {
      this.submitBtn.disabled = false;
      this.submitBtn.textContent = 'Save Project';
    }
  }

  /**
   * Show a notification using the unified notification system
   * @param {string} message - Message to show
   * @param {string} type - Notification type (success, error, warning, info)
   */
  showNotification(message, type) {
    if (window.showNotification) {
      window.showNotification(message, type);
    } else {
      console.log(`[${type.toUpperCase()}] ${message}`);
    }
  }

  /**
   * Validate form fields
   * @returns {boolean} Whether the form is valid
   */
  validateForm() {
    let isValid = true;

    if (!this.nameInput.value.trim()) {
      if (this.nameError) {
        this.nameError.classList.remove('hidden');
      }
      this.nameInput.focus();
      isValid = false;
    } else if (this.nameError) {
      this.nameError.classList.add('hidden');
    }

    return isValid;
  }

  /**
   * Save draft form values to localStorage
   */
  saveDraft() {
    const draft = {
      name: this.nameInput.value,
      description: document.getElementById('projectDescInput')?.value || '',
      goals: document.getElementById('projectGoalsInput')?.value || ''
    };
    localStorage.setItem('projectDraft', JSON.stringify(draft));
  }

  /**
   * Load draft form values from localStorage
   */
  loadDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem('projectDraft'));
      if (draft) {
        this.nameInput.value = draft.name || '';

        const descInput = document.getElementById('projectDescInput');
        if (descInput) {
          descInput.value = draft.description || '';
        }

        const goalsInput = document.getElementById('projectGoalsInput');
        if (goalsInput) {
          goalsInput.value = draft.goals || '';
        }
      }
    } catch (e) {
      console.warn('Failed to load project form draft', e);
    }
  }

  /**
   * Clear saved draft values
   */
  clearDraft() {
    localStorage.removeItem('projectDraft');
  }

  /**
   * Open the project modal using the unified ModalManager
   */
  openModal() {
    // Re-initialize elements if they weren't found initially
    if (!this.form || !this.nameInput || !this.submitBtn) {
      this.form = document.getElementById('projectForm');
      this.nameInput = document.getElementById('projectForm-nameInput') ||
                       document.getElementById('projectNameInput');
      this.nameError = document.getElementById('projectForm-nameError') ||
                       document.getElementById('projectNameError');
      this.submitBtn = document.getElementById('submitProjectFormBtn') ||
                       document.querySelector('#projectForm button[type="submit"]');

      if (!this.form || !this.nameInput || !this.submitBtn) {
        console.warn('Modal form elements still not found during openModal');
      } else {
        console.log('Successfully found modal elements on open');
        // Now that we have the elements, initialize event listeners
        this.initEventListeners();
      }
    }

    const modalEl = document.getElementById('projectFormModal');
    if (!modalEl) {
      console.error('Modal element not found');
      return;
    }

    try {
      if (window.ModalManager && window.modalManager) {
        window.modalManager.show(this.modalId);
      } else {
        // Robust fallback
        modalEl.classList.remove('hidden');
        modalEl.style.display = 'flex';
      }

      // Additional UI setup
      document.body.style.overflow = 'hidden';
      this.nameInput?.focus();

    } catch (error) {
      console.error('Error opening modal:', error);
      // Emergency fallback
      modalEl.classList.remove('hidden');
      modalEl.style.display = 'flex';
    }
  }

  /**
   * Close the project modal using the unified ModalManager
   */
  closeModal() {
    if (window.ModalManager && window.modalManager) {
      window.modalManager.hide(this.modalId);
    } else {
      // Fallback to direct manipulation
      this.modalElement.classList.add('hidden');
      this.modalElement.style.display = 'none';
      document.body.style.overflow = '';
    }
  }

  /**
   * Set up a MutationObserver to watch for the modal element to be added to the DOM
   * @private
   */
  _setupModalObserver() {
    // Create a MutationObserver to watch for the modal element to be added to the DOM
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length) {
          const modalAdded = Array.from(mutation.addedNodes).some(node => {
            return node.id === 'projectFormModal' ||
                   (node.querySelector && node.querySelector('#projectFormModal'));
          });

          if (modalAdded) {
            this.initializeModal();
            observer.disconnect();
            console.log('Project form modal detected by observer, initialized');
            return;
          }
        }
      }
    });

    // Start observing the document body
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

// Initialize and expose globally
window.initProjectModal = () => {
  if (!window.projectModal) {
    window.projectModal = new ProjectModal();
  }
  return window.projectModal;
};

// Initialize when DOM is ready, but don't open the modal automatically
document.addEventListener('DOMContentLoaded', () => {
  // Initialize the modal without showing it
  if (!window.projectModal) {
    window.projectModal = new ProjectModal();
  }
});

// Init if loaded after DOMContentLoaded, but without auto-showing
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  if (!window.projectModal) {
    window.projectModal = new ProjectModal();
  }
}
}
