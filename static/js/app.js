/* app.js
 * Main application orchestration (root-level entry).
 *
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║ This is the ONLY module allowed to contain top-level side effects ║
 * ║ or immediate execution, per .clinerules/custominstructions.md.    ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 */

// Polyfill for CustomEvent in older browsers
import './utils/polyfillCustomEvent.js';

// 1) Core config & factory imports
import { APP_CONFIG } from './appConfig.js';
import { createBrowserService } from './utils/browserService.js';
import { setBrowserService as registerSessionBrowserService, getSessionId } from './utils/session.js';
import { createDomAPI } from './utils/domAPI.js';
import { createDomReadinessService } from './utils/domReadinessService.js';
import { createEventHandlers } from './eventHandler.js';
import { createSafeHandler } from './safeHandler.js';
import { createLogger } from './logger.js';
import { createAppInitializer } from './init/appInitializer.js';

// Additional factories (passed through to appInitializer)
import {
  shouldSkipDedup,
  stableStringify,
  isAbsoluteUrl,
  formatBytes as globalFormatBytes,
  formatDate as globalFormatDate,
  fileIcon as globalFileIcon
} from './utils/globalUtils.js';

import { isValidProjectId } from './projectManager.js';
import { createApiEndpoints } from './utils/apiEndpoints.js';
import { createApiClient } from './utils/apiClient.js';
import { createHtmlTemplateLoader } from './utils/htmlTemplateLoader.js';
import MODAL_MAPPINGS from './modalConstants.js';
import { createFileUploadComponent } from './FileUploadComponent.js';
import { createAccessibilityEnhancements } from './accessibility-utils.js';
import { createNavigationService } from './navigationService.js';
import { createUiRenderer } from './uiRenderer.js';
import { createKnowledgeBaseComponent } from './knowledgeBaseComponent.js';
import { createProjectDetailsEnhancements } from './project-details-enhancements.js';
import { createTokenStatsManager } from './tokenStatsManager.js';
import { createModalManager } from './modalManager.js';
import { createAuthModule } from './auth.js';
import { createProjectManager, isValidProjectId as isValidIdDup } from './projectManager.js';
import { createModelConfig } from './modelConfig.js';
import { createProjectDashboard } from './projectDashboard.js';
import { createChatManager } from './chat.js';
import { createProjectDetailsComponent } from './projectDetailsComponent.js';
import { createProjectListComponent } from './projectListComponent.js';
import { createProjectModal } from './modalManager.js';
import { createSidebar } from './sidebar.js';

// ─────────────────────────────────────────────────────────────────────────────
// 2) Minimal singletons: DependencySystem, logger, sanitizer, eventHandlers
// ─────────────────────────────────────────────────────────────────────────────

// Create base browser service & register with session
const browserService = createBrowserService({
  windowObject: (typeof window !== 'undefined') ? window : undefined
});
registerSessionBrowserService(browserService);

const DependencySystem = browserService.getDependencySystem();
if (!DependencySystem || !DependencySystem.modules) {
  throw new Error('[app.js] Missing or invalid DependencySystem — aborting startup.');
}

// Grab DOMPurify from the global window (if present)
const sanitizer = browserService.getWindow()?.DOMPurify;
if (!sanitizer) {
  throw new Error('[App] DOMPurify not found — cannot proceed (security requirement).');
}

// Create main logger
const logger = createLogger({
  context: 'App',
  debug: (APP_CONFIG.DEBUG === true),
  minLevel: APP_CONFIG.LOGGING?.MIN_LEVEL || 'info',
  consoleEnabled: APP_CONFIG.LOGGING?.CONSOLE_ENABLED !== false,
  sessionIdProvider: getSessionId
});

// Create the safeHandler wrapper
const { safeHandler } = createSafeHandler({ logger });

// Register these essentials with the DependencySystem
DependencySystem.register('sanitizer',   sanitizer);
DependencySystem.register('domPurify',   sanitizer); // legacy alias
DependencySystem.register('logger',      logger);
DependencySystem.register('safeHandler', safeHandler);
DependencySystem.register('createChatManager', createChatManager);

const domAPI = createDomAPI({
  documentObject: browserService.getDocument(),
  windowObject:   browserService.getWindow(),
  debug:          APP_CONFIG.DEBUG === true,
  sanitizer
});

// Create minimal errorReporter stub so serviceInit won't fail
// (the real errorReporter might get replaced or augmented by system)
const errorReporter = {
  report(error, ctx = {}) {
    logger.error('[errorReporter] reported', error, { context: 'errorReporter', ...ctx });
  }
};
DependencySystem.register('errorReporter', errorReporter);

const eventHandlers = createEventHandlers({
  DependencySystem,
  domAPI,
  browserService,
  APP_CONFIG,
  errorReporter,      // pass a real errorReporter stub, not null
  sanitizer,
  safeHandler,
  logger
});

// Register them
DependencySystem.register('domAPI',        domAPI);
DependencySystem.register('browserService', browserService);
DependencySystem.register('eventHandlers',  eventHandlers);

// ─────────────────────────────────────────────────────────────────────────────
// 3) Create the single unified appInitializer instance
// ─────────────────────────────────────────────────────────────────────────────

// We also need a domReadinessService for certain phases
const domReadinessService = createDomReadinessService({
  DependencySystem,
  domAPI,
  browserService,
  eventHandlers,
  APP_CONFIG,
  logger
});
DependencySystem.register('domReadinessService', domReadinessService);
eventHandlers.setDomReadinessService(domReadinessService);

// Prepare a dictionary of helper functions for UI usage
const uiUtils = {
  formatBytes: globalFormatBytes,
  formatDate:  globalFormatDate,
  fileIcon:    globalFileIcon
};

// Prepare a dictionary of global utility functions
const globalUtils = {
  shouldSkipDedup,
  stableStringify,
  normaliseUrl: browserService.normaliseUrl || null,
  isAbsoluteUrl,
  isValidProjectId  // canonical reference
};

// Now instantiate the unified AppInitializer
const appInit = createAppInitializer({
  // Core infrastructure
  DependencySystem,
  domAPI,
  browserService,
  eventHandlers,
  logger,
  sanitizer,
  safeHandler,
  domReadinessService,
  APP_CONFIG,
  uiUtils,
  globalUtils,
  getSessionId,
  createApiEndpoints,
  MODAL_MAPPINGS,

  // Factories
  createFileUploadComponent,
  createApiClient,
  createAccessibilityEnhancements,
  createNavigationService,
  createHtmlTemplateLoader,
  createUiRenderer,
  createKnowledgeBaseComponent,
  createProjectDetailsEnhancements,
  createTokenStatsManager,
  createModalManager,
  createAuthModule,
  createProjectManager,
  createModelConfig,
  createProjectDashboard,
  createChatManager,
  createProjectDetailsComponent,
  createProjectListComponent,
  createProjectModal,
  createSidebar
});

// ─────────────────────────────────────────────────────────────────────────────
// 4) Kick off appInit so it runs all orchestration phases
// ─────────────────────────────────────────────────────────────────────────────
// Wait for document ready via domReadinessService before initializing the application
domReadinessService.documentReady()
  .then(async () => {
    try {
      await appInit.initializeApp();
    } catch (err) {
      logger.error('[app.js] Application failed to initialize.', err, { context: 'app:bootstrap' });
    }
  });

// If desired, you can export references to “appInit” or config
export { createAppConfig } from './appConfig.js';
