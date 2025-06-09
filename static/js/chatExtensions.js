/**
 * chatExtensions.js
 * DependencySystem/DI refactored modular extension for chat UI enhancements:
 *  - Chat title editing
 *  - Future conversation actions
 *
 * Usage:
 *   import { createChatExtensions } from './chatExtensions.js';
 *   const chatExtensions = createChatExtensions({ DependencySystem });
 *   chatExtensions.init(); // call after DOM is ready
 */

export function createChatExtensions(options = {}) {
  /* ------------------------------------------------------------------
   * Factory Guardrails – Validate dependencies & feature flag gating
   * ------------------------------------------------------------------ */
  if (!options.DependencySystem) throw new Error("[chatExtensions] Missing DependencySystem");

  // Feature-flag gating (EXT_CHAT) --------------------------------------
  const isEnabled =
    // Explicit override wins
    options.extChatEnabled === true ||
    // If app module exposes featureFlags, honour EXT_CHAT
    options.app?.featureFlags?.EXT_CHAT === true;

  if (!isEnabled) {
    throw new Error("[chatExtensions] disabled by feature flag EXT_CHAT=off");
  }

  // --- STRICT DI VALIDATION (no silent fallbacks) ----------------------
  const REQUIRED_DEPS = [
    "eventHandlers",
    "chatManager",
    "app",
    "domAPI",
    "domReadinessService",
    "logger",
  ];

  for (const dep of REQUIRED_DEPS) {
    if (!options[dep]) {
      throw new Error(`[chatExtensions] Missing ${dep}`);
    }
  }

  const {
    DependencySystem,
    eventHandlers,
    chatManager,
    app,
    domAPI,
    domReadinessService,
    logger,
  } = options;

  const MODULE_CONTEXT = "chatExtensions";

  // Register the factory instance in the DI container so other modules can
  // lazily resolve it without violating guard-rails (no direct imports).
  if (typeof DependencySystem?.register === 'function' && !DependencySystem.modules?.get('chatExtensionsFactory')) {
    DependencySystem.register('chatExtensionsFactory', createChatExtensions);
  }

  /* ------------------------------------------------------------------
   * Public API
   * ------------------------------------------------------------------ */
  /* ------------------------------------------------------------------
   * init()
   * ------------------------------------------------------------------
   * Lightweight, guard-rails-compliant bootstrap that wires the minimal UI
   * interactions required for phase-2 without blocking the application.
   *
   * Capabilities delivered in this initial version:
   *   • Conversation-title inline edit (click → prompt → update DOM + emit event)
   *   • Emits unified event on `AppBus` / `eventBus` so other modules can react.
   *   • No backend PATCH call yet – that will be added once the conversation
   *     update endpoint is finalised (tracked in docs/phase2/2.1).
   */
  async function init() {
    const context = `${MODULE_CONTEXT}::init`;

    // Wait for the title element to appear.
    try {
      await domReadinessService.dependenciesAndElements({
        domSelectors: ['#conversationTitle'],
        timeout: 8000,
        context,
      });
    } catch (err) {
      logger.warn('[chatExtensions] conversationTitle element not found – skipping title-edit wiring', err, { context });
      return; // Nothing else to wire, exit gracefully.
    }

    const titleEl = domAPI.getElementById('conversationTitle');
    if (!titleEl) {
      logger.warn('[chatExtensions] conversationTitle element resolved to null – abort wiring', { context });
      return;
    }

    // Add visual affordance (editable cursor) – non-intrusive.
    titleEl.style.cursor = 'pointer';
    titleEl.title = 'Click to rename conversation';

    const safeHandler = DependencySystem?.modules?.get('safeHandler') || ((fn) => fn);

    // Click handler → prompt for new title, update DOM + emit event.
    eventHandlers.trackListener(
      titleEl,
      'click',
      safeHandler(async () => {
        const currentTitle = titleEl.textContent || '';
        // Simple prompt – will be replaced by modal in Phase-3.
        const newTitle = globalThis.prompt('Rename conversation', currentTitle);
        if (!newTitle || newTitle.trim() === '' || newTitle === currentTitle) return;

        titleEl.textContent = newTitle.trim();

        // Notify others via unified bus if available.
        const appBus = DependencySystem.modules.get('AppBus') || DependencySystem.modules.get('eventBus');
        if (appBus) {
          appBus.dispatchEvent(new CustomEvent('conversation:titleEdited', {
            detail: {
              conversationId: chatManager?.currentConversationId || null,
              newTitle: newTitle.trim(),
            }
          }));
        }

        logger.info('[chatExtensions] Conversation title updated', {
          context: MODULE_CONTEXT,
          conversationId: chatManager?.currentConversationId || null,
          newTitle: newTitle.trim(),
        });
      }, 'conversationTitleClick'),
      { context: MODULE_CONTEXT, description: 'conversationTitleClickHandler' },
    );

    logger.debug('[chatExtensions] Title-edit wiring completed', { context });
  }

  function destroy() {
    if (
      DependencySystem &&
      typeof DependencySystem.cleanupModuleListeners === "function"
    ) {
      DependencySystem.cleanupModuleListeners(MODULE_CONTEXT);
    }
    if (
      eventHandlers &&
      typeof eventHandlers.cleanupListeners === "function"
    ) {
      eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
    }
  }

  // Register instance in DI container before exposing public API so that other
  // modules can resolve it immediately. The guard-rails allow registration at
  // factory-execution time inside appInitializer-imported modules.
  try {
    if (typeof DependencySystem?.modules?.get === 'function' &&
        !DependencySystem.modules.get('chatExtensions') &&
        typeof DependencySystem.register === 'function') {
      DependencySystem.register('chatExtensions', { init, destroy, cleanup: destroy });
    }
  } catch (regErr) {
    try {
      logger?.warn?.('[chatExtensions] Failed to register instance in DependencySystem', regErr, { context: MODULE_CONTEXT });
    } catch {/* noop */}
  }

  return { init, destroy, cleanup: destroy };
}

export default createChatExtensions;
