export const createErrorReporterStub = (log, ctx='ErrorReporterStub') => ({
  report : (...a) => log?.error?.(`[${ctx}]`, ...a, { context: ctx })
});
