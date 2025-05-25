/**
 * sidebarMobileDock.js - Mobile bottom dock navigation for sidebar
 *
 * Extracted from sidebar.js monolith to follow code guardrails:
 * - Factory function export with strict DI
 * - Single responsibility: mobile dock creation and management
 * - Centralized event handling with context tags
 * - DOM readiness via domReadinessService
 *
 * @param {object} deps - All dependencies injected
 * @param {object} deps.domAPI - DOM manipulation interface
 * @param {object} deps.eventHandlers - Event tracking system
 * @param {object} deps.viewportAPI - Viewport size detection
 * @param {object} deps.logger - Logging interface
 * @param {object} deps.domReadinessService - DOM readiness service
 * @param {function} deps.safeHandler - Error handling wrapper
 * @param {function} deps.onTabActivate - Callback for tab activation
 */
export function createSidebarMobileDock({
  domAPI,
  eventHandlers,
  viewportAPI,
  logger,
  domReadinessService,
  safeHandler,
  onTabActivate
} = {}) {

  // Dependency validation
  if (!domAPI) throw new Error('[SidebarMobileDock] domAPI is required');
  if (!eventHandlers) throw new Error('[SidebarMobileDock] eventHandlers is required');
  if (!viewportAPI) throw new Error('[SidebarMobileDock] viewportAPI is required');
  if (!logger) throw new Error('[SidebarMobileDock] logger is required');
  if (!domReadinessService) throw new Error('[SidebarMobileDock] domReadinessService is required');
  if (typeof safeHandler !== 'function') throw new Error('[SidebarMobileDock] safeHandler is required');
  if (typeof onTabActivate !== 'function') throw new Error('[SidebarMobileDock] onTabActivate is required');

  const MODULE_CONTEXT = 'SidebarMobileDock';
  let mobileDockEl = null;
  let isInitialized = false;

  /**
   * Creates a dock button with specified properties
   */
  function createDockButton(id, label, icon, onClick) {
    let button = domAPI.getElementById(id);
    if (!button) {
      button = domAPI.createElement('button');
      button.id = id;
      button.className = 'btn btn-ghost btn-square flex-1';
      domAPI.setInnerHTML(button, `${icon}<span class="sr-only">${label}</span>`);

      eventHandlers.trackListener(
        button,
        'click',
        safeHandler(onClick, `dock:${id}`),
        {
          context: MODULE_CONTEXT,
          description: `Mobile dock button: ${label}`
        }
      );

      if (mobileDockEl) {
        domAPI.appendChild(mobileDockEl, button);
      }
    }
    return button;
  }

  /**
   * Creates or ensures the mobile dock exists
   */
  function ensureMobileDock() {
    // Only show on mobile screens
    if (viewportAPI.getInnerWidth() >= 640) {
      return null;
    }

    if (mobileDockEl) {
      return mobileDockEl;
    }

    mobileDockEl = domAPI.getElementById('sidebarDock');
    if (!mobileDockEl) {
      mobileDockEl = domAPI.createElement('div');
      mobileDockEl.id = 'sidebarDock';
      mobileDockEl.className = 'sidebar-dock hidden';

      // Find sidebar element to append to
      const sidebarEl = domAPI.getElementById('mainSidebar');
      if (sidebarEl) {
        domAPI.appendChild(sidebarEl, mobileDockEl);
      }
    }

    // Create dock buttons (only 3 to match sidebar tabs)
    createDockButton('dockRecentBtn', 'Recent', '🕑', () => onTabActivate('recent'));
    createDockButton('dockStarredBtn', 'Starred', '⭐', () => onTabActivate('starred'));
    createDockButton('dockProjectsBtn', 'Projects', '📁', () => onTabActivate('projects'));

    return mobileDockEl;
  }

  /**
   * Shows the mobile dock
   */
  function showDock() {
    const dock = ensureMobileDock();
    if (dock) {
      domAPI.removeClass(dock, 'hidden');
      logger.debug('[SidebarMobileDock] Dock shown', { context: MODULE_CONTEXT });
    }
  }

  /**
   * Hides the mobile dock
   */
  function hideDock() {
    if (mobileDockEl) {
      domAPI.addClass(mobileDockEl, 'hidden');
      logger.debug('[SidebarMobileDock] Dock hidden', { context: MODULE_CONTEXT });
    }
  }

  /**
   * Updates dock visibility based on viewport and sidebar state
   */
  function updateDockVisibility(sidebarVisible = false) {
    if (!mobileDockEl) return;

    const isMobile = viewportAPI.getInnerWidth() < 640;
    const shouldShow = isMobile && sidebarVisible;

    domAPI.toggleClass(mobileDockEl, 'hidden', !shouldShow);

    logger.debug('[SidebarMobileDock] Visibility updated', {
      isMobile,
      sidebarVisible,
      shouldShow,
      context: MODULE_CONTEXT
    });
  }

  /**
   * Handles viewport resize events
   */
  function handleResize() {
    const isMobile = viewportAPI.getInnerWidth() < 640;

    if (!isMobile && mobileDockEl) {
      // Hide dock on desktop
      hideDock();
    } else if (isMobile) {
      // Ensure dock exists on mobile
      ensureMobileDock();
    }
  }

  /**
   * Initializes the mobile dock
   */
  async function init() {
    try {
      await domReadinessService.dependenciesAndElements({
        deps: ['viewportAPI'],
        domSelectors: ['#mainSidebar'],
        context: MODULE_CONTEXT
      });

      // Set up resize listener
      eventHandlers.trackListener(
        domAPI.getWindow(),
        'resize',
        safeHandler(handleResize, 'Mobile dock resize'),
        {
          context: MODULE_CONTEXT,
          description: 'Mobile dock viewport resize handler'
        }
      );

      // Create initial dock if on mobile
      ensureMobileDock();

      isInitialized = true;
      logger.info('[SidebarMobileDock] Initialized successfully', { context: MODULE_CONTEXT });

    } catch (error) {
      logger.error('[SidebarMobileDock] Failed to initialize', error, { context: MODULE_CONTEXT });
      throw error;
    }
  }

  /**
   * Cleanup function
   */
  function cleanup() {
    try {
      eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });

      if (mobileDockEl) {
        mobileDockEl.remove();
        mobileDockEl = null;
      }

      isInitialized = false;
      logger.debug('[SidebarMobileDock] Cleanup completed', { context: MODULE_CONTEXT });

    } catch (error) {
      logger.error('[SidebarMobileDock] Cleanup failed', error, { context: MODULE_CONTEXT });
    }
  }

  // Public API
  return {
    init,
    cleanup,
    showDock,
    hideDock,
    updateDockVisibility,
    ensureMobileDock,
    get isInitialized() {
      return isInitialized;
    },
    get dockElement() {
      return mobileDockEl;
    }
  };
}
