export function createErrorReporterStub({ logger } = {}) {
  const log = logger ?? { error() {} };
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
