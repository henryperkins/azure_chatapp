/**
 * sidebar.js – Strict DI/DependencySystem Refactored Edition
 *
 * A modular sidebar controller with no hard-coded window.*, document.*, or localStorage usage.
 * All dependencies (eventHandlers, app, projectDashboard, projectManager, uiRenderer, DependencySystem,
 * notificationHandler, storageAPI, viewportAPI, domAPI) are injected or resolved from DependencySystem if not provided.
 *
 * Exported as a factory function: createSidebar(opts).
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
 * @param {Function} options.notificationHandler - For notifications (optional).
 * @param {Object} options.storageAPI - For persistent storage (required).
 * @param {Object} options.viewportAPI - For viewport info (required).
 * @param {Object} options.domAPI - For DOM operations (required). Must provide:
 *    - getElementById(id)
 *    - createElement(tag)
 *    - querySelector(selector)
 *    - body: reference to <body>
 *    - getActiveElement(): HTMLElement (required, replaces use of document.activeElement)
 *    - ownerDocument: Document reference (required for event dispatch)
 * @returns {Object} The sidebar module with init(), destroy(), and other controls.
 */
export function createSidebar({
  eventHandlers,
  app,
  projectDashboard,
  projectManager,
  uiRenderer,
  DependencySystem,
  notificationHandler,
  storageAPI,
  viewportAPI,
  domAPI
} = {}) {
  if (!DependencySystem) throw new Error('[sidebar] DependencySystem is required.');
  if (!eventHandlers) throw new Error('[sidebar] eventHandlers is required.');
  if (!storageAPI) throw new Error('[sidebar] storageAPI (getItem/setItem) must be injected.');
  if (!viewportAPI) throw new Error('[sidebar] viewportAPI (getInnerWidth) must be injected.');
  if (!domAPI) throw new Error('[sidebar] domAPI (getElementById/createElement/querySelector/body/getActiveElement/ownerDocument) must be injected.');
  if (typeof domAPI.getActiveElement !== 'function') {
    throw new Error('[sidebar] domAPI.getActiveElement() must be provided to avoid using document.activeElement');
  }
  if (!domAPI.ownerDocument || typeof domAPI.ownerDocument.dispatchEvent !== 'function') {
    throw new Error('[sidebar] domAPI.ownerDocument with dispatchEvent() must be provided to avoid using window/document globals');
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
  notificationHandler = notificationHandler ||
    (app && app.showNotification ? app.showNotification.bind(app) : (msg, type) => { });

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

  // Starred conversations (from storage)
  const starred = new Set(
    safeParseJSON(storageAPI.getItem('starredConversations'), [])
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

      // --- Enhancement: get initial context from URL if needed ---
      if (app && typeof app.getInitialSidebarContext === 'function') {
        // Accepts { projectId, chatId }, returns object or null
        const { projectId, chatId } = app.getInitialSidebarContext() || {};
        if (projectId && projectManager && typeof projectManager.setCurrentProjectId === 'function') {
          projectManager.setCurrentProjectId(projectId);
        }
        // Optionally: handle chatId for sidebar if sidebar supports chat highlighting
      }

      const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
      await activateTab(activeTab);

      notificationHandler('[sidebar] initialized successfully', 'info');
      return true;
    } catch (err) {
      notificationHandler('[sidebar] Initialization failed: ' + (err && err.message ? err.message : err), 'error');
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
      eventHandlers.cleanupListeners?.(evt.element, evt.type, evt.description);
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

    notificationHandler('[sidebar] destroyed', 'info');
  }

  /**
   * Internal helper: queries important DOM elements for the sidebar.
   * Throws an error on missing critical nodes.
   */
  function findDom() {
    el = domAPI.getElementById('mainSidebar');
    btnToggle = domAPI.getElementById('navToggleBtn');
    btnClose = domAPI.getElementById('closeSidebarBtn');
    btnPin = domAPI.getElementById('pinSidebarBtn');

    if (!el || !btnToggle) {
      throw new Error('sidebar: critical DOM nodes missing (#mainSidebar or #navToggleBtn)');
    }
  }

  /**
   * Restores pinned/visible states from storage if present.
   * Updates classes and pinned visuals accordingly.
   */
  function restorePersistentState() {
    pinned = storageAPI.getItem('sidebarPinned') === 'true';
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
    if (viewportAPI && viewportAPI.onResize) {
      // If viewportAPI provides an event, use it
      track(viewportAPI, 'resize', handleResize, 'Sidebar resize');
    }

    [
      { name: 'recent', id: 'recentChatsTab' },
      { name: 'starred', id: 'starredChatsTab' },
      { name: 'projects', id: 'projectsTab' },
    ].forEach(({ name, id }) => {
      const btn = domAPI.getElementById(id);
      track(btn, 'click', () => activateTab(name), `Sidebar tab ${name}`);
    });
  }

  /**
   * Toggles the pinned state. If pinned is forced true, the sidebar remains visible.
   * @param {boolean} [force] - Force pinned true/false, or toggle if undefined.
   */
  function togglePin(force) {
    pinned = (force !== undefined) ? !!force : !pinned;
    storageAPI.setItem('sidebarPinned', pinned);
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

    const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
    if (activeTab === 'projects') {
      ensureProjectDashboard();
      const projSearch = domAPI.getElementById('sidebarProjectSearch');
      if (projSearch) projSearch.focus();
    }

    dispatch('sidebarVisibilityChanged', { visible });
  }

  /**
   * Hides the sidebar if it is currently shown and not pinned.
   */
  function closeSidebar() {
    if (!visible || pinned) return;
    const activeEl = domAPI.getActiveElement();
    if (el.contains(activeEl)) {
      // blur any focused element inside the sidebar
      activeEl.blur();
    }
    visible = false;
    el.classList.add('-translate-x-full');
    el.setAttribute('aria-hidden', 'true');
    btnToggle.setAttribute('aria-expanded', 'false');
    removeBackdrop();
    dispatch('sidebarVisibilityChanged', { visible });
  }

  /**
   * Handles viewport resize events to remove the backdrop if width is large enough (desktop).
   */
  function handleResize() {
    if (viewportAPI.getInnerWidth() >= 1024) {
      removeBackdrop();
    }
  }

  /**
   * Creates a semi-transparent backdrop to close the sidebar on mobile/tablet.
   */
  function createBackdrop() {
    if (backdrop) return;
    if (viewportAPI.getInnerWidth() >= 1024) {
      return; // No backdrop in large screens
    }
    backdrop = domAPI.createElement('div');
    Object.assign(backdrop, {
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
    domAPI.body && domAPI.body.appendChild(backdrop);
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
   * Saves the active tab in storage and ensures the proper UI panels are shown.
   * @param {string} name - The tab name to activate
   */
  async function activateTab(name = 'recent') {
    try {
      const map = {
        recent: { btn: 'recentChatsTab', panel: 'recentChatsSection' },
        starred: { btn: 'starredChatsTab', panel: 'starredChatsSection' },
        projects: { btn: 'projectsTab', panel: 'projectsSection' },
      };
      if (!map[name]) {
        name = 'recent';
      }

      Object.entries(map).forEach(([key, ids]) => {
        const btn = domAPI.getElementById(ids.btn);
        const panel = domAPI.getElementById(ids.panel);
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

      storageAPI.setItem('sidebarActiveTab', name);
      dispatch('sidebarTabChanged', { tab: name });

      if (name === 'recent') {
        maybeRenderRecentConversations();
      } else if (name === 'starred') {
        maybeRenderStarredConversations();
      }
    } catch (err) {
      notificationHandler('[sidebar] Failed to activate tab: ' + (err && err.message ? err.message : err), 'error');
    }
  }

  /**
   * If the 'projects' tab is active, calls projectDashboard.initialize()
   * and triggers any needed UI rendering for projects.
   */
  async function ensureProjectDashboard() {
    try {
      if (!projectDashboard || typeof projectDashboard.initialize !== 'function') return;
      const section = domAPI.getElementById('projectsSection');
      if (section && !section.dataset.initialised) {
        await projectDashboard.initialize();
        section.dataset.initialised = 'true';
      }
      if (projectManager?.projects && uiRenderer?.renderProjects) {
        uiRenderer.renderProjects(projectManager.projects);
      }
    } catch (err) {
      notificationHandler('[sidebar] Failed to ensure project dashboard: ' + (err && err.message ? err.message : err), 'error');
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
   * Toggles the 'starred' status of a conversation, saving to storage.
   * @param {string|number} id - conversation ID
   * @returns {boolean} - whether it is starred after toggling
   */
  function toggleStarConversation(id) {
    if (starred.has(id)) {
      starred.delete(id);
    } else {
      starred.add(id);
    }
    storageAPI.setItem('starredConversations', JSON.stringify([...starred]));
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
    if (domAPI && domAPI.ownerDocument && typeof CustomEvent !== 'undefined') {
      domAPI.ownerDocument.dispatchEvent(new CustomEvent(name, { detail }));
    }
  }

  // Return the public interface of the sidebar module
  return {
    init,
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
