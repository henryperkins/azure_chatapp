import { MODAL_MAPPINGS } from './modalConstants.js';

/**
 * Provides methods to show/hide mapped modals, handle scroll lock,
 * manages <dialog> elements (or fallback), and tracks event cleanup.
 */
class ModalManager {
  /**
   * @constructor
   * @param {Object} opts - Dependencies config object.
   * @param {Object} [opts.eventHandlers]
   * @param {Object} [opts.DependencySystem]
   * @param {Object} [opts.domAPI]
   * @param {Object} [opts.browserService]
   * @param {Object} [opts.modalMapping]
   * @param {Object} [opts.domPurify]
   */
  constructor({
    eventHandlers,
    domAPI,
    browserService,
    DependencySystem,
    modalMapping,
    domPurify
  } = {}) {
    this.DependencySystem = DependencySystem || undefined;
    this.eventHandlers =
      eventHandlers ||
      this.DependencySystem?.modules?.get?.('eventHandlers') ||
      undefined;
    this.domAPI = domAPI || this.DependencySystem?.modules?.get?.('domAPI');
    if (!this.domAPI) {
      throw new Error('[ModalManager] domAPI DI not provided');
    }
    this.browserService =
      browserService ||
      this.DependencySystem?.modules?.get?.('browserService');
    if (!this.browserService) {
      throw new Error('[ModalManager] browserService DI not provided');
    }
    this.modalMappings =
      modalMapping ||
      this.DependencySystem?.modules?.get?.('modalMapping') ||
      MODAL_MAPPINGS;
    this.domPurify =
      domPurify ||
      this.DependencySystem?.modules?.get?.('domPurify') ||
      this.DependencySystem?.modules?.get?.('sanitizer') ||
      null;

    this.app = this.DependencySystem?.modules?.get?.('app') || null;

    this.activeModal = null;
    this._scrollLockY = undefined;
  }

  _isDebug() {
    return !!this.app?.config?.debug;
  }

  _manageBodyScroll(enableScroll) {
    const scrollingEl = this.domAPI.getScrollingElement();
    if (!enableScroll) {
      this._scrollLockY = scrollingEl.scrollTop;
      this.domAPI.getBody().style.position = 'fixed';
      this.domAPI.getBody().style.top = `-${this._scrollLockY}px`;
      this.domAPI.getBody().style.width = '100vw';
      this.domAPI.getBody().style.overflow = 'hidden';
      this.domAPI.getDocumentElement().style.overflow = 'hidden';
    } else {
      this.domAPI.getBody().style.position = '';
      this.domAPI.getBody().style.top = '';
      this.domAPI.getBody().style.width = '';
      this.domAPI.getBody().style.overflow = '';
      this.domAPI.getDocumentElement().style.overflow = '';
      if (this._scrollLockY !== undefined) {
        scrollingEl.scrollTop = this._scrollLockY;
        this._scrollLockY = undefined;
      }
    }
  }

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

  _onDialogClose(modalId) {
    if (this.activeModal === modalId) {
      this.activeModal = null;
      this.domAPI.getBody().style.overflow = '';
    }
  }

  async init() {
    const depSys = this.DependencySystem;
    if (!depSys) {
      throw new Error('[ModalManager] DependencySystem missing in init');
    }
    await depSys.waitFor(['eventHandlers'], null, 5000);

    this.validateModalMappings(this.modalMappings);

    Object.values(this.modalMappings).forEach((modalId) => {
      const modalEl = this.domAPI.getElementById(modalId);
      if (!modalEl) {
        throw new Error(`[ModalManager] Required modal missing in DOM: ${modalId}`);
      }
      const handler = () => this._onDialogClose(modalId);
      if (this.eventHandlers?.trackListener) {
        this.eventHandlers.trackListener(modalEl, 'close', handler, {
          description: `Close event for ${modalId}`,
          context: 'modalManager',
          source: 'ModalManager.init'
        });
      }
    });

    const doc =
      this.domAPI?.getDocument?.() ||
      (typeof document !== 'undefined' ? document : null);
    if (doc && typeof this.domAPI?.dispatchEvent === 'function') {
      this.domAPI.dispatchEvent(
        doc,
        new CustomEvent('modalmanager:initialized', { detail: { success: true } })
      );
    }
  }

  destroy() {
    if (!this.eventHandlers?.cleanupListeners) {
      return;
    }
    this.eventHandlers.cleanupListeners({ context: 'modalManager' });
  }

  validateModalMappings(modalMapping) {
    Object.entries(modalMapping).forEach(([key, modalId]) => {
      const elements = this.domAPI.querySelectorAll(`#${modalId}`);
      if (elements.length === 0) {
        // removed console usage
      } else if (elements.length > 1) {
        // removed console usage
      }
    });
  }

  show(modalName, options = {}) {
    if (this.app?.isInitializing && !options.showDuringInitialization) {
      return false;
    }

    const modalId = this.modalMappings[modalName];
    if (!modalId) {
      return false;
    }

    const modalEl = this.domAPI.getElementById(modalId);
    if (!modalEl) {
      return false;
    }

    this._showModalElement(modalEl);
    this.activeModal = modalName;
    return true;
  }

  confirmAction(options) {
    const modalName = 'confirm';
    const modalId = this.modalMappings[modalName];
    if (!modalId) {
      return;
    }

    const modalEl = this.domAPI.getElementById(modalId);
    if (!modalEl) {
      return;
    }

    const titleEl = modalEl.querySelector('h3');
    const messageEl = modalEl.querySelector('p');
    const confirmBtn = modalEl.querySelector('#confirmActionBtn');
    const cancelBtn = modalEl.querySelector('#cancelActionBtn');

    if (titleEl) {
      titleEl.textContent = options.title || 'Confirm?';
    }
    if (messageEl) {
      messageEl.textContent = options.message || '';
    }
    if (confirmBtn) {
      confirmBtn.textContent = options.confirmText || 'Confirm';
      confirmBtn.className = `btn ${options.confirmClass || 'btn-primary'}`;
    }
    if (cancelBtn) {
      cancelBtn.textContent = options.cancelText || 'Cancel';
    }

    function replaceWithClone(btn) {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      return newBtn;
    }
    const newConfirmBtn = confirmBtn ? replaceWithClone(confirmBtn) : null;
    const newCancelBtn = cancelBtn ? replaceWithClone(cancelBtn) : null;

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

    if (this.eventHandlers?.trackListener) {
      if (newConfirmBtn) {
        this.eventHandlers.trackListener(newConfirmBtn, 'click', confirmHandler, {
          description: 'Confirm Modal Confirm Click',
          context: 'modalManager',
          source: 'ModalManager.confirmAction'
        });
      }
      if (newCancelBtn) {
        this.eventHandlers.trackListener(newCancelBtn, 'click', cancelHandler, {
          description: 'Confirm Modal Cancel Click',
          context: 'modalManager',
          source: 'ModalManager.confirmAction'
        });
      }
    } else {
      throw new Error('[ModalManager] eventHandlers.trackListener is required for confirmAction');
    }

    this.show(modalName, {
      showDuringInitialization: options.showDuringInitialization,
    });
  }

  hide(modalName) {
    const modalId = this.modalMappings[modalName];
    if (!modalId) {
      return;
    }
    const modalEl = this.domAPI.getElementById(modalId);
    if (!modalEl) {
      return;
    }
    this._hideModalElement(modalEl);
    if (this.activeModal === modalName) {
      this.activeModal = null;
    }
  }
}

/**
 * A dedicated class for handling the project creation/editing modal.
 */
class ProjectModal {
  /**
   * @constructor
   * @param {Object} opts
   *   @param {Object} [opts.projectManager]
   *   @param {Object} [opts.eventHandlers]
   *   @param {Object} [opts.DependencySystem]
   *   @param {Object} [opts.domAPI]
   *   @param {Object} [opts.domPurify]
   */
  constructor({ projectManager, eventHandlers, DependencySystem, domAPI, domPurify } = {}) {
    this.DependencySystem = DependencySystem || undefined;

    this.eventHandlers =
      eventHandlers ||
      this.DependencySystem?.modules?.get?.('eventHandlers') ||
      undefined;
    this.projectManager =
      projectManager ||
      this.DependencySystem?.modules?.get?.('projectManager') ||
      undefined;
    this.domAPI = domAPI || this.DependencySystem?.modules?.get?.('domAPI');
    if (!this.domAPI) {
      throw new Error('[ProjectModal] domAPI DI not provided');
    }

    this.domPurify =
      domPurify ||
      this.DependencySystem?.modules?.get?.('domPurify') ||
      this.DependencySystem?.modules?.get?.('sanitizer') ||
      null;

    this.modalElement = null;
    this.formElement = null;
    this.isOpen = false;
    this.currentProjectId = null;
  }

  _isDebug() {
    const app = this.DependencySystem?.modules?.get?.('app');
    return !!app?.config?.debug;
  }

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

  _setButtonLoading(btn, isLoading, loadingText = 'Saving...') {
    if (!btn) return;
    if (isLoading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      const html = `<span class="loading loading-spinner loading-xs"></span> ${loadingText}`;
      if (this.domPurify && typeof this.domPurify.sanitize === 'function') {
        btn.innerHTML = this.domPurify.sanitize(html);
      } else {
        btn.textContent = loadingText;
      }
    } else {
      btn.disabled = false;
      if (btn.dataset.originalText) {
        btn.textContent = btn.dataset.originalText;
        delete btn.dataset.originalText;
      }
    }
  }

  init() {
    this.modalElement = this.domAPI.getElementById('projectModal');
    this.formElement = this.domAPI.getElementById('projectModalForm');
    if (!this.modalElement || !this.formElement) {
      throw new Error('[ProjectModal] Required DOM elements not found on init.');
    }
    this.setupEventListeners();
  }

  destroy() {
    if (!this.eventHandlers?.cleanupListeners) {
      return;
    }
    this.eventHandlers.cleanupListeners({ context: 'projectModal' });
  }

  openModal(project = null) {
    if (!this.modalElement) {
      return;
    }

    if (this.formElement) {
      this.formElement.reset();
    }

    const titleEl = this.modalElement.querySelector('#projectModalTitle');
    if (titleEl) {
      titleEl.textContent = project ? 'Edit Project' : 'Create Project';
    }

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
      if (idEl) {
        idEl.value = '';
      }
    }

    this._showModalElement();
    this.isOpen = true;
  }

  setupEventListeners() {
    if (!this.formElement) return;

    const submitHandler = async (e) => {
      await this.handleSubmit(e);
    };
    this._bindEvent(
      this.formElement,
      'submit',
      submitHandler,
      'ProjectModal submit',
      { passive: false }
    );

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
    this._bindEvent(
      this.domAPI.ownerDocument,
      'keydown',
      escHandler,
      'ProjectModal ESC handler'
    );

    const backdropHandler = (e) => {
      if (e.target === this.modalElement && this.isOpen) {
        this.closeModal();
      }
    };
    this._bindEvent(
      this.modalElement,
      'click',
      backdropHandler,
      'ProjectModal backdrop click'
    );
  }

  closeModal() {
    if (!this.modalElement) return;
    this._hideModalElement();
    this.isOpen = false;
    this.currentProjectId = null;
  }

  async handleSubmit(e) {
    e.preventDefault();
    if (!this.formElement) {
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

      if (!projectData.name.trim()) {
        return;
      }

      const saveBtn = this.modalElement.querySelector('#projectSaveBtn');
      this._setButtonLoading(saveBtn, true);

      await this.saveProject(projectId, projectData);
      this.closeModal();
    } catch {
      // removed console usage
    } finally {
      const saveBtn = this.modalElement.querySelector('#projectSaveBtn');
      this._setButtonLoading(saveBtn, false);
    }
  }

  async saveProject(projectId, projectData) {
    if (!this.projectManager) {
      throw new Error('[ProjectModal] projectManager not available (not injected)');
    }
    await this.projectManager.saveProject(projectId, projectData);
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

  _bindEvent(element, type, handler, description, options = {}) {
    if (this.eventHandlers?.trackListener) {
      this.eventHandlers.trackListener(element, type, handler, {
        description,
        context: 'projectModal',
        source: 'ProjectModal._bindEvent',
        ...options
      });
    } else {
      throw new Error('[ProjectModal] eventHandlers.trackListener is required');
    }
  }
}

/**
 * Create a single ModalManager instance using the classes above.
 */
export function createModalManager({
  eventHandlers,
  domAPI,
  browserService,
  DependencySystem,
  modalMapping,
  domPurify
} = {}) {
  return new ModalManager({
    eventHandlers,
    domAPI,
    browserService,
    DependencySystem,
    modalMapping,
    domPurify
  });
}

/**
 * Returns an instance of ProjectModal class.
 */
export function createProjectModal({
  projectManager,
  eventHandlers,
  DependencySystem,
  domAPI,
  domPurify
} = {}) {
  return new ProjectModal({
    projectManager,
    eventHandlers,
    DependencySystem,
    domAPI,
    domPurify
  });
}
