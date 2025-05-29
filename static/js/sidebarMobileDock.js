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
      button.className = 'dock-btn';
      button.setAttribute('type', 'button');
      button.setAttribute('aria-label', label);
      
      // Create dock button structure with icon and label
      const iconEl = domAPI.createElement('div');
      iconEl.className = 'dock-icon';
      domAPI.setTextContent(iconEl, icon);
      
      const labelEl = domAPI.createElement('div');
      labelEl.className = 'dock-label';
      domAPI.setTextContent(labelEl, label);
      
      const indicatorEl = domAPI.createElement('div');
      indicatorEl.className = 'dock-indicator';
      
      domAPI.appendChild(button, iconEl);
      domAPI.appendChild(button, labelEl);
      domAPI.appendChild(button, indicatorEl);

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
        // Append to the dock-nav container, not the main dock
        const dockNav = mobileDockEl.querySelector('.dock-nav');
        if (dockNav) {
          domAPI.appendChild(dockNav, button);
        } else {
          domAPI.appendChild(mobileDockEl, button);
        }
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
      logger.debug('[SidebarMobileDock] Skipping dock creation - not mobile viewport', {
        width: viewportAPI.getInnerWidth(),
        context: MODULE_CONTEXT
      });
      return null;
    }

    if (mobileDockEl) {
      logger.debug('[SidebarMobileDock] Mobile dock already exists', { context: MODULE_CONTEXT });
      return mobileDockEl;
    }

    mobileDockEl = domAPI.getElementById('sidebarDock');
    if (!mobileDockEl) {
      // Create main dock container
      mobileDockEl = domAPI.createElement('div');
      mobileDockEl.id = 'sidebarDock';
      mobileDockEl.className = 'sidebar-dock hidden';
      
      // Create navigation container
      const dockNav = domAPI.createElement('div');
      dockNav.className = 'dock-nav';
      domAPI.appendChild(mobileDockEl, dockNav);

      // Append mobile dock to body so it can be positioned fixed at bottom
      const body = domAPI.getDocument()?.body;
      if (body) {
        domAPI.appendChild(body, mobileDockEl);
        logger.debug('[SidebarMobileDock] Mobile dock created and appended to body', { context: MODULE_CONTEXT });
      } else {
        logger.warn('[SidebarMobileDock] Document body not found - dock cannot be attached', { context: MODULE_CONTEXT });
        return null;
      }
    } else {
      logger.debug('[SidebarMobileDock] Found existing mobile dock element', { context: MODULE_CONTEXT });
    }

    // Create dock buttons (only 3 to match sidebar tabs)
    try {
      createDockButton('dockRecentBtn', 'Recent', '🕑', () => onTabActivate('recent'));
      createDockButton('dockStarredBtn', 'Starred', '⭐', () => onTabActivate('starred'));
      createDockButton('dockProjectsBtn', 'Projects', '📁', () => onTabActivate('projects'));
      logger.debug('[SidebarMobileDock] Dock buttons created successfully', { context: MODULE_CONTEXT });
    } catch (buttonErr) {
      logger.error('[SidebarMobileDock] Failed to create dock buttons', buttonErr, { context: MODULE_CONTEXT });
      return null;
    }

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
    if (!mobileDockEl) {
      logger.warn('[SidebarMobileDock] updateDockVisibility called but mobileDockEl is null', { context: MODULE_CONTEXT });
      return;
    }

    const isMobile = viewportAPI.getInnerWidth() < 640;
    const shouldShow = isMobile && sidebarVisible;

    if (shouldShow) {
      domAPI.removeClass(mobileDockEl, 'hidden');
      logger.debug('[SidebarMobileDock] Mobile dock shown', { context: MODULE_CONTEXT });
    } else {
      domAPI.addClass(mobileDockEl, 'hidden');
      logger.debug('[SidebarMobileDock] Mobile dock hidden', { context: MODULE_CONTEXT });
    }

    logger.debug('[SidebarMobileDock] Visibility updated', {
      isMobile,
      sidebarVisible,
      shouldShow,
      elementExists: !!mobileDockEl,
      elementHidden: mobileDockEl.classList.contains('hidden'),
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
      // Wait for critical dependencies and DOM elements
      await domReadinessService.dependenciesAndElements({
        deps: ['viewportAPI', 'eventHandlers', 'domAPI'],
        domSelectors: ['#mainSidebar'],
        timeout: 10000, // 10 second timeout
        context: MODULE_CONTEXT
      });

      // Verify all injected dependencies are still available
      if (!domAPI) throw new Error('[SidebarMobileDock] domAPI became unavailable during init');
      if (!eventHandlers) throw new Error('[SidebarMobileDock] eventHandlers became unavailable during init');
      if (!viewportAPI) throw new Error('[SidebarMobileDock] viewportAPI became unavailable during init');
      if (!logger) throw new Error('[SidebarMobileDock] logger became unavailable during init');

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

      // Create initial dock if on mobile (this will check viewport size)
      ensureMobileDock();

      isInitialized = true;
      logger.info('[SidebarMobileDock] Initialized successfully', { 
        context: MODULE_CONTEXT,
        isMobile: viewportAPI.getInnerWidth() < 640
      });

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
