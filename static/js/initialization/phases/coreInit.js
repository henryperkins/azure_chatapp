// ========================================
// FILE: /initialization/phases/coreInit.js
// ========================================
/**
 * Core-system bootstrap phase
 * ----------------------------------------
 * The original monolithic `appInitializer.js` contained ~300 lines of logic
 * that instantiated and registered the application-wide managers such as
 * ModalManager, ProjectManager and (optionally) ChatManager.  During the
 * refactor these lines were removed and a temporary stub that threw an error
 * was left behind to remind maintainers that the extraction was pending.
 *
 * This file supplies a *minimal* but fully-functional implementation of that
 * logic so that the new initialization pipeline can complete without
 * blowing up.  The implementation purposefully focuses on wiring and DI – it
 * does **not** try to re-introduce all historical side-effects.  Any heavy
 * lifting remains the responsibility of the dedicated feature factories
 * (`createModalManager`, `createProjectManager`, `createChatManager`, …).
 *
 * Key goals:
 *   1. No thrown "Not implemented" error anymore ➜ boot sequence succeeds.
 *   2. Instantiate the core managers if the corresponding factory functions
 *      are available.
 *   3. Register the created instances with the DependencySystem using the
 *      canonical module names expected by downstream code.
 *   4. Provide a cleanup() that tears down event listeners of the created
 *      instances (best-effort – only if the instance exposes a cleanup
 *      method).
 */

// External factories (resolved at *runtime* to avoid circular deps)
import { createModalManager }       from "../../modalManager.js";
import { createProjectManager }     from "../../projectManager.js";

// Optional factories live outside the initialization tree and are therefore
// injected via the argument object.  Falling back to dynamic import would
// re-introduce the circular-dependency maze we just got rid of.

export function createCoreInit(deps = {}) {
  const {
    // Mandatory core services
    DependencySystem,
    logger,
    domAPI,
    browserService,
    eventHandlers,
    domReadinessService,
    sanitizer,

    // Injected factory helpers (may be undefined)
    createChatManager : injectedCreateChatManager,
  } = deps;

  if (!DependencySystem) throw new Error('[coreInit] Missing DependencySystem');
  if (!logger)          throw new Error('[coreInit] Missing logger');
  if (!domAPI)          throw new Error('[coreInit] Missing domAPI');
  if (!browserService)  throw new Error('[coreInit] Missing browserService');
  if (!eventHandlers)   throw new Error('[coreInit] Missing eventHandlers');
  if (!domReadinessService) throw new Error('[coreInit] Missing domReadinessService');
  if (!sanitizer)       throw new Error('[coreInit] Missing sanitizer');

  // Instance holders so that cleanup() can iterate over them later.
  const _instances = new Map();

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

  const registerInstance = (name, instance) => {
    if (!instance) return;
    _instances.set(name, instance);
    if (!DependencySystem.modules.has(name)) {
      DependencySystem.register(name, instance);
    } else {
      DependencySystem.modules.set(name, instance);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  async function initializeCoreSystems() {
    logger.info('[coreInit] Initializing core systems…', { context: 'coreInit' });

    /* ---------------- Modal Manager ---------------- */
    try {
      if (!DependencySystem.modules.get('modalManager')) {
        const modalMgr = createModalManager({
          eventHandlers,
          domAPI,
          browserService,
          DependencySystem,
          domPurify: sanitizer,
          domReadinessService,
          logger,
          errorReporter : DependencySystem.modules.get('errorReporter'),
          eventService  : DependencySystem.modules.get('eventService'),
          sanitizer,
        });

        registerInstance('modalManager', modalMgr);

        if (typeof modalMgr.initialize === 'function') {
          await modalMgr.initialize();
        }
      }
    } catch (err) {
      logger.error('[coreInit] Failed to bootstrap ModalManager', err, { context: 'coreInit:modalManager' });
      throw err;
    }

    /* ---------------- Project Manager ---------------- */
    try {
      if (!DependencySystem.modules.get('projectManager')) {
        const projectMgr = createProjectManager({
          DependencySystem,
          domReadinessService,
          logger,
          timer         : browserService,
          eventHandlers,
          eventService  : DependencySystem.modules.get('eventService'),
        });

        registerInstance('projectManager', projectMgr);
      }
    } catch (err) {
      logger.error('[coreInit] Failed to bootstrap ProjectManager', err, { context: 'coreInit:projectManager' });
      throw err;
    }

    /* ---------------- Chat Manager (optional) ---------------- */
    try {
      if (typeof injectedCreateChatManager === 'function' && !DependencySystem.modules.get('chatManager')) {

        // Resolve dependent factories from DI.  If any are missing we skip
        // chat bootstrapping instead of throwing.
        const createConversationManager = DependencySystem.modules.get('createConversationManager');
        const createMessageHandler      = DependencySystem.modules.get('createMessageHandler');
        const createChatUIController    = DependencySystem.modules.get('createChatUIController');

        if (createConversationManager && createMessageHandler && createChatUIController) {

          const chatMgr = injectedCreateChatManager({
            DependencySystem,
            logger,
            eventHandlers,
            domReadinessService,
            domAPI,
            eventService : DependencySystem.modules.get('eventService'),

            conversationManager : createConversationManager({
              DependencySystem,
              logger,
              apiRequest        : DependencySystem.modules.get('apiRequest'),
              apiEndpoints      : DependencySystem.modules.get('apiEndpoints'),
              projectContextService : DependencySystem.modules.get('projectContextService'),
              authenticationService : DependencySystem.modules.get('authenticationService')
                  || DependencySystem.modules.get('authStateManager'),
              browserService,
              tokenStatsManager : DependencySystem.modules.get('tokenStatsManagerProxy'),
              modelConfig       : DependencySystem.modules.get('modelConfig'),
              eventService      : DependencySystem.modules.get('eventService'),
              eventBus          : DependencySystem.modules.get('AppBus'),
            }),

            messageHandler : createMessageHandler({
              DependencySystem,
              logger,
              apiRequest   : DependencySystem.modules.get('apiRequest'),
              apiEndpoints : DependencySystem.modules.get('apiEndpoints'),
              browserService,
            }),

            chatUIController : createChatUIController({
              DependencySystem,
              domAPI,
              browserService,
              logger,
              eventHandlers,
              sanitizer,
            }),
          });

          registerInstance('chatManager', chatMgr);

          if (chatMgr.initialize) {
            chatMgr.initialize().catch((err) => {
              logger.error('[coreInit] chatManager.initialize() failed', err, { context: 'coreInit:chatManager' });
            });
          }
        } else {
          logger.debug('[coreInit] Skipping ChatManager bootstrap – dependent factories not available', { context: 'coreInit:chatManager' });
        }
      }
    } catch (err) {
      logger.error('[coreInit] Failed to bootstrap ChatManager', err, { context: 'coreInit:chatManager' });
      // Do *not* re-throw – chat is optional.
    }

    logger.info('[coreInit] Core systems initialised', { context: 'coreInit' });
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Cleanup                                                             */
  /* ------------------------------------------------------------------ */

  function cleanup() {
    for (const [name, inst] of _instances.entries()) {
      try {
        if (typeof inst.cleanup === 'function') {
          inst.cleanup();
        }
      } catch (err) {
        logger.warn(`[coreInit] ${name}.cleanup() threw`, err, { context: 'coreInit:cleanup' });
      }
    }

    eventHandlers.cleanupListeners({ context: 'coreInit' });
    logger.debug('[coreInit] Cleanup completed', { context: 'coreInit' });
  }

  return {
    initializeCoreSystems,
    cleanup,
  };
}
