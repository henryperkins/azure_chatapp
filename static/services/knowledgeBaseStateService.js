const MODULE = 'KBStateService';

/**
 * KB State Service (Single Source of Truth via appModule.state)
 * This service stores KB state in appModule.state. All reads/writes go through appModule.state. 
 * This ensures no desynchronization with the canonical app state.
 */
export function createKnowledgeBaseStateService({ eventService, logger, appModule } = {}) {
  if (!eventService) throw new Error(`[${MODULE}] Missing eventService`);
  if (!logger) throw new Error(`[${MODULE}] Missing logger`);
  if (!appModule || !appModule.state) throw new Error(`[${MODULE}] Missing appModule with state`);

  const emit = () => eventService.emit('knowledgeBaseChanged', { kb: appModule.state.knowledgeBase || null });

  return Object.freeze({
    setKB(kb) {
      appModule.state.knowledgeBase = kb || null;
      logger.debug(`[${MODULE}] setKB`, { id: appModule.state.knowledgeBase?.id });
      emit();
    },
    clearKB() {
      if (appModule.state.knowledgeBase) {
        appModule.state.knowledgeBase = null;
        emit();
      }
    },
    getKB() {
      return appModule.state.knowledgeBase || null;
    },
    isActive() {
      const kb = appModule.state.knowledgeBase;
      return Boolean(kb && kb.is_active !== false);
    },
    cleanup() {
      appModule.state.knowledgeBase = null;
    }
  });
}

export default createKnowledgeBaseStateService;
