/**
 * @fileoverview
 * Manages all application modals and their interactions (showing, hiding, etc.).
 * Provides a flexible design for registering event handlers and customizing each modal’s content.
 *
 * NOTE: This refactored version removes implicit global instances and offers
 * factory functions instead. You can create instances in app.js (or elsewhere)
 * and register them with window.DependencySystem.register('modalManager', modalManagerInstance)
 * to ensure they’re discoverable by the rest of the application.
 */

/**
 * Dependencies (injected externally, e.g. via DependencySystem):
 *  - window.eventHandlers.trackListener (optional) for managed event listening.
 *  - window.projectManager (optional) for handling project operations.
 *  - window.showNotification (optional) for user notifications.
 *  - FormData (built-in) for form handling.
 *  - document (built-in) for DOM queries and events.
 */

class ModalManager {
  /**
   * @constructor
   * @param {Object} opts - Dependency injection object.
   *   @param {object} [opts.eventHandlers] - For managed event binding.
   *   @param {object} [opts.DependencySystem] - Optional for DI.
   */
  constructor({ eventHandlers, DependencySystem } = {}) {
    this.DependencySystem =
      DependencySystem ||
      (typeof window !== "undefined" ? window.DependencySystem : undefined);
    this.eventHandlers =
      eventHandlers ||
      (this.DependencySystem?.modules?.get?.("eventHandlers")) ||
      undefined;

    this.modalMappings = {
      project: "projectModal",
      delete: "deleteConfirmModal",
      confirm: "confirmActionModal",
      knowledge: "knowledgeBaseSettingsModal",
      knowledgeResult: "knowledgeResultModal",
      instructions: "instructionsModal",
      contentView: "contentViewModal",
      login: "loginModal", // Added login modal mapping
    };

    this.activeModal = null;
  }

  /**
   * Initialize and attach 'close' listeners to dialogs. Orchestrator must call after DOM ready.
   */
  init() {
    console.log("[ModalManager] init() called. Setting up modals...");

    Object.values(this.modalMappings).forEach((modalId) => {
      const modalEl = document.getElementById(modalId);
      if (modalEl) {
        if (this.eventHandlers?.trackListener) {
          this.eventHandlers.trackListener(
            modalEl,
            "close",
            () => this._onDialogClose(modalId),
            { description: `Close event for ${modalId}` }
          );
        } else {
          modalEl.addEventListener("close", () => this._onDialogClose(modalId));
        }
      }
    });

    console.log("[ModalManager] Initialization complete.");
  }

  /**
   * Internal utility to handle a dialog's 'close' event.
   * @private
   */
  _onDialogClose(modalId) {
    if (this.activeModal === modalId) {
      console.log(`[ModalManager] Dialog ${modalId} closed (native event).`);
      this.activeModal = null;
      document.body.style.overflow = "";
    }
  }

  /**
   * An internal utility to toggle body scroll on/off while a modal is visible.
   * @param {boolean} enableScroll - True to enable scroll, false to disable it.
   * @private
   */
  _manageBodyScroll(enableScroll) {
    document.body.style.overflow = enableScroll ? "" : "hidden";
    document.documentElement.style.overflow = enableScroll ? "" : "hidden";
  }

  /**
   * Show a dialog by its logical name (from modalMappings).
   * @param {string} modalName - The key from modalMappings to show.
   * @param {object} [options] - Optional parameters (e.g. updateContent callback).
   * @returns {boolean} True if successfully shown, false otherwise.
   */
  show(modalName, options = {}) {
    // Optionally skip if the app is still initializing
    if (window.__appInitializing && !options.showDuringInitialization) {
      console.log(`[ModalManager] Skipping modal '${modalName}' during app init`);
      return false;
    }

    const modalId = this.modalMappings[modalName];
    if (!modalId) {
      console.error(`[ModalManager] Modal mapping missing for: ${modalName}`);
      return false;
    }

    const modalEl = document.getElementById(modalId);
    if (!modalEl) {
      console.error(`[ModalManager] Modal element missing: ${modalId}`);
      return false;
    }

    try {
      // Make sure the modal isn't hidden at the CSS level
      modalEl.classList.remove("hidden");

      // Update content if provided
      if (typeof options.updateContent === "function") {
        options.updateContent(modalEl);
      }

      // Attempt to show as a native <dialog>
      if (typeof modalEl.showModal === "function") {
        modalEl.showModal();
        this.activeModal = modalId;
        this._manageBodyScroll(false);
      } else {
        // Fallback if <dialog>.showModal() isn’t available
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
   * Hide a dialog by its logical name.
   * @param {string} modalName - The key from modalMappings to hide.
   * @returns {boolean} True if hidden successfully, false otherwise.
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
   * Show a generic confirmation dialog with dynamic title/message/buttons.
   * Useful for "Are you sure?" actions throughout the app.
   * @param {object} options - Configuration for the confirm dialog.
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

    // Retrieve key elements for updating text, buttons, etc.
    const titleEl = modalEl.querySelector("h3");
    const messageEl = modalEl.querySelector("p");
    const confirmBtn = modalEl.querySelector("#confirmActionBtn");
    const cancelBtn = modalEl.querySelector("#cancelActionBtn");

    // Set provided text or fallback values
    if (titleEl) titleEl.textContent = options.title || "Confirm?";
    if (messageEl) messageEl.textContent = options.message || "";
    if (confirmBtn) {
      confirmBtn.textContent = options.confirmText || "Confirm";
      confirmBtn.className = `btn ${options.confirmClass || "btn-primary"}`;
    }
    if (cancelBtn) {
      cancelBtn.textContent = options.cancelText || "Cancel";
    }

    // To avoid leftover event handlers, we replace the buttons with clones
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    // Handlers for Confirm/Cancel
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

    // Attach handlers with eventHandlers->trackListener if available, otherwise fallback
    if (this.eventHandlers?.trackListener) {
      this.eventHandlers.trackListener(newConfirmBtn, "click", confirmHandler, {
        description: "Confirm Modal Confirm Click"
      });
      this.eventHandlers.trackListener(newCancelBtn, "click", cancelHandler, {
        description: "Confirm Modal Cancel Click"
      });
    } else {
      newConfirmBtn.addEventListener("click", confirmHandler);
      newCancelBtn.addEventListener("click", cancelHandler);
    }

    // Finally, show the modal
    this.show(modalName, {
      showDuringInitialization: options.showDuringInitialization,
    });
  }
}

/**
 * A factory function to create and initialize a new ModalManager instance.
 * Exports are used so app.js can decide when and how to instantiate and register.
 * @returns {ModalManager} A fully initialized ModalManager instance.
 */
export function createModalManager() {
  const manager = new ModalManager();
  manager.init();
  return manager;
}

/**
 * -------------------------------------------------------------------------
 * ProjectModal (Dedicated to creating/editing a single project)
 * -------------------------------------------------------------------------
 */

class ProjectModal {
  /**
   * @constructor
   * @param {Object} opts
   *   @param {Object} [opts.projectManager] - Project manager instance.
   *   @param {Object} [opts.eventHandlers] - Event handler utilities.
   *   @param {Function} [opts.showNotification] - Notification function.
   *   @param {Object} [opts.DependencySystem] - Optional for DI.
   */
  constructor({ projectManager, eventHandlers, showNotification, DependencySystem } = {}) {
    this.DependencySystem =
      DependencySystem ||
      (typeof window !== "undefined" ? window.DependencySystem : undefined);

    this.eventHandlers =
      eventHandlers ||
      (this.DependencySystem?.modules?.get?.("eventHandlers")) ||
      undefined;
    this.projectManager =
      projectManager ||
      (this.DependencySystem?.modules?.get?.("projectManager")) ||
      undefined;
    this.showNotification =
      showNotification ||
      (this.DependencySystem?.modules?.get?.("app")?.showNotification) ||
      undefined;

    this.modalElement = null;
    this.formElement = null;
    this.isOpen = false;
    this.currentProjectId = null;
  }

  /**
   * Initialize after DOM is ready. Throws if modal/form elements not found.
   */
  init() {
    this.modalElement = document.getElementById("projectModal");
    this.formElement = document.getElementById("projectModalForm");
    if (!this.modalElement || !this.formElement) {
      throw new Error("[ProjectModal] Required DOM elements not found on init.");
    }
    this.setupEventListeners();
    console.log("[ProjectModal] Initialized successfully");
  }

  /**
   * Open the project modal (create or edit).
   * @param {object|null} project - If null, we create a new project. Otherwise, we edit the existing one.
   */
  openModal(project = null) {
    if (!this.modalElement) {
      console.error("[ProjectModal] No modalElement found!");
      return;
    }

    // Reset form each time
    if (this.formElement) {
      this.formElement.reset();
    }

    // Update title
    const titleEl = this.modalElement.querySelector("#projectModalTitle");
    if (titleEl) {
      titleEl.textContent = project ? "Edit Project" : "Create Project";
    }

    // If editing an existing project, populate form fields
    if (project) {
      this.currentProjectId = project.id;
      const idInput = this.modalElement.querySelector("#projectModalIdInput");
      const nameInput = this.modalElement.querySelector("#projectModalNameInput");
      const descInput = this.modalElement.querySelector("#projectModalDescInput");
      const goalsInput = this.modalElement.querySelector("#projectModalGoalsInput");
      const maxTokensInput = this.modalElement.querySelector("#projectModalMaxTokensInput");

      if (idInput) idInput.value = project.id || "";
      if (nameInput) nameInput.value = project.name || "";
      if (descInput) descInput.value = project.description || "";
      if (goalsInput) goalsInput.value = project.goals || "";
      if (maxTokensInput) maxTokensInput.value = project.max_tokens || "";
    } else {
      this.currentProjectId = null;
      const idEl = this.modalElement.querySelector("#projectModalIdInput");
      if (idEl) idEl.value = "";
    }

    // Show the dialog (native or fallback)
    if (typeof this.modalElement.showModal === "function") {
      this.modalElement.showModal();
    } else {
      this.modalElement.style.display = "flex";
    }
    this.isOpen = true;
  }

  /**
   * Attach all needed event listeners: form submission, cancel, ESC key, backdrop clicks, etc.
   * This should be called once, typically in init().
   */
  setupEventListeners() {
    if (!this.formElement) return;

    // Submission
    const submitHandler = async (e) => await this.handleSubmit(e);
    if (this.eventHandlers?.trackListener) {
      this.eventHandlers.trackListener(this.formElement, "submit", submitHandler, {
        passive: false,
        description: "ProjectModal submit"
      });
    } else {
      this.formElement.addEventListener("submit", submitHandler);
    }

    const cancelBtn = this.modalElement.querySelector("#projectCancelBtn");
    if (cancelBtn) {
      const cancelHandler = (e) => {
        e.preventDefault();
        this.closeModal();
      };
      if (this.eventHandlers?.trackListener) {
        this.eventHandlers.trackListener(cancelBtn, "click", cancelHandler, {
          description: "ProjectModal Cancel"
        });
      } else {
        cancelBtn.addEventListener("click", cancelHandler);
      }
    }

    const escHandler = (e) => {
      if (e.key === "Escape" && this.isOpen) {
        this.closeModal();
      }
    };
    if (this.eventHandlers?.trackListener) {
      this.eventHandlers.trackListener(document, "keydown", escHandler, {
        description: "ProjectModal ESC handler"
      });
    } else {
      document.addEventListener("keydown", escHandler);
    }

    const backdropHandler = (e) => {
      if (e.target === this.modalElement && this.isOpen) {
        this.closeModal();
      }
    };
    if (this.eventHandlers?.trackListener) {
      this.eventHandlers.trackListener(this.modalElement, "click", backdropHandler, {
        description: "ProjectModal backdrop click"
      });
    } else {
      this.modalElement.addEventListener("click", backdropHandler);
    }
  }

  /**
   * Closes the modal dialog if open.
   */
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

  /**
   * Handle the form submission, which either creates or updates a project.
   * @param {Event} e - Form submit event.
   */
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

  /**
   * Save a project via a projectManager. If projectId is provided, updates; otherwise creates.
   * @param {string|null} projectId - If provided, updates an existing project.
   * @param {object} projectData - The data to create or update.
   * @throws If no projectManager is available or the save operation fails.
   */
  async saveProject(projectId, projectData) {
    if (!this.projectManager) {
      throw new Error("[ProjectModal] projectManager not available (not injected)");
    }
    await this.projectManager.createOrUpdateProject(projectId, projectData);
  }

  /**
   * Visually indicate loading/spinner on buttons to prevent double-submits.
   * @param {boolean} isLoading - True to disable and set spinner, false to restore.
   */
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

  /**
   * Utility to show an error message. Prefers showNotification for user feedback.
   * @param {string} message - The error text.
   */
  showError(message) {
    if (this.showNotification) {
      this.showNotification(message, "error");
    } else {
      alert(message);
    }
  }

  showSuccess(message) {
    if (this.showNotification) {
      this.showNotification(message, "success");
    } else {
      console.log(message);
    }
  }
}

/**
 * A factory function to create the ProjectModal without attaching it to a global.
 * This allows app.js (or another orchestrator) to decide when to initialize.
 * @returns {ProjectModal} A new ProjectModal instance.
 */
export function createProjectModal({ projectManager, eventHandlers, showNotification, DependencySystem } = {}) {
  return new ProjectModal({ projectManager, eventHandlers, showNotification, DependencySystem });
}
