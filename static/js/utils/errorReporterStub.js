/**
 * errorReporterStub.js — Guardrails-compliant stub factory for error reporting.
 */

export function createErrorReporterStub({ logger, context = 'ErrorReporterStub' } = {}) {
  if (!logger || typeof logger.error !== 'function') {
    throw new Error('[errorReporterStub] logger dependency with .error() required');
  }
  function report(...args) {
    logger.error(`[${context}]`, ...args, { context });
  }
  // Cleanup API for guardrails
  function cleanup() {
    // No-op: nothing to cleanup in stub, present for uniformity.
  }
  return { report, cleanup };
}
