/*
// VENDOR-EXEMPT-SIZE: Core module pending refactor in Q3-25
*/
/*
// VENDOR-EXEMPT-SIZE: Core module pending refactor in Q3-25
*/
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
   * @param {Object} [opts.domReadinessService]
   * @param {Object} [opts.logger]
   * @param {Object} [opts.errorReporter]
   */
  constructor({
    eventHandlers,
    domAPI,
    browserService,
    DependencySystem,
    modalMapping,
    domPurify,
    domReadinessService,
    logger,            // New: injectable logger
    errorReporter      // New: injectable error reporting
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

    this.domReadinessService =
      domReadinessService ||
      this.DependencySystem?.modules?.get?.('domReadinessService') ||
      null;

    // logger and errorReporter DI pattern
    if (!logger) throw new Error('[ModalManager] logger is required');
    this.logger = logger;
    this.errorReporter =
      errorReporter ||
      this.DependencySystem?.modules?.get?.('errorReporter') ||
      { report: () => { } };
    this.app = this.DependencySystem?.modules?.get?.('app') || null;

    // Ensure safeHandler is available everywhere
    this.safeHandler =
      this.DependencySystem?.modules?.get?.('safeHandler');
    if (typeof this.safeHandler !== 'function')
      throw new Error('[ModalManager] safeHandler dependency missing');

    // ─── Deferred “fully-ready” promise ─────────────────────────
    this._readyResolve = null;
    this._readyReject = null;
    this._readyPromise = new Promise((res, rej) => {
      this._readyResolve = res;
      this._readyReject = rej;
    });

    this.activeModal = null;
    this._scrollLockY = undefined;

    this.logger.debug?.('[ModalManager] constructed', { withApp: !!this.app }); // Changed to debug
  }

  isReadyPromise() { return this._readyPromise; }

  _isDebug() {
    return !!this.app?.config?.debug;
  }

  _manageBodyScroll(enableScroll) {
    const scrollingEl = this.domAPI.getScrollingElement();
    if (!enableScroll) {
      // Store both vertical and horizontal scroll positions
      this._scrollLockY = scrollingEl.scrollTop;
      this._scrollLockX = scrollingEl.scrollLeft;
      this.domAPI.getBody().style.position = 'fixed';
      this.domAPI.getBody().style.top = `-${this._scrollLockY}px`;
      this.domAPI.getBody().style.left = `-${this._scrollLockX || 0}px`;
      this.domAPI.getBody().style.width = '100vw';
      this.domAPI.getBody().style.overflow = 'hidden';
      this.domAPI.getDocumentElement().style.overflow = 'hidden';
      /* iOS Safari viewport-height fix:
         Force html element to full height while locked, preventing
         shrink on address-bar collapse which otherwise allows
         background scroll. */
      this.domAPI.getDocumentElement().style.height = '100%';
    } else {
      this.domAPI.getBody().style.position = '';
      this.domAPI.getBody().style.top = '';
      this.domAPI.getBody().style.left = '';
      this.domAPI.getBody().style.width = '';
      this.domAPI.getBody().style.overflow = '';
      this.domAPI.getDocumentElement().style.overflow = '';
      /* reset iOS fix */
      this.domAPI.getDocumentElement().style.height = '';
      // Patch: always reset scrollTop and scrollLeft using the stored values from before modal open.
      const y = this._scrollLockY !== undefined ? this._scrollLockY : 0;
      const x = this._scrollLockX !== undefined ? this._scrollLockX : 0;
      setTimeout(() => {
        if (typeof scrollingEl.scrollTo === 'function') {
          scrollingEl.scrollTo({ left: x, top: y, behavior: 'auto' });
        } else {
          scrollingEl.scrollTop = y;
          scrollingEl.scrollLeft = x;
        }
      }, 0);
      this._scrollLockY = undefined;
      this._scrollLockX = undefined;
    }
  }

  _showModalElement(modalEl) {
    const modalId = modalEl.id || 'unknown_modal_id';
    this.logger.debug?.(`[ModalManager] Showing modal element: #${modalId}`, { modalId });

    // Patch: always clear inline display (let DaisyUI/Tailwind flex show responsively)
    modalEl.style.display = '';
    modalEl.classList.remove('hidden');
    modalEl.removeAttribute('hidden'); // Defensive: clear if present
    modalEl.style.zIndex = '9999';

    if (typeof modalEl.showModal === 'function') {
      modalEl.showModal();
      this._manageBodyScroll(false);
    } else {
      modalEl.setAttribute('open', 'true');
      this._manageBodyScroll(false);
    }
  }

  _hideModalElement(modalEl) {
    const modalId = modalEl.id || 'unknown_modal_id';
    this.logger.debug?.(`[ModalManager] Hiding modal element: #${modalId}`, { modalId });

    // Patch: always clear any inline display (do not force display:none/flex, let DaisyUI handle)
    modalEl.style.display = '';
    modalEl.removeAttribute('hidden');
    if (typeof modalEl.close === 'function') {
      modalEl.close();
    } else {
      modalEl.classList.add('hidden');
      modalEl.removeAttribute('open');
    }
    this._manageBodyScroll(true);
  }

  _onDialogClose(modalId) {
    // Find the modalName for this modalId for robust activeModal clearing
    let modalNameForId = null;
    if (this.modalMappings) {
      for (const [name, id] of Object.entries(this.modalMappings)) {
        if (id === modalId) {
          modalNameForId = name;
          break;
        }
      }
    }
    if (this.activeModal === modalNameForId) {
      this.activeModal = null;
      this._manageBodyScroll(true);
      this.logger.debug?.(`[ModalManager] Dialog ${modalId} (${modalNameForId || 'unknown'}) closed via 'close' event, activeModal cleared.`);
    }
  }

  _registerAvailableModals() {
    const sh = this.safeHandler;
    if (!this.modalMappings || typeof this.modalMappings !== 'object') {
      this.logger.warn?.('[ModalManager] _registerAvailableModals: No modalMappings available to register.');
      return;
    }
    let registeredCount = 0;
    let notFoundCount = 0;
    this.logger.debug?.(`[ModalManager] _registerAvailableModals: Starting registration for ${Object.keys(this.modalMappings).length} mapped modals.`);

    Object.entries(this.modalMappings).forEach(([modalName, modalId]) => {
      const modalEl = this.domAPI.getElementById(modalId);
      if (!modalEl) {
        this.logger.warn?.(`[ModalManager] _registerAvailableModals: Modal element #${modalId} for "${modalName}" not found in DOM.`);
        notFoundCount++;
        return;
      }

      // For <dialog> elements, listen to the native 'close' event
      if (modalEl.tagName === 'DIALOG' && typeof this.eventHandlers?.trackListener === 'function') {
        this.eventHandlers.trackListener(
          modalEl,
          'close',
          sh(() => this._onDialogClose(modalId),
             `ModalManager:dialogClose:${modalId}`),
          {
            description: `Dialog close event for ${modalId}`,
            context: 'modalManager',
            source: 'ModalManager._registerAvailableModals'
          }
        );
      }

      // For generic close buttons within modals
      const closeButtons = this.domAPI.querySelectorAll('[data-modal-dismiss], .modal-close-button', modalEl);
      closeButtons.forEach(button => {
        if (typeof this.eventHandlers?.trackListener === 'function') {
          this.eventHandlers.trackListener(
            button,
            'click',
            sh((e) => {
                e.preventDefault();
                this.hide(modalName); // Use modalName for hiding
              },`ModalManager:closeBtn:${modalName}`),
            {
              description: `Close button click for modal ${modalName} (${modalId})`,
              context: 'modalManager',
              source: 'ModalManager._registerAvailableModals'
            }
          );
        }
      });
      this.logger.debug?.(`[ModalManager] _registerAvailableModals: Successfully registered modal: ${modalName} (#${modalId})`);
      registeredCount++;
    });
    this.logger.info?.(`[ModalManager] _registerAvailableModals: Finished. Registered ${registeredCount} modals. ${notFoundCount} modals not found in DOM.`);
  }

  async init() {
    this.logger.info?.('[ModalManager] init() called.');

    // Track the (possibly synthetic) modalsLoaded event so we can replay it later
    let modalsLoadedEventData = null;

    try {
      const depSys = this.DependencySystem;
      if (!depSys) {
        this.logger.error?.('[ModalManager] init: DependencySystem missing.');
        throw new Error('[ModalManager] DependencySystem missing in init');
      }

      if (!this.domReadinessService) {
        this.logger.error?.('[ModalManager] init: domReadinessService missing from DI.');
        throw new Error('[ModalManager] Missing domReadinessService in DI. Make sure it is registered.');
      }

      this.logger.debug?.('[ModalManager] init: Awaiting core dependencies (eventHandlers, domAPI).');
      await this.domReadinessService.dependenciesAndElements({
        deps: ['eventHandlers', 'domAPI'],
        timeout: 5000,
        context: 'modalManager.init:coreDeps'
      });
      this.logger.debug?.('[ModalManager] init: Core dependencies ready.');

      this.logger.debug?.('[ModalManager] init: Awaiting body element readiness.');
      await this.domReadinessService.dependenciesAndElements({
        deps: [],
        domSelectors: ['body'],
        timeout: 5000,
        context: 'modalManager.init:bodyReady'
      });
      this.logger.debug?.('[ModalManager] init: Body element ready.');

      /* ----------------------------------------------------------
         Eager-load modals template if it is not yet in the DOM.
         This guarantees that the required 'modalsLoaded' event
         will fire, allowing init() to proceed without timing out.
      ---------------------------------------------------------- */
      let shouldWaitForEvent = true;
      try {
        const container = this.domAPI.getElementById('modalsContainer');
        const modalsAlreadyInjected =
          !!(container && container.children && container.children.length > 0);

        const htmlTemplateLoader =
          this.DependencySystem?.modules?.get?.('htmlTemplateLoader');

        if (modalsAlreadyInjected) {
          this.logger.info?.(
            '[ModalManager] init: Modals already injected, skipping load and event wait.'
          );
          shouldWaitForEvent = false;
        } else if (htmlTemplateLoader?.loadTemplate) {
          this.logger.info?.(
            '[ModalManager] init: Loading /static/html/modals.html template eagerly.'
          );

          // Fire-and-forget; `loadTemplate` will dispatch the
          //   `modalsLoaded` event on success (or even on error),
          //   which is what this.init() waits for next.
          htmlTemplateLoader
            .loadTemplate({
              url: '/static/html/modals.html',
              containerSelector: '#modalsContainer',
              eventName: 'modalsLoaded'
            })
            .catch((err) =>
              this.logger.warn?.(
                '[ModalManager] init: Failed to load modals.html',
                err,
                { context: 'modalManager' }
              )
            );
        } else {
          this.logger.warn?.(
            '[ModalManager] init: htmlTemplateLoader not available and modals not pre-injected. Emitting synthetic modalsLoaded event.'
          );
          // Emit synthetic event to unblock initialization
          this.domAPI.dispatchEvent(this.domAPI.getDocument(),
            new CustomEvent('modalsLoaded', {
              detail: { success: false, error: 'loader missing (synthetic)', synthetic: true }
            }));
          shouldWaitForEvent = false; // Don't wait for event we just dispatched
        }
      } catch (err) {
        this.logger.warn?.(
          '[ModalManager] init: Unexpected error during eager modals load',
          err,
          { context: 'modalManager' }
        );
        // Emit synthetic event to unblock initialization
        const doc = this.domAPI.getDocument();
        this.domAPI.dispatchEvent(
          doc,
          new CustomEvent('modalsLoaded', {
            detail: {
              success: false,
              error: err.message || 'Unexpected error during modal load',
              synthetic: true
            }
          })
        );
      }

      if (shouldWaitForEvent) {
        this.logger.info?.("[ModalManager] init: Waiting for 'modalsLoaded' event...");
        // CRITICAL CHANGE: Strict wait for modalsLoaded.
        // If modals.html fails to load or the event doesn't fire, ModalManager init will fail.
        modalsLoadedEventData = await this.domReadinessService.waitForEvent('modalsLoaded', {
          timeout: 15000, // Increased timeout to 15s for modals.html loading
          context: 'modalManager.init:waitForModalsLoaded'
        });

        if (!modalsLoadedEventData?.detail?.success) {
          this.logger.warn?.('[ModalManager] modalsLoaded indicated failure – continuing in degraded mode', { detail: modalsLoadedEventData.detail });
        }
        this.logger.info?.("[ModalManager] init: 'modalsLoaded' event received.", { synthetic: modalsLoadedEventData?.detail?.synthetic });
      } else {
        this.logger.info?.("[ModalManager] init: Skipping 'modalsLoaded' event wait - modals already present.");
      }

      /* -----------------------------------------------------------------
       * Ensure late listeners (e.g. app.js Stage-4) can still observe the
       * event even if it happened earlier in this init().
       * ----------------------------------------------------------------- */
      if (this.domReadinessService?.emitReplayable) {
        const detail =
          modalsLoadedEventData?.detail
            ?? { success: true, synthetic: !shouldWaitForEvent };
        this.domReadinessService.emitReplayable('modalsLoaded', detail);
      }

      // The one-time listener for 'modalsLoaded' to re-scan is removed as we now strictly await it.
      // If it was necessary due to late injection by other means, that's a separate issue.
      // For now, assume modals.html load is the sole trigger for 'modalsLoaded'.

      this.logger.debug?.('[ModalManager] init: Registering available modals after modalsLoaded.');
      this._registerAvailableModals();

      // Validate mapping ↔ DOM consistency
      this.validateModalMappings(this.modalMappings);

      const doc = this.domAPI.getDocument();
      this.domAPI.dispatchEvent(
        doc,
        new CustomEvent('modalmanager:initialized', { detail: { success: true } })
      );
      this.logger.info?.('[ModalManager] init() completed successfully. ModalManager is ready.');
      this._readyResolve?.(true);
    } catch (err) {
      this.logger.error?.('[ModalManager] init() failed catastrophically.', err, { context: 'modalManager.init' });
      this._readyReject?.(err); // Reject the promise
      // No rethrow here, error is reported via promise.
      // If rethrow is desired, ensure calling initializers (coreInit/uiInit) handle it.
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
        this.logger.error?.(`[ModalManager][validateModalMappings] No modal element found for modalId '${modalId}' (mapping key '${key}')`);
        this.errorReporter.report?.(new Error('Modal element not found'), { module: 'ModalManager', modalId, mappingKey: key, fn: 'validateModalMappings' });
      } else if (elements.length > 1) {
        this.logger.warn?.(`[ModalManager][validateModalMappings] Multiple modal elements found for modalId '${modalId}' (mapping key '${key}'). IDs must be unique.`);
        this.errorReporter.report?.(new Error('Duplicate modal element IDs'), { module: 'ModalManager', modalId, mappingKey: key, fn: 'validateModalMappings' });
      }
    });
  }

  async show(modalName, options = {}) {
    this.logger.debug?.(`[ModalManager] show() called for modal: ${modalName}`, { modalName, options });

    // CRITICAL CHANGE: Await readiness before proceeding
    try {
      this.logger.debug?.(`[ModalManager] show(${modalName}): Awaiting manager readiness (isReadyPromise).`);
      await this.isReadyPromise(); // Ensures init() completed successfully
      this.logger.debug?.(`[ModalManager] show(${modalName}): Manager is ready.`);
    } catch (err) {
      this.logger.error?.(`[ModalManager] show(${modalName}): ModalManager not ready or its initialization failed. Cannot show modal.`, { error: err, modalName });
      this.errorReporter.report?.(err, { module: 'ModalManager', fn: 'show', modalName, reason: 'ManagerNotReadyOrInitFailed' });
      return false; // Cannot proceed if manager isn't ready
    }

    // --- Ensure the injected modals container is visible and clear display overrides
    // Patch: make #modalsContainer always visible (remove 'hidden'/hidden/display:none) whenever opening
    const containerEl = this.domAPI.getElementById('modalsContainer');
    if (containerEl) {
      this.domAPI.removeClass(containerEl, 'hidden');
      containerEl.removeAttribute?.('hidden');
      containerEl.style.display = '';
    } else {
      // This might not be a critical error if modals are directly in body, but good to log.
      this.logger.warn?.(`[ModalManager] show(${modalName}): #modalsContainer element not found. Modals might not display correctly if they rely on this container.`, { modalName });
    }

    const INIT_SAFE = new Set(['login', 'register', 'error', 'fatal', 'confirm']);

    // Detect current app-initializing state regardless of whether the appModule
    // exposes it as a *method* (canonical as of 2025) or as a boolean flag.
    let appIsInitializing = false;
    if (this.app) {
      if (typeof this.app.isInitializing === 'function') {
        appIsInitializing = !!this.app.isInitializing();
      } else if (typeof this.app.isInitializing === 'boolean') {
        appIsInitializing = this.app.isInitializing;
      } else if (this.app.state && typeof this.app.state.initializing === 'boolean') {
        appIsInitializing = this.app.state.initializing;
      }
    }

    if (appIsInitializing && !options.showDuringInitialization && !INIT_SAFE.has(modalName)) {
      this.logger.warn?.(`[ModalManager] show(${modalName}): Attempt to show modal during app initialization (and !options.showDuringInitialization). Aborting.`, { modalName });
      return false;
    }

    const modalId = this.modalMappings[modalName];
    if (!modalId) {
      this.logger.warn?.(`[ModalManager] show(${modalName}): Modal name not found in mappings. Cannot show.`, { modalName });
      return false;
    }
    this.logger.debug?.(`[ModalManager] show(${modalName}): Found modalId "${modalId}" in mappings.`);

    const modalEl = this.domAPI.getElementById(modalId);
    if (!modalEl) {
      this.logger.warn?.(`[ModalManager] show(${modalName}): Modal element with ID "${modalId}" NOT FOUND in DOM. Cannot show. This is unexpected if init was successful.`, { modalName, modalId });
      return false;
    }
    this.logger.debug?.(`[ModalManager] show(${modalName}): Found modal element for ID "${modalId}". Proceeding to show.`);

    // Dynamic content for error modal
    if (modalName === 'error') {
      const titleEl = modalEl.querySelector('#errorModalTitle');
      const messageEl = modalEl.querySelector('#errorModalMessage');
      if (titleEl && options.title) titleEl.textContent = options.title;
      if (messageEl && options.message) messageEl.textContent = options.message;
      this.logger.debug?.(`[ModalManager] show(${modalName}): Populated error modal content.`, { title: options.title });
    }

    this._showModalElement(modalEl);

    if (this.domReadinessService?.emitReplayable)
      this.domReadinessService.emitReplayable('modalShown', { modal: modalName });

    this.activeModal = modalName;
    this.logger.info?.(`[ModalManager] Successfully shown modal: ${modalName} (#${modalId})`);
    return true;
  }

  async confirmAction(options) {
    this.logger.debug?.('[ModalManager] confirmAction() called.', { options });

    const sh = this.safeHandler;

    // CRITICAL CHANGE: Await readiness before proceeding (as it calls show())
    try {
      this.logger.debug?.('[ModalManager] confirmAction: Awaiting manager readiness (isReadyPromise).');
      await this.isReadyPromise();
      this.logger.debug?.('[ModalManager] confirmAction: Manager is ready.');
    } catch (err) {
      this.logger.error?.('[ModalManager] confirmAction: ModalManager not ready or its initialization failed. Cannot show confirmation.', { error: err });
      this.errorReporter.report?.(err, { module: 'ModalManager', fn: 'confirmAction', reason: 'ManagerNotReadyOrInitFailed' });
      // Optionally call options.onCancel() or throw, depending on desired behavior
      if (typeof options.onCancel === 'function') {
        options.onCancel(); // Simulate cancellation as modal cannot be shown
      }
      return; // Cannot proceed
    }

    const modalName = 'confirm';
    const modalId = this.modalMappings[modalName];
    if (!modalId) {
      this.logger.warn?.('[ModalManager] confirmAction: Confirm modal "confirm" not found in mappings.');
      return; // Cannot proceed
    }

    const modalEl = this.domAPI.getElementById(modalId);
    if (!modalEl) {
      this.logger.warn?.(`[ModalManager] confirmAction: Confirm modal element with ID "${modalId}" NOT FOUND in DOM.`);
      return; // Cannot proceed
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

    const confirmHandler = sh(() => {
      this.hide(modalName);
      if (typeof options.onConfirm === 'function') {
        options.onConfirm();
      }
    }, 'ModalManager:confirmAction:confirm');
    const cancelHandler = sh(() => {
      this.hide(modalName);
      if (typeof options.onCancel === 'function') {
        options.onCancel();
      }
    }, 'ModalManager:confirmAction:cancel');

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

  /**
   * Display the dedicated Delete confirmation modal (#deleteConfirmModal).
   * Mirrors confirmAction() but targets the "delete" mapping so we can have
   * separate copy/styling for destructive actions.
   *
   * @param {Object} options
   * @param {string} [options.title]        – Heading text (defaults to "Confirm Delete")
   * @param {string} [options.message]      – Body text
   * @param {string} [options.confirmText]  – Confirm button label (defaults "Delete")
   * @param {string} [options.cancelText]   – Cancel button label
   * @param {Function} [options.onConfirm]  – callback if user confirms
   * @param {Function} [options.onCancel]   – callback if user cancels/ closes
   * @returns {Promise<void>|undefined}
   */
  async confirmDelete(options = {}) {
    this.logger.debug?.('[ModalManager] confirmDelete() called.', { options });

    const sh = this.safeHandler;

    try {
      await this.isReadyPromise();
    } catch (err) {
      this.logger.error?.('[ModalManager] confirmDelete: manager not ready', err);
      if (typeof options.onCancel === 'function') options.onCancel();
      return;
    }

    const modalName = 'delete';
    const modalId = this.modalMappings[modalName];
    if (!modalId) {
      this.logger.warn?.('[ModalManager] confirmDelete: mapping "delete" missing');
      return;
    }

    const modalEl = this.domAPI.getElementById(modalId);
    if (!modalEl) {
      this.logger.warn?.(`[ModalManager] confirmDelete: element #${modalId} not found`);
      return;
    }

    // Populate content
    const titleEl = modalEl.querySelector('h3');
    const messageEl = modalEl.querySelector('#deleteConfirmText');
    const confirmBtn = modalEl.querySelector('#confirmDeleteBtn');
    const cancelBtn = modalEl.querySelector('#cancelDeleteBtn');

    if (titleEl) titleEl.textContent = options.title || 'Confirm Delete';
    if (messageEl) messageEl.textContent = options.message || 'Are you sure you want to delete this item?';
    if (confirmBtn) {
      confirmBtn.textContent = options.confirmText || 'Delete';
      confirmBtn.className = `btn ${options.confirmClass || 'btn-error'}`;
    }
    if (cancelBtn) cancelBtn.textContent = options.cancelText || 'Cancel';

    // Replace buttons to remove stale listeners
    function _replace(btn) {
      if (!btn) return null;
      const clone = btn.cloneNode(true);
      btn.parentNode.replaceChild(clone, btn);
      return clone;
    }
    const newConfirmBtn = _replace(confirmBtn);
    const newCancelBtn = _replace(cancelBtn);

    const confirmHandler = sh(() => {
      this.hide(modalName);
      if (typeof options.onConfirm === 'function') options.onConfirm();
    }, 'ModalManager:confirmDelete:confirm');

    const cancelHandler = sh(() => {
      this.hide(modalName);
      if (typeof options.onCancel === 'function') options.onCancel();
    }, 'ModalManager:confirmDelete:cancel');

    if (!this.eventHandlers?.trackListener) {
      throw new Error('[ModalManager] eventHandlers.trackListener is required for confirmDelete');
    }
    if (newConfirmBtn) {
      this.eventHandlers.trackListener(newConfirmBtn, 'click', confirmHandler, {
        description: 'Delete Modal Confirm Click',
        context: 'modalManager',
        source: 'ModalManager.confirmDelete'
      });
    }
    if (newCancelBtn) {
      this.eventHandlers.trackListener(newCancelBtn, 'click', cancelHandler, {
        description: 'Delete Modal Cancel Click',
        context: 'modalManager',
        source: 'ModalManager.confirmDelete'
      });
    }

    // Show modal via existing util
    this.show(modalName, {
      showDuringInitialization: options.showDuringInitialization,
    });
  }

  hide(modalName) {
    const modalId = this.modalMappings[modalName];
    if (!modalId) {
      this.logger.warn?.(`[ModalManager] hide(${modalName}): Modal name not found in mappings. Cannot hide.`, { modalName });
      return;
    }
    const modalEl = this.domAPI.getElementById(modalId);
    if (!modalEl) {
      this.logger.warn?.(`[ModalManager] hide(${modalName}): Modal element with ID "${modalId}" NOT FOUND in DOM. Cannot hide.`, { modalName, modalId });
      return;
    }
    this._hideModalElement(modalEl); // This logs internally

    if (this.domReadinessService?.emitReplayable)
      this.domReadinessService.emitReplayable('modalHidden', { modal: modalName });

    if (this.activeModal === modalName) {
      this.activeModal = null;
      this.logger.debug?.(`[ModalManager] hide(${modalName}): Modal hidden and activeModal cleared.`);
    } else {
      this.logger.debug?.(`[ModalManager] hide(${modalName}): Modal hidden. It was not the active modal (activeModal was ${this.activeModal}).`);
    }

    // Race-proof PATCH: Only hide #modalsContainer if *no* modals are visible or open.
    const containerEl = this.domAPI.getElementById('modalsContainer');
    if (containerEl) {
      const modals = containerEl.querySelectorAll('.modal');
      let stillOpen = false;
      modals.forEach(modal => {
        if ((typeof modal.open === 'boolean' && modal.open) ||
            (!modal.classList.contains('hidden') && !modal.hasAttribute('hidden'))) {
          stillOpen = true;
        }
      });
      if (!stillOpen) {
        containerEl.classList.add('hidden');
        containerEl.setAttribute('hidden', 'true');
        containerEl.style.display = 'none';
      }
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
   *   @param {Object} [opts.domReadinessService] -- injected readiness service
   *   @param {Object} [opts.logger]
   *   @param {Object} [opts.errorReporter]
   */
  constructor({ projectManager, eventHandlers, DependencySystem, domAPI, domPurify, domReadinessService, logger, errorReporter } = {}) {
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

    this.domReadinessService =
      domReadinessService ||
      this.DependencySystem?.modules?.get?.('domReadinessService') ||
      null;

    if (!this.domReadinessService) {
      throw new Error('[ProjectModal] domReadinessService DI not provided');
    }

    if (!logger) throw new Error('[ProjectModal] logger is required');
    this.logger = logger;
    this.errorReporter =
      errorReporter ||
      this.DependencySystem?.modules?.get?.('errorReporter') ||
      { report: () => { } };

    this.modalElement = null;
    this.formElement = null;
    this.isOpen = false;
    this.currentProjectId = null;

    this.logger.info?.('[ProjectModal] constructed'); // Changed to info for better visibility

    // Inject mobile modal safe-area CSS via domAPI (once per instance)
    try {
      const doc = this.domAPI.getDocument();
      const win = this.domAPI.getWindow?.();
      const markerId = 'modal-box-safe-area-css';
      if (doc && win && !this.domAPI.getElementById(markerId)) {
        const styleEl = this.domAPI.createElement('style');
        styleEl.id = markerId;
        styleEl.textContent =
          `@media (max-width:640px){` +
          `.modal-box{max-width:calc(100vw - 2rem)!important;` +
          `max-height:calc(100vh - 3.5rem)!important;overflow-y:auto;}` +
          `.modal.modal-bottom{align-items:flex-end;}` +
          `.sm\\:modal-middle{align-items:flex-start;}` +
          `}`;
        this.domAPI.appendChild(doc.head, styleEl);
      }
    } catch (e) {
      this.logger.debug?.('[ProjectModal] safe-area CSS injection failed', e, { context: 'modalManager' });
    }
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

  /**
   * Await readiness of modal DOM elements via domReadinessService.
   * This method must be called and awaited before interacting with modal DOM.
   */
  async init() {
    this.logger.info?.('[ProjectModal] init() called.');
    try {
      // This relies on modals.html (containing #projectModal) already being loaded.
      // ModalManager's init should ensure this before ProjectModal.init is typically called.
      this.logger.debug?.('[ProjectModal] init: Awaiting DOM elements #projectModal and #projectModalForm.');
      await this.domReadinessService.dependenciesAndElements({
        domSelectors: ['#projectModal', '#projectModalForm'],
        timeout: 7000, // Increased timeout slightly, assuming modals.html is loaded
        context: 'projectModal.init:awaitElements'
      });
      this.logger.debug?.('[ProjectModal] init: DOM elements wait completed.');

      this.modalElement = this.domAPI.getElementById('projectModal');
      this.formElement = this.domAPI.getElementById('projectModalForm');

      if (!this.modalElement) {
        this.logger.error?.('[ProjectModal] init: #projectModal element NOT FOUND in DOM after domReadinessService wait. This is critical.');
        throw new Error('[ProjectModal] #projectModal element not found on init.');
      }
      if (!this.formElement) {
        this.logger.error?.('[ProjectModal] init: #projectModalForm element NOT FOUND in DOM after domReadinessService wait. This is critical.');
        throw new Error('[ProjectModal] #projectModalForm element not found on init.');
      }
      this.logger.debug?.('[ProjectModal] init: #projectModal and #projectModalForm elements successfully found.');

      this.setupEventListeners(); // Internal logging within this method

      if (typeof this.domAPI.dispatchEvent === 'function' && this.modalElement) {
        this.domAPI.dispatchEvent(
          this.modalElement,
          new CustomEvent('projectModal:ready', { detail: { success: true } })
        );
      }
      this.logger.info?.('[ProjectModal] init() completed successfully.');
    } catch (err) {
      this.logger.error?.('[ProjectModal] init() failed.', err, { context: 'projectModal.init' });
      this.errorReporter.report?.(err, { module: 'ProjectModal', fn: 'init', reason: 'DomElementsOrListenersFailed' });
      throw err; // Re-throw so callers (e.g., UI initializer) know init failed
    }
  }

  destroy() {
    if (!this.eventHandlers?.cleanupListeners) {
      return;
    }
    this.eventHandlers.cleanupListeners({ context: 'projectModal' });
  }

  openModal(project = null) {
    if (!this.modalElement) {
      this.logger.warn?.('[ProjectModal] openModal: modalElement is null (likely init failed). Cannot open.');
      return;
    }
    this.logger.debug?.(`[ProjectModal] openModal called. Project: ${project ? project.id : 'new'}`, { project });

    if (this.formElement) {
      this.formElement.reset();
      this.logger.debug?.('[ProjectModal] openModal: Form reset.');
    } else {
      this.logger.warn?.('[ProjectModal] openModal: formElement is null. Cannot reset form.');
    }

    const titleEl = this.modalElement.querySelector('#projectModalTitle');
    if (titleEl) {
      titleEl.textContent = project ? 'Edit Project' : 'Create Project';
    } else {
      this.logger.warn?.('[ProjectModal] openModal: #projectModalTitle element not found.');
    }

    if (project) {
      this.currentProjectId = project.id;
      this.logger.debug?.(`[ProjectModal] openModal: Populating form for editing project ID: ${this.currentProjectId}`);
      const idInput = this.modalElement.querySelector('#projectModalIdInput');
      const nameInput = this.modalElement.querySelector('#projectModalNameInput');
      const descInput = this.modalElement.querySelector('#projectModalDescInput');
      const goalsInput = this.modalElement.querySelector('#projectModalGoalsInput');
      const maxTokensInput = this.modalElement.querySelector('#projectModalMaxTokensInput');

      if (idInput) idInput.value = project.id || ''; else this.logger.warn?.('[ProjectModal] openModal: #projectModalIdInput not found.');
      if (nameInput) nameInput.value = project.name || ''; else this.logger.warn?.('[ProjectModal] openModal: #projectModalNameInput not found.');
      if (descInput) descInput.value = project.description || ''; else this.logger.warn?.('[ProjectModal] openModal: #projectModalDescInput not found.');
      if (goalsInput) goalsInput.value = project.goals || ''; else this.logger.warn?.('[ProjectModal] openModal: #projectModalGoalsInput not found.');
      if (maxTokensInput) maxTokensInput.value = project.max_tokens || ''; else this.logger.warn?.('[ProjectModal] openModal: #projectModalMaxTokensInput not found.');
    } else {
      this.currentProjectId = null;
      this.logger.debug?.('[ProjectModal] openModal: Clearing form for new project.');
      const idEl = this.modalElement.querySelector('#projectModalIdInput');
      if (idEl) {
        idEl.value = ''; // Ensure hidden ID field is cleared for new projects
      } else {
        this.logger.warn?.('[ProjectModal] openModal: #projectModalIdInput not found for clearing.');
      }
      // Explicitly clear other fields for new project scenario
      const nameInput = this.modalElement.querySelector('#projectModalNameInput');
      if (nameInput) nameInput.value = '';
      const descInput = this.modalElement.querySelector('#projectModalDescInput');
      if (descInput) descInput.value = '';
      const goalsInput = this.modalElement.querySelector('#projectModalGoalsInput');
      if (goalsInput) goalsInput.value = '';
      const maxTokensInput = this.modalElement.querySelector('#projectModalMaxTokensInput');
      if (maxTokensInput) maxTokensInput.value = '';

    }

    this._showModalElement(); // Internal logging for show
    this.isOpen = true;
    this.logger.info?.(`[ProjectModal] Modal opened. Mode: ${project ? 'edit' : 'create'}, Project ID: ${this.currentProjectId || 'N/A'}`);
  }

  setupEventListeners() {
    if (!this.modalElement) {
      this.logger.warn?.('[ProjectModal] setupEventListeners: modalElement is null. Cannot set up common listeners.');
      // If modalElement is null, formElement is also likely null or irrelevant.
      return;
    }
    if (!this.formElement) {
      this.logger.warn?.('[ProjectModal] setupEventListeners: formElement is null. Cannot set up form submit listener.');
      // Proceed to set up modal-specific listeners like ESC and backdrop if modalElement exists
    }

    this.logger.debug?.('[ProjectModal] Setting up event listeners.');

    // Submit handling is now managed centrally by EventHandler.setupProjectModalForm.
    // This avoids registering multiple 'submit' listeners on the same form which
    // previously caused a second submission after the form was reset, triggering
    // spurious “Project name is required” validation errors.  Local submit
    // binding has therefore been removed.

    const cancelBtn = this.modalElement.querySelector('#projectCancelBtn');
    if (cancelBtn) {
      const cancelHandler = (e) => {
        e.preventDefault();
        this.logger.debug?.('[ProjectModal] Cancel button clicked.');
        this.closeModal();
      };
      this._bindEvent(cancelBtn, 'click', cancelHandler, 'ProjectModal Cancel button click');
    } else {
      this.logger.warn?.('[ProjectModal] setupEventListeners: Cancel button #projectCancelBtn not found in #projectModal.');
    }

    // Listen on document for ESC key for wider capture, e.g., if focus is not directly in modal
    const escHandler = (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.logger.debug?.('[ProjectModal] ESC key pressed while modal is open, closing modal.');
        this.closeModal();
      }
    };
    this._bindEvent(
      this.domAPI.ownerDocument, // Changed from this.modalElement for broader scope if modal loses focus
      'keydown',
      escHandler,
      'ProjectModal Document ESC key handler'
    );

    // Click on backdrop (dialog element itself) to close, if it's a <dialog>
    // For non-<dialog> fallbacks, this might need CSS to make the backdrop clickable.
    const backdropHandler = (e) => {
      // Check if the click is directly on the dialog/modalElement itself
      if (e.target === this.modalElement && this.isOpen) {
        this.logger.debug?.('[ProjectModal] Backdrop clicked (e.target is modalElement), closing modal.');
        this.closeModal();
      }
    };
    this._bindEvent(
      this.modalElement, // Listener on the modal itself
      'click',
      backdropHandler,
      'ProjectModal backdrop click handler'
    );
    this.logger.debug?.('[ProjectModal] Event listeners setup completed.');
  }

  closeModal() {
    if (!this.modalElement) {
      this.logger.warn?.('[ProjectModal] closeModal: modalElement is null. Cannot close.');
      return;
    }
    if (!this.isOpen) {
      this.logger.debug?.('[ProjectModal] closeModal: Modal is already closed or was never opened.');
      return;
    }
    this._hideModalElement(); // Internal logging for hide
    this.isOpen = false;
    const closedProjectId = this.currentProjectId; // Capture before resetting
    this.currentProjectId = null;
    this.logger.info?.(`[ProjectModal] Modal closed. Was for Project ID: ${closedProjectId || 'N/A'}`);
  }

  async handleSubmit(e) {
    e.preventDefault(); // Always prevent default for form submission via JS
    if (!this.formElement) {
      this.logger.warn?.('[ProjectModal] handleSubmit: formElement is null. Cannot process submission.');
      return;
    }
    this.logger.debug?.('[ProjectModal] handleSubmit: Form submission initiated.');

    const saveBtn = this.modalElement.querySelector('#projectSaveBtn');
    if (!saveBtn) {
      this.logger.warn?.('[ProjectModal] handleSubmit: Save button #projectSaveBtn not found. UI update for loading state will fail.');
    }

    try {
      const formData = new FormData(this.formElement);
      const projectData = {
        name: formData.get('name')?.trim() || '', // Ensure trimmed
        description: formData.get('description') || '',
        goals: formData.get('goals') || '',
        max_tokens: formData.get('maxTokens') || null
      };
      // projectId from hidden input for existing projects, or null/empty for new.
      // this.currentProjectId is set when opening for an existing project.
      const projectIdFromForm = formData.get('projectId');
      const idToSave = projectIdFromForm || this.currentProjectId; // Prefer form ID if available, else currentProjectId

      this.logger.debug?.(`[ProjectModal] handleSubmit: Project data extracted. Name: "${projectData.name}", Form ID: "${projectIdFromForm}", Current Edit ID: "${this.currentProjectId}", Effective ID for save: "${idToSave}"`);

      if (!projectData.name) { // Check after trim
        this.logger.warn?.('[ProjectModal] handleSubmit: Project name is empty after trim. Aborting save.');
        // TODO: Implement user-facing validation feedback (e.g., highlight field, show message)
        this.errorReporter.report?.(new Error('Validation: Project name empty'), {
          module: 'ProjectModal', fn: 'handleSubmit', validationError: true, field: 'name'
        });
        if (saveBtn) this._setButtonLoading(saveBtn, false); // Reset button if validation fails early
        return;
      }

      if (saveBtn) this._setButtonLoading(saveBtn, true, 'Saving...');
      this.logger.info?.(`[ProjectModal] handleSubmit: Attempting to save project. ID: ${idToSave || '(new project)'}, Name: "${projectData.name}"`);

      await this.saveProject(idToSave, projectData); // Use idToSave (could be null for new project)

      this.logger.info?.(`[ProjectModal] handleSubmit: Project save successful. ID: ${idToSave || '(new project after save)'}, Name: "${projectData.name}"`);
      this.closeModal();

    } catch (err) {
      this.logger.error?.('[ProjectModal][handleSubmit] Error during project save operation:', err, { projectId: this.currentProjectId, formData: Object.fromEntries(new FormData(this.formElement)) });
      this.errorReporter.report?.(err, { module: 'ProjectModal', fn: 'handleSubmit', currentProjectId: this.currentProjectId });
      // TODO: Show error to user within the modal (e.g., a toast or message area in the modal)
    } finally {
      // Ensure button loading state is always reset, even if saveBtn was not found initially (though less likely)
      if (saveBtn) this._setButtonLoading(saveBtn, false);
      this.logger.debug?.('[ProjectModal] handleSubmit: Submission process finished.');
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
  eventHandlers, domAPI, browserService, DependencySystem,
  modalMapping, domPurify, domReadinessService, logger
} = {}) {
  if (!logger) throw new Error('[createModalManager] logger dependency is required');
  return new ModalManager({
    eventHandlers, domAPI, browserService, DependencySystem,
    modalMapping, domPurify, domReadinessService, logger
  });
}

/**
 * Factory that creates a **ProjectModal** instance.
 * Validates required dependencies and exposes a compliant public API that
 * includes a mandatory `cleanup()` method for listener/resource teardown.
 *
 * @param {Object} deps
 * @param {Object} deps.projectManager          – Required
 * @param {Object} deps.eventHandlers           – Required
 * @param {Object} deps.domAPI                  – Required
 * @param {Object} deps.domReadinessService     – Required
 * @param {Object} [deps.DependencySystem]      – Optional DI container
 * @param {Object} [deps.domPurify]             – Optional sanitizer
 * @returns {Object} Public API surface for the created ProjectModal
 */
export function createProjectModal(deps = {}) {
  const {
    projectManager,
    eventHandlers,
    DependencySystem,
    domAPI,
    domPurify,
    domReadinessService,
    logger
  } = deps;

  // ─── Dependency validation (Factory Rule #1) ────────────────────────────────
  if (!projectManager) throw new Error('[createProjectModal] Missing dependency: projectManager');
  if (!eventHandlers) throw new Error('[createProjectModal] Missing dependency: eventHandlers');
  if (!domAPI) throw new Error('[createProjectModal] Missing dependency: domAPI');
  if (!domReadinessService) throw new Error('[createProjectModal] Missing dependency: domReadinessService');
  if (!logger)             throw new Error('[createProjectModal] Missing dependency: logger');

  // ─── Instance creation ──────────────────────────────────────────────────────
  const instance = new ProjectModal({
    projectManager, eventHandlers, DependencySystem,
    domAPI, domPurify, domReadinessService, logger
  });

  // ─── Exposed public API (no direct instance leak) ───────────────────────────
  return {
    // Conveniences mirroring underlying instance ------------------------------
    initialize: (...args) => instance.init(...args),
    openModal: (...args) => instance.openModal(...args),
    closeModal: (...args) => instance.closeModal(...args),

    // Optional direct access (kept minimal & explicit)
    getInstance: () => instance,

    // MANDATORY cleanup hook per guardrails -----------------------------------
    cleanup: () => {
      if (eventHandlers?.cleanupListeners) {
        eventHandlers.cleanupListeners({ context: 'projectModal' });
      }
      instance.destroy();
    }
  };
}

// Inject mobile modal safe-area rule once only (after library/module load)
