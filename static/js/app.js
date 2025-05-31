/* app.js
 * Root application entrypoint (NO side effects or singleton registration here!)
 * All startup logic—including DependencySystem registration, event handlers, browser/session wiring, sanitizer checks—
 * must now be invoked within static/js/init/appInitializer.js as clearly named functions or within the initialization sequence.
 */

 // CustomEvent polyfill (DI-safe factory)
import { createCustomEventPolyfill } from './utils/polyfillCustomEvent.js';

// Core config & factory imports for bootstrapping
import { APP_CONFIG } from './appConfig.js';
import { createBrowserService } from './utils/browserService.js';
import { createAppInitializer } from './init/appInitializer.js';

// Factories and utilities to be passed to appInitializer
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
import { MODAL_MAPPINGS } from './modalConstants.js';
import { createFileUploadComponent } from './FileUploadComponent.js';
import { createAccessibilityEnhancements } from './accessibility-utils.js';
import { createNavigationService } from './navigationService.js';
import { createUiRenderer } from './uiRenderer.js';
import { createKnowledgeBaseComponent } from './knowledgeBaseComponent.js';
import { createProjectDetailsEnhancements } from './project-details-enhancements.js';
import { createTokenStatsManager } from './tokenStatsManager.js';
import { createModalManager } from './modalManager.js';
import { createAuthModule } from './auth.js';
import { createProjectManager } from './projectManager.js';
import { createModelConfig } from './modelConfig.js';
import { createProjectDashboard } from './projectDashboard.js';
import { createChatManager } from './chat.js';
import { createProjectDetailsComponent } from './projectDetailsComponent.js';
import { createProjectListComponent } from './projectListComponent.js';
import { createProjectModal } from './modalManager.js';
import { createSidebar } from './sidebar.js';

/**
 * STRICT: The only initialization code here is to create the 'browserService',
 * acquire the DependencySystem instance, and pass factories to the AppInitializer.
 * All wiring, DI registration, side effects or checks have been migrated to appInitializer.js.
 */
const browserService = createBrowserService({
  windowObject: (typeof window !== 'undefined') ? window : undefined
});

// Ensure CustomEvent exists in the injected window
createCustomEventPolyfill({ browserService });

const DependencySystem = browserService.getDependencySystem();

// Instantiate and run the app initializer
const appInit = createAppInitializer({
  DependencySystem,
  browserService,
  APP_CONFIG,
  shouldSkipDedup,
  stableStringify,
  isAbsoluteUrl,
  globalFormatBytes,
  globalFormatDate,
  globalFileIcon,
  isValidProjectId,
  createApiEndpoints,
  createApiClient,
  createHtmlTemplateLoader,
  MODAL_MAPPINGS,
  createFileUploadComponent,
  createAccessibilityEnhancements,
  createNavigationService,
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

// The ONLY orchestration in app.js: start up through the unified initializer
appInit.initializeApp();

// Optionally re-export the appConfig for test harnessing or diagnostics
export { createAppConfig } from './appConfig.js';
