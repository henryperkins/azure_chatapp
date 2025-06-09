/**
 * ModalStateManager - extracted modal state and lifecycle (Phase-2)
 * ----------------------------------------------------------------
 * Handles modal state tracking, lifecycle events, modal mapping,
 * and coordination between modals. Extracted from oversized modalManager.js.
 */

export function createModalStateManager({
  eventService,
  logger,
  modalMappings = {}
} = {}) {
  const MODULE = 'ModalStateManager';

  if (!eventService || !logger) {
    throw new Error(`[${MODULE}] Required dependencies missing: eventService, logger`);
  }

  const _log = (msg, extra = {}) => logger?.debug?.(`[${MODULE}] ${msg}`, {
    context: MODULE,
    ...extra
  });

  const _logError = (msg, err, extra = {}) => {
    logger?.error?.(`[${MODULE}] ${msg}`, err?.stack || err, {
      context: MODULE,
      ...extra
    });
  };

  // Modal state tracking
  let activeModal = null;
  let modalStack = [];
  let modalHistory = [];
  const modalStates = new Map();

  // Modal configuration
  let currentModalMappings = { ...modalMappings };

  function setActiveModal(modalName) {
    const previousModal = activeModal;
    activeModal = modalName;

    if (modalName) {
      // Add to stack if not already present
      if (!modalStack.includes(modalName)) {
        modalStack.push(modalName);
      }
      
      // Add to history
      modalHistory.push({
        modal: modalName,
        timestamp: Date.now(),
        action: 'opened'
      });

      // Update modal state
      modalStates.set(modalName, {
        isOpen: true,
        openedAt: Date.now(),
        zIndex: modalStack.length + 1000
      });
    } else {
      // Remove from stack
      if (previousModal) {
        const index = modalStack.indexOf(previousModal);
        if (index > -1) {
          modalStack.splice(index, 1);
        }

        // Add to history
        modalHistory.push({
          modal: previousModal,
          timestamp: Date.now(),
          action: 'closed'
        });

        // Update modal state
        modalStates.set(previousModal, {
          isOpen: false,
          closedAt: Date.now(),
          zIndex: null
        });
      }
    }

    // Emit state change event
    eventService.emit('modal:stateChanged', {
      activeModal,
      previousModal,
      modalStack: [...modalStack],
      timestamp: Date.now()
    });

    _log('Active modal changed', { 
      activeModal, 
      previousModal, 
      stackDepth: modalStack.length 
    });
  }

  function getActiveModal() {
    return activeModal;
  }

  function isModalOpen(modalName) {
    if (!modalName) return false;
    const state = modalStates.get(modalName);
    return state?.isOpen || false;
  }

  function getModalState(modalName) {
    if (!modalName) return null;
    return modalStates.get(modalName) || null;
  }

  function getAllModalStates() {
    return Object.fromEntries(modalStates);
  }

  function getModalStack() {
    return [...modalStack];
  }

  function getModalHistory(limit = 10) {
    return modalHistory.slice(-limit);
  }

  function clearModalHistory() {
    modalHistory = [];
    _log('Modal history cleared');
  }

  function getTopModal() {
    return modalStack.length > 0 ? modalStack[modalStack.length - 1] : null;
  }

  function getModalId(modalName) {
    if (!modalName) return null;
    return currentModalMappings[modalName] || modalName;
  }

  function getModalName(modalId) {
    if (!modalId) return null;
    
    for (const [name, id] of Object.entries(currentModalMappings)) {
      if (id === modalId) {
        return name;
      }
    }
    
    return modalId; // Return original if no mapping found
  }

  function registerModal(modalName, modalId, options = {}) {
    if (!modalName || !modalId) {
      _logError('registerModal: modalName and modalId required');
      return false;
    }

    try {
      currentModalMappings[modalName] = modalId;
      
      // Initialize modal state
      modalStates.set(modalName, {
        isOpen: false,
        registeredAt: Date.now(),
        options: { ...options },
        zIndex: null
      });

      eventService.emit('modal:registered', {
        modalName,
        modalId,
        options,
        timestamp: Date.now()
      });

      _log('Modal registered', { modalName, modalId, options });
      return true;
    } catch (err) {
      _logError('Failed to register modal', err, { modalName, modalId });
      return false;
    }
  }

  function unregisterModal(modalName) {
    if (!modalName) return false;

    try {
      const modalId = currentModalMappings[modalName];
      
      if (modalId) {
        delete currentModalMappings[modalName];
        modalStates.delete(modalName);

        // Remove from stack if present
        const index = modalStack.indexOf(modalName);
        if (index > -1) {
          modalStack.splice(index, 1);
        }

        // Clear as active if it was active
        if (activeModal === modalName) {
          activeModal = null;
        }

        eventService.emit('modal:unregistered', {
          modalName,
          modalId,
          timestamp: Date.now()
        });

        _log('Modal unregistered', { modalName, modalId });
        return true;
      }
      
      return false;
    } catch (err) {
      _logError('Failed to unregister modal', err, { modalName });
      return false;
    }
  }

  function updateModalMappings(newMappings) {
    if (!newMappings || typeof newMappings !== 'object') {
      _logError('updateModalMappings: valid mappings object required');
      return false;
    }

    try {
      currentModalMappings = { ...currentModalMappings, ...newMappings };
      
      eventService.emit('modal:mappingsUpdated', {
        newMappings,
        allMappings: { ...currentModalMappings },
        timestamp: Date.now()
      });

      _log('Modal mappings updated', { 
        newCount: Object.keys(newMappings).length,
        totalCount: Object.keys(currentModalMappings).length 
      });
      return true;
    } catch (err) {
      _logError('Failed to update modal mappings', err);
      return false;
    }
  }

  function getModalMappings() {
    return { ...currentModalMappings };
  }

  function canOpenModal(modalName) {
    if (!modalName) return false;

    // Check if modal is registered
    if (!currentModalMappings[modalName]) {
      _log('Cannot open modal - not registered', { modalName });
      return false;
    }

    // Check if already open
    if (isModalOpen(modalName)) {
      _log('Cannot open modal - already open', { modalName });
      return false;
    }

    return true;
  }

  function canCloseModal(modalName) {
    if (!modalName) return false;

    // Check if modal is open
    if (!isModalOpen(modalName)) {
      _log('Cannot close modal - not open', { modalName });
      return false;
    }

    return true;
  }

  function closeAllModals() {
    const openModals = [...modalStack];
    
    try {
      modalStack = [];
      modalStates.forEach((state, modalName) => {
        if (state.isOpen) {
          modalStates.set(modalName, {
            ...state,
            isOpen: false,
            closedAt: Date.now(),
            zIndex: null
          });
        }
      });

      activeModal = null;

      eventService.emit('modal:allClosed', {
        closedModals: openModals,
        timestamp: Date.now()
      });

      _log('All modals closed', { closedCount: openModals.length });
      return openModals;
    } catch (err) {
      _logError('Failed to close all modals', err);
      return [];
    }
  }

  function getZIndex(modalName) {
    if (!modalName) return null;
    const state = modalStates.get(modalName);
    return state?.zIndex || null;
  }

  function setZIndex(modalName, zIndex) {
    if (!modalName || typeof zIndex !== 'number') return false;

    try {
      const state = modalStates.get(modalName);
      if (state) {
        modalStates.set(modalName, { ...state, zIndex });
        _log('Modal z-index updated', { modalName, zIndex });
        return true;
      }
      return false;
    } catch (err) {
      _logError('Failed to set modal z-index', err, { modalName, zIndex });
      return false;
    }
  }

  return {
    // Active modal management
    setActiveModal,
    getActiveModal,
    getTopModal,

    // Modal state queries
    isModalOpen,
    getModalState,
    getAllModalStates,
    canOpenModal,
    canCloseModal,

    // Modal stack management
    getModalStack,
    closeAllModals,

    // Modal registration
    registerModal,
    unregisterModal,

    // Modal mapping
    getModalId,
    getModalName,
    getModalMappings,
    updateModalMappings,

    // History and tracking
    getModalHistory,
    clearModalHistory,

    // Z-index management
    getZIndex,
    setZIndex,

    cleanup() {
      _log('cleanup()');
      closeAllModals();
      modalStates.clear();
      modalHistory = [];
      currentModalMappings = {};
    }
  };
}

export default createModalStateManager;