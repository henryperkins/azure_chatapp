const MODULE = 'KBStateService';

export function createKnowledgeBaseStateService({ eventService, logger } = {}) {
  if (!eventService) throw new Error(`[${MODULE}] Missing eventService`);
  if (!logger) throw new Error(`[${MODULE}] Missing logger`);

  let _kb = null;
  const emit = () => eventService.emit('knowledgeBaseChanged', { kb: _kb });

  return Object.freeze({
    setKB(kb) { _kb = kb || null; logger.debug(`[${MODULE}] setKB`, { id: _kb?.id }); emit(); },
    clearKB() { if (_kb) { _kb = null; emit(); } },
    getKB() { return _kb; },
    isActive() { return Boolean(_kb && _kb.is_active !== false); },
    cleanup() { _kb = null; }
  });
}

export default createKnowledgeBaseStateService;
