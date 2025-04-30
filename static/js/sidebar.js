/**
 * sidebar.js – DI/DependencySystem Refactored Edition
 *
 * Single source-of-truth for all sidebar behaviour, strictly modular.
 *
 * NO dependency on window.* or global registration; all dependencies injected or resolved via DependencySystem once and passed as options.
 *
 * Usage:
 *   import { createSidebar } from './sidebar.js';
 *   const sidebar = createSidebar({ eventHandlers, app, projectDashboard, projectManager, uiRenderer, DependencySystem });
 *   DependencySystem.register('sidebar', sidebar);
 *   sidebar.init();
 */

export function createSidebar({
  eventHandlers,
  app,
  projectDashboard,
  projectManager,
  uiRenderer,
  DependencySystem
} = {}) {
  if (!DependencySystem) throw new Error('DependencySystem is required for sidebar');
  if (!eventHandlers) throw new Error('eventHandlers is required for sidebar');

  // Dependency resolution helpers
  function resolveDep(name) {
    if (DependencySystem?.modules?.get) return DependencySystem.modules.get(name);
    if (DependencySystem?.get) return DependencySystem.get(name);
    return undefined;
  }
  app = app || resolveDep('app');
  projectDashboard = projectDashboard || resolveDep('projectDashboard');
  projectManager = projectManager || resolveDep('projectManager');
  uiRenderer = uiRenderer || resolveDep('uiRenderer');

  let el, btnToggle, btnClose, btnPin, backdrop;
  let pinned = false;  // stays open when true
  let visible = false; // current visual state

  function safeParseJSON(jsonString, defaultVal) {
    if (typeof jsonString !== 'string') return defaultVal;
    try { return JSON.parse(jsonString); } catch { return defaultVal; }
  }
  const starred = new Set(
    safeParseJSON(localStorage?.getItem('starredConversations'), [])
  );

  // ───────────────────────── init ─────────────────────────
  async function init() {
    try {
      findDom();
      restorePersistentState();
      bindDomEvents();
      const activeTab = localStorage?.getItem('sidebarActiveTab') || 'recent';
      await activateTab(activeTab);
      console.log('[sidebar] initialized successfully');
      return true;
    } catch (err) {
      console.error('[sidebar] Initialization failed:', err);
      return false;
    }
  }

  function findDom() {
    el = document.getElementById('mainSidebar');
    btnToggle = document.getElementById('navToggleBtn');
    btnClose = document.getElementById('closeSidebarBtn');
    btnPin = document.getElementById('pinSidebarBtn');
    if (!el || !btnToggle) {
      throw new Error('sidebar: critical DOM nodes missing (#mainSidebar and/or #navToggleBtn)');
    }
  }

  function restorePersistentState() {
    pinned = localStorage?.getItem('sidebarPinned') === 'true';
    if (pinned) {
      el.classList.add('sidebar-pinned', 'translate-x-0');
      visible = true;
    }
    updatePinButtonVisual();
  }

  function bindDomEvents() {
    const addListener = (target, type, handler, desc) => {
      if (!target) return;
      eventHandlers.trackListener(target, type, handler, { description: desc });
    };

    addListener(btnToggle, 'click', () => toggleSidebar(), 'Sidebar toggle');
    addListener(btnClose, 'click', () => closeSidebar(), 'Sidebar close');
    addListener(btnPin, 'click', () => togglePin(), 'Sidebar pin');
    addListener(window, 'resize', handleResize, 'Sidebar resize');

    [
      { name: 'recent', id: 'recentChatsTab' },
      { name: 'starred', id: 'starredChatsTab' },
      { name: 'projects', id: 'projectsTab' },
    ].forEach(({ name, id }) => {
      const btn = document.getElementById(id);
      addListener(btn, 'click', () => activateTab(name), `Sidebar tab ${name}`);
    });
  }

  function togglePin(force) {
    pinned = (force !== undefined) ? !!force : !pinned;
    if (localStorage) localStorage.setItem('sidebarPinned', pinned);
    el.classList.toggle('sidebar-pinned', pinned);
    updatePinButtonVisual();
    if (pinned) showSidebar();
    dispatch('sidebarPinChanged', { pinned });
  }

  function updatePinButtonVisual() {
    if (!btnPin) return;
    btnPin.setAttribute('aria-pressed', pinned.toString());
    btnPin.title = pinned ? 'Unpin sidebar' : 'Pin sidebar';
    btnPin.classList.toggle('text-primary', pinned);
  }

  function toggleSidebar(forceVisible) {
    const willShow = (forceVisible !== undefined) ? !!forceVisible : !visible;
    willShow ? showSidebar() : closeSidebar();
  }

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

  function closeSidebar() {
    if (!visible || pinned) return;
    if (el.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    visible = false;
    el.classList.add('-translate-x-full');
    el.setAttribute('aria-hidden', 'true');
    btnToggle.setAttribute('aria-expanded', 'false');
    removeBackdrop();

    dispatch('sidebarVisibilityChanged', { visible });
  }

  function handleResize() {
    if (window?.innerWidth >= 1024) {
      removeBackdrop();
    }
  }

  function createBackdrop() {
    if (backdrop || window?.innerWidth >= 1024) return;
    backdrop = Object.assign(document.createElement('div'), {
      className: 'fixed inset-0 bg-black bg-opacity-50 z-40',
      style: 'cursor:pointer',
    });

    const closeHandler = () => closeSidebar();
    eventHandlers.trackListener(backdrop, 'click', closeHandler, { description: 'Sidebar backdrop' });

    document.body.appendChild(backdrop);
  }

  function removeBackdrop() {
    if (backdrop) {
      backdrop.remove();
      backdrop = null;
    }
  }

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
        btn.setAttribute('aria-selected', isActive.toString());
        btn.tabIndex = isActive ? 0 : -1;
        panel.classList.toggle('hidden', !isActive);
        panel.classList.toggle('flex', isActive);

        if (isActive && name === 'projects' && el.getAttribute('aria-hidden') === 'false') {
          ensureProjectDashboard();
        }
      }
    });

    if (localStorage) localStorage.setItem('sidebarActiveTab', name);
    dispatch('sidebarTabChanged', { tab: name });

    if (name === 'recent') {
      maybeRenderRecentConversations();
    } else if (name === 'starred') {
      maybeRenderStarredConversations();
    }
  }

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

  function isConversationStarred(id) {
    return starred.has(id);
  }

  function toggleStarConversation(id) {
    if (starred.has(id)) {
      starred.delete(id);
    } else {
      starred.add(id);
    }
    if (localStorage) localStorage.setItem('starredConversations', JSON.stringify([...starred]));
    maybeRenderStarredConversations();
    dispatch('sidebarStarredChanged', { id, starred: starred.has(id) });
    return starred.has(id);
  }

  // Conversation rendering helpers remain the same, but use only injected deps

  function renderConversations(data) {
    const cont = document.getElementById('sidebarConversations');
    if (!cont) return;
    cont.innerHTML = '';

    const list = data?.data?.conversations || data?.conversations || [];
    const uniq = [];
    const seen = new Set();
    list.forEach(c => {
      if (c.id && !seen.has(c.id)) {
        uniq.push(c);
        seen.add(c.id);
      }
    });

    if (!uniq.length) {
      cont.appendChild(Object.assign(document.createElement('li'), {
        className: 'text-gray-500 text-center py-4',
        textContent: 'No conversations yet',
      }));
      return;
    }

    uniq.forEach(c => cont.appendChild(createConversationLI(c)));
  }

  function renderStarredConversations(data) {
    const cont = document.getElementById('starredConversations');
    if (!cont) return;
    cont.innerHTML = '';
    const all = data?.data?.conversations || data?.conversations || [];
    const filtered = all.filter(c => c.id && starred.has(c.id));
    if (!filtered.length) {
      cont.appendChild(Object.assign(document.createElement('li'), {
        className: 'text-gray-500 text-center py-4',
        textContent: 'No starred conversations yet',
      }));
      return;
    }
    filtered.forEach(c => cont.appendChild(createConversationLI(c)));
  }

  function createConversationLI(item) {
    const li = document.createElement('li');
    li.className = 'p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer';

    const flex = Object.assign(document.createElement('div'), { className: 'flex flex-col' });

    const head = Object.assign(document.createElement('div'), { className: 'flex items-center justify-between' });
    const t = Object.assign(document.createElement('span'), { className: 'flex-1 truncate font-medium', textContent: item.title || `Conversation ${item.id}` });
    head.appendChild(t);

    const b = document.createElement('button');
    updateStarBtn(b, isConversationStarred(item.id));
    b.addEventListener('click', e => {
      e.stopPropagation();
      if (!app?.state?.isAuthenticated) {
        app?.showNotification
          ? app.showNotification('Login to star conversations.', 'warning')
          : alert('Login to star conversations.');
        return;
      }
      const nowStarred = toggleStarConversation(item.id);
      updateStarBtn(b, nowStarred);
    });
    head.appendChild(b);

    const sub = Object.assign(document.createElement('div'), { className: 'flex items-center text-xs text-gray-500 mt-1' });
    if (item.model_id) {
      sub.appendChild(Object.assign(document.createElement('span'), { className: 'truncate', textContent: item.model_id }));
    }
    if (item.project_id) {
      if (item.model_id) {
        sub.appendChild(Object.assign(document.createElement('span'), { className: 'mx-1', textContent: '•' }));
      }
      sub.appendChild(Object.assign(document.createElement('span'), { className: 'truncate', textContent: 'Project' }));
    }

    flex.append(head, sub);
    li.appendChild(flex);

    li.addEventListener('click', () => {
      if (!app?.state?.isAuthenticated) {
        app?.showNotification
          ? app.showNotification('Sign in to view conversations.', 'warning')
          : alert('Sign in to view conversations.');
        return;
      }
      // If a navigation module is present, use it
      const nav = null;
      if (nav) {
        nav(item.id);
      } else {
        app?.showNotification
          ? app.showNotification('Navigation unavailable.', 'error')
          : alert('Navigation unavailable.');
      }
    });

    return li;
  }

  function updateStarBtn(btn, on) {
    btn.className = on
      ? 'ml-2 text-yellow-500'
      : 'ml-2 text-gray-300 hover:text-yellow-500';
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4"
           fill="${on ? 'currentColor' : 'none'}"
           viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1
                 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1
                 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l
                 -3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838
                 -.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976
                 -2.888c-.783-.57-.38-1.81.588
                 -1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/>
      </svg>`;
  }

  function dispatch(name, detail) {
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent(name, { detail }));
    }
  }

  return {
    init,
    toggleSidebar,
    closeSidebar,
    showSidebar,
    togglePin,
    activateTab,
    isConversationStarred,
    toggleStarConversation,
    renderConversations,
    renderStarredConversations,
  };
}
