/**
 * sidebarMobileDock.js - Mobile bottom dock for sidebar
 * Addresses repeated creation issues with a debounced resize handler
 * and single ensureMobileDock() check.
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
  if (!domAPI) throw new Error('[SidebarMobileDock] domAPI is required');
  if (!eventHandlers) throw new Error('[SidebarMobileDock] eventHandlers is required');
  if (!viewportAPI) throw new Error('[SidebarMobileDock] viewportAPI is required');
  if (!logger) throw new Error('[SidebarMobileDock] logger is required');
  if (!domReadinessService) throw new Error('[SidebarMobileDock] domReadinessService is required');
  if (typeof safeHandler !== 'function') throw new Error('[SidebarMobileDock] safeHandler is required');
  if (typeof onTabActivate !== 'function') throw new Error('[SidebarMobileDock] onTabActivate is required');

  const MODULE_CONTEXT = 'SidebarMobileDock';
  let mobileDockEl = null;

  let creationInProgress = false;
  let resizeDebounceTimer = null;

  function createDockButton(id, label, icon, onClick) {
    let button = domAPI.getElementById(id);
    if (!button) {
      button = domAPI.createElement('button');
      button.id = id;
      button.className = 'dock-btn';
      button.setAttribute('type', 'button');
      button.setAttribute('aria-label', label);

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
        { context: MODULE_CONTEXT, description: `Dock button: ${label}` }
      );

      const nav = mobileDockEl?.querySelector('.dock-nav');
      if (nav) {
        domAPI.appendChild(nav, button);
      } else {
        domAPI.appendChild(mobileDockEl, button);
      }
    }
    return button;
  }

  function ensureMobileDock() {
    const isMobile = (viewportAPI.getInnerWidth() < 640);
    if (!isMobile) return null;
    if (mobileDockEl) {
      logger.debug('[SidebarMobileDock] Already exists', { context: MODULE_CONTEXT });
      return mobileDockEl;
    }
    if (creationInProgress) return null;
    creationInProgress = true;

    try {
      mobileDockEl = domAPI.getElementById('sidebarDock');
      if (!mobileDockEl) {
        mobileDockEl = domAPI.createElement('div');
        mobileDockEl.id = 'sidebarDock';
        mobileDockEl.className = 'sidebar-dock hidden';

        const dockNav = domAPI.createElement('div');
        dockNav.className = 'dock-nav';
        domAPI.appendChild(mobileDockEl, dockNav);

        const body = domAPI.getDocument()?.body;
        body && domAPI.appendChild(body, mobileDockEl);
      }
      // Create 3 buttons
      createDockButton('dockRecentBtn', 'Recent', '🕑', () => onTabActivate('recent'));
      createDockButton('dockStarredBtn', 'Starred', '⭐', () => onTabActivate('starred'));
      createDockButton('dockProjectsBtn', 'Projects', '📁', () => onTabActivate('projects'));
      return mobileDockEl;
    } finally {
      creationInProgress = false;
    }
  }

  function showDock() {
    const dock = ensureMobileDock();
    if (dock) {
      domAPI.removeClass(dock, 'hidden');
      logger.debug('[SidebarMobileDock] Shown', { context: MODULE_CONTEXT });
    }
  }

  function hideDock() {
    if (mobileDockEl) {
      domAPI.addClass(mobileDockEl, 'hidden');
    }
  }

  function handleResizeDebounced() {
    if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
    resizeDebounceTimer = setTimeout(() => {
      const isMobile = viewportAPI.getInnerWidth() < 640;
      if (!isMobile && mobileDockEl) {
        hideDock();
      } else if (isMobile) {
        ensureMobileDock();
      }
    }, 150);
  }

  function updateDockVisibility(sidebarVisible = false) {
    if (!mobileDockEl) {
      logger.debug('[SidebarMobileDock] No dock yet, ensuring creation if mobile.', { context: MODULE_CONTEXT });
      ensureMobileDock();
    }
    const isMobile = (viewportAPI.getInnerWidth() < 640);
    // Show the dock whenever we are on a mobile viewport **and** the sidebar
    // itself is NOT visible.  The dock acts as a surrogate navigation when the
    // full sidebar is closed; if the sidebar is open (overlay or pinned) we
    // hide the dock to avoid duplicated controls.
    const shouldShow = (isMobile && !sidebarVisible);
    if (shouldShow) {
      mobileDockEl && domAPI.removeClass(mobileDockEl, 'hidden');
    } else {
      mobileDockEl && domAPI.addClass(mobileDockEl, 'hidden');
    }
  }

  async function init() {
    // Ensure readiness
    await domReadinessService.dependenciesAndElements({
      deps: ['viewportAPI', 'eventHandlers', 'domAPI'],
      domSelectors: ['#mainSidebar'],
      timeout: 10000,
      context: MODULE_CONTEXT
    });
    eventHandlers.trackListener(
      domAPI.getWindow(),
      'resize',
      safeHandler(handleResizeDebounced, '[MobileDock] resize'),
      { context: MODULE_CONTEXT }
    );
    ensureMobileDock();
    logger.info('[SidebarMobileDock] Initialized', { context: MODULE_CONTEXT });
  }

  function cleanup() {
    eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
    if (resizeDebounceTimer) {
      clearTimeout(resizeDebounceTimer);
      resizeDebounceTimer = null;
    }
    if (mobileDockEl) {
      mobileDockEl.remove();
      mobileDockEl = null;
    }
    creationInProgress = false;
    logger.debug('[SidebarMobileDock] Cleanup done', { context: MODULE_CONTEXT });
  }

  return {
    init,
    cleanup,
    showDock,
    hideDock,
    updateDockVisibility,
    ensureMobileDock,
    get dockElement() {
      return mobileDockEl;
    }
  };
}
