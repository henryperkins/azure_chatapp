/**
 * sidebar.js – Strict DI/DependencySystem, context-rich notifications (2025-05)
 *
 * All notify.* calls provide: group, context, module ("Sidebar"), source (function), dynamic detail, originalError as needed.
 * This enables rapid troubleshooting, Sentry correlation, and support for all user/system events.
 */

import { safeParseJSON } from './utils/globalUtils.js';
import { safeInvoker } from './utils/notifications-helpers.js';

const MODULE = "Sidebar";

export function createSidebar({
  eventHandlers,
  app,
  projectDashboard,
  projectManager,
  uiRenderer,
  DependencySystem,
  notify,
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
  app = app || resolveDep('app');
  projectDashboard = projectDashboard || resolveDep('projectDashboard');
  projectManager = projectManager || resolveDep('projectManager');
  uiRenderer = uiRenderer || resolveDep('uiRenderer');
  if (!notify) throw new Error('[sidebar] notify util (from DI) is required');

  function resolveDep(name) {
    if (DependencySystem?.modules?.get) return DependencySystem.modules.get(name);
    if (DependencySystem?.get) return DependencySystem.get(name);
    return undefined;
  }

  let el = null;
  let btnToggle = null;
  let btnClose = null;
  let btnPin = null;
  let backdrop = null;
  let pinned = false;
  let visible = false;
  let trackedEvents = [];

  const starred = new Set(
    safeParseJSON(storageAPI.getItem('starredConversations'), [])
  );

  async function init() {
    notify.debug('[sidebar] init() called', { group: true, context: 'sidebar', module: MODULE, source: 'init' });
    try {
      findDom();
      restorePersistentState();
      bindDomEvents();
      if (app && typeof app.getInitialSidebarContext === 'function') {
        const { projectId } = app.getInitialSidebarContext() || {};
        if (projectId && projectManager && typeof projectManager.setCurrentProjectId === 'function') {
          projectManager.setCurrentProjectId(projectId);
        }
      }
      const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
      await activateTab(activeTab);
      notify.info('[sidebar] initialized successfully', { group: true, context: 'sidebar', module: MODULE, source: 'init', activeTab });

      // --- Standardized "sidebar:initialized" event ---
      const doc = domAPI?.getDocument?.() || (typeof document !== "undefined" ? document : null);
      if (doc) {
        if (domAPI?.dispatchEvent) {
          domAPI.dispatchEvent(doc, new CustomEvent('sidebar:initialized',
            { detail: { success: true } }));
        } else {
          doc.dispatchEvent(new CustomEvent('sidebar:initialized',
            { detail: { success: true } }));
        }
      }

      return true;
    } catch (err) {
      notify.error('[sidebar] Initialization failed: ' + (err && err.message ? err.message : err), {
        group: true, context: 'sidebar', module: MODULE, source: 'init', originalError: err
      });
      return false;
    }
  }

  function destroy() {
    trackedEvents.forEach(evt => {
      eventHandlers.cleanupListeners?.(evt.element, evt.type, evt.description);
    });
    trackedEvents = [];
    if (backdrop) { backdrop.remove(); backdrop = null; }
    pinned = false; visible = false;
    notify.info('[sidebar] destroyed', { group: true, context: 'sidebar', module: MODULE, source: 'destroy' });
  }

  function findDom() {
    el = domAPI.getElementById('mainSidebar');
    btnToggle = domAPI.getElementById('navToggleBtn');
    btnClose = domAPI.getElementById('closeSidebarBtn');
    btnPin = domAPI.getElementById('pinSidebarBtn');
    if (!el || !btnToggle) {
      notify.error('sidebar: critical DOM nodes missing (#mainSidebar or #navToggleBtn)', {
        group: true, context: 'sidebar', module: MODULE, source: 'findDom',
        detail: { el, btnToggle }
      });
      throw new Error('sidebar: critical DOM nodes missing (#mainSidebar or #navToggleBtn)');
    }
  }

  function restorePersistentState() {
    pinned = storageAPI.getItem('sidebarPinned') === 'true';
    if (pinned) {
      el.classList.add('sidebar-pinned', 'translate-x-0');
      visible = true;
    }
    updatePinButtonVisual();
  }

  function bindDomEvents() {
    const track = (element, evtType, handler, description, sourceOverride) => {
      if (!element) return;
      const contextualHandler = safeInvoker(
        handler,
        { notify },
        { context: 'sidebar', module: MODULE, source: sourceOverride || description }
      );
      const wrappedHandler = eventHandlers.trackListener(element, evtType, contextualHandler, { description });
      if (wrappedHandler) {
        trackedEvents.push({ element, type: evtType, description });
      }
    };
    track(btnToggle, 'click', () => toggleSidebar(), 'Sidebar toggle', 'toggleSidebar');
    track(btnClose, 'click', () => closeSidebar(), 'Sidebar close', 'closeSidebar');
    track(btnPin, 'click', () => togglePin(), 'Sidebar pin', 'togglePin');
    if (viewportAPI && viewportAPI.onResize) {
      track(viewportAPI, 'resize', handleResize, 'Sidebar resize', 'handleResize');
    }
    [
      { name: 'recent', id: 'recentChatsTab' },
      { name: 'starred', id: 'starredChatsTab' },
      { name: 'projects', id: 'projectsTab' },
    ].forEach(({ name, id }) => {
      const btn = domAPI.getElementById(id);
      track(btn, 'click', () => activateTab(name), `Sidebar tab ${name}`, 'activateTab');
    });

    // Bind a generic "error" event handler for child widget error forward
    if (el) {
      const errorHandler = safeInvoker(
        (e) => {
          notify.error('[sidebar] Widget error: ' + (e && e.detail && e.detail.message ? e.detail.message : String(e)), {
            group: true,
            context: 'sidebar',
            module: MODULE,
            source: 'childWidgetError',
            originalError: e?.detail?.error || e?.error || e
          });
        },
        { notify },
        { context: 'sidebar', module: MODULE, source: 'childWidgetError' }
      );
      const handler = eventHandlers.trackListener(el, 'error', errorHandler, { description: 'Sidebar child widget error' });
      if (handler) {
        trackedEvents.push({ element: el, type: 'error', description: 'Sidebar child widget error' });
      }
    }
  }

  function togglePin(force) {
    pinned = (force !== undefined) ? !!force : !pinned;
    storageAPI.setItem('sidebarPinned', pinned);
    el.classList.toggle('sidebar-pinned', pinned);
    updatePinButtonVisual();
    if (pinned) showSidebar();
    dispatch('sidebarPinChanged', { pinned });
    notify.info('[sidebar] pin status changed', {
      group: true,
      context: 'sidebar',
      module: MODULE,
      source: 'togglePin',
      detail: {
        pinned,
        viewportWidth: viewportAPI.getInnerWidth?.(),
        pinState: pinned
      }
    });
  }

  function updatePinButtonVisual() {
    if (!btnPin) return;
    btnPin.setAttribute('aria-pressed', pinned.toString());
    btnPin.title = pinned ? 'Unpin sidebar' : 'Pin sidebar';
    btnPin.classList.toggle('text-primary', pinned);
    btnPin.classList.add('btn', 'btn-ghost', 'btn-square', 'btn-sm', 'min-w-[44px]', 'min-h-[44px]');
  }

  function toggleSidebar(forceVisible) {
    const willShow = (forceVisible !== undefined) ? !!forceVisible : !visible;
    willShow ? showSidebar() : closeSidebar();
    notify.info('[sidebar] toggled', {
      group: true,
      context: 'sidebar',
      module: MODULE,
      source: 'toggleSidebar',
      detail: {
        willShow,
        viewportWidth: viewportAPI.getInnerWidth?.(),
        pinState: pinned
      }
    });
  }

  function showSidebar() {
    if (visible) return;
    visible = true;
    el.classList.remove('-translate-x-full');
    el.setAttribute('aria-hidden', 'false');
    btnToggle.setAttribute('aria-expanded', 'true');
    createBackdrop();
    if (typeof document !== 'undefined' && document.body && !document.body.classList.contains('with-sidebar-open')) {
      document.body.classList.add('with-sidebar-open');
    }
    const activeTab = storageAPI.getItem('sidebarActiveTab') || 'recent';
    if (activeTab === 'projects') {
      ensureProjectDashboard();
      const projSearch = domAPI.getElementById('sidebarProjectSearch');
      if (projSearch) projSearch.focus();
    }
    dispatch('sidebarVisibilityChanged', { visible });
    notify.info('[sidebar] shown', { group: true, context: 'sidebar', module: MODULE, source: 'showSidebar' });
  }

  function closeSidebar() {
    if (!visible || pinned) return;
    const activeEl = domAPI.getActiveElement();
    if (el.contains(activeEl)) activeEl.blur();
    visible = false;
    el.classList.add('-translate-x-full');
    el.setAttribute('aria-hidden', 'true');
    btnToggle.setAttribute('aria-expanded', 'false');
    removeBackdrop();
    if (typeof document !== 'undefined' && document.body && document.body.classList.contains('with-sidebar-open')) {
      document.body.classList.remove('with-sidebar-open');
    }
    dispatch('sidebarVisibilityChanged', { visible });
    notify.info('[sidebar] closed', {
      group: true, context: 'sidebar', module: MODULE, source: 'closeSidebar'
    });
  }

  function handleResize() {
    if (viewportAPI.getInnerWidth() >= 1024) removeBackdrop();
    notify.info('[sidebar] resize event', { group: true, context: 'sidebar', module: MODULE, source: 'handleResize', detail: { width: viewportAPI.getInnerWidth() } });
  }

  function createBackdrop() {
    if (backdrop) return;
    if (viewportAPI.getInnerWidth() >= 1024) return;
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
      trackedEvents.push({ element: backdrop, type: 'click', description: 'Sidebar backdrop' });
    }
    domAPI.body && domAPI.body.appendChild(backdrop);
  }

  function removeBackdrop() {
    if (backdrop) { backdrop.remove(); backdrop = null; }
  }

  async function activateTab(name = 'recent') {
    try {
      const map = {
        recent: { btn: 'recentChatsTab', panel: 'recentChatsSection' },
        starred: { btn: 'starredChatsTab', panel: 'starredChatsSection' },
        projects: { btn: 'projectsTab', panel: 'projectsSection' },
      };
      if (!map[name]) name = 'recent';
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
          if (isActive && name === 'projects' && el.getAttribute('aria-hidden') === 'false') {
            ensureProjectDashboard();
          }
        }
      });
      storageAPI.setItem('sidebarActiveTab', name);
      dispatch('sidebarTabChanged', { tab: name });
      if (name === 'recent') maybeRenderRecentConversations();
      else if (name === 'starred') maybeRenderStarredConversations();
      notify.info('[sidebar] tab activated', { group: true, context: 'sidebar', module: MODULE, source: 'activateTab', detail: { tab: name } });
    } catch (err) {
      notify.error('[sidebar] Failed to activate tab: ' + (err && err.message ? err.message : err), { group: true, context: 'sidebar', module: MODULE, source: 'activateTab', originalError: err });
    }
  }

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
      notify.error('[sidebar] Failed to ensure project dashboard: ' + (err && err.message ? err.message : err), {
        group: true, context: 'sidebar', module: MODULE, source: 'ensureProjectDashboard', originalError: err
      });
    }
  }

  function maybeRenderRecentConversations() {
    if (uiRenderer?.renderConversations) uiRenderer.renderConversations();
  }

  function maybeRenderStarredConversations() {
    if (uiRenderer?.renderStarredConversations) uiRenderer.renderStarredConversations();
  }

  function isConversationStarred(id) { return starred.has(id); }
  function toggleStarConversation(id) {
    if (starred.has(id)) starred.delete(id); else starred.add(id);
    storageAPI.setItem('starredConversations', JSON.stringify([...starred]));
    maybeRenderStarredConversations();
    dispatch('sidebarStarredChanged', { id, starred: starred.has(id) });
    notify.info('[sidebar] star toggled', { group: true, context: 'sidebar', module: MODULE, source: 'toggleStarConversation', detail: { id, starred: starred.has(id) } });
    return starred.has(id);
  }

  function dispatch(name, detail) {
    if (domAPI && domAPI.ownerDocument && typeof CustomEvent !== 'undefined') {
      domAPI.dispatchEvent(domAPI.ownerDocument, new CustomEvent(name, { detail }));
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
    toggleStarConversation,
    maybeRenderRecentConversations,
    maybeRenderStarredConversations,
  };
}
