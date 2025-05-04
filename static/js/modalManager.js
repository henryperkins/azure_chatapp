import { MODAL_MAPPINGS } from './modalConstants.js';

/**
 * @fileoverview
 * Manages all application modals and their interactions (showing, hiding, etc.).
 * Provides a flexible design for registering event handlers and customizing each modal’s content.
 *
 * Modules:
 *  - eventHandlers: for tracked event binding/unbinding
 *  - showNotification: function to display notifications (error, info, warning, etc.)
 *  - app: optional object with an 'isInitializing' boolean to indicate if the app is still in init phase
 *  - domPurify: optional sanitize function for innerHTML usage
 *
 * Exports:
 *  - createModalManager({ eventHandlers, DependencySystem, modalMapping })
 *  - createProjectModal({ projectManager, eventHandlers, showNotification, DependencySystem })
 */

/**
 * A small utility to get the primary scrolling element (consistent across browsers).
 * @returns {HTMLElement} The scrolling element or fallback.
 */
function getScrollingElement() {
  return (
    document.scrollingElement ||
    document.documentElement ||
    document.body
  );
}

/**
 * @class ModalManager
 * Provides methods to show/hide mapped modals, handle scroll lock,
 * manages <dialog> elements (or fallback), and tracks event cleanup.
 */
class ModalManager {
  /**
   * @constructor
   * @param {Object} opts - Dependencies config object.
   * @param {Object} [opts.eventHandlers] - For managed event binding (trackListener, cleanupListeners).
   * @param {Object} [opts.DependencySystem] - For dynamic injection (app, showNotification, etc.).
   * @param {Object} [opts.modalMapping] - Overwrites the default modal mappings if provided.
   * @param {Function} [opts.showNotification] - Notification function override.
   * @param {Object} [opts.domPurify] - Sanitization library for any needed HTML.
   */
  constructor({
    eventHandlers,
    DependencySystem,
    modalMapping,
    showNotification,
    domPurify,
  } = {}) {
    this.DependencySystem = DependencySystem || undefined;
    this.eventHandlers = eventHandlers || this.DependencySystem?.modules?.get?.('eventHandlers') || undefined;
    this.modalMappings = modalMapping || this.DependencySystem?.modules?.get?.('modalMapping') || MODAL_MAPPINGS;
    this.showNotification = showNotification || this.DependencySystem?.modules?.get?.('app')?.showNotification || undefined;
    this.domPurify = domPurify || this.DependencySystem?.modules?.get?.('domPurify') || null;

    /**
     * Attempt to retrieve an app reference (to check isInitializing, debug, etc.).
     */
    this.app = this.DependencySystem?.modules?.get?.('app') || null;

    /** @type {string|null} The currently active modal ID */
    this.activeModal = null;

    /** @type {number|undefined} Scroll position for body scroll lock */
    this._scrollLockY = undefined;

    /**
     * Store tracked events for removal in destroy().
     * Each entry: { element, type, description }.
     */
    this._trackedEvents = [];
  }

  /**
   * Internal convenience to see if debug mode is on via app config.
   * @returns {boolean}
   * @private
   */
  _isDebug() {
    return !!this.app?.config?.debug;
  }

  /**
   * Provide a unified user notification approach (error, warn, info).
   * If showNotification is available, uses it. Otherwise no-op.
   * You may tweak logic to handle debug logs only in debug mode, etc.
   * @param {'error'|'warn'|'info'} level
   * @param {string} message
   * @param {boolean} [debugOnly=false]
   */
  _notify(level, message, debugOnly = false) {
    if (debugOnly && !this._isDebug()) {
      return;
    }
    if (this.showNotification) {
      this.showNotification(
        message,
        level,
        undefined,
        { group: true, context: "modalManager" }
      );
    }
    // else do nothing (no direct console usage allowed)
  }

  // ---------------------------
  // Scroll locking / unlocking
  // ---------------------------

  /**
   * @method _manageBodyScroll
   * Lock or unlock body scrolling by using position:fixed trick
   * @param {boolean} enableScroll - True to unlock, false to lock
   * @private
   */
  _manageBodyScroll(enableScroll) {
    const scrollingEl = getScrollingElement();
    if (!enableScroll) {
      // Lock scrolling (modal open)
      this._scrollLockY = scrollingEl.scrollTop;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${this._scrollLockY}px`;
      document.body.style.width = '100vw';
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    } else {
      // Unlock scrolling (modal close)
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
      if (this._scrollLockY !== undefined) {
        scrollingEl.scrollTop = this._scrollLockY;
        this._scrollLockY = undefined;
      }
    }
  }

  // -----------
  // Modal show/hide helpers
  // -----------

  /**
   * Show a dialog element (native or fallback).
   * @private
   * @param {HTMLElement} modalEl
   */
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

  /**
   * Hide a dialog element (native or fallback).
   * @private
   * @param {HTMLElement} modalEl
   */
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
   * Handle the native 'close' event for a dialog if we are tracking it with trackListener.
   * @private
   * @param {string} modalId
   */
  _onDialogClose(modalId) {
    if (this.activeModal === modalId) {
      if (this._isDebug()) {
        this._notify('info', `[ModalManager] Dialog ${modalId} closed (native event).`, true);
      }
      this.activeModal = null;
      document.body.style.overflow = '';
    }
  }

  // -----------
  // Modal core API
  // -----------

  /**
   * @method init
   * Attach 'close' listeners to each mapped dialog. Orchestrator must call after DOM is ready.
   * Also validates mappings for missing/duplicate IDs.
   */
  init() {
    if (this._isDebug()) {
      this._notify('info', '[ModalManager] init() called. Setting up modals...', true);
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
          this._notify('warn', `No eventHandlers found; cannot attach close event for ${modalId}`);
        }
      }
    });

    if (this._isDebug()) {
      this._notify('info', '[ModalManager] Initialization complete.', true);
    }
  }

  /**
   * Remove all tracked event listeners. For use in SPAs or dynamic re-inits.
   */
  destroy() {
    if (!this.eventHandlers?.cleanupListeners) {
      if (this._isDebug()) {
        this._notify('warn', '[ModalManager] destroy() called but no eventHandlers.cleanupListeners available.');
      }
      return;
    }
    // Remove each tracked event:
    this._trackedEvents.forEach((evt) => {
      this.eventHandlers.cleanupListeners(evt.element, evt.type, evt.description);
    });
    this._trackedEvents = [];

    if (this._isDebug()) {
      this._notify('info', '[ModalManager] destroyed: all tracked listeners removed.', true);
    }
  }

  /**
   * Check for missing or duplicate modal IDs in the DOM.
   * @param {Object} modalMapping
   */
  validateModalMappings(modalMapping) {
    Object.entries(modalMapping).forEach(([key, modalId]) => {
      const elements = document.querySelectorAll(`#${modalId}`);
      if (elements.length === 0) {
        this._notify('error', `ModalManager: No element found for ${key} with ID "${modalId}"`, false);
      } else if (elements.length > 1) {
        this._notify('error', `ModalManager: Duplicate elements found for ${key} with ID "${modalId}"`, false);
      }
    });
  }

  /**
   * Show a modal by its name (from modalMappings).
   * @param {string} modalName
   * @param {object} [options]
   * @returns {boolean}
   */
  show(modalName, options = {}) {
    // Instead of window.__appInitializing, rely on app?.isInitializing
    if (this.app?.isInitializing && !options.showDuringInitialization) {
      if (this._isDebug()) {
        this._notify('info', `[ModalManager] Skipping modal '${modalName}' during app init`, true);
      }
      return false;
    }

    const modalId = this.modalMappings[modalName];
    if (!modalId) {
      this._notify('error', `[ModalManager] Modal mapping missing for: ${modalName}`, false);
      return false;
    }

    const modalEl = document.getElementById(modalId);
    if (!modalEl) {
      this._notify('error', `[ModalManager] Modal element missing: ${modalId}`, false);
      return false;
    }

    this._showModalElement(modalEl);
    this.activeModal = modalName;
    return true;
  }

  /**
   * Show a confirmation modal with custom text and handlers.
   * @param {Object} options
   *   @param {string} [options.title]
   *   @param {string} [options.message]
   *   @param {string} [options.confirmText]
   *   @param {string} [options.cancelText]
   *   @param {string} [options.confirmClass]
   *   @param {Function} [options.onConfirm]
   *   @param {Function} [options.onCancel]
   *   @param {boolean} [options.showDuringInitialization]
   */
  confirmAction(options) {
    const modalName = 'confirm';
    const modalId = this.modalMappings[modalName];
    if (!modalId) {
      this._notify('error', '[ModalManager] Confirm modal ID not mapped.', false);
      return;
    }

    const modalEl = document.getElementById(modalId);
    if (!modalEl) {
      this._notify('error', '[ModalManager] Confirm modal element not found.', false);
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

    // Attach handlers with eventHandlers->trackListener if available, otherwise throw
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
      throw new Error('[ModalManager] eventHandlers.trackListener is required for confirmAction');
    }

    // Finally, show the modal
    this.show(modalName, {
      showDuringInitialization: options.showDuringInitialization,
    });
  }

  /**
   * Hide a modal by its name (from modalMappings).
   * @param {string} modalName
   */
  hide(modalName) {
    const modalId = this.modalMappings[modalName];
    if (!modalId) {
      this._notify('error', `[ModalManager] Modal mapping missing for: ${modalName}`);
      return;
    }
    const modalEl = document.getElementById(modalId);
    if (!modalEl) {
      this._notify('error', `[ModalManager] Modal element missing: ${modalId}`);
      return;
    }
    this._hideModalElement(modalEl);
    if (this.activeModal === modalName) {
      this.activeModal = null;
    }
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
      this.showNotification(
        message,
        type,
        undefined,
        { group: true, context: "projectModal" }
      );
    }
    // else do nothing (no direct alert/console)
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
      this._notify('info', '[ProjectModal] Initialized successfully');
    }
  }

  /**
   * Provide a cleanup method to remove event listeners in an SPA scenario.
   */
  destroy() {
    if (!this.eventHandlers?.cleanupListeners) {
      if (this._isDebug()) {
        this._notify('warn', '[ProjectModal] destroy() called but eventHandlers.cleanupListeners is unavailable.');
      }
      return;
    }
    this._trackedEvents.forEach((evt) => {
      this.eventHandlers.cleanupListeners(evt.element, evt.type, evt.description);
    });
    this._trackedEvents = [];
    if (this._isDebug()) {
      this._notify('info', '[ProjectModal] destroyed: all tracked listeners removed.');
    }
  }

  /**
   * Open the project modal (for creating or editing).
   * @param {object|null} project - If null, we create a new project. Otherwise, we edit the existing one.
   */
  openModal(project = null) {
    if (!this.modalElement) {
      this._notify('error', '[ProjectModal] No modalElement found!');
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
      this._notify('error', '[ProjectModal] No formElement found!');
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
    } catch {
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
    await this.projectManager.saveProject(projectId, projectData);
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
   * Helper for binding an event. Uses eventHandlers if available, else throws.
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
      throw new Error('[ProjectModal] eventHandlers.trackListener is required');
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
