/**
 * modalManager.js
 * Consistent modal management utility
 */

class ModalManager {
  // Registry of modal IDs for easier reference
  static registry = {
    project: "projectFormModal",
    instructions: "instructionsModal",
    confirm: "confirmActionModal",
    content: "contentViewModal",
    knowledge: "knowledgeBaseSettingsModal",
    result: "knowledgeResultModal"
  };
  
  /**
   * Show a modal by ID
   */
  static show(id, data = {}) {
    const modalId = this.registry[id] || id;
    const modal = document.getElementById(modalId);
    if (!modal) return null;
    
    // Set data for specific modal types
    if (id === "project") {
      this._populateProjectForm(data.project);
    } else if (id === "content" && data.content) {
      this._setContentModalData(data.title, data.content);
    } else if (id === "knowledge" && data.kb) {
      this._populateKnowledgeForm(data.kb);
    } else if (id === "confirm" && data.options) {
      this._setConfirmOptions(data.options);
    }
    
    modal.classList.remove("hidden");
    return modal;
  }
  
  /**
   * Hide a modal by ID
   */
  static hide(id) {
    const modalId = this.registry[id] || id;
    document.getElementById(modalId)?.classList.add("hidden");
  }
  
  /**
   * Show the project form with optional project data
   */
  static showProjectForm(project = null) {
    this._populateProjectForm(project);
    this.show("project");
  }
  
  /**
   * Hide the project form
   */
  static hideProjectForm() {
    this.hide("project");
  }
  
  /**
   * Show a confirmation dialog
   */
  static confirmAction(options) {
    const {
      title = "Confirm Action",
      message = "Are you sure you want to proceed with this action?",
      confirmText = "Confirm",
      cancelText = "Cancel",
      confirmClass = "bg-blue-600",
      onConfirm = () => {},
      onCancel = () => {}
    } = options;
    
    // Find or create modal
    let modal = document.getElementById(this.registry.confirm);
    
    if (!modal) {
      modal = document.createElement("div");
      modal.id = this.registry.confirm;
      modal.className = "fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center hidden";
      
      const modalInner = document.createElement("div");
      modalInner.className = "bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full";
      
      const header = document.createElement("div");
      header.className = "flex justify-between items-center mb-4";
      
      const heading = document.createElement("h3");
      heading.id = "confirmActionTitle";
      heading.className = "text-xl font-semibold";
      
      const closeBtn = document.createElement("button");
      closeBtn.className = "text-gray-500 hover:text-gray-700";
      closeBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none"
          viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
           d="M6 18L18 6M6 6l12 12" />
        </svg>
      `;
      
      header.appendChild(heading);
      header.appendChild(closeBtn);
      
      const content = document.createElement("div");
      content.id = "confirmActionContent";
      content.className = "mb-6";
      
      const actions = document.createElement("div");
      actions.className = "flex justify-end space-x-3";
      
      const cancelBtn = document.createElement("button");
      cancelBtn.id = "confirmCancelBtn";
      cancelBtn.className = "px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-100";
      
      const confirmBtn = document.createElement("button");
      confirmBtn.id = "confirmActionBtn";
      confirmBtn.className = `px-4 py-2 rounded text-white hover:bg-opacity-90 ${confirmClass}`;
      
      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      
      modalInner.appendChild(header);
      modalInner.appendChild(content);
      modalInner.appendChild(actions);
      
      modal.appendChild(modalInner);
      document.body.appendChild(modal);
    }
    
    // Update content
    const titleEl = document.getElementById("confirmActionTitle");
    const contentEl = document.getElementById("confirmActionContent");
    const confirmBtnEl = document.getElementById("confirmActionBtn");
    const cancelBtnEl = document.getElementById("confirmCancelBtn");
    const closeBtnEl = modal.querySelector("svg").parentElement;
    
    if (titleEl) titleEl.textContent = title;
    if (contentEl) contentEl.textContent = message;
    if (confirmBtnEl) {
      confirmBtnEl.textContent = confirmText;
      confirmBtnEl.className = `px-4 py-2 rounded text-white hover:bg-opacity-90 ${confirmClass}`;
    }
    if (cancelBtnEl) cancelBtnEl.textContent = cancelText;
    
    // Update handlers
    const handleConfirm = () => {
      onConfirm();
      modal.classList.add("hidden");
    };
    
    const handleCancel = () => {
      onCancel();
      modal.classList.add("hidden");
    };
    
    // Remove old handlers
    const oldConfirmBtn = document.getElementById("confirmActionBtn");
    const oldCancelBtn = document.getElementById("confirmCancelBtn");
    
    if (oldConfirmBtn) {
      const newConfirmBtn = oldConfirmBtn.cloneNode(true);
      oldConfirmBtn.parentNode.replaceChild(newConfirmBtn, oldConfirmBtn);
      newConfirmBtn.addEventListener("click", handleConfirm);
    }
    
    if (oldCancelBtn) {
      const newCancelBtn = oldCancelBtn.cloneNode(true);
      oldCancelBtn.parentNode.replaceChild(newCancelBtn, oldCancelBtn);
      newCancelBtn.addEventListener("click", handleCancel);
    }
    
    if (closeBtnEl) {
      closeBtnEl.onclick = handleCancel;
    }
    
    // Show modal
    modal.classList.remove("hidden");
    
    return modal;
  }
  
  /**
   * Create a modal for viewing content
   */
  static createViewModal(title, content) {
    const modalId = this.registry.content;
    let modal = document.getElementById(modalId);
    
    if (!modal) {
      modal = document.createElement("div");
      modal.id = modalId;
      modal.className = "fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center hidden";
      
      const modalInner = document.createElement("div");
      modalInner.className = "bg-white dark:bg-gray-800 rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto";
      
      const header = document.createElement("div");
      header.className = "flex justify-between items-center mb-4";
      
      const heading = document.createElement("h3");
      heading.id = "contentViewModalTitle";
      heading.className = "text-xl font-semibold";
      header.appendChild(heading);
      
      const closeBtn = document.createElement("button");
      closeBtn.id = "closeContentViewModalBtn";
      closeBtn.className = "text-gray-500 hover:text-gray-700";
      closeBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none"
          viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
           d="M6 18L18 6M6 6l12 12" />
        </svg>
      `;
      closeBtn.addEventListener("click", () => this.hideViewModal());
      header.appendChild(closeBtn);
      
      const contentWrapper = document.createElement("div");
      contentWrapper.id = "contentViewModalContent";
      
      modalInner.appendChild(header);
      modalInner.appendChild(contentWrapper);
      modal.appendChild(modalInner);
      document.body.appendChild(modal);
    }
    
    // Update content
    this._setContentModalData(title, content);
    
    // Show modal
    modal.classList.remove("hidden");
    return { modal, modalContent: document.getElementById("contentViewModalContent"), heading: document.getElementById("contentViewModalTitle") };
  }
  
  /**
   * Hide the view modal
   */
  static hideViewModal() {
    this.hide("content");
  }
  
  // Private helper methods
  static _populateProjectForm(project) {
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
  
  static _setContentModalData(title, content) {
    const titleEl = document.getElementById("contentViewModalTitle");
    const contentEl = document.getElementById("contentViewModalContent");
    
    if (titleEl) titleEl.textContent = title || "Content";
    if (contentEl) contentEl.innerHTML = content || "";
  }
  
  static _populateKnowledgeForm(kb = null) {
    const nameInput = document.getElementById("knowledgeBaseNameInput");
    const descInput = document.getElementById("knowledgeBaseDescInput");
    const modelSelect = document.getElementById("embeddingModelSelect");
    const processAllCheckbox = document.getElementById("processAllFilesCheckbox");
    
    if (nameInput) nameInput.value = kb ? kb.name || "" : "";
    if (descInput) descInput.value = kb ? kb.description || "" : "";
    if (modelSelect && kb && kb.embedding_model) modelSelect.value = kb.embedding_model;
    if (processAllCheckbox) processAllCheckbox.checked = true; // Default to true for new KBs
  }
  
  static _setConfirmOptions(options) {
    if (!options) return;
    
    const titleEl = document.getElementById("confirmActionTitle");
    const contentEl = document.getElementById("confirmActionContent");
    const confirmBtnEl = document.getElementById("confirmActionBtn");
    const cancelBtnEl = document.getElementById("confirmCancelBtn");
    
    if (titleEl && options.title) titleEl.textContent = options.title;
    if (contentEl && options.message) contentEl.textContent = options.message;
    if (confirmBtnEl && options.confirmText) confirmBtnEl.textContent = options.confirmText;
    if (cancelBtnEl && options.cancelText) cancelBtnEl.textContent = options.cancelText;
    if (confirmBtnEl && options.confirmClass) {
      confirmBtnEl.className = `px-4 py-2 rounded text-white hover:bg-opacity-90 ${options.confirmClass}`;
    }
  }
}

// Export the module
window.ModalManager = ModalManager;