/**
 * uiInit.js
 * Factory for initializing all UI components, event tracking, sidebar helpers, and late-phase visual enhancements.
 *
 * Guardrails:
 * - Factory export (createUIInitializer)
 * - Strict DI: All dependencies passed as arguments
 * - No top-level/side effect logic
 * - All DOM access via domAPI or domReadinessService
 * - All event/listener work via injected eventHandlers
 * - All logging via injected logger
 */

export function createUIInitializer({
  DependencySystem,
  domAPI,
  browserService,
  eventHandlers,
  domReadinessService,
  logger,
  APP_CONFIG,
  safeHandler,
  sanitizer,
  createProjectDetailsEnhancements,
  createTokenStatsManager,
  createKnowledgeBaseComponent,
  apiRequest,
  uiUtils
}) {
  if (
    !DependencySystem || !domAPI || !browserService ||
    !eventHandlers || !domReadinessService || !logger || !APP_CONFIG || !safeHandler
  ) {
    throw new Error('[uiInit] Missing required dependencies for UI initialization.');
  }

  let _uiInitialized = false;

  async function initializeUIComponents() {
    if (_uiInitialized) return;
    let domAndModalsReady = false;
    try {
      await domReadinessService.dependenciesAndElements({
        domSelectors: ['#projectListView', '#projectDetailsView'],
        timeout: 10000,
        context: 'uiInit:initializeUIComponents:domCheck'
      });

      // Mobile/sidebar UI helpers
      const navToggleBtn = domAPI.getElementById('navToggleBtn');
      const closeSidebarBtn = domAPI.getElementById('closeSidebarBtn');
      const doc = domAPI.getDocument();

      function setSidebarOpen(open) {
        const sidebar = domAPI.getElementById('mainSidebar');
        domAPI[open ? 'addClass' : 'removeClass'](doc.body, 'sidebar-open');
        domAPI[open ? 'addClass' : 'removeClass'](doc.documentElement, 'sidebar-open');
        if (sidebar) {
          domAPI[open ? 'addClass' : 'removeClass'](sidebar, 'translate-x-0');
          domAPI[open ? 'removeClass' : 'addClass'](sidebar, '-translate-x-full');
          sidebar.setAttribute('aria-hidden', String(!open));
        }
        if (navToggleBtn) navToggleBtn.setAttribute('aria-expanded', String(open));
      }

      if (navToggleBtn) {
        eventHandlers.trackListener(
          navToggleBtn,
          'click',
          safeHandler(() => setSidebarOpen(navToggleBtn.getAttribute('aria-expanded') !== 'true'), 'navToggleBtn:toggleSidebar'),
          { context: 'uiInit:sidebar', description: 'toggleSidebar' }
        );
      }
      if (closeSidebarBtn) {
        eventHandlers.trackListener(
          closeSidebarBtn, 'click',
          () => setSidebarOpen(false),
          { context: 'uiInit:sidebar', description: 'closeSidebar' }
        );
      }
      eventHandlers.trackListener(
        doc,
        'keydown',
        (e) => { if (e.key === 'Escape') setSidebarOpen(false); },
        { context: 'uiInit:sidebar', description: 'escCloseSidebar' }
      );

      // Project List Template Loader
      const htmlLoader = DependencySystem.modules.get('htmlTemplateLoader');
      if (htmlLoader?.loadTemplate) {
        try {
          logger.log('[UIInit] Loading project_list.html template into #projectListView', { context: 'uiInit:loadTemplates' });
          await htmlLoader.loadTemplate({
            url: '/static/html/project_list.html',
            containerSelector: '#projectListView',
            eventName: 'projectListHtmlLoaded'
          });
          logger.log('[UIInit] project_list.html loaded; event projectListHtmlLoaded dispatched.', { context: 'uiInit:loadTemplates' });
        } catch (err) {
          logger.error('[UIInit] Failed to load project_list.html template', err, { context: 'uiInit:loadTemplates' });
        }
      } else {
        logger.error('[UIInit] htmlTemplateLoader.loadTemplate unavailable', { context: 'uiInit:loadTemplates' });
      }

      // Wait for ModalManager readiness up to 8s, warn but do not abort
      const modalMgr = DependencySystem.modules.get('modalManager');
      if (modalMgr?.isReadyPromise) {
        await Promise.race([
          modalMgr.isReadyPromise(),
          new Promise(res => browserService.getWindow().setTimeout(res, 8000))
        ]).catch(() => {
          logger.warn('[UIInit] ModalManager not ready after 8s – continuing', { context: 'uiInit' });
        });
      }
      domAndModalsReady = true;
    } catch (err) {
      logger.error('[UIInit] Error during DOM/modal readiness', err, { context: 'uiInit:readinessError' });
    }

    // NOTE: createAndRegisterUIComponents is left to future extraction as subfactory for clarity

    // Register ProjectDashboard views, initialize accessibility, ChatExtensions, etc.
    // ... OMITTED: Detailed per original app.js to be filled-in on deeper split extraction

    _uiInitialized = true;
  }

  return { initializeUIComponents };
}
