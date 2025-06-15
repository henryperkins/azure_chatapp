/* app.js
 * Root application entrypoint (NO side effects or singleton registration here!)
 * All startup logic—including DependencySystem registration, event handlers, browser/session wiring, sanitizer checks—
 * must now be invoked within static/js/init/appInitializer.js as clearly named functions or within the initialization sequence.
 */

 // CustomEvent polyfill (DI-safe factory)
console.log('[DEBUG] app.js: Loading imports...');
import { createCustomEventPolyfill } from './utils/polyfillCustomEvent.js';

// Core config & factory imports for bootstrapping
import { APP_CONFIG } from './appConfig.js';
import { createBrowserService } from './utils/browserService.js';
// DOMPurify injection helper – passed to initializer, **not executed here**
import { createDOMPurifyGlobal } from './vendor/dompurify-global.js';
import { createAppInitializer } from './initialization/appInitializer.js';

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
import { createModalConstants } from './modalConstants.js';
import { createSelectorConstants } from './utils/selectorConstants.js';
import { createLogDeliveryService } from './logDeliveryService.js';
import { createModalManager } from './modalManager.js';
import { createAuth } from './auth.js';
import { createProjectManager } from './projectManager.js';
import { createModelConfig } from './modelConfig.js';
import { createProjectDashboard } from './projectDashboard.js';
import { createChatManager } from './chat.js';
import { createChatExtensions } from './chatExtensions.js';
import { createProjectDetailsComponent } from './projectDetailsComponent.js';
import { createProjectListComponent } from './projectListComponent.js';
import { createProjectModal } from './modalManager.js';
import { createSidebar } from './sidebar.js';
import { createChatUIController } from './chatUIController.js';
import { createConversationManager } from './conversationManager.js';
import { createMessageHandler } from './messageHandler.js';
import { createProjectDetailsRenderer } from './projectDetailsRenderer.js';
import { createProjectDataCoordinator } from './projectDataCoordinator.js';
import { createProjectEventHandlers } from './projectEventHandlers.js';
import { createLoginButtonHandler } from './loginButtonHandler.js';
import { createProjectListRenderer } from './projectListRenderer.js';

// Newly hooked factories (Phase 2025-06-11)
import { createModalFormHandler } from './modalFormHandler.js';
import { createModalStateManager } from './modalStateManager.js';
import { createModalRenderer } from './modalRenderer.js';
import { createSidebarAuth } from './sidebarAuth.js';
import { createSidebarEnhancements } from './sidebar-enhancements.js';
import { createSidebarMobileDock } from './sidebarMobileDock.js';

// Previously uninitialized components
import { createThemeManager } from './theme-toggle.js';
import { createKnowledgeBaseReadinessService } from './knowledgeBaseReadinessService.js';
import { createKbResultHandlers } from './kb-result-handlers.js';
import { createAuthHeaderUI } from './components/authHeaderUI.js';
import { createAuthFormListenerFactory } from './authFormListenerFactory.js';
import { createProjectDashboardUtils } from './projectDashboardUtils.js';
import { createStorageService } from './utils/storageService.js';
import { createFormattingUtils } from './formatting.js';
import { createPullToRefresh } from './utils/pullToRefresh.js';

/**
 * STRICT: The only initialization code here is to create the 'browserService',
 * acquire the DependencySystem instance, and pass factories to the AppInitializer.
 * All wiring, DI registration, side effects or checks have been migrated to appInitializer.js.
 */
console.log('[DEBUG] app.js: Starting application bootstrap');

const browserService = createBrowserService({
  windowObject: (typeof window !== 'undefined') ? window : undefined
});
console.log('[DEBUG] app.js: browserService created successfully');


// DO NOT execute DOMPurify injection or polyfills here – pass factories instead.

const DependencySystem = browserService.getDependencySystem();
console.log('[DEBUG] app.js: DependencySystem acquired');

// Instantiate and run the app initializer
// --------------------------------------------------------------
// Consolidated factory map
// --------------------------------------------------------------
const factories = {
  createApiEndpoints,
  createApiClient,
  createHtmlTemplateLoader,
  createFileUploadComponent,
  createAccessibilityEnhancements,
  createNavigationService,
  createUiRenderer,
  createKnowledgeBaseComponent,
  createProjectDetailsEnhancements,
  createTokenStatsManager,
  createModalConstants,
  createSelectorConstants,
  createLogDeliveryService,
  createModalManager,
  createAuth,
  createProjectManager,
  createModelConfig,
  createProjectDashboard,
  createChatManager,
  createChatExtensions,
  createProjectDetailsComponent,
  createProjectListComponent,
  createProjectModal,
  createSidebar,
  // New renderer for project list
  createProjectListRenderer,
  // Phase-2/3 extracted factories
  createChatUIController,
  createConversationManager,
  createMessageHandler,
  createProjectDetailsRenderer,
  createProjectDataCoordinator,
  createProjectEventHandlers,
  createLoginButtonHandler,
  // Modal/Sidebar sub-factories (newly registered)
  createModalFormHandler,
  createModalStateManager,
  createModalRenderer,
  createSidebarAuth,
  createSidebarEnhancements,
  createSidebarMobileDock,
  // Previously uninitialized components
  createThemeManager,
  createKnowledgeBaseReadinessService,
  createKbResultHandlers,
  createAuthHeaderUI,
  createAuthFormListenerFactory,
  createProjectDashboardUtils,
  createStorageService,
  createFormattingUtils,
  createPullToRefresh
};

// Create globalUtils object for services that need it
const globalUtils = {
  shouldSkipDedup,
  stableStringify,
  isAbsoluteUrl,
  formatBytes: globalFormatBytes,
  formatDate: globalFormatDate,
  fileIcon: globalFileIcon
};

console.log('[DEBUG] app.js: Creating appInitializer with dependencies');

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
  globalUtils,
  MODAL_MAPPINGS,
  // Top-level factories required by createAppInitializer
  createApiEndpoints,
  createApiClient,
  createChatManager,
  // ServiceInit mandatory factories
  createNavigationService,
  createAccessibilityEnhancements,
  createFileUploadComponent,
  // UIInit mandatory factories
  createKnowledgeBaseComponent,
  createProjectDetailsEnhancements,
  createTokenStatsManager,
  createModalConstants,
  createSelectorConstants,
  createChatExtensions,
  createLoginButtonHandler,
  createLogDeliveryService,
  createHtmlTemplateLoader,
  createUiRenderer,
  // new pattern
  factories,
  // prerequisite factories (previously executed here)
  createDOMPurifyGlobal,
  createCustomEventPolyfill
});
console.log('[DEBUG] app.js: appInitializer created successfully');

// The ONLY orchestration in app.js: start up through the unified initializer
console.log('[DEBUG] app.js: Calling initializeApp()');
try {
  appInit.initializeApp();
  console.log('[DEBUG] app.js: initializeApp() called successfully');
} catch (error) {
  console.error('[DEBUG] app.js: Error in initializeApp():', error);
  // Dispatch error event for HTML to catch
  try {
    const browserService = createBrowserService();
    const windowEl = browserService.getWindow(); // DOM element - adding 'El' suffix
    windowEl.dispatchEvent(new CustomEvent('app:error', {
      detail: { message: `Initialization failed: ${error.message}` }
    }));
  } catch (dispatchError) {
    console.error('[DEBUG] app.js: Failed to dispatch error event:', dispatchError);
  }
}

// Optionally re-export the appConfig for test harnessing or diagnostics
export { createAppConfig } from './appConfig.js';
