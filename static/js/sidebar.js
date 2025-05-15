/**
 * sidebar.js – Strict DI/DependencySystem (notifications removed)
 *
 * Core sidebar functionality remains, while all logging/debugging/notify calls have been removed.
 */

import { safeParseJSON } from './utils/globalUtils.js';
import { createSidebarAuth } from './sidebar-auth.js';
import { createSidebarEvents } from './sidebar-events.js';

const MODULE = "Sidebar";

export function createSidebar({
  eventHandlers,
  app,
  projectDashboard,
  projectManager,
  uiRenderer,
  DependencySystem,
  storageAPI,
  viewportAPI,
  domAPI,
  accessibilityUtils
} = {}) {
  // Basic validations
  if (!DependencySystem) {
    throw new Error('[sidebar] DependencySystem is required.');
  }
  if (!eventHandlers) {
    throw new Error('[sidebar] eventHandlers is required.');
  }
  if (!storageAPI) {
    throw new Error('[sidebar] storageAPI (getItem/setItem) must be injected.');
  }
  if (!viewportAPI) {
    throw new Error('[sidebar] viewportAPI (getInnerWidth) must be injected.');
  }
  if (!domAPI) {
    throw new Error('[sidebar] domAPI is required.');
  }
  if (typeof domAPI.getActiveElement !== 'function') {
    throw new Error('[sidebar] domAPI.getActiveElement() must be provided.');
  }
  if (typeof domAPI.getDocument !== 'function') {
    throw new Error('[sidebar] domAPI.getDocument() must be a function.');
  }
  if (!accessibilityUtils || typeof accessibilityUtils.announce !== 'function') {
    throw new Error('[sidebar] accessibilityUtils with an announce method is required.');
  }

  // Resolve optional dependencies if not provided
  app = app || resolveDep('app');
  projectDashboard = projectDashboard || resolveDep('projectDashboard');
  projectManager = projectManager || resolveDep('projectManager');

  // Validate uiRenderer
  if (
    !uiRenderer ||
    typeof uiRenderer.renderConversations !== 'function' ||
    typeof uiRenderer.renderStarredConversations !== 'function' ||
    typeof uiRenderer.renderProjects !== 'function'
  ) {
    throw new Error(
      '[sidebar] uiRenderer with renderConversations, renderStarredConversations, and renderProjects is required.'
    );
  }

  function resolveDep(name) {
    if (DependencySystem?.modules?.get) {
      return DependencySystem.modules.get(name);
    }
    if (DependencySystem?.get) {
      return DependencySystem.get(name);
    }
    return undefined;
  }

  // DOM references
  let el = null;
  let btnToggle = null;
  let btnClose = null;
  let btnPin = null;
  let backdrop = null;
  let pinned = false;
  let visible = false;

  // Search input elements
  let chatSearchInputEl = null;
  let sidebarProjectSearchInputEl = null;

  // Inline auth state and logic
  const sidebarAuth = createSidebarAuth({
    DependencySystem,
    domAPI,
    eventHandlers,
    accessibilityUtils,
    MODULE
  });

  // Track starred conversations via local storage
  const starred = new Set(
    safeParseJSON(storageAPI.getItem('starredConversations'), [])
  );

  // Set up sidebar events (no logging)
  const sidebarEvents = createSidebarEvents({
    eventHandlers,
    DependencySystem,
    domAPI,
    uiRenderer,
    MODULE,
    chatSearchInputEl,
    sidebarProjectSearchInputEl,
    _handleChatSearch,
    _handleProjectSearch,
    activateTab,
    handleResize,
    isConversationStarred,
    toggleStarConversation,
    storageAPI,
    accessibilityUtils,
    showSidebar,
    closeSidebar,
    ensureProjectDashboard,
    togglePin,
    handleGlobalAuthStateChangeForSidebar
  });

  /**
   * Initialize the sidebar: find DOM elements, set up auth, restore state, etc.
   */
  async function init() {
    try {
      findDom();
      sidebarAuth.initAuthDom();
      sidebarAuth.setupInlineAuthForm();
      restorePersistentState();
      sidebarEvents.bindDomEvents();

      if (app && typeof app.getInitialSidebarContext === 'function') {
        const { projectId } = app.getInitialSidebarContext() || {};
        if (projectId && app && typeof app.setCurrentProject === 'function') {
          app.setCurrentProject({ id: projectId });
        }
      }

      const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
      await activateTab(activeTab);

      // Validate that the document supports dispatchEvent
      const docForValidation = domAPI.getDocument();
      if (!docForValidation || typeof docForValidation.dispatchEvent !== 'function') {
        throw new Error(
          '[sidebar] Document object from domAPI.getDocument() must have a dispatchEvent method.'
        );
      }

      return true;
    } catch {
      // Return false on error (no logging)
      return false;
    }
  }

  /**
   * Clean up any listeners, DOM references, etc.
   */
  function destroy() {
    if (DependencySystem && typeof DependencySystem.cleanupModuleListeners === 'function') {
      DependencySystem.cleanupModuleListeners(MODULE);
    } else if (eventHandlers && typeof eventHandlers.cleanupListeners === 'function') {
      eventHandlers.cleanupListeners({ context: MODULE });
    }
    if (eventHandlers && typeof eventHandlers.cleanupListeners === 'function') {
      eventHandlers.cleanupListeners({ context: 'inlineAuth' });
    }
    if (backdrop) {
      backdrop.remove();
      backdrop = null;
    }
    pinned = false;
    visible = false;
  }

  /**
   * Find key DOM elements.
   */
  function findDom() {
    el = domAPI.getElementById('mainSidebar');
    btnToggle = domAPI.getElementById('navToggleBtn');
    btnClose = domAPI.getElementById('closeSidebarBtn');
    btnPin = domAPI.getElementById('pinSidebarBtn');
    chatSearchInputEl = domAPI.getElementById('chatSearchInput');
    sidebarProjectSearchInputEl = domAPI.getElementById('sidebarProjectSearch');

    if (!el || !btnToggle) {
      throw new Error(
        'sidebar: critical DOM nodes missing (#mainSidebar or #navToggleBtn)'
      );
    }
  }

  /**
   * Restore pinned/visibility state from localStorage and adjust DOM.
   */
  function restorePersistentState() {
    pinned = storageAPI.getItem('sidebarPinned') === 'true';
    const isDesktop = viewportAPI.getInnerWidth() >= 768;
    if (pinned || isDesktop) {
      el.classList.add('sidebar-pinned');
      el.classList.remove('-translate-x-full');
      el.classList.add('translate-x-0');
      visible = true;
      el.setAttribute('aria-hidden', 'false');
      if (btnToggle) {
        btnToggle.setAttribute('aria-expanded', 'true');
      }
    }
    updatePinButtonVisual();
  }

  /**
   * Handle conversation search input.
   */
  function _handleChatSearch() {
    if (!chatSearchInputEl || !uiRenderer) return;
    const searchTerm = chatSearchInputEl.value.trim().toLowerCase();
    const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';

    const currentProject = projectManager.getCurrentProject?.();
    const projectId = currentProject?.id;

    if (activeTab === 'recent') {
      uiRenderer.renderConversations(
        projectId,
        searchTerm,
        isConversationStarred,
        toggleStarConversation
      );
      if (accessibilityUtils?.announce) {
        accessibilityUtils.announce(`Recent conversations filtered for "${searchTerm || 'all'}".`);
      }
    } else if (activeTab === 'starred') {
      uiRenderer.renderStarredConversations(
        projectId,
        searchTerm,
        isConversationStarred,
        toggleStarConversation
      );
      if (accessibilityUtils?.announce) {
        accessibilityUtils.announce(`Starred conversations filtered for "${searchTerm || 'all'}".`);
      }
    }
  }

  /**
   * Handle project search input.
   */
  function _handleProjectSearch() {
    if (!sidebarProjectSearchInputEl || !projectManager || !uiRenderer) return;
    const searchTerm = sidebarProjectSearchInputEl.value.trim().toLowerCase();

    const allProjects = projectManager.projects || [];
    const filteredProjects = searchTerm
      ? allProjects.filter((project) =>
          project.name && project.name.toLowerCase().includes(searchTerm)
        )
      : allProjects;

    uiRenderer.renderProjects(filteredProjects);
    if (accessibilityUtils?.announce) {
      accessibilityUtils.announce(
        `Projects filtered for "${searchTerm || 'all'}". Found ${filteredProjects.length} projects.`
      );
    }
  }

  /**
   * Activate a specific sidebar tab.
   */
  async function activateTab(name = 'recent') {
    try {
      const map = {
        recent: { btn: 'recentChatsTab', panel: 'recentChatsSection' },
        starred: { btn: 'starredChatsTab', panel: 'starredChatsSection' },
        projects: { btn: 'projectsTab', panel: 'projectsSection' }
      };
      if (!map[name]) {
        name = 'recent';
      }
      Object.entries(map).forEach(([key, ids]) => {
        const btn = domAPI.getElementById(ids.btn);
        const panel = domAPI.getElementById(ids.panel);
        if (btn && panel) {
          const isActive = key === name;
          btn.classList.toggle('tab-active', isActive);
          btn.setAttribute('aria-selected', String(isActive));
          btn.tabIndex = isActive ? 0 : -1;
          panel.classList.toggle('hidden', !isActive);
          if (isActive) {
            panel.classList.add('flex');
          } else {
            panel.classList.remove('flex');
          }
        }
      });
      storageAPI.setItem('sidebarActiveTab', name);
      dispatch('sidebarTabChanged', { tab: name });

      const currentProject = projectManager?.getCurrentProject?.();
      const projectId = currentProject?.id;

      if (name === 'recent' || name === 'starred') {
        if (!projectId) {
          const currentSearchTerm = chatSearchInputEl?.value?.trim().toLowerCase() || '';
          if (name === 'recent') {
            uiRenderer?.renderConversations?.(
              null,
              currentSearchTerm,
              isConversationStarred,
              toggleStarConversation
            );
          } else {
            uiRenderer?.renderStarredConversations?.(
              null,
              currentSearchTerm,
              isConversationStarred,
              toggleStarConversation
            );
          }
        } else {
          if (name === 'recent') {
            maybeRenderRecentConversations();
          } else {
            maybeRenderStarredConversations();
          }
        }
      } else if (name === 'projects') {
        await ensureProjectDashboard();
        _handleProjectSearch();
      }
    } catch {
      // No logging, just fail silently
    }
  }

  /**
   * Ensure project dashboard is initialized, then render projects.
   */
  async function ensureProjectDashboard() {
    try {
      if (!projectDashboard || typeof projectDashboard.initialize !== 'function') {
        return;
      }
      const section = domAPI.getElementById('projectsSection');
      if (section && !section.dataset.initialised) {
        section.dataset.initialised = 'true';
      }
      if (projectManager?.projects && uiRenderer?.renderProjects) {
        uiRenderer.renderProjects(projectManager.projects);
      }
    } catch {
      // Silent catch
    }
  }

  /**
   * Helper to render recent conversations if a project is selected (or show empty if not).
   */
  function maybeRenderRecentConversations(searchTerm = chatSearchInputEl?.value?.trim().toLowerCase() || "") {
    const projectId = projectManager?.getCurrentProject?.()?.id;
    if (!projectId) {
      if (searchTerm) {
        uiRenderer?.renderConversations?.(
          null,
          searchTerm,
          isConversationStarred,
          toggleStarConversation
        );
      }
      return;
    }
    uiRenderer?.renderConversations?.(projectId, searchTerm, isConversationStarred, toggleStarConversation);
  }

  /**
   * Helper to render starred conversations if a project is selected (or show empty if not).
   */
  function maybeRenderStarredConversations(searchTerm = chatSearchInputEl?.value?.trim().toLowerCase() || "") {
    const projectId = projectManager?.getCurrentProject?.()?.id;
    if (!projectId) {
      if (searchTerm) {
        uiRenderer?.renderStarredConversations?.(
          null,
          searchTerm,
          isConversationStarred,
          toggleStarConversation
        );
      }
      return;
    }
    uiRenderer?.renderStarredConversations?.(projectId, searchTerm, isConversationStarred, toggleStarConversation);
  }

  /**
   * Handle global auth state changes (delegates to sidebarAuth).
   */
  function handleGlobalAuthStateChangeForSidebar(event) {
    sidebarAuth.handleGlobalAuthStateChange(event);
  }

  /**
   * Toggle or set the pinned state of the sidebar.
   */
  function togglePin(force) {
    pinned = force !== undefined ? !!force : !pinned;
    storageAPI.setItem('sidebarPinned', pinned);
    el.classList.toggle('sidebar-pinned', pinned);
    updatePinButtonVisual();
    if (pinned) {
      showSidebar();
    }
    dispatch('sidebarPinChanged', { pinned });
  }

  function updatePinButtonVisual() {
    if (!btnPin) return;
    btnPin.setAttribute('aria-pressed', pinned.toString());
    btnPin.title = pinned ? 'Unpin sidebar' : 'Pin sidebar';
    btnPin.classList.toggle('text-primary', pinned);
  }

  /**
   * Toggle the sidebar's visibility, optionally forcing it.
   */
  function toggleSidebar(forceVisible) {
    const willShow = forceVisible !== undefined ? !!forceVisible : !visible;
    willShow ? showSidebar() : closeSidebar();
  }

  /**
   * Show the sidebar (e.g., on mobile or when pinned).
   */
  function showSidebar() {
    if (visible) return;
    visible = true;

    el.classList.remove('-translate-x-full');
    el.classList.add('translate-x-0');

    if ('inert' in HTMLElement.prototype && el.inert) {
      el.inert = false;
    }
    el.setAttribute('aria-hidden', 'false');
    if (btnToggle) {
      btnToggle.setAttribute('aria-expanded', 'true');
    }

    createBackdrop();
    if (domAPI.body && !domAPI.body.classList.contains('with-sidebar-open')) {
      domAPI.body.classList.add('with-sidebar-open');
    }

    const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
    if (activeTab === 'projects') {
      ensureProjectDashboard();
      const projSearch = domAPI.getElementById('sidebarProjectSearch');
      if (projSearch) {
        projSearch.focus();
      }
    }

    dispatch('sidebarVisibilityChanged', { visible });
  }

  /**
   * Close the sidebar unless it's pinned; also manage focus if needed.
   */
  function closeSidebar() {
    if (!visible || pinned) return;
    const activeEl = domAPI.getActiveElement();
    let focusSuccessfullyMoved = false;

    if (el.contains(activeEl)) {
      // Try moving focus to the toggle button
      if (
        btnToggle &&
        typeof btnToggle.focus === 'function' &&
        btnToggle.offsetParent !== null
      ) {
        btnToggle.focus();
        if (domAPI.getActiveElement() === btnToggle) {
          focusSuccessfullyMoved = true;
        }
      }
      if (!focusSuccessfullyMoved && typeof activeEl.blur === 'function') {
        activeEl.blur();
        if (el.contains(domAPI.getActiveElement())) {
          if (domAPI.body && typeof domAPI.body.focus === 'function') {
            domAPI.body.focus();
          }
        }
      }
    }

    visible = false;
    el.classList.add('-translate-x-full');

    const hasFocusableElements = el.querySelector(
      'button, input, a, [tabindex]:not([tabindex="-1"])'
    );
    if (hasFocusableElements) {
      if ('inert' in HTMLElement.prototype) {
        el.inert = true;
      }
    } else {
      el.setAttribute('aria-hidden', 'true');
    }

    if (btnToggle) {
      btnToggle.setAttribute('aria-expanded', 'false');
    }
    removeBackdrop();
    if (domAPI.body && domAPI.body.classList.contains('with-sidebar-open')) {
      domAPI.body.classList.remove('with-sidebar-open');
    }

    dispatch('sidebarVisibilityChanged', { visible });
  }

  /**
   * Called on viewport resize; removes backdrop if screen is large enough.
   */
  function handleResize() {
    if (viewportAPI.getInnerWidth() >= 1024) {
      removeBackdrop();
    }
  }

  /**
   * Create a backdrop for mobile devices.
   */
  function createBackdrop() {
    if (backdrop) return;
    if (viewportAPI.getInnerWidth() >= 1024) {
      return;
    }
    backdrop = domAPI.createElement('div');
    Object.assign(backdrop.style, {
      position: 'fixed',
      inset: '0px',
      zIndex: '40',
      backgroundColor: 'rgba(0,0,0,0.5)',
      cursor: 'pointer'
    });
    eventHandlers.trackListener(backdrop, 'click', () => closeSidebar(), {
      description: 'Sidebar backdrop click to close',
      context: MODULE
    });
    if (domAPI.body) {
      domAPI.body.appendChild(backdrop);
    }
  }

  /**
   * Remove the backdrop if it exists.
   */
  function removeBackdrop() {
    if (backdrop) {
      backdrop.remove();
      backdrop = null;
    }
  }

  /**
   * Check if a conversation is starred.
   */
  function isConversationStarred(id) {
    return starred.has(id);
  }

  /**
   * Toggle star/unstar status for a conversation.
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
   * Dispatch a custom event if possible.
   */
  function dispatch(name, detail) {
    const doc = domAPI.getDocument();
    if (doc && typeof doc.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
      doc.dispatchEvent(new CustomEvent(name, { detail }));
    }
  }

  return {
    init,
    destroy,
    toggleSidebar,
    closeSidebar,
    showSidebar,
    togglePin,
    activateTab,
    isConversationStarred,
    toggleStarConversation
  };
}
