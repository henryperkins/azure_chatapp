// Thin re-export wrapper to ensure legacy import paths under
// "static/js/services/eventService.js" continue to work after the
// service was moved to "static/services/eventService.js".
//
// DO NOT put business logic here – the single source of truth lives in
// ../../services/eventService.js.  Keeping this file prevents breakage
// for modules that still reference the old path while the migration is
// completed.

export { createEventService } from '../../services/eventService.js';
export { createEventService as default } from '../../services/eventService.js';
