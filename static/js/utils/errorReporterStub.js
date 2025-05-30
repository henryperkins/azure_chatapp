export function createErrorReporterStub({ logger } = {}) {
  if (!logger) throw new Error('[errorReporterStub] Missing logger dependency');
  const log = logger;
  return {
    report: (...args) => {
      const err = new Error('[errorReporterStub] No real reporter provided');
      log.error('[errorReporterStub] report() called on stub', err,
                { context: 'errorReporterStub:report', args });
      throw err;
    },
    cleanup () {}
  };
}
