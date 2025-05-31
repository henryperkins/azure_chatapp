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

export function createChatExtensions(options) {
  // === FACTORY GUARDRAIL: STRICT DI VALIDATION (No fallback, throw immediately, BEFORE destructuring) ===
  if (!options) throw new Error('Missing options');
  if (!options.DependencySystem) throw new Error('Missing DependencySystem');
  if (!options.eventHandlers) throw new Error('Missing eventHandlers');
  if (!options.chatManager) throw new Error('Missing chatManager');

  if (!options.app) throw new Error('Missing app');
  if (!options.domAPI) throw new Error('Missing domAPI');
  if (!options.domReadinessService) throw new Error('Missing domReadinessService');
  if (!options.logger) throw new Error('Missing logger');

  // Strict Dependency Injection — all dependencies must be passed in via options
  const {
    DependencySystem,
    eventHandlers,
    chatManager,
    app,
    domAPI,
    domReadinessService,
    logger
  } = options;

  var MODULE_CONTEXT = "chatExtensions";

  async function init() {
    logger.info('[chatExtensions] disabled – awaiting redesign');
  }


  function destroy() {
    if (DependencySystem && typeof DependencySystem.cleanupModuleListeners === "function") {
      DependencySystem.cleanupModuleListeners(MODULE_CONTEXT);
    } else if (eventHandlers && typeof eventHandlers.cleanupListeners === "function") {
      eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
    }
  }

  function cleanup() {
    destroy();
  }

  return {
    init: init,
    destroy: destroy,
    cleanup: cleanup
  };
}

export default createChatExtensions;
