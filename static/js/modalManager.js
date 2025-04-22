let modalManagerInstance = null;

/** modalManager.js
 * Dependencies:
 * - window.eventHandlers.trackListener (external dependency, for event management)
 * - window.projectManager (external dependency, for project operations)
 * - window.showNotification (external dependency, for notifications)
 * - window.DependencySystem (external dependency, for registration)
 * - document (browser built-in, for element queries and events)
 * - FormData (browser built-in, for form handling)
 */

class ModalManager {
  constructor() {
    /**
     * Maps logical modal names to <dialog> element IDs.
     */
    this.modalMappings = {
      project: "projectModal",
      delete: "deleteConfirmModal",
      confirm: "confirmActionModal",
      knowledge: "knowledgeBaseSettingsModal",
      knowledgeResult: "knowledgeResultModal",
      instructions: "instructionsModal",
      contentView: "contentViewModal",
    };
    this.activeModal = null;
  }

  /**
   * init - sets up any necessary event listeners or final steps.
   */
  init() {
    console.log("[ModalManager] init() called. Setting up modals...");

    // Register close listeners for mapped dialogs
    Object.values(this.modalMappings).forEach((modalId) => {
      const modalEl = document.getElementById(modalId);
      if (modalEl) {
        // Use trackListener if available
        if (window.eventHandlers?.trackListener) {
          window.eventHandlers.trackListener(
            modalEl,
            "close",
            () => {
              if (this.activeModal === modalId) {
                console.log(
                  `[ModalManager] Dialog ${modalId} closed (native event).`
                );
                this.activeModal = null;
                document.body.style.overflow = "";
              }
            },
            { description: `Close event for ${modalId}` }
          );
        } else {
          // Fallback if eventHandlers is not available
          modalEl.addEventListener("close", () => {
            if (this.activeModal === modalId) {
              console.log(
                `[ModalManager] Dialog ${modalId} closed (native fallback).`
              );
              this.activeModal = null;
              document.body.style.overflow = "";
            }
          });
        }
      }
    });

    console.log("[ModalManager] Initialization complete.");
  }

  /**
   * Manage body scroll utility
   * @private
   */
  _manageBodyScroll(enableScroll) {
    document.body.style.overflow = enableScroll ? "" : "hidden";
    document.documentElement.style.overflow = enableScroll ? "" : "hidden";
  }

  /**
   * Show a dialog by logical name
   * @param {string} modalName - Key in modalMappings
   * @param {object} [options] - Additional options
   * @returns {boolean} - success/failure
   */
  show(modalName, options = {}) {
    if (window.__appInitializing && !options.showDuringInitialization) {
      console.log(`[ModalManager] Skipping modal '${modalName}' during app init`);
      return false;
    }

    const modalId = this.modalMappings[modalName];
    if (!modalId) {
      console.error(`[ModalManager] Modal mapping missing for: ${modalName}`);
      return false;
    }

    let modalEl = document.getElementById(modalId);
    if (!modalEl) {
      console.error(`[ModalManager] Modal element missing: ${modalId}`);
      return false;
    }

    try {
      // Force modal to top layer
      modalEl.style.zIndex = "99999";

      // Remove any hidden classes
      modalEl.classList.remove("hidden");

      // Update content if callback provided
      if (typeof options.updateContent === "function") {
        options.updateContent(modalEl);
      }

      // Show using native dialog or fallback
      if (typeof modalEl.showModal === "function") {
        modalEl.showModal();
        modalEl.style.display = "flex"; // Ensure visibility
        this.activeModal = modalId;
        this._manageBodyScroll(false);
      } else {
        console.warn(
          `[ModalManager] .showModal() not available for ID='${modalId}', using fallback.`
        );
        modalEl.style.display = "flex";
        modalEl.setAttribute("open", "true");
        this.activeModal = modalId;
      }

      console.log(`[ModalManager] Successfully showed modal: ${modalName}`);
      return true;
    } catch (error) {
      console.error(`[ModalManager] Error showing modal ${modalName}:`, error);
      return false;
    }
  }

  /**
   * Hide a dialog by name
   * @param {string} modalName
   * @returns {boolean}
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
    if (typeof modalEl.close === "function") {
      modalEl.close();
    } else {
      modalEl.style.display = "none";
    }

    if (this.activeModal === modalId) {
      this.activeModal = null;
      this._manageBodyScroll(true);
    }
    return true;
  }

  /**
   * Show a generic confirmation dialog
   * @param {object} options
   */
  confirmAction(options) {
    const modalName = "confirm";
    const modalId = this.modalMappings[modalName];
    if (!modalId) {
      console.error("[ModalManager] Confirm modal ID not mapped.");
      return;
    }

    const modalEl = document.getElementById(modalId);
    if (!modalEl) {
      console.error("[ModalManager] Confirm modal element not found.");
      return;
    }

    // Update modal text
    const titleEl = modalEl.querySelector("h3");
    const messageEl = modalEl.querySelector("p");
    const confirmBtn = modalEl.querySelector("#confirmActionBtn");
    const cancelBtn = modalEl.querySelector("#cancelActionBtn");

    if (titleEl) titleEl.textContent = options.title || "Confirm?";
    if (messageEl) messageEl.textContent = options.message || "";
    if (confirmBtn) {
      confirmBtn.textContent = options.confirmText || "Confirm";
      confirmBtn.className = `btn ${options.confirmClass || "btn-primary"}`;
    }
    if (cancelBtn) {
      cancelBtn.textContent = options.cancelText || "Cancel";
    }

    // Remove old handlers by cloning
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    const confirmHandler = () => {
      this.hide(modalName);
      if (typeof options.onConfirm === "function") {
        options.onConfirm();
      }
    };
    const cancelHandler = () => {
      this.hide(modalName);
      if (typeof options.onCancel === "function") {
        options.onCancel();
      }
    };

    // Use trackListener or fallback
    if (window.eventHandlers?.trackListener) {
      window.eventHandlers.trackListener(newConfirmBtn, "click", confirmHandler, {
        description: "Confirm Modal Confirm Click",
      });
      window.eventHandlers.trackListener(newCancelBtn, "click", cancelHandler, {
        description: "Confirm Modal Cancel Click",
      });
    } else {
      newConfirmBtn.addEventListener("click", confirmHandler);
      newCancelBtn.addEventListener("click", cancelHandler);
    }

    // Show the modal
    this.show(modalName, {
      showDuringInitialization: options.showDuringInitialization,
    });
  }
}

/**
 * Provide an explicit init function to be called from app.js or similar:
 */
function initModalManager() {
  if (!modalManagerInstance) {
    modalManagerInstance = new ModalManager();
    window.modalManager = modalManagerInstance;

    // Register with DependencySystem immediately
    if (window.DependencySystem) {
      window.DependencySystem.register("modalManager", modalManagerInstance);
      console.log("[modalManager] Registered with DependencySystem");
    }
  }

  modalManagerInstance.init();
  return modalManagerInstance;
}

// Initialize immediately when script loads
window.modalManager = initModalManager();

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

    // Bind methods as needed
    this.openModal = this.openModal.bind(this);
    this.closeModal = this.closeModal.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  /**
   * Updated init() method and openModal() per the snippet
   */
  init() {
    console.log("[ProjectModal] Starting initialization...");

    // Update selectors to use new IDs
    this.modalElement = document.getElementById("projectModal");
    this.formElement = document.getElementById("projectModalForm");

    if (!this.modalElement || !this.formElement) {
      console.error("[ProjectModal] Required elements not found", {
        modal: !!this.modalElement,
        form: !!this.formElement
      });
      return;
    }

    this.setupEventListeners();
    console.log("[ProjectModal] Initialized successfully");
  }

  openModal(project = null) {
    if (!this.modalElement) {
      console.error("[ProjectModal] No modalElement found!");
      return;
    }

    // Reset form
    if (this.formElement) {
      this.formElement.reset();
    }

    const titleEl = this.modalElement.querySelector("#projectModalTitle");
    if (titleEl) {
      titleEl.textContent = project ? "Edit Project" : "Create Project";
    }

    if (project) {
      this.currentProjectId = project.id;
      this.modalElement.querySelector("#projectModalIdInput").value = project.id || "";
      this.modalElement.querySelector("#projectModalNameInput").value = project.name || "";
      this.modalElement.querySelector("#projectModalDescInput").value = project.description || "";
      this.modalElement.querySelector("#projectModalGoalsInput").value = project.goals || "";
      this.modalElement.querySelector("#projectModalMaxTokensInput").value = project.max_tokens || "";
    } else {
      this.currentProjectId = null;
      const idEl = this.modalElement.querySelector("#projectModalIdInput");
      if (idEl) idEl.value = "";
    }

    // Show the dialog
    if (typeof this.modalElement.showModal === "function") {
      this.modalElement.showModal();
    } else {
      this.modalElement.style.display = "flex";
    }
    this.isOpen = true;
  }

  /**
   * The rest of the methods stay mostly the same.
   * Make sure they reference the updated IDs as well (e.g., #projectModalForm).
   */
  setupEventListeners() {
    if (!this.formElement) return;

    // Submit listener
    const cb = async (e) => await this.handleSubmit(e);
    if (window.eventHandlers?.trackListener) {
      window.eventHandlers.trackListener(this.formElement, "submit", cb, {
        passive: false,
        description: "ProjectModal submit",
      });
    } else {
      this.formElement.addEventListener("submit", cb);
    }

    // Cancel button
    const cancelBtn = this.modalElement.querySelector("#projectCancelBtn");
    if (cancelBtn) {
      const cHandler = (e) => {
        e.preventDefault();
        this.closeModal();
      };
      if (window.eventHandlers?.trackListener) {
        window.eventHandlers.trackListener(cancelBtn, "click", cHandler, {
          description: "ProjectModal Cancel",
        });
      } else {
        cancelBtn.addEventListener("click", cHandler);
      }
    }

    // ESC key
    const escHandler = (e) => {
      if (e.key === "Escape" && this.isOpen) {
        this.closeModal();
      }
    };
    if (window.eventHandlers?.trackListener) {
      window.eventHandlers.trackListener(document, "keydown", escHandler, {
        description: "ProjectModal ESC handler",
      });
    } else {
      document.addEventListener("keydown", escHandler);
    }

    // Clicking on the backdrop for <dialog>
    const backdropHandler = (e) => {
      if (e.target === this.modalElement && this.isOpen) {
        this.closeModal();
      }
    };
    if (window.eventHandlers?.trackListener) {
      window.eventHandlers.trackListener(this.modalElement, "click", backdropHandler, {
        description: "ProjectModal backdrop click",
      });
    } else {
      this.modalElement.addEventListener("click", backdropHandler);
    }
  }

  closeModal() {
    if (!this.modalElement) return;

    if (typeof this.modalElement.close === "function") {
      this.modalElement.close();
    } else {
      this.modalElement.style.display = "none";
    }
    this.isOpen = false;
    this.currentProjectId = null;
  }

  async handleSubmit(e) {
    e.preventDefault();
    if (!this.formElement) {
      console.error("[ProjectModal] No formElement found!");
      return;
    }

    try {
      const formData = new FormData(this.formElement);
      const projectData = {
        name: formData.get("name") || "",
        description: formData.get("description") || "",
        goals: formData.get("goals") || "",
        max_tokens: formData.get("maxTokens") || null,
      };
      const projectId = formData.get("projectId");

      if (!projectData.name.trim()) {
        this.showError("Project name is required");
        return;
      }

      this.setLoading(true);
      await this.saveProject(projectId, projectData);

      this.closeModal();
      this.showSuccess(projectId ? "Project updated" : "Project created");
    } catch (error) {
      console.error("[ProjectModal] Save error:", error);
      this.showError("Failed to save project");
    } finally {
      this.setLoading(false);
    }
  }

  async saveProject(projectId, projectData) {
    if (!window.projectManager) {
      throw new Error("[ProjectModal] projectManager not available");
    }
    // Use createOrUpdateProject which handles both create and update
    await window.projectManager.createOrUpdateProject(projectId, projectData);
  }

  setLoading(isLoading) {
    const saveBtn = this.modalElement.querySelector("#projectSaveBtn");
    const cancelBtn = this.modalElement.querySelector("#projectCancelBtn");
    if (saveBtn) {
      saveBtn.disabled = isLoading;
      saveBtn.classList.toggle("loading", isLoading);
    }
    if (cancelBtn) {
      cancelBtn.disabled = isLoading;
    }
  }

  showError(message) {
    if (window.showNotification) {
      window.showNotification(message, "error");
    } else {
      alert(message);
    }
  }

  showSuccess(message) {
    if (window.showNotification) {
      window.showNotification(message, "success");
    } else {
      console.log(message);
    }
  }
}

// Provide a global instance for the ProjectModal, or create on demand
if (!window.projectModal) {
  window.projectModal = new ProjectModal();
  console.log("[modalManager.js] Global projectModal instance created.");
}

// --- Ensure ProjectModal is initialized after modals.html is loaded ---
document.addEventListener("modalsLoaded", () => {
  if (window.projectModal && typeof window.projectModal.init === "function") {
    window.projectModal.init();
    console.log("[modalManager.js] projectModal.init() called after modalsLoaded");
  }
});
