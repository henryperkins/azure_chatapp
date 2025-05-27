import { createApiEndpoints } from '../utils/apiEndpoints.js';
import { createErrorReporterStub } from '../utils/errorReporterStub.js';

/**
 * serviceInit.js
 * Factory for service registration logic extracted from app.js.
 *
 * Handles the complex service registration and wiring that was scattered
 * throughout app.js initialization.
 *
 * Guardrails:
 * - Factory export (createServiceInitializer)
 * - Strict DI: Accept all dependencies as factory arguments
 * - No import-time side effects
 * - All logging via injected logger
 */

export function createServiceInitializer({
  DependencySystem,
  domAPI,
  browserServiceInstance,
  eventHandlers,
  domReadinessService,
  sanitizer,
  APP_CONFIG,
  uiUtils,
  globalUtils,
  createFileUploadComponent,
  createApiClient,
  createAccessibilityEnhancements,
  createNavigationService,
  createHtmlTemplateLoader,
  createUiRenderer,
  logger,
  getSessionId
}) {
  if (
    !DependencySystem || !domAPI || !browserServiceInstance || !eventHandlers ||
    !domReadinessService || !sanitizer || !APP_CONFIG || !getSessionId
  ) {
    throw new Error('[serviceInit] Missing required dependencies for service initialization.');
  }
  // Capture whether a real logger instance was provided by caller
  const providedLogger = !!logger;
  // Allow logger to be missing at first; fallback to browserServiceInstance console or a no-op.
  // This is useful for very early bootstrap before the main logger is configured.
  if (!providedLogger) {
    const winConsole = browserServiceInstance?.getWindow?.()?.console;
    // Use a simple console-like object if no real logger or window.console is available.
    logger = winConsole ?? { info() {}, warn() {}, error() {}, debug() {}, log() {} };
  }

  // Helper: register a module with DependencySystem only if it's not already present.
  // Prevents errors from re-registering modules.
  function safeRegister(name, value) {
    if (!DependencySystem?.modules?.has?.(name)) {
      DependencySystem.register(name, value);
      logger?.debug?.(`[serviceInit] Registered "${name}"`, { context: 'serviceInit:safeRegister' });
    } else {
      logger?.debug?.(`[serviceInit] "${name}" already registered – skipping registration.`, { context: 'serviceInit:safeRegister' });
    }
  }

  /**
   * Registers basic, foundational services required by many parts of the application.
   * These include core browser utilities, DOM access, event handling, and initial error reporting.
   * This function should be called early in the application bootstrap sequence.
   */
  function registerBasicServices() {
    logger?.info('[serviceInit] Starting registration of basic services...', { context: 'serviceInit:registerBasicServices' });
    try {
      // Register the main logger instance if it was provided externally (i.e., fully configured).
      if (providedLogger) {
        safeRegister('logger', logger);
      }

      // Register core browser and DOM services.
      // These are fundamental for most interactions with the browser environment.
      safeRegister('domAPI', domAPI); // Utility for DOM manipulations.
      safeRegister('browserAPI', browserServiceInstance); // General browser API access.
      safeRegister('browserService', browserServiceInstance); // Alias for browserAPI.
      safeRegister('viewportAPI', browserServiceInstance); // Specifically for viewport-related functionalities.
      safeRegister('storage', browserServiceInstance); // For local/session storage access via browserService.
      safeRegister('eventHandlers', eventHandlers); // Central event management system.
      safeRegister('domReadinessService', domReadinessService); // Service for DOM readiness checks.

      // Wire the circular dependency between eventHandlers and domReadinessService.
      // This is done post-construction via a setter to avoid instantiation deadlocks.
      if (eventHandlers.setDomReadinessService) {
        eventHandlers.setDomReadinessService(domReadinessService);
      } else {
        logger?.warn('[serviceInit] eventHandlers.setDomReadinessService is not defined. Circular dependency might not be fully resolved.', { context: 'serviceInit:registerBasicServices' });
      }

      // Register or reuse a shared errorReporter.
      // Falls back to a stub if no real error reporter is already in DI.
      const existingErrorReporter = DependencySystem.modules.get('errorReporter');
      safeRegister(
        'errorReporter',
        existingErrorReporter || createErrorReporterStub({ logger: DependencySystem.modules.get('logger') || logger }) // Use current logger
      );

      // Register utility services (UI utils, global utils, sanitizer).
      if (uiUtils) safeRegister('uiUtils', uiUtils);
      if (globalUtils) safeRegister('globalUtils', globalUtils);
      safeRegister('sanitizer', sanitizer); // DOMPurify instance.
      safeRegister('domPurify', sanitizer); // Legacy alias for sanitizer.

      // Register FileUploadComponent factory if provided.
      if (createFileUploadComponent) {
        safeRegister('FileUploadComponent', createFileUploadComponent);
      }

      // Register API endpoints. Resolves them if not already present in DI.
      const apiEndpointsInstance = createApiEndpoints({ logger, DependencySystem, config: APP_CONFIG });
      const resolvedEndpoints = DependencySystem.modules.get('apiEndpoints') || apiEndpointsInstance.endpoints;
      safeRegister('apiEndpoints', resolvedEndpoints);

      logger?.debug('[serviceInit] API endpoints registered successfully.', {
        endpointCount: Object.keys(resolvedEndpoints).length,
        context: 'serviceInit:registerBasicServices'
      });
      // Detailed endpoint logging can be verbose; consider conditional logging based on DEBUG flags if necessary.
      // logger?.log('[serviceInit] Detailed endpoint mappings:', resolvedEndpoints, { context: 'serviceInit:registerBasicServices' });

      logger?.info('[serviceInit] Basic services registration completed.', { context: 'serviceInit:registerBasicServices' });
    } catch (err) {
      logger?.error('[serviceInit] Failed to register basic services', err, { context: 'serviceInit:registerBasicServices' });
      throw err; // Re-throw to halt initialization if basic services fail.
    }
  }

  /**
   * Creates and registers advanced services, such as the API client, navigation service,
   * HTML template loader, and UI renderer. These often depend on basic services being registered.
   * This function is called after basic services and the main logger are set up.
   */
  function registerAdvancedServices() {
    logger?.info('[serviceInit] Starting registration of advanced services...', { context: 'serviceInit:registerAdvancedServices' });
    try {
      // 1. API Client
      // This creates the main API client instance used for network requests.
      // It requires APP_CONFIG, globalUtils, an auth module accessor, browserService, and logger.
      let apiClientInstance = null; // Renamed from apiRequest to avoid confusion with apiRequest.fetch
      if (createApiClient && globalUtils) {
        logger?.debug('[serviceInit] Creating API client...', { context: 'serviceInit:registerAdvancedServices' });
        apiClientInstance = createApiClient({
          APP_CONFIG,
          globalUtils: { // Pass specific utils needed by apiClient
            shouldSkipDedup : globalUtils.shouldSkipDedup,
            stableStringify : globalUtils.stableStringify,
            normaliseUrl    : globalUtils.normaliseUrl,
            isAbsoluteUrl   : globalUtils.isAbsoluteUrl
          },
          getAuthModule : () => DependencySystem.modules.get('auth'), // Accessor for auth module
          browserService: browserServiceInstance,
          eventHandlers,                 // ← ADD THIS LINE
          logger        : DependencySystem.modules.get('logger'),
        });
        /* ---------dd---------------------------------------------------------
         * Replace the early proxy with the real implementation.
         * If a placeholder already exists (registered in app.js), we overwrite
         * it so all modules now reference the fully-featured version.
         * ------------------------------------------------------------------ */
        if (DependencySystem?.modules?.has?.('apiRequest')) {
          DependencySystem.modules.set('apiRequest', apiClientInstance.fetch);
          logger?.debug('[serviceInit] apiRequest proxy replaced with real implementation.', { context: 'serviceInit:registerAdvancedServices', eventHandlers });
        } else {
          safeRegister('apiRequest', apiClientInstance.fetch);
        }
        /* Store the full API client object (create or overwrite). */
        if (DependencySystem?.modules?.has?.('apiClientObject')) {
          DependencySystem.modules.set('apiClientObject', apiClientInstance);
        } else {
          safeRegister('apiClientObject', apiClientInstance);
        }
        logger?.debug('[serviceInit] API client created and registered (apiRequest, apiClientObject).', { context: 'serviceInit:registerAdvancedServices' });
      } else {
        logger?.warn('[serviceInit] createApiClient factory or globalUtils not provided. API client not created.', { context: 'serviceInit:registerAdvancedServices' });
      }

      // 2. Accessibility Enhancements
      // Creates and registers utilities for improving application accessibility.
      if (createAccessibilityEnhancements) {
        logger?.debug('[serviceInit] Creating Accessibility Enhancements...', { context: 'serviceInit:registerAdvancedServices' });
        const accessibilityUtilsInstance = createAccessibilityEnhancements({
          domAPI,
          eventHandlers,
          logger: DependencySystem.modules.get('logger'),
          domReadinessService,
          DependencySystem, // For potential internal DI
          safeHandler: DependencySystem.modules.get('safeHandler') // Use DI-registered safeHandler
        });
        // Note: `register` is used here instead of `safeRegister` if it's critical and should overwrite.
        // Assuming safeRegister is generally preferred unless overwrite is intended.
        safeRegister('accessibilityUtils', accessibilityUtilsInstance);
        logger?.debug('[serviceInit] Accessibility Enhancements created and registered.', { context: 'serviceInit:registerAdvancedServices' });
      }

      // 3. Navigation Service
      // Manages application routing and URL manipulation.
      if (createNavigationService) {
        logger?.debug('[serviceInit] Creating Navigation Service...', { context: 'serviceInit:registerAdvancedServices' });
        const navigationServiceInstance = createNavigationService({
          domAPI,
          browserService: browserServiceInstance,
          DependencySystem, // For internal DI
          eventHandlers
        });
        safeRegister('navigationService', navigationServiceInstance);
        logger?.debug('[serviceInit] Navigation Service created and registered.', { context: 'serviceInit:registerAdvancedServices' });
      }

      // 4. HTML Template Loader
      // Responsible for fetching and caching HTML templates.
      if (createHtmlTemplateLoader) {
        logger?.debug('[serviceInit] Creating HTML Template Loader...', { context: 'serviceInit:registerAdvancedServices' });

        // ⬅ Enforce DI: hard guard for domReadinessService
        if (!domReadinessService) {
          throw new Error('[serviceInit] domReadinessService required for htmlTemplateLoader');
        }

        const htmlTemplateLoaderInstance = createHtmlTemplateLoader({
          DependencySystem, // For internal DI
          domAPI,
          sanitizer,
          eventHandlers,
          apiClient: apiClientInstance, // Pass the created API client instance
          timerAPI: browserServiceInstance, // For timeouts/intervals
          domReadinessService,  // ⬅ inject explicitly
          logger: DependencySystem.modules.get('logger')
        });
        safeRegister('htmlTemplateLoader', htmlTemplateLoaderInstance);
        logger?.debug('[serviceInit] HTML Template Loader created and registered.', { context: 'serviceInit:registerAdvancedServices' });
      }

      // 5. UI Renderer
      // Handles rendering of complex UI structures or components.
      if (createUiRenderer && apiClientInstance) { // Depends on apiClient being created
        logger?.debug('[serviceInit] Creating UI Renderer...', { context: 'serviceInit:registerAdvancedServices' });
        const currentApiEndpoints = DependencySystem.modules.get('apiEndpoints');
        const currentLogger = DependencySystem.modules.get('logger');
        if (!currentApiEndpoints) {
          currentLogger?.error('[serviceInit] apiEndpoints not available for uiRenderer creation. Skipping UI Renderer.', { context: 'serviceInit:registerAdvancedServices' });
        } else {
          const uiRendererInstance = createUiRenderer({
            domAPI,
            eventHandlers,
            apiRequest: apiClientInstance.fetch, // Pass the fetch method specifically
            apiEndpoints: currentApiEndpoints,
            // Callbacks for UI interactions, to be implemented by consuming modules (e.g., sidebar)
            onConversationSelect: (conversationId) => {
              logger?.debug('[serviceInit] uiRenderer: onConversationSelect triggered.', { conversationId, context: 'serviceInit:uiRenderer' });
              const doc = domAPI.getDocument();
              if (doc && eventHandlers?.createCustomEvent) {
                domAPI.dispatchEvent(doc, eventHandlers.createCustomEvent('uiRenderer:conversationSelected', { detail: { conversationId } }));
              }
            },
            onProjectSelect: (projectId) => {
              logger?.debug('[serviceInit] uiRenderer: onProjectSelect triggered.', { projectId, context: 'serviceInit:uiRenderer' });
              const doc = domAPI.getDocument();
              if (doc && eventHandlers?.createCustomEvent) {
                domAPI.dispatchEvent(doc, eventHandlers.createCustomEvent('uiRenderer:projectSelected', { detail: { projectId } }));
              }
            },
            domReadinessService,
            logger: currentLogger,
            DependencySystem // For internal DI
          });
          safeRegister('uiRenderer', uiRendererInstance);
          logger?.debug('[serviceInit] UI Renderer created and registered.', { context: 'serviceInit:registerAdvancedServices' });
        }
      } else if (!apiClientInstance && createUiRenderer) {
          logger?.warn('[serviceInit] UI Renderer requires API client, but it was not created. Skipping UI Renderer.', { context: 'serviceInit:registerAdvancedServices' });
      }

      logger?.info('[serviceInit] Advanced services registration completed.', { context: 'serviceInit:registerAdvancedServices' });
    } catch (err) {
      logger?.error('[serviceInit] Failed to register advanced services', err, { context: 'serviceInit:registerAdvancedServices' });
      throw err; // Re-throw to halt initialization if advanced services fail.
    }
  }

  /**
   * setLogger – Inject a fully configured logger after initial bootstrap.
   * Prevent duplicate-module errors by registering only once.
   * @param {object} newLogger – fully initialized logger instance
   */
  function setLogger(newLogger) {
    if (!newLogger) return;
    logger = newLogger;
    safeRegister('logger', newLogger);
  }
  return {
    registerBasicServices,
    registerAdvancedServices,
    setLogger,
    cleanup() {
      // Service registration doesn't create event listeners directly
      eventHandlers.cleanupListeners({ context: 'serviceInit' });
      const logger = DependencySystem.modules.get('logger');
      logger?.debug('[serviceInit] Cleanup completed', { context: 'serviceInit:cleanup' });
    }
  };
}
