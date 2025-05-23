import { resolveApiEndpoints } from '../utils/apiEndpoints.js';
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
  logger,
  sanitizer,
  APP_CONFIG,
  uiUtils,
  globalUtils,
  createFileUploadComponent,
  createApiClient,
  createAccessibilityEnhancements,
  createNavigationService,
  createHtmlTemplateLoader
}) {
  if (
    !DependencySystem || !domAPI || !browserServiceInstance || !eventHandlers ||
    !domReadinessService || !logger || !sanitizer || !APP_CONFIG
  ) {
    throw new Error('[serviceInit] Missing required dependencies for service initialization.');
  }

  // Helper: register only if not already present
  function safeRegister(name, value) {
    if (!DependencySystem?.modules?.has?.(name)) {
      DependencySystem.register(name, value);
    } else {
      logger?.debug?.(`[serviceInit] "${name}" already registered – skipping`, { context: 'serviceInit:safeRegister' });
    }
  }

  /**
   * Register all basic services that were scattered in app.js
   */
  function registerBasicServices() {
    try {
      // Register core browser and DOM services
      safeRegister('domAPI', domAPI);
      safeRegister('browserAPI',         browserServiceInstance);
      safeRegister('browserService',     browserServiceInstance);
      safeRegister('storage',            browserServiceInstance);
      safeRegister('eventHandlers',      eventHandlers);
      safeRegister('domReadinessService',domReadinessService);

      // Wire circular dependency with setter (post-construction)
      eventHandlers.setDomReadinessService(domReadinessService);

      // Register / reuse shared errorReporter
      safeRegister(
        'errorReporter',
        DependencySystem.modules.get('errorReporter') ||
        createErrorReporterStub(logger,'serviceInit:ErrorReporterStub')
      );

      // Register utility services
      if (uiUtils) safeRegister('uiUtils', uiUtils);
      if (globalUtils) safeRegister('globalUtils', globalUtils);
      safeRegister('sanitizer', sanitizer);
      safeRegister('domPurify', sanitizer); // legacy alias

      // Register file upload component factory
      if (createFileUploadComponent) {
        safeRegister('FileUploadComponent', createFileUploadComponent);
      }

      // Register API endpoints (only if not already provided)
      safeRegister('apiEndpoints',
        DependencySystem.modules.get('apiEndpoints') ||
        resolveApiEndpoints(APP_CONFIG));

      logger.log('[serviceInit] Basic services registered', { context: 'serviceInit:registerBasicServices' });
    } catch (err) {
      logger.error('[serviceInit] Failed to register basic services', err, { context: 'serviceInit:registerBasicServices' });
      throw err;
    }
  }

  /**
   * Create and register advanced services (API client, navigation, etc.)
   */
  function registerAdvancedServices() {
    try {
      // Create API client
      if (createApiClient && globalUtils) {
        const apiRequest = createApiClient({
          APP_CONFIG,
          globalUtils: {
            shouldSkipDedup: globalUtils.shouldSkipDedup,
            stableStringify: globalUtils.stableStringify,
            normaliseUrl: globalUtils.normaliseUrl,
            isAbsoluteUrl: globalUtils.isAbsoluteUrl
          },
          getAuthModule: () => DependencySystem.modules.get('auth'),
          browserService: browserServiceInstance
        });
        DependencySystem.register('apiRequest', apiRequest);
      }

      // Create accessibility enhancements
      if (createAccessibilityEnhancements) {
        const accessibilityUtils = createAccessibilityEnhancements({
          domAPI,
          eventHandlers,
          logger,
          domReadinessService
        });
        DependencySystem.register('accessibilityUtils', accessibilityUtils);
      }

      // Create navigation service
      if (createNavigationService) {
        const navigationService = createNavigationService({
          domAPI,
          browserService: browserServiceInstance,
          DependencySystem,
          eventHandlers
        });
        DependencySystem.register('navigationService', navigationService);
      }

      // Create HTML template loader
      if (createHtmlTemplateLoader) {
        const htmlTemplateLoader = createHtmlTemplateLoader({
          DependencySystem,
          domAPI,
          eventHandlers,
          sanitizer,
          apiClient: {
            fetch: (...args) => {
              const win = browserServiceInstance.getWindow();
              if (!win?.fetch) {
                throw new Error('[serviceInit] browserService.getWindow().fetch is not available');
              }
              return win.fetch(...args);
            }
          },
          timerAPI: {
            setTimeout: (...args) => browserServiceInstance.getWindow().setTimeout(...args),
            clearTimeout: (...args) => browserServiceInstance.getWindow().clearTimeout(...args)
          }
        });
        DependencySystem.register('htmlTemplateLoader', htmlTemplateLoader);
      }

      logger.log('[serviceInit] Advanced services registered', { context: 'serviceInit:registerAdvancedServices' });
    } catch (err) {
      logger.error('[serviceInit] Failed to register advanced services', err, { context: 'serviceInit:registerAdvancedServices' });
      throw err;
    }
  }

  return {
    registerBasicServices,
    registerAdvancedServices
  };
}
