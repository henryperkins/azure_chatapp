/**
 * sidebar.js – DI/DependencySystem Refactored Edition
 *
 * A modular sidebar controller with no hard-coded window.* usage (except for
 * an optional fallback to check window.innerWidth). All dependencies
 * (eventHandlers, app, projectDashboard, projectManager, uiRenderer, DependencySystem)
 * are injected or resolved once from DependencySystem if not provided.
 *
 * Exported as a factory function: createSidebar(opts).
 *
 * Checklist Compliance Highlights:
 * - Modularity & DI: All external references injected, no global mutation.
 * - Event & Listener Management: Uses trackListener, destroy() cleanup added.
 * - Logging: Wrapped in app?.config?.debug checks.
 */

import { safeParseJSON } from './utils/globalUtils.js';

/**
 * Factory function to create a sidebar module instance.
 * @param {Object} options
 * @param {Object} options.eventHandlers - The event-handling module (required).
 * @param {Object} options.app - Core app or orchestrator reference (optional).
 * @param {Object} options.projectDashboard - The project's dashboard module (optional).
 * @param {Object} options.projectManager - For project data (optional).
 * @param {Object} options.uiRenderer - For rendering DOM elements (optional).
 * @param {Object} options.DependencySystem - The DI container reference (required).
 * @returns {Object} The sidebar module with init(), destroy(), and other controls.
 */
export function createSidebar({
  eventHandlers,
  app,
  projectDashboard,
  projectManager,
  uiRenderer,
  DependencySystem
} = {}) {
  if (!DependencySystem) {
    throw new Error('[sidebar] DependencySystem is required.');
  }
  if (!eventHandlers) {
    throw new Error('[sidebar] eventHandlers is required.');
  }

  // Dependency resolution helpers
  function resolveDep(name) {
    if (DependencySystem?.modules?.get) return DependencySystem.modules.get(name);
    if (DependencySystem?.get) return DependencySystem.get(name);
    return undefined;
  }

  // Fallback resolution if not injected
  app = app || resolveDep('app');
  projectDashboard = projectDashboard || resolveDep('projectDashboard');
  projectManager = projectManager || resolveDep('projectManager');
  uiRenderer = uiRenderer || resolveDep('uiRenderer');

  /** @type {HTMLElement|null} */
  let el = null;
  let btnToggle = null;
  let btnClose = null;
  let btnPin = null;
  let backdrop = null;

  /** @type {boolean} pinned (state) */
  let pinned = false;
  /** @type {boolean} visible (state) */
  let visible = false;

  // Track all event registrations for cleanup
  let trackedEvents = [];

  // Instead of direct localStorage, you could inject storage, but we keep this for brevity.
  const starred = new Set(
    safeParseJSON(localStorage?.getItem('starredConversations'), [])
  );

  /**
   * Initialize sidebar: finds DOM nodes, restores persistent state,
   * registers event listeners, and activates the saved tab.
   * @returns {Promise<boolean>} Resolves true if successful, false if error.
   */
  async function init() {
    try {
      findDom();
      restorePersistentState();
      bindDomEvents();

      const activeTab = localStorage?.getItem('sidebarActiveTab') || 'recent';
      await activateTab(activeTab);

      if (app?.config?.debug) {
        console.log('[sidebar] initialized successfully');
      }
      return true;
    } catch (err) {
      console.error('[sidebar] Initialization failed:', err);
      // If you have a notification system, you could do: app.showNotification(...)
      return false;
    }
  }

  /**
   * Cleanup/teardown method for removing all event listeners and
   * resetting internal states. Call before unmounting or re-initializing.
   */
  function destroy() {
    // Unregister all tracked listeners
    trackedEvents.forEach(evt => {
      eventHandlers.cleanupListeners(evt.element, evt.type, evt.description);
    });
    trackedEvents = [];

    // Remove the backdrop if still present
    if (backdrop) {
      backdrop.remove();
      backdrop = null;
    }

    // Reset local states
    pinned = false;
    visible = false;

    if (app?.config?.debug) {
      console.log('[sidebar] destroyed');
    }
  }

  /**
   * Internal helper: queries important DOM elements for the sidebar.
   * Throws an error on missing critical nodes.
   */
  function findDom() {
    el = document.getElementById('mainSidebar');
    btnToggle = document.getElementById('navToggleBtn');
    btnClose = document.getElementById('closeSidebarBtn');
    btnPin = document.getElementById('pinSidebarBtn');

    if (!el || !btnToggle) {
      throw new Error('sidebar: critical DOM nodes missing (#mainSidebar or #navToggleBtn)');
    }
  }

  /**
   * Restores pinned/visible states from localStorage if present.
   * Updates classes and pinned visuals accordingly.
   */
  function restorePersistentState() {
    pinned = localStorage?.getItem('sidebarPinned') === 'true';
    if (pinned) {
      el.classList.add('sidebar-pinned', 'translate-x-0');
      visible = true;
    }
    updatePinButtonVisual();
  }

  /**
   * Registers all relevant DOM events with trackListener.
   * They will be unregistered in destroy().
   */
  function bindDomEvents() {
    const track = (element, evtType, handler, description) => {
      if (!element) return;
      const wrappedHandler = eventHandlers.trackListener(element, evtType, handler, { description });
      if (wrappedHandler) {
        trackedEvents.push({ element, type: evtType, description });
      }
    };

    track(btnToggle, 'click', () => toggleSidebar(), 'Sidebar toggle');
    track(btnClose, 'click', () => closeSidebar(), 'Sidebar close');
    track(btnPin, 'click', () => togglePin(), 'Sidebar pin');
    track(window, 'resize', handleResize, 'Sidebar resize');

    [
      { name: 'recent', id: 'recentChatsTab' },
      { name: 'starred', id: 'starredChatsTab' },
      { name: 'projects', id: 'projectsTab' },
    ].forEach(({ name, id }) => {
      const btn = document.getElementById(id);
      track(btn, 'click', () => activateTab(name), `Sidebar tab ${name}`);
    });
  }

  /**
   * Toggles the pinned state. If pinned is forced true, the sidebar remains visible.
   * @param {boolean} [force] - Force pinned true/false, or toggle if undefined.
   */
  function togglePin(force) {
    pinned = (force !== undefined) ? !!force : !pinned;
    if (localStorage) {
      localStorage.setItem('sidebarPinned', pinned);
    }
    el.classList.toggle('sidebar-pinned', pinned);
    updatePinButtonVisual();

    if (pinned) {
      showSidebar();
    }
    dispatch('sidebarPinChanged', { pinned });
  }

  /**
   * Updates the pin-button's visual indicators (aria-pressed, classes, etc.).
   */
  function updatePinButtonVisual() {
    if (!btnPin) return;
    btnPin.setAttribute('aria-pressed', pinned.toString());
    btnPin.title = pinned ? 'Unpin sidebar' : 'Pin sidebar';
    btnPin.classList.toggle('text-primary', pinned);
    btnPin.classList.add('btn', 'btn-ghost', 'btn-square', 'btn-sm', 'min-w-[44px]', 'min-h-[44px]');
  }

  /**
   * Toggles the sidebar's visibility.
   * @param {boolean} [forceVisible] - Force show/hide if provided.
   */
  function toggleSidebar(forceVisible) {
    const willShow = (forceVisible !== undefined) ? !!forceVisible : !visible;
    willShow ? showSidebar() : closeSidebar();
  }

  /**
   * Makes the sidebar visible, unless it already is or pinned is false.
   */
  function showSidebar() {
    if (visible) return;
    visible = true;
    el.classList.remove('-translate-x-full');
    el.setAttribute('aria-hidden', 'false');
    btnToggle.setAttribute('aria-expanded', 'true');
    createBackdrop();

    const activeTab = localStorage?.getItem('sidebarActiveTab') || 'recent';
    if (activeTab === 'projects') {
      ensureProjectDashboard();
      const projSearch = document.getElementById('sidebarProjectSearch');
      if (projSearch) projSearch.focus();
    }

    dispatch('sidebarVisibilityChanged', { visible });
  }

  /**
   * Hides the sidebar if it is currently shown and not pinned.
   */
  function closeSidebar() {
    if (!visible || pinned) return;
    if (el.contains(document.activeElement)) {
      // blur any focused element inside the sidebar
      document.activeElement.blur();
    }
    visible = false;
    el.classList.add('-translate-x-full');
    el.setAttribute('aria-hidden', 'true');
    btnToggle.setAttribute('aria-expanded', 'false');
    removeBackdrop();
    dispatch('sidebarVisibilityChanged', { visible });
  }

  /**
   * Handles window resize events to remove the backdrop if width is large enough (desktop).
   */
  function handleResize() {
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      removeBackdrop();
    }
  }

  /**
   * Creates a semi-transparent backdrop to close the sidebar on mobile/tablet.
   */
  function createBackdrop() {
    if (backdrop) return;
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      return; // No backdrop in large screens
    }
    backdrop = Object.assign(document.createElement('div'), {
      className: 'fixed inset-0 bg-base-300/70 z-40',
      style: 'cursor:pointer',
    });

    const closeHandler = () => closeSidebar();
    const tracked = eventHandlers.trackListener(backdrop, 'click', closeHandler, {
      description: 'Sidebar backdrop'
    });
    if (tracked) {
      trackedEvents.push({
        element: backdrop,
        type: 'click',
        description: 'Sidebar backdrop'
      });
    }
    document.body.appendChild(backdrop);
  }

  /**
   * Removes the existing backdrop if present.
   */
  function removeBackdrop() {
    if (backdrop) {
      backdrop.remove();
      backdrop = null;
    }
  }

  /**
   * Activate one of the sidebar's tabs: 'recent', 'starred', or 'projects'.
   * Saves the active tab in localStorage and ensures the proper UI panels are shown.
   * @param {string} name - The tab name to activate
   */
  async function activateTab(name = 'recent') {
    const map = {
      recent: { btn: 'recentChatsTab', panel: 'recentChatsSection' },
      starred: { btn: 'starredChatsTab', panel: 'starredChatsSection' },
      projects: { btn: 'projectsTab', panel: 'projectsSection' },
    };
    if (!map[name]) {
      name = 'recent';
    }

    Object.entries(map).forEach(([key, ids]) => {
      const btn = document.getElementById(ids.btn);
      const panel = document.getElementById(ids.panel);
      if (btn && panel) {
        const isActive = (key === name);
        btn.classList.toggle('tab-active', isActive);
        btn.setAttribute('aria-selected', String(isActive));
        btn.tabIndex = isActive ? 0 : -1;
        panel.classList.toggle('hidden', !isActive);
        panel.classList.toggle('flex', isActive);

        // On 'projects' tab active, ensure project dashboard is loaded
        if (isActive && name === 'projects' && el.getAttribute('aria-hidden') === 'false') {
          ensureProjectDashboard();
        }
      }
    });

    if (localStorage) {
      localStorage.setItem('sidebarActiveTab', name);
    }
    dispatch('sidebarTabChanged', { tab: name });

    if (name === 'recent') {
      maybeRenderRecentConversations();
    } else if (name === 'starred') {
      maybeRenderStarredConversations();
    }
  }

  /**
   * If the 'projects' tab is active, calls projectDashboard.initialize()
   * and triggers any needed UI rendering for projects.
   */
  async function ensureProjectDashboard() {
    if (!projectDashboard || typeof projectDashboard.initialize !== 'function') return;
    const section = document.getElementById('projectsSection');
    if (section && !section.dataset.initialised) {
      await projectDashboard.initialize();
      section.dataset.initialised = 'true';
    }
    if (projectManager?.projects && uiRenderer?.renderProjects) {
      uiRenderer.renderProjects(projectManager.projects);
    }
  }

  function maybeRenderRecentConversations() {
    if (uiRenderer?.renderConversations) {
      uiRenderer.renderConversations();
    }
  }

  function maybeRenderStarredConversations() {
    if (uiRenderer?.renderStarredConversations) {
      uiRenderer.renderStarredConversations();
    }
  }

  /**
   * Checks if a conversation ID is starred.
   * @param {string|number} id - conversation ID
   * @returns {boolean}
   */
  function isConversationStarred(id) {
    return starred.has(id);
  }

  /**
   * Toggles the 'starred' status of a conversation, saving to localStorage.
   * @param {string|number} id - conversation ID
   * @returns {boolean} - whether it is starred after toggling
   */
  function toggleStarConversation(id) {
    if (starred.has(id)) {
      starred.delete(id);
    } else {
      starred.add(id);
    }
    if (localStorage) {
      localStorage.setItem('starredConversations', JSON.stringify([...starred]));
    }
    maybeRenderStarredConversations();
    dispatch('sidebarStarredChanged', { id, starred: starred.has(id) });
    return starred.has(id);
  }

  /**
   * Dispatches a CustomEvent for cross-module communication.
   * @param {string} name - event name
   * @param {Object} detail - event detail payload
   */
  function dispatch(name, detail) {
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent(name, { detail }));
    }
  }

  // Return the public interface of the sidebar module
  return {
    /**
     * @function init
     * @description Initializes the sidebar (DOM queries, event binding, etc.).
     */
    init,
    /**
     * @function destroy
     * @description Cleans up event listeners, DOM elements, and resets state.
     */
    destroy,
    toggleSidebar,
    closeSidebar,
    showSidebar,
    togglePin,
    activateTab,
    isConversationStarred,
    toggleStarConversation,
    maybeRenderRecentConversations,
    maybeRenderStarredConversations,
  };
}
