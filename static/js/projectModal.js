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
    this.modal = document.getElementById('projectFormModal');
    if (!this.modal) {
      console.error('Project form modal element not found');
      return;
    }

    this.form = document.getElementById('projectForm');
    this.nameInput = document.getElementById('projectForm-nameInput');
    this.nameError = document.getElementById('projectForm-nameError');
    this.closeBtn = document.getElementById('closeProjectFormBtn');
    this.cancelBtn = document.getElementById('cancelProjectFormBtn');
    this.submitBtn = document.getElementById('submitProjectFormBtn');

    if (!this.form || !this.nameInput || !this.closeBtn || !this.cancelBtn || !this.submitBtn) {
      console.error('Required modal elements not found');
      return;
    }

    this.initEventListeners();
    this.loadDraft();
    this.initialized = true;
  }

  initEventListeners() {
    // Form submission
    this.form.addEventListener('submit', (e) => this.handleSubmit(e));
    
    // Close modal triggers
    this.closeBtn.addEventListener('click', () => this.closeModal());
    this.cancelBtn.addEventListener('click', () => this.closeModal());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeModal();
    });

    // Auto-save on input changes
    this.nameInput.addEventListener('input', () => this.saveDraft());
    document.getElementById('projectDescInput')
      .addEventListener('input', () => this.saveDraft());
    document.getElementById('projectGoalsInput')
      .addEventListener('input', () => this.saveDraft());
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
        description: document.getElementById('projectDescInput').value.trim(),
        goals: document.getElementById('projectGoalsInput').value.trim(),
        max_tokens: parseInt(document.getElementById('projectMaxTokensInput').value, 10)
      };

      const response = await window.projectManager.createOrUpdateProject(
        document.getElementById('projectIdInput').value || null,
        formData
      );

      this.showNotification(
        document.getElementById('projectIdInput').value ? 'Project updated' : 'Project created',
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

  showNotification(message, type) {
    if (window.showNotification) {
      window.showNotification(message, type);
    } else {
      console.log(`[${type.toUpperCase()}] ${message}`);
    }
  }

  validateForm() {
    let isValid = true;
    
    if (!this.nameInput.value.trim()) {
      this.nameError.classList.remove('hidden');
      this.nameInput.focus();
      isValid = false;
    } else {
      this.nameError.classList.add('hidden');
    }

    return isValid;
  }

  saveDraft() {
    const draft = {
      name: this.nameInput.value,
      description: document.getElementById('projectDescInput').value,
      goals: document.getElementById('projectGoalsInput').value
    };
    localStorage.setItem('projectDraft', JSON.stringify(draft));
  }

  loadDraft() {
    const draft = JSON.parse(localStorage.getItem('projectDraft'));
    if (draft) {
      this.nameInput.value = draft.name || '';
      document.getElementById('projectDescInput').value = draft.description || '';
      document.getElementById('projectGoalsInput').value = draft.goals || '';
    }
  }

  clearDraft() {
    localStorage.removeItem('projectDraft');
  }

  openModal() {
    // Reset all inline styles first
    this.modal.removeAttribute('style');
    
    // Apply base modal classes
    this.modal.classList.remove('hidden');
    this.modal.classList.add('project-modal-container');

    // Focus the name input
    this.nameInput.focus();

    // Prevent background scrolling
    document.body.style.overflow = 'hidden';
  }

  closeModal() {
    this.modal.classList.add('hidden');
    this.modal.style.display = 'none'; // Explicitly reset the display style
    document.body.style.overflow = '';
  }
}

// Initialize and expose globally
window.initProjectModal = () => {
  if (!window.projectModal) {
    window.projectModal = new ProjectModal();
  }
  return window.projectModal;
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initProjectModal();
});

// Auto-initialize if loaded after DOMContentLoaded
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  initProjectModal();
}
}
