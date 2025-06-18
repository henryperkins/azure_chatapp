// Re-export wrapper for backward-compatibility
// --------------------------------------------------------------
// The folder structure was refactored in early 2025, moving the
// main initializer from `static/js/init/appInitializer.js` to
// `static/js/initialization/appInitializer.js`.  Older modules and
// a regression test still import the original location using a
// relative path.  To avoid churn and keep the test suite stable we
// provide this thin wrapper that simply re-exports the refactored
// factory.

export { createAppInitializer } from '../initialization/appInitializer.js';
