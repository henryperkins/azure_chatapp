/**
 * modalManager.js
 * Consolidated file merging:
 *  1. ModalManager class (for generic dialogs)
 *  2. ProjectModal class (for project creation/editing)
 *
 * Exposes:
 *  - window.modalManager (instance of ModalManager)
 *  - window.ProjectModal (class)
 *  - window.projectModal (instance of ProjectModal)
 */

(function () {
  /**
   * -------------------------------------------------------------------------
   * MODAL MANAGER (Generic handling of named modals)
   * -------------------------------------------------------------------------
   */
  class ModalManager {
    constructor() {
      /**
       * Maps logical modal names to their <dialog> element IDs.
       * Change "project" → "projectModal" so it matches the ProjectModal ID.
       */
      this.modalMappings = {
        project: 'projectModal',
        delete: 'deleteConfirmModal',
        confirm: 'confirmActionModal',
        knowledge: 'knowledgeBaseSettingsModal',
        knowledgeResult: 'knowledgeResultModal',
        instructions: 'instructionsModal',
        contentView: 'contentViewModal'
      };
      this.activeModal = null;
      console.log('[ModalManager] Initialized.');

      // Register close listeners for mapped dialogs
      Object.values(this.modalMappings).forEach((modalId) => {
        const modalEl = document.getElementById(modalId);
        if (modalEl && typeof modalEl.addEventListener === 'function') {
          modalEl.addEventListener('close', () => {
            if (this.activeModal === modalId) {
              console.log(`[ModalManager] Dialog ${modalId} closed via native event.`);
              this.activeModal = null;
              // optional: reset body overflow
              document.body.style.overflow = '';
            }
          });
        }
      });
    }

    /**
     * Check if the class is available (static utility).
     */
    static isAvailable() {
      return typeof ModalManager !== 'undefined';
    }

    /**
     * Show a dialog by logical name
     * @param {string} modalName
     * @param {object} options
     * @returns {boolean} success
     */
    _manageBodyScroll(enableScroll) {
      document.body.style.overflow = enableScroll ? '' : 'hidden';
      document.documentElement.style.overflow = enableScroll ? '' : 'hidden';
    }

    show(modalName, options = {}) {
      // If app is still initializing, optionally skip
      if (window.__appInitializing && !options.showDuringInitialization) {
        console.log(`[ModalManager] Skipping modal '${modalName}' during app initialization`);
        return false;
      }

      // Resolve the mapped ID
      const modalId = this.modalMappings[modalName];
      if (!modalId) {
        console.error(`[ModalManager] No ID mapping for modalName='${modalName}'`);
        return false;
      }

      const modalEl = document.getElementById(modalId);
      if (!modalEl) {
        console.error(`[ModalManager] <dialog> element not found for ID='${modalId}'`);
        return false;
      }

      // Hide any currently active modal
      if (this.activeModal && this.activeModal !== modalId) {
        this.hide(Object.keys(this.modalMappings).find((key) => this.modalMappings[key] === this.activeModal));
      }

      // Optionally update modal content
      if (typeof options.updateContent === 'function') {
        try {
          options.updateContent(modalEl);
        } catch (err) {
          console.error(`[ModalManager] updateContent error for ${modalName}:`, err);
        }
      }

      // Attempt to show it as a dialog
      if (typeof modalEl.showModal === 'function') {
        modalEl.showModal();
        modalEl.style.zIndex = '2000';
        this.activeModal = modalId;
        this._manageBodyScroll(false);
      } else {
        // Fallback if no <dialog> support
        console.warn(`[ModalManager] .showModal() not available for ID='${modalId}'. Using fallback display.`);
        modalEl.style.display = 'block';
        this.activeModal = modalId;
      }

      return true;
    }

    /**
     * Hide a given dialog by name
     * @param {string} modalName
     * @returns {boolean} success
     */
    hide(modalName) {
      const modalId = this.modalMappings[modalName];
      if (!modalId) {
        console.error(`[ModalManager] No ID mapping found for '${modalName}'`);
        return false;
      }

      const modalEl = document.getElementById(modalId);
      if (!modalEl) {
        console.error(`[ModalManager] Element not found for ID='${modalId}'`);
        return false;
      }

      console.log(`[ModalManager] Hiding modal '${modalName}' (#${modalId})`);
      if (typeof modalEl.close === 'function') {
        modalEl.close();
      } else {
        modalEl.style.display = 'none';
      }

      if (this.activeModal === modalId) {
        this.activeModal = null;
        this._manageBodyScroll(true);
      }
      return true;
    }

    /**
     * Show a generic confirmation dialog
     * @param {object} options see below
     */
    confirmAction(options) {
      const modalName = 'confirm';
      const modalId = this.modalMappings[modalName];
      if (!modalId) {
        console.error('[ModalManager] Confirm modal ID not mapped.');
        return;
      }
      const modalEl = document.getElementById(modalId);
      if (!modalEl) {
        console.error('[ModalManager] Confirm modal element not found.');
        return;
      }

      // Update modal text
      const titleEl = modalEl.querySelector('h3');
      const messageEl = modalEl.querySelector('p');
      const confirmBtn = modalEl.querySelector('#confirmActionBtn');
      const cancelBtn = modalEl.querySelector('#cancelActionBtn');
      if (titleEl) titleEl.textContent = options.title || 'Confirm?';
      if (messageEl) messageEl.textContent = options.message || '';
      if (confirmBtn) {
        confirmBtn.textContent = options.confirmText || 'Confirm';
        confirmBtn.className = `btn ${options.confirmClass || 'btn-primary'}`;
      }
      if (cancelBtn) {
        cancelBtn.textContent = options.cancelText || 'Cancel';
      }

      // Remove old handlers by cloning
      const newConfirmBtn = confirmBtn.cloneNode(true);
      confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
      const newCancelBtn = cancelBtn.cloneNode(true);
      cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

      // Add new
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

      // Show the modal
      this.show(modalName, { showDuringInitialization: options.showDuringInitialization });
    }
  }

  // Create a global instance if not already existing
  if (!window.modalManager) {
    window.modalManager = new ModalManager();
    console.log('[modalManager.js] Global modalManager instance created.');
  } else {
    console.log('[modalManager.js] A global modalManager instance already exists.');
  }

  /**
   * -------------------------------------------------------------------------
   * PROJECT MODAL (Dedicated to creating/editing a single project)
   * -------------------------------------------------------------------------
   */
  class ProjectModal {
    constructor() {
      this.modalElement = null;
      this.formElement = null;
      this.isOpen = false;
      this.currentProjectId = null;

      // Bind
      this.openModal = this.openModal.bind(this);
      this.closeModal = this.closeModal.bind(this);
      this.handleSubmit = this.handleSubmit.bind(this);

      // Init w/ DOM
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.init());
      } else {
        this.init();
      }
    }

    init() {
      // Attempt to find #projectModal or rely on modalManager
      this.modalElement = document.getElementById('projectModal');

      if (!this.modalElement) {
        this.createModalElement();
      }
      // Setup
      this.setupEventListeners();
      console.log('[ProjectModal] Initialized');
    }

    createModalElement() {
      this.modalElement = document.createElement('dialog');
      this.modalElement.id = 'projectModal';
      this.modalElement.className = 'modal';

      this.modalElement.innerHTML = `
        <div class="modal-box">
          <h3 id="projectModalTitle" class="font-bold text-lg mb-4">Create Project</h3>
          <form id="projectForm" class="space-y-4">
            <input type="hidden" id="projectIdInput" name="projectId" value="">
            <div class="form-control">
              <label for="projectNameInput" class="label">
                <span class="label-text">Project Name</span>
              </label>
              <input id="projectNameInput" name="name" type="text"
                class="input input-bordered w-full"
                required
                placeholder="Enter project name">
            </div>
            <div class="form-control">
              <label for="projectDescInput" class="label">
                <span class="label-text">Description</span>
              </label>
              <textarea id="projectDescInput" name="description"
                class="textarea textarea-bordered min-h-16"
                placeholder="Optional project description"></textarea>
            </div>
            <div class="form-control">
              <label for="projectGoalsInput" class="label">
                <span class="label-text">Goals</span>
              </label>
              <textarea id="projectGoalsInput" name="goals"
                class="textarea textarea-bordered min-h-16"
                placeholder="Optional project goals"></textarea>
            </div>
            <div class="form-control">
              <label for="projectMaxTokensInput" class="label">
                <span class="label-text">Max Tokens</span>
              </label>
              <input id="projectMaxTokensInput" name="maxTokens" type="number"
                class="input input-bordered w-full"
                placeholder="Optional token limit">
            </div>
            <div class="modal-action">
              <button type="button" id="projectCancelBtn" class="btn">Cancel</button>
              <button type="submit" id="projectSaveBtn" class="btn btn-primary">Save</button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(this.modalElement);
      this.formElement = this.modalElement.querySelector('#projectForm');
    }

    setupEventListeners() {
      // Get the form
      if (!this.formElement) {
        this.formElement = this.modalElement.querySelector('#projectForm');
      }

      // Form submission
      if (this.formElement) {
        this.formElement.removeEventListener('submit', this.handleSubmit);
        this.formElement.addEventListener('submit', this.handleSubmit);
      }

      // Cancel button
      const cancelBtn = this.modalElement.querySelector('#projectCancelBtn');
      if (cancelBtn) {
        cancelBtn.removeEventListener('click', this.closeModal);
        cancelBtn.addEventListener('click', this.closeModal);
      }

      // ESC
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen) {
          this.closeModal();
        }
      });

      // Click on backdrop (if using <dialog>)
      this.modalElement.addEventListener('click', (e) => {
        if (e.target === this.modalElement && this.isOpen) {
          this.closeModal();
        }
      });
    }

    openModal(project = null) {
      if (!this.modalElement) {
        console.error('[ProjectModal] No modalElement found!');
        return;
      }

      // Reset
      if (this.formElement) {
        this.formElement.reset();
      }

      const titleEl = this.modalElement.querySelector('#projectModalTitle');
      if (titleEl) titleEl.textContent = project ? 'Edit Project' : 'Create Project';

      if (project) {
        this.currentProjectId = project.id;
        this.modalElement.querySelector('#projectIdInput').value = project.id || '';
        this.modalElement.querySelector('#projectNameInput').value = project.name || '';
        this.modalElement.querySelector('#projectDescInput').value = project.description || '';
        this.modalElement.querySelector('#projectGoalsInput').value = project.goals || '';
        this.modalElement.querySelector('#projectMaxTokensInput').value = project.max_tokens || '';
      } else {
        // Clear ID
        this.currentProjectId = null;
        const idEl = this.modalElement.querySelector('#projectIdInput');
        if (idEl) idEl.value = '';
      }

      // Show
      if (typeof this.modalElement.showModal === 'function') {
        this.modalElement.showModal();
      } else {
        this.modalElement.style.display = 'flex';
      }
      this.isOpen = true;
    }

    closeModal() {
      if (!this.modalElement) return;

      if (typeof this.modalElement.close === 'function') {
        this.modalElement.close();
      } else {
        this.modalElement.style.display = 'none';
      }
      this.isOpen = false;
      this.currentProjectId = null;
    }

    async handleSubmit(e) {
      e.preventDefault();

      if (!this.formElement) {
        console.error('[ProjectModal] No formElement found!');
        return;
      }

      try {
        const formData = new FormData(this.formElement);
        const projectData = {
          name: formData.get('name') || '',
          description: formData.get('description') || '',
          goals: formData.get('goals') || '',
          max_tokens: formData.get('maxTokens') || null
        };
        const projectId = formData.get('projectId');

        // Basic validation
        if (!projectData.name.trim()) {
          this.showError('Project name is required');
          return;
        }

        // Show loading
        this.setLoading(true);

        // Save
        await this.saveProject(projectId, projectData);

        // Close
        this.closeModal();
        this.showSuccess(projectId ? 'Project updated' : 'Project created');
      } catch (error) {
        console.error('[ProjectModal] Save error:', error);
        this.showError('Failed to save project');
      } finally {
        this.setLoading(false);
      }
    }

    async saveProject(projectId, projectData) {
      if (!window.projectManager) {
        throw new Error('[ProjectModal] projectManager not available');
      }

      // Use createOrUpdateProject which handles both cases
      await window.projectManager.createOrUpdateProject(projectId, projectData);

      // Refresh the list
      if (typeof window.projectManager.loadProjects === 'function') {
        await window.projectManager.loadProjects();
      }
    }

    setLoading(isLoading) {
      const saveBtn = this.modalElement.querySelector('#projectSaveBtn');
      const cancelBtn = this.modalElement.querySelector('#projectCancelBtn');
      if (saveBtn) {
        saveBtn.disabled = isLoading;
        saveBtn.classList.toggle('loading', isLoading);
      }
      if (cancelBtn) {
        cancelBtn.disabled = isLoading;
      }
    }

    showError(message) {
      if (window.showNotification) {
        window.showNotification(message, 'error');
      } else {
        alert(message);
      }
    }
    showSuccess(message) {
      if (window.showNotification) {
        window.showNotification(message, 'success');
      } else {
        console.log(message);
      }
    }
  }

  // Expose the ProjectModal class
  window.ProjectModal = ProjectModal;

  // Create a global instance for convenience
  if (!window.projectModal) {
    window.projectModal = new ProjectModal();
    console.log('[modalManager.js] Global projectModal instance created.');
  } else {
    console.log('[modalManager.js] A global projectModal instance already exists.');
  }
})();
