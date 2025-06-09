export function createSafeHandler({ DependencySystem, logger } = {}) {
  if (!DependencySystem) throw new Error('[createSafeHandler] DependencySystem required');
  if (!logger)          throw new Error('[createSafeHandler] logger required');

  const raw = DependencySystem.modules?.get?.('safeHandler');

  function safeHandler(fn, ctx = 'safeHandler') {
    return typeof raw === 'function'
      ? raw(fn, ctx)
      : (typeof raw?.safeHandler === 'function'
          ? raw.safeHandler(fn, ctx)
          : (...a) => {
              try { return fn(...a); }
              catch (err) {
                logger.error('[safeHandler] wrapped fn failed', err,
                  { context: 'safeHandler:' + ctx });
              }
            });
  }

  return { safeHandler, cleanup() {} };
}

// Legacy named export (unchanged signature)
export function getSafeHandler(DependencySystem) {
  return createSafeHandler({ DependencySystem, logger: { error(){} } }).safeHandler;
}

// Default export for compatibility
export default createSafeHandler;
