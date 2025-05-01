/**
 * @fileoverview
 * Manages all application modals and their interactions (showing, hiding, etc.).
 * Provides a flexible design for registering event handlers and customizing each modal’s content.
 *
 * NOTE: This refactored version removes implicit global instances and offers
 * factory functions instead. You can create instances in app.js (or elsewhere)
 * and register them with window.DependencySystem.register('modalManager', modalManagerInstance)
 * to ensure they’re discoverable by the rest of the application.
 *
 * Also includes a 'destroy()' method for untracking events in an SPA scenario.
 */

import { MODAL_MAPPINGS } from './modalConstants.js';

/**
 * @class ModalManager
 * Provides methods to show/hide mapped modals, handle scroll lock,
 * and artificially manage native <dialog> elements (fallback for older browsers).
 */
class ModalManager {
  /**
   * @constructor
   * @param {Object} opts - Dependency injection object.
   * @param {object} [opts.eventHandlers] - For managed event binding (optional).
   * @param {object} [opts.DependencySystem] - For dynamic injection (optional).
   * @param {object} [opts.modalMapping] - Overwrites the default modal mapping if provided.
   */
  constructor({ eventHandlers, DependencySystem, modalMapping } = {}) {
    this.DependencySystem =
      DependencySystem ||
      (typeof window !== 'undefined' ? window.DependencySystem : undefined);

    this.eventHandlers =
      eventHandlers ||
      this.DependencySystem?.modules?.get?.('eventHandlers') ||
      undefined;

    // Use injected mapping, DI, or fallback to the imported constant
    this.modalMappings =
      modalMapping ||
      this.DependencySystem?.modules?.get?.('modalMapping') ||
      MODAL_MAPPINGS;

    /** @type {string|null} Currently active modal ID */
    this.activeModal = null;

    /** @type {number|undefined} Scroll position for body scroll lock */
    this._scrollLockY = undefined;

    /**
     * Track all event registrations for a potential destroy() call.
     * Each entry is { element, type, description } so we can remove them later.
     */
    this._trackedEvents = [];
  }

  /**
   * Returns true if the app is in debug mode based on DI or environment.
   * @private
   */
  _isDebug() {
    const app = this.DependencySystem?.modules?.get?.('app');
    return !!app?.config?.debug;
  }

  // --- DRY Modal Show/Hide helpers ---
  _showModalElement(modalEl) {
    if (typeof modalEl.showModal === 'function') {
      modalEl.showModal();
      this._manageBodyScroll(false);
    } else {
      modalEl.classList.remove('hidden');
      modalEl.style.display = 'flex';
      modalEl.setAttribute('open', 'true');
      this._manageBodyScroll(false);
    }
  }

  _hideModalElement(modalEl) {
    if (typeof modalEl.close === 'function') {
      modalEl.close();
    } else {
      modalEl.classList.add('hidden');
      modalEl.style.display = 'none';
      modalEl.removeAttribute('open');
    }
    this._manageBodyScroll(true);
  }

  /**
   * @method init
   * Initialize and attach 'close' listeners to dialogs. Orchestrator must call after DOM ready.
   * Also validates modal mappings for missing/duplicate IDs.
   */
  init() {
    if (this._isDebug()) {
      console.log('[ModalManager] init() called. Setting up modals...');
    }

    this.validateModalMappings(this.modalMappings);

    Object.values(this.modalMappings).forEach((modalId) => {
      const modalEl = document.getElementById(modalId);
      if (modalEl) {
        const handler = () => this._onDialogClose(modalId);
        if (this.eventHandlers?.trackListener) {
          const wrappedHandler = this.eventHandlers.trackListener(
            modalEl,
            'close',
            handler,
            { description: `Close event for ${modalId}` }
          );
          if (wrappedHandler) {
            this._trackedEvents.push({
              element: modalEl,
              type: 'close',
              description: `Close event for ${modalId}`,
            });
          }
        } else {
          modalEl.addEventListener('close', handler);
          // We can't untrack these if there's no eventHandlers, unless we store references manually
        }
      }
    });

    if (this._isDebug()) {
      console.log('[ModalManager] Initialization complete.');
    }
  }

  /**
   * @method destroy
   * Cleans up tracked event listeners, removing them via eventHandlers.
   * Call before unmounting or re-initializing in an SPA.
   */
  destroy() {
    if (!this.eventHandlers?.cleanupListeners) {
      if (this._isDebug()) {
        console.warn('[ModalManager] destroy() called but no eventHandlers.cleanupListeners available.');
      }
      return;
    }
    // Remove every tracked event:
    this._trackedEvents.forEach((evt) => {
      this.eventHandlers.cleanupListeners(evt.element, evt.type, evt.description);
    });
    this._trackedEvents = [];

    if (this._isDebug()) {
      console.log('[ModalManager] destroyed: all tracked listeners removed.');
    }
  }

  /**
   * @method validateModalMappings
   * Check for missing or duplicate modal IDs in the DOM.
   * @param {Object} modalMapping
   */
  validateModalMappings(modalMapping) {
    Object.entries(modalMapping).forEach(([key, modalId]) => {
      const elements = document.querySelectorAll(`#${modalId}`);
      if (elements.length === 0) {
        console.error(`ModalManager: No element found for ${key} with ID "${modalId}"`);
      } else if (elements.length > 1) {
        console.error(`ModalManager: Duplicate elements found for ${key} with ID "${modalId}"`);
      }
    });
  }

  /**
   * Internal utility to handle a dialog's 'close' event.
   * @private
   */
  _onDialogClose(modalId) {
    if (this.activeModal === modalId) {
      if (this._isDebug()) {
        console.log(`[ModalManager] Dialog ${modalId} closed (native event).`);
      }
      this.activeModal = null;
      document.body.style.overflow = '';
    }
  }

  /**
   * @method _manageBodyScroll
   * Robust scroll lock: Disables background scroll for all devices (including iOS).
   * Uses position: fixed trick and restores scroll position on unlock.
   * @param {boolean} enableScroll - True to enable scroll, false to lock it.
   * @private
   */
  _manageBodyScroll(enableScroll) {
    if (!enableScroll) {
      // Lock scrolling (modal open)
      if (typeof window !== 'undefined' && window.scrollY !== undefined) {
        this._scrollLockY = window.scrollY;
        document.body.style.position = 'fixed';
        document.body.style.top = `-${this._scrollLockY}px`;
        document.body.style.width = '100vw';
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = 'hidden';
      }
      document.documentElement.style.overflow = 'hidden';
    } else {
      // Unlock scrolling (modal close)
      if (typeof window !== 'undefined' && this._scrollLockY !== undefined) {
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
        window.scrollTo(0, this._scrollLockY);
        this._scrollLockY = undefined;
      } else {
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
      }
    }
  }

  /**
   * @method show
   * Show a dialog by its logical name (from modalMappings).
   * @param {string} modalName - The key from modalMappings to show.
   * @param {object} [options] - Optional parameters (e.g. updateContent callback).
   * @returns {boolean} True if successfully shown, false otherwise.
   */
  show(modalName, options = {}) {
    // Optionally skip if the app is still initializing
    if (typeof window !== 'undefined' && window.__appInitializing && !options.showDuringInitialization) {
      if (this._isDebug()) {
        console.log(`[ModalManager] Skipping modal '${modalName}' during app init`);
      }
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
      modalEl.classList.remove('hidden');

      // Update content if provided
      if (typeof options.updateContent === 'function') {
        options.updateContent(modalEl);
      }

      this._showModalElement(modalEl);
      this.activeModal = modalId;

      if (this._isDebug()) {
        console.log(`[ModalManager] Successfully showed modal: ${modalName}`);
      }
      return true;
    } catch (error) {
      console.error(`[ModalManager] Error showing modal ${modalName}:`, error);
      return false;
    }
  }

  /**
   * @method hide
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

    if (this._isDebug()) {
      console.log(`[ModalManager] Hiding modal '${modalName}' (#${modalId})`);
    }
    this._hideModalElement(modalEl);

    if (this.activeModal === modalId) {
      this.activeModal = null;
    }
    return true;
  }

  /**
   * @method confirmAction
   * Show a generic confirmation dialog with dynamic title/message/buttons.
   * Useful for "Are you sure?" actions throughout the app.
   * @param {object} options - Configuration for the confirm dialog.
   *   @param {string} [options.title] - Title text
   *   @param {string} [options.message] - Body text
   *   @param {string} [options.confirmText] - Confirm button text
   *   @param {string} [options.cancelText] - Cancel button text
   *   @param {string} [options.confirmClass] - Additional styling for confirm button
   *   @param {Function} [options.onConfirm] - Callback for confirm
   *   @param {Function} [options.onCancel] - Callback for cancel
   *   @param {boolean} [options.showDuringInitialization] - Show even if app is in init phase
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

    // Retrieve key elements for updating text, buttons, etc.
    const titleEl = modalEl.querySelector('h3');
    const messageEl = modalEl.querySelector('p');
    const confirmBtn = modalEl.querySelector('#confirmActionBtn');
    const cancelBtn = modalEl.querySelector('#cancelActionBtn');

    // Set provided text or fallback values
    if (titleEl) titleEl.textContent = options.title || 'Confirm?';
    if (messageEl) messageEl.textContent = options.message || '';
    if (confirmBtn) {
      confirmBtn.textContent = options.confirmText || 'Confirm';
      confirmBtn.className = `btn ${options.confirmClass || 'btn-primary'}`;
    }
    if (cancelBtn) {
      cancelBtn.textContent = options.cancelText || 'Cancel';
    }

    // To avoid leftover event handlers, we replace the buttons with clones
    function replaceWithClone(btn) {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      return newBtn;
    }
    const newConfirmBtn = confirmBtn ? replaceWithClone(confirmBtn) : null;
    const newCancelBtn = cancelBtn ? replaceWithClone(cancelBtn) : null;

    // Handlers for Confirm/Cancel
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

    // Attach handlers with eventHandlers->trackListener if available, otherwise fallback
    if (this.eventHandlers?.trackListener) {
      if (newConfirmBtn) {
        this.eventHandlers.trackListener(newConfirmBtn, 'click', confirmHandler, {
          description: 'Confirm Modal Confirm Click',
        });
      }
      if (newCancelBtn) {
        this.eventHandlers.trackListener(newCancelBtn, 'click', cancelHandler, {
          description: 'Confirm Modal Cancel Click',
        });
      }
    } else {
      newConfirmBtn?.addEventListener('click', confirmHandler);
      newCancelBtn?.addEventListener('click', cancelHandler);
    }

    // Finally, show the modal
    this.show(modalName, {
      showDuringInitialization: options.showDuringInitialization,
    });
  }
}

/**
 * A factory function to create a new ModalManager instance.
 * The init() method must be called separately after the modal DOM is ready.
 * @returns {ModalManager} A new ModalManager instance.
 */
export function createModalManager({ eventHandlers, DependencySystem, modalMapping } = {}) {
  return new ModalManager({ eventHandlers, DependencySystem, modalMapping });
}

/**
 * -------------------------------------------------------------------------
 * ProjectModal (Dedicated to creating/editing a single project)
 * -------------------------------------------------------------------------
 */

/**
 * @class ProjectModal
 * A dedicated class for handling the project creation/editing modal.
 */
class ProjectModal {
  /**
   * @constructor
   * @param {Object} opts
   *   @param {Object} [opts.projectManager] - Project manager instance.
   *   @param {Object} [opts.eventHandlers] - Event handler utilities.
   *   @param {Function} [opts.showNotification] - Notification function.
   *   @param {Object} [opts.DependencySystem] - For dynamic injection (optional).
   */
  constructor({ projectManager, eventHandlers, showNotification, DependencySystem } = {}) {
    this.DependencySystem =
      DependencySystem ||
      (typeof window !== 'undefined' ? window.DependencySystem : undefined);

    this.eventHandlers =
      eventHandlers ||
      this.DependencySystem?.modules?.get?.('eventHandlers') ||
      undefined;
    this.projectManager =
      projectManager ||
      this.DependencySystem?.modules?.get?.('projectManager') ||
      undefined;
    this.showNotification =
      showNotification ||
      this.DependencySystem?.modules?.get?.('app')?.showNotification ||
      undefined;

    this.modalElement = null;
    this.formElement = null;
    this.isOpen = false;
    this.currentProjectId = null;

    // Track events if destruction may be needed
    this._trackedEvents = [];
  }

  /**
   * @private
   * Check if app debug mode is on, if the app is available via DI.
   */
  _isDebug() {
    const app = this.DependencySystem?.modules?.get?.('app');
    return !!app?.config?.debug;
  }

  // --- DRY Modal Show/Hide helpers ---
  _showModalElement() {
    if (typeof this.modalElement.showModal === 'function') {
      this.modalElement.showModal();
    } else {
      this.modalElement.classList.remove('hidden');
      this.modalElement.style.display = 'flex';
      this.modalElement.setAttribute('open', 'true');
    }
  }

  _hideModalElement() {
    if (typeof this.modalElement.close === 'function') {
      this.modalElement.close();
    } else {
      this.modalElement.classList.add('hidden');
      this.modalElement.style.display = 'none';
      this.modalElement.removeAttribute('open');
    }
  }

  /**
   * Provide unified user notification approach (errors, success, etc.).
   * @private
   */
  _notify(type, message) {
    if (this.showNotification) {
      this.showNotification(message, type);
    } else {
      if (type === 'error') alert(message);
      else if (this._isDebug()) console.log(message);
    }
  }

  /**
   * Indicate loading/spinner on buttons to prevent double-submits.
   * @private
   * @param {HTMLElement} btn
   * @param {boolean} isLoading
   * @param {string} [loadingText="Saving..."]
   */
  _setButtonLoading(btn, isLoading, loadingText = 'Saving...') {
    if (!btn) return;
    if (isLoading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      btn.innerHTML = `<span class="loading loading-spinner loading-xs"></span> ${loadingText}`;
    } else {
      btn.disabled = false;
      if (btn.dataset.originalText) {
        btn.textContent = btn.dataset.originalText;
        delete btn.dataset.originalText;
      }
    }
  }

  /**
   * Initialize after DOM is ready. Throws if modal/form elements not found.
   * Typically called from the orchestrator (e.g. app.js).
   */
  init() {
    this.modalElement = document.getElementById('projectModal');
    this.formElement = document.getElementById('projectModalForm');
    if (!this.modalElement || !this.formElement) {
      throw new Error('[ProjectModal] Required DOM elements not found on init.');
    }
    this.setupEventListeners();

    if (this._isDebug()) {
      console.log('[ProjectModal] Initialized successfully');
    }
  }

  /**
   * Provide a cleanup method to remove event listeners in an SPA scenario.
   */
  destroy() {
    if (!this.eventHandlers?.cleanupListeners) {
      if (this._isDebug()) {
        console.warn('[ProjectModal] destroy() called but eventHandlers.cleanupListeners is unavailable.');
      }
      return;
    }
    this._trackedEvents.forEach((evt) => {
      this.eventHandlers.cleanupListeners(evt.element, evt.type, evt.description);
    });
    this._trackedEvents = [];
    if (this._isDebug()) {
      console.log('[ProjectModal] destroyed: all tracked listeners removed.');
    }
  }

  /**
   * Open the project modal (for creating or editing).
   * @param {object|null} project - If null, we create a new project. Otherwise, we edit the existing one.
   */
  openModal(project = null) {
    if (!this.modalElement) {
      console.error('[ProjectModal] No modalElement found!');
      return;
    }

    // Reset form each time
    if (this.formElement) {
      this.formElement.reset();
    }

    // Update title
    const titleEl = this.modalElement.querySelector('#projectModalTitle');
    if (titleEl) {
      titleEl.textContent = project ? 'Edit Project' : 'Create Project';
    }

    // If editing an existing project, populate form fields
    if (project) {
      this.currentProjectId = project.id;
      const idInput = this.modalElement.querySelector('#projectModalIdInput');
      const nameInput = this.modalElement.querySelector('#projectModalNameInput');
      const descInput = this.modalElement.querySelector('#projectModalDescInput');
      const goalsInput = this.modalElement.querySelector('#projectModalGoalsInput');
      const maxTokensInput = this.modalElement.querySelector('#projectModalMaxTokensInput');

      if (idInput) idInput.value = project.id || '';
      if (nameInput) nameInput.value = project.name || '';
      if (descInput) descInput.value = project.description || '';
      if (goalsInput) goalsInput.value = project.goals || '';
      if (maxTokensInput) maxTokensInput.value = project.max_tokens || '';
    } else {
      this.currentProjectId = null;
      const idEl = this.modalElement.querySelector('#projectModalIdInput');
      if (idEl) idEl.value = '';
    }

    // Show the dialog (native or fallback)
    this._showModalElement();
    this.isOpen = true;
  }

  /**
   * Attach all needed DOM event listeners for form submission, cancel, ESC key, etc.
   * This is called once in init().
   */
  setupEventListeners() {
    if (!this.formElement) return;

    const submitHandler = async (e) => { await this.handleSubmit(e); };
    this._bindEvent(this.formElement, 'submit', submitHandler, 'ProjectModal submit', { passive: false });

    const cancelBtn = this.modalElement.querySelector('#projectCancelBtn');
    if (cancelBtn) {
      const cancelHandler = (e) => {
        e.preventDefault();
        this.closeModal();
      };
      this._bindEvent(cancelBtn, 'click', cancelHandler, 'ProjectModal Cancel');
    }

    const escHandler = (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.closeModal();
      }
    };
    this._bindEvent(document, 'keydown', escHandler, 'ProjectModal ESC handler');

    const backdropHandler = (e) => {
      if (e.target === this.modalElement && this.isOpen) {
        this.closeModal();
      }
    };
    this._bindEvent(this.modalElement, 'click', backdropHandler, 'ProjectModal backdrop click');
  }

  /**
   * Close the modal dialog if open.
   */
  closeModal() {
    if (!this.modalElement) return;
    this._hideModalElement();
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
      console.error('[ProjectModal] No formElement found!');
      return;
    }

    try {
      const formData = new FormData(this.formElement);
      const projectData = {
        name: formData.get('name') || '',
        description: formData.get('description') || '',
        goals: formData.get('goals') || '',
        max_tokens: formData.get('maxTokens') || null,
      };
      const projectId = formData.get('projectId');

      if (!projectData.name.trim()) {
        this._notify('error', 'Project name is required');
        return;
      }

      const saveBtn = this.modalElement.querySelector('#projectSaveBtn');
      this._setButtonLoading(saveBtn, true);

      await this.saveProject(projectId, projectData);

      this.closeModal();
      this._notify('success', projectId ? 'Project updated' : 'Project created');
    } catch (error) {
      console.error('[ProjectModal] Save error:', error);
      this._notify('error', 'Failed to save project');
    } finally {
      const saveBtn = this.modalElement.querySelector('#projectSaveBtn');
      this._setButtonLoading(saveBtn, false);
    }
  }

  /**
   * Save a project via projectManager. If projectId is provided, updates; otherwise creates new.
   * @param {string|null} projectId - If provided, updates an existing project.
   * @param {object} projectData - The data to create or update.
   * @throws If no projectManager is available or the save operation fails.
   */
  async saveProject(projectId, projectData) {
    if (!this.projectManager) {
      throw new Error('[ProjectModal] projectManager not available (not injected)');
    }
    await this.projectManager.createOrUpdateProject(projectId, projectData);
  }

  /**
   * Indicate loading/spinner on buttons to prevent double-submits.
   * @param {boolean} isLoading - True to disable and set spinner, false to restore.
   */
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

  /**
   * Helper for binding an event. Uses eventHandlers if available, else fallback to addEventListener.
   * @private
   * @param {HTMLElement|Document} element - The element to bind.
   * @param {string} type - The event type.
   * @param {Function} handler - The event callback.
   * @param {string} description - A short description for debugging.
   * @param {object} [options] - Additional event options (capture, passive, etc.).
   */
  _bindEvent(element, type, handler, description, options = {}) {
    if (this.eventHandlers?.trackListener) {
      const wrapped = this.eventHandlers.trackListener(element, type, handler, {
        description,
        ...options,
      });
      if (wrapped) {
        this._trackedEvents.push({ element, type, description });
      }
    } else {
      element.addEventListener(type, handler, options);
      // No trackedEvents unbinding if no eventHandlers.
      // For a robust fallback, you'd store references and removeEventListener in destroy().
    }
  }
}

/**
 * A factory function to create the ProjectModal without attaching it to a global.
 * This allows app.js (or another orchestrator) to decide when to initialize/destroy.
 * @returns {ProjectModal} A new ProjectModal instance.
 */
export function createProjectModal({ projectManager, eventHandlers, showNotification, DependencySystem } = {}) {
  return new ProjectModal({ projectManager, eventHandlers, showNotification, DependencySystem });
}
