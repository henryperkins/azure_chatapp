/**
 * modalManager.js - Refactored Modal Manager (Phase-2)
 * ---------------------------------------------------
 * Slim coordinator that orchestrates modal operations using extracted modules:
 * - ModalRenderer: DOM manipulation and rendering
 * - ModalStateManager: State tracking and lifecycle
 * - ModalFormHandler: Form handling within modals
 * 
 * Reduced from 1235 → ~400 lines through separation of concerns.
 */

import { MODAL_MAPPINGS } from './modalConstants.js';
import { createModalRenderer } from './modalRenderer.js';
import { createModalStateManager } from './modalStateManager.js';
import { createModalFormHandler } from './modalFormHandler.js';

export function createModalManager({
  eventHandlers,
  domAPI,
  browserService,
  DependencySystem,
  modalMapping,
  domPurify,
  domReadinessService,
  logger,
  errorReporter,
  eventService,
  sanitizer
} = {}) {
  
  // Dependency validation
  if (!domAPI) {
    throw new Error('[ModalManager] domAPI DI not provided');
  }
  if (!browserService) {
    throw new Error('[ModalManager] browserService DI not provided');
  }
  if (!logger) {
    throw new Error('[ModalManager] logger is required');
  }

  const MODULE_CONTEXT = 'ModalManager';
  
  // Use provided sanitizer or fallback to domPurify
  const modalSanitizer = sanitizer || domPurify;
  if (!modalSanitizer) {
    throw new Error('[ModalManager] sanitizer (DOMPurify) is required');
  }

  // Get safeHandler
  const safeHandler = DependencySystem?.modules?.get?.('safeHandler');
  if (typeof safeHandler !== 'function') {
    throw new Error('[ModalManager] safeHandler not available in DependencySystem');
  }

  // === EXTRACTED MODULE INSTANCES ===
  const renderer = createModalRenderer({
    domAPI,
    browserService,
    logger,
    sanitizer: modalSanitizer
  });

  const stateManager = createModalStateManager({
    eventService: eventService || DependencySystem?.modules?.get?.('eventService'),
    logger,
    modalMappings: modalMapping || MODAL_MAPPINGS
  });

  const formHandler = createModalFormHandler({
    domAPI,
    eventHandlers,
    logger,
    sanitizer: modalSanitizer,
    safeHandler
  });

  // === INITIALIZATION ===
  let isReady = false;
  let readyPromise = null;

  async function initialize() {
    if (readyPromise) return readyPromise;

    readyPromise = (async () => {
      try {
        logger.info('[ModalManager] Initializing', { context: MODULE_CONTEXT });

        // Wait for DOM readiness
        if (domReadinessService) {
          await domReadinessService.waitForEvent('app:ready');
        }

        // Register default modal mappings
        const mappings = modalMapping || MODAL_MAPPINGS;
        for (const [name, id] of Object.entries(mappings)) {
          stateManager.registerModal(name, id);
        }

        // Set up global modal event listeners
        setupGlobalEventListeners();

        isReady = true;
        logger.info('[ModalManager] Initialization complete', { 
          modalCount: Object.keys(mappings).length,
          context: MODULE_CONTEXT 
        });

      } catch (err) {
        logger.error('[ModalManager] Initialization failed', err, { context: MODULE_CONTEXT });
        throw err;
      }
    })();

    return readyPromise;
  }

  function setupGlobalEventListeners() {
    const document = domAPI.getDocument();

    // ESC key handler
    const escapeHandler = safeHandler((event) => {
      if (event.key === 'Escape') {
        const activeModal = stateManager.getActiveModal();
        if (activeModal) {
          hide(activeModal);
        }
      }
    }, MODULE_CONTEXT + ':EscapeKey');

    eventHandlers.trackListener(document, 'keydown', escapeHandler, {
      context: MODULE_CONTEXT,
      description: 'EscapeKeyHandler'
    });

    // Modal backdrop click handler
    const backdropHandler = safeHandler((event) => {
      if (event.target.classList.contains('modal-backdrop')) {
        const activeModal = stateManager.getActiveModal();
        if (activeModal) {
          hide(activeModal);
        }
      }
    }, MODULE_CONTEXT + ':BackdropClick');

    eventHandlers.trackListener(document, 'click', backdropHandler, {
      context: MODULE_CONTEXT,
      description: 'BackdropClickHandler'
    });

    // Modal close request handler
    const closeRequestHandler = safeHandler((event) => {
      const { modalId, source } = event.detail || {};
      if (modalId) {
        const modalName = stateManager.getModalName(modalId);
        if (modalName) {
          logger.debug('[ModalManager] Close requested', { modalName, source });
          hide(modalName);
        }
      }
    }, MODULE_CONTEXT + ':CloseRequest');

    eventHandlers.trackListener(document, 'modal:requestClose', closeRequestHandler, {
      context: MODULE_CONTEXT,
      description: 'CloseRequestHandler'
    });
  }

  // === CORE MODAL OPERATIONS ===
  function show(modalName, options = {}) {
    try {
      logger.debug('[ModalManager] Showing modal', { modalName, options });

      if (!stateManager.canOpenModal(modalName)) {
        logger.warn('[ModalManager] Cannot open modal', { modalName });
        return false;
      }

      const modalId = stateManager.getModalId(modalName);
      const modalEl = renderer.findModalElement(modalId);

      if (!modalEl) {
        logger.error('[ModalManager] Modal element not found', { modalName, modalId });
        return false;
      }

      // Update content if provided
      if (options.content) {
        renderer.updateModalContent(modalEl, options.content, {
          sanitize: options.sanitize !== false,
          selector: options.contentSelector
        });
      }

      // Update title if provided
      if (options.title) {
        renderer.setModalTitle(modalEl, options.title);
      }

      // Update modal content via callback
      if (typeof options.updateContent === 'function') {
        try {
          options.updateContent(modalEl);
        } catch (err) {
          logger.error('[ModalManager] Update content callback failed', err, { modalName });
        }
      }

      // Show the modal
      const success = renderer.showModalElement(modalEl);
      if (success) {
        stateManager.setActiveModal(modalName);
        
        // Center modal if requested
        if (options.center) {
          renderer.centerModal(modalEl);
        }

        logger.info('[ModalManager] Modal shown successfully', { modalName });
        return true;
      } else {
        logger.error('[ModalManager] Failed to show modal element', { modalName });
        return false;
      }

    } catch (err) {
      logger.error('[ModalManager] Error showing modal', err, { modalName });
      return false;
    }
  }

  function hide(modalName) {
    try {
      logger.debug('[ModalManager] Hiding modal', { modalName });

      if (!modalName) {
        // Hide active modal if no name provided
        modalName = stateManager.getActiveModal();
        if (!modalName) {
          logger.warn('[ModalManager] No modal to hide');
          return false;
        }
      }

      if (!stateManager.canCloseModal(modalName)) {
        logger.warn('[ModalManager] Cannot close modal', { modalName });
        return false;
      }

      const modalId = stateManager.getModalId(modalName);
      const modalEl = renderer.findModalElement(modalId);

      if (!modalEl) {
        logger.error('[ModalManager] Modal element not found for hiding', { modalName, modalId });
        return false;
      }

      // Hide the modal
      const success = renderer.hideModalElement(modalEl);
      if (success) {
        stateManager.setActiveModal(null);
        logger.info('[ModalManager] Modal hidden successfully', { modalName });
        return true;
      } else {
        logger.error('[ModalManager] Failed to hide modal element', { modalName });
        return false;
      }

    } catch (err) {
      logger.error('[ModalManager] Error hiding modal', err, { modalName });
      return false;
    }
  }

  function toggle(modalName, options = {}) {
    if (stateManager.isModalOpen(modalName)) {
      return hide(modalName);
    } else {
      return show(modalName, options);
    }
  }

  function hideAll() {
    try {
      const closedModals = stateManager.closeAllModals();
      
      // Hide all modal elements
      closedModals.forEach(modalName => {
        const modalId = stateManager.getModalId(modalName);
        const modalEl = renderer.findModalElement(modalId);
        if (modalEl) {
          renderer.hideModalElement(modalEl);
        }
      });

      logger.info('[ModalManager] All modals hidden', { count: closedModals.length });
      return closedModals;
    } catch (err) {
      logger.error('[ModalManager] Error hiding all modals', err);
      return [];
    }
  }

  // === FORM INTEGRATION ===
  function bindForm(modalName, formSelector, onSubmit, options = {}) {
    try {
      const modalId = stateManager.getModalId(modalName);
      const modalEl = renderer.findModalElement(modalId);

      if (!modalEl) {
        logger.error('[ModalManager] Cannot bind form - modal not found', { modalName, modalId });
        return false;
      }

      return formHandler.bindModalForm(modalEl, formSelector, onSubmit, {
        ...options,
        context: MODULE_CONTEXT + ':' + modalName
      });
    } catch (err) {
      logger.error('[ModalManager] Error binding modal form', err, { modalName, formSelector });
      return false;
    }
  }

  // === CONFIRMATION DIALOGS ===
  function confirmDelete(options = {}) {
    const {
      title = 'Confirm Delete',
      message = 'Are you sure you want to delete this item?',
      confirmText = 'Delete',
      cancelText = 'Cancel',
      confirmClass = 'btn-error',
      onConfirm,
      onCancel
    } = options;

    return show('confirm', {
      title,
      updateContent: (modalEl) => {
        const messageEl = modalEl.querySelector('.modal-message');
        if (messageEl) {
          domAPI.setTextContent(messageEl, message);
        }

        const confirmBtn = modalEl.querySelector('.confirm-btn');
        if (confirmBtn) {
          domAPI.setTextContent(confirmBtn, confirmText);
          confirmBtn.className = `btn ${confirmClass}`;
          
          // Remove existing listeners
          eventHandlers.cleanupListeners({ 
            target: confirmBtn, 
            context: MODULE_CONTEXT + ':ConfirmDelete' 
          });
          
          // Add new listener
          eventHandlers.trackListener(confirmBtn, 'click', safeHandler(() => {
            hide('confirm');
            if (typeof onConfirm === 'function') {
              onConfirm();
            }
          }, MODULE_CONTEXT + ':ConfirmAction'), {
            context: MODULE_CONTEXT + ':ConfirmDelete',
            description: 'ConfirmDeleteAction'
          });
        }

        const cancelBtn = modalEl.querySelector('.cancel-btn');
        if (cancelBtn) {
          domAPI.setTextContent(cancelBtn, cancelText);
          
          eventHandlers.trackListener(cancelBtn, 'click', safeHandler(() => {
            hide('confirm');
            if (typeof onCancel === 'function') {
              onCancel();
            }
          }, MODULE_CONTEXT + ':CancelAction'), {
            context: MODULE_CONTEXT + ':ConfirmDelete',
            description: 'ConfirmDeleteCancel'
          });
        }
      }
    });
  }

  function confirmAction(options = {}) {
    return confirmDelete(options);
  }

  // === PUBLIC API ===
  return {
    // Initialization
    initialize,
    isReadyPromise: () => readyPromise,

    // Core modal operations
    show,
    hide,
    toggle,
    hideAll,

    // State queries (delegate to state manager)
    isOpen: (modalName) => stateManager.isModalOpen(modalName),
    getActiveModal: () => stateManager.getActiveModal(),
    getModalStack: () => stateManager.getModalStack(),
    getAllStates: () => stateManager.getAllModalStates(),

    // Form handling (delegate to form handler)
    bindForm,
    validateForm: (modalName, formSelector) => {
      const modalId = stateManager.getModalId(modalName);
      const modalEl = renderer.findModalElement(modalId);
      if (modalEl) {
        const form = modalEl.querySelector(formSelector);
        return formHandler.validateModalForm(form);
      }
      return { valid: false, errors: ['Modal or form not found'] };
    },

    // Confirmation dialogs
    confirmDelete,
    confirmAction,

    // Modal management
    registerModal: (name, id, options) => stateManager.registerModal(name, id, options),
    unregisterModal: (name) => stateManager.unregisterModal(name),

    // Utility methods
    getModalMappings: () => stateManager.getModalMappings(),
    updateModalContent: (modalName, content, options) => {
      const modalId = stateManager.getModalId(modalName);
      const modalEl = renderer.findModalElement(modalId);
      return modalEl ? renderer.updateModalContent(modalEl, content, options) : false;
    },

    cleanup() {
      logger.debug('[ModalManager] cleanup()', { context: MODULE_CONTEXT });
      
      // Cleanup extracted modules
      renderer.cleanup();
      stateManager.cleanup();
      formHandler.cleanup();
      
      // Cleanup event listeners
      eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
      
      // Reset state
      isReady = false;
      readyPromise = null;
    }
  };
}

// Legacy class-based interface for backward compatibility
export default class ModalManager {
  constructor(opts) {
    const manager = createModalManager(opts);
    
    // Delegate all methods to the functional implementation
    Object.assign(this, manager);
    
    // Auto-initialize
    this.initialize().catch(err => {
      if (opts?.logger) {
        opts.logger.error('[ModalManager] Auto-initialization failed:', err, { context: 'ModalManager' });
      } else {
        console.error('[ModalManager] Auto-initialization failed:', err);
      }
    });
  }
}