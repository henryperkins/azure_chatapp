/**
 * Project Modal Component
 * Handles the creation and editing of projects using a modal dialog
 */

(function () {
  class ProjectModal {
    constructor() {
      this.modalElement = null;
      this.formElement = null;
      this.isOpen = false;
      this.currentProjectId = null;

      // Bind methods to preserve 'this' context
      this.openModal = this.openModal.bind(this);
      this.closeModal = this.closeModal.bind(this);
      this.handleSubmit = this.handleSubmit.bind(this);

      // Initialize once the DOM is ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.init());
      } else {
        this.init();
      }
    }

    init() {
      // Try to find the existing modal
      this.modalElement = document.getElementById('projectModal');

      // Create modal if it doesn't exist
      if (!this.modalElement) {
        this.createModalElement();
      }

      // Set up event listeners
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
                     class="input input-bordered w-full" required
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
      // Get form element if not already set
      if (!this.formElement) {
        this.formElement = this.modalElement.querySelector('#projectForm');
      }

      // Form submission handler
      if (this.formElement) {
        this.formElement.removeEventListener('submit', this.handleSubmit);
        this.formElement.addEventListener('submit', this.handleSubmit);
      }

      // Cancel button handler
      const cancelBtn = this.modalElement.querySelector('#projectCancelBtn');
      if (cancelBtn) {
        cancelBtn.removeEventListener('click', this.closeModal);
        cancelBtn.addEventListener('click', this.closeModal);
      }

      // Close on ESC key
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen) {
          this.closeModal();
        }
      });

      // Close on backdrop click (if using <dialog>)
      this.modalElement.addEventListener('click', (e) => {
        if (e.target === this.modalElement && this.isOpen) {
          this.closeModal();
        }
      });
    }

    openModal(project = null) {
      if (!this.modalElement) {
        console.error('[ProjectModal] Modal element not found');
        return;
      }

      // Reset the form
      if (this.formElement) {
        this.formElement.reset();
      }

      // Set title based on whether we're editing or creating
      const titleElement = this.modalElement.querySelector('#projectModalTitle');
      if (titleElement) {
        titleElement.textContent = project ? 'Edit Project' : 'Create Project';
      }

      // Set form values if editing an existing project
      if (project) {
        this.currentProjectId = project.id;
        const idInput = this.modalElement.querySelector('#projectIdInput');
        const nameInput = this.modalElement.querySelector('#projectNameInput');
        const descInput = this.modalElement.querySelector('#projectDescInput');
        const goalsInput = this.modalElement.querySelector('#projectGoalsInput');
        const maxTokensInput = this.modalElement.querySelector('#projectMaxTokensInput');

        if (idInput) idInput.value = project.id || '';
        if (nameInput) nameInput.value = project.name || '';
        if (descInput) descInput.value = project.description || '';
        if (goalsInput) goalsInput.value = project.goals || '';
        if (maxTokensInput) maxTokensInput.value = project.max_tokens || '';
      } else {
        this.currentProjectId = null;
        // Clear the hidden project ID field
        const idInput = this.modalElement.querySelector('#projectIdInput');
        if (idInput) idInput.value = '';
      }

      // Show the modal using the appropriate method
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
        console.error('[ProjectModal] Form not found');
        return;
      }

      try {
        const formData = new FormData(this.formElement);
        const projectData = {
          name: formData.get('name'),
          description: formData.get('description') || '',
          goals: formData.get('goals') || '',
          max_tokens: formData.get('maxTokens') || null
        };

        // Get the project ID if we're editing
        const projectId = formData.get('projectId');

        if (!projectData.name) {
          this.showError('Project name is required');
          return;
        }

        // Show loading state
        this.setLoading(true);

        // Save the project
        await this.saveProject(projectId, projectData);

        // Close the modal
        this.closeModal();

        // Show success notification
        this.showSuccess(projectId ? 'Project updated' : 'Project created');

      } catch (error) {
        console.error('[ProjectModal] Save error:', error);
        this.showError('Failed to save project');
      } finally {
        this.setLoading(false);
      }
    }

    async saveProject(projectId, projectData) {
      // Check if we have the project manager available
      if (!window.projectManager) {
        throw new Error('Project manager not available');
      }

      // Determine if creating or updating
      if (projectId) {
        // Update existing project
        await window.projectManager.updateProject(projectId, projectData);
      } else {
        // Create new project
        await window.projectManager.createProject(projectData);
      }

      // Refresh projects list
      await window.projectManager.loadProjects();
    }

    setLoading(isLoading) {
      const saveButton = this.modalElement.querySelector('#projectSaveBtn');
      const cancelButton = this.modalElement.querySelector('#projectCancelBtn');

      if (saveButton) {
        saveButton.disabled = isLoading;
        saveButton.classList.toggle('loading', isLoading);
      }

      if (cancelButton) {
        cancelButton.disabled = isLoading;
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

  // Create an instance and expose it globally
  window.projectModal = new ProjectModal();
})();
