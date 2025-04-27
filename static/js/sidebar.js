/**
 * sidebar.js – single source-of-truth for all sidebar behaviour
 *
 * Nothing is attached to window; the singleton is registered with
 * DependencySystem as “sidebar”.  Other modules obtain it via:
 *   const sidebar = DependencySystem.modules.get('sidebar');
 *
 * Required globals (via DependencySystem or late-loaded):
 *   - eventHandlers
 *   - app                : for auth state + notifications
 *   - projectDashboard   : lazy-init on ‘projects’ tab
 *   - projectManager     : for project lists
 *   - uiRenderer         : optional – for render helper reuse
 */

export function createSidebar() {
  /* ───────────────────────── state ───────────────────────── */
  let el, btnToggle, btnClose, btnPin, backdrop;
  let pinned = false;           // stays open when true
  let visible = false;           // current visual state
  let starred = new Set(JSON.parse(localStorage.getItem('starredConversations') || '[]'));

  /* ───────────────────────── init ───────────────────────── */
  async function init() {
    await findDom();
    restorePersistentState();
    bindDomEvents();
    await activateTab(localStorage.getItem('sidebarActiveTab') || 'recent');
    console.log('[sidebar] initialised');
    return true;
  }

  async function findDom() {
    for (let i = 0; i < 6; i += 1) {
      el = document.getElementById('mainSidebar');
      btnToggle = document.getElementById('navToggleBtn');
      btnClose = document.getElementById('closeSidebarBtn');
      btnPin = document.getElementById('pinSidebarBtn');
      if (el && btnToggle) break;
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r => setTimeout(r, 300));
    }
    if (!el || !btnToggle) throw new Error('sidebar: critical DOM nodes missing');
  }

  function restorePersistentState() {
    pinned = localStorage.getItem('sidebarPinned') === 'true';
    if (pinned) {
      el.classList.add('sidebar-pinned', 'translate-x-0');
      visible = true;
    }
    updatePinButtonVisual();
  }

  /* ───────────────────── event wiring ───────────────────── */
  function bindDomEvents() {
    const EH = window.eventHandlers;
    EH.trackListener(btnToggle, 'click', () => toggleSidebar(), { description: 'Sidebar toggle' });
    EH.trackListener(btnClose, 'click', () => closeSidebar(), { description: 'Sidebar close' });
    EH.trackListener(btnPin, 'click', () => togglePin(), { description: 'Sidebar pin' });
    EH.trackListener(window, 'resize', handleResize, { description: 'Sidebar resize' });

    [
      { name: 'recent', id: 'recentChatsTab' },
      { name: 'starred', id: 'starredChatsTab' },
      { name: 'projects', id: 'projectsTab' },
    ].forEach(({ name, id }) => {
      const btn = document.getElementById(id);
      if (btn) EH.trackListener(btn, 'click', () => activateTab(name),
        { description: `Sidebar tab ${name}` });
    });
  }

  /* ───────────────────── pin / unpin ───────────────────── */
  function togglePin(force) {
    pinned = force !== undefined ? !!force : !pinned;
    localStorage.setItem('sidebarPinned', pinned);
    el.classList.toggle('sidebar-pinned', pinned);
    updatePinButtonVisual();
    if (pinned) showSidebar();          // keep open
    dispatch('sidebarPinChanged', { pinned });
  }

  function updatePinButtonVisual() {
    if (!btnPin) return;
    btnPin.setAttribute('aria-pressed', pinned.toString());
    btnPin.title = pinned ? 'Unpin sidebar' : 'Pin sidebar';
    btnPin.classList.toggle('text-primary', pinned);
  }

  /* ───────────────────── show / hide ───────────────────── */
  function toggleSidebar(forceVisible) {
    const willShow = forceVisible !== undefined ? !!forceVisible : !visible;
    willShow ? showSidebar() : closeSidebar();
  }

  function showSidebar() {
    if (visible) return;
    visible = true;
    el.classList.remove('-translate-x-full');
    el.setAttribute('aria-hidden', 'false');
    btnToggle.setAttribute('aria-expanded', 'true');
    createBackdrop();
    dispatch('sidebarVisibilityChanged', { visible });
  }

  function closeSidebar() {
    if (!visible || pinned) return;     // don't close when pinned
    visible = false;
    el.classList.add('-translate-x-full');
    el.setAttribute('aria-hidden', 'true');
    btnToggle.setAttribute('aria-expanded', 'false');
    removeBackdrop();
    dispatch('sidebarVisibilityChanged', { visible });
  }

  function handleResize() {
    if (window.innerWidth >= 1024) removeBackdrop();   // desktop
  }

  /* ───────────────────── backdrop (mobile) ───────────────────── */
  function createBackdrop() {
    if (backdrop || window.innerWidth >= 1024) return;
    backdrop = Object.assign(document.createElement('div'), {
      className: 'fixed inset-0 bg-black bg-opacity-50 z-40',
      style: 'cursor:pointer',
    });
    window.eventHandlers.trackListener(backdrop, 'click', closeSidebar,
      { description: 'Sidebar backdrop' });
    document.body.appendChild(backdrop);
  }
  function removeBackdrop() { if (backdrop) { backdrop.remove(); backdrop = null; } }

  /* ───────────────────── tabs ───────────────────── */
  async function activateTab(name = 'recent') {
    const map = {
      recent: { btn: 'recentChatsTab', panel: 'recentChatsSection' },
      starred: { btn: 'starredChatsTab', panel: 'starredChatsSection' },
      projects: { btn: 'projectsTab', panel: 'projectsSection' },
    };
    if (!map[name]) name = 'recent';

    Object.entries(map).forEach(([key, ids]) => {
      const btn = document.getElementById(ids.btn);
      const panel = document.getElementById(ids.panel);
      if (btn && panel) {
        const active = key === name;
        btn.classList.toggle('tab-active', active);
        btn.setAttribute('aria-selected', active.toString());
        btn.tabIndex = active ? 0 : -1;
        panel.classList.toggle('hidden', !active);
        panel.classList.toggle('flex', active);
      }
    });

    localStorage.setItem('sidebarActiveTab', name);
    dispatch('sidebarTabChanged', { tab: name });

    if (name === 'projects') await ensureProjectDashboard();
    if (name === 'recent') maybeRenderConversations();
  }

  async function ensureProjectDashboard() {
    const DS = window.DependencySystem;
    const dash = DS?.waitFor ? await DS.waitFor('projectDashboard', null, 5000) : null;
    if (!dash) return;

    const section = document.getElementById('projectsSection');
    if (section && !section.dataset.initialised) {
      await dash.initialize?.();
      section.dataset.initialised = 'true';
    }

    const pm = DS.modules.get('projectManager');
    const uiR = DS.modules.get('uiRenderer');
    if (pm?.projects && uiR?.renderProjects) uiR.renderProjects(pm.projects);
  }

  function maybeRenderConversations() {
    const uiR = window.uiRenderer;
    if (window.chatConfig?.conversations && uiR?.renderConversations) {
      uiR.renderConversations(window.chatConfig);
    }
  }

  /* ────────────────── star/unstar helpers ────────────────── */
  function isConversationStarred(id) { return starred.has(id); }

  function toggleStarConversation(id) {
    if (starred.has(id)) starred.delete(id);
    else starred.add(id);
    localStorage.setItem('starredConversations', JSON.stringify([...starred]));
    dispatch('sidebarStarredChanged', { id, starred: starred.has(id) });
    return starred.has(id);
  }

  /* ────────────────── rendering utilities ────────────────── */
  function renderConversations(data) {
    const cont = document.getElementById('sidebarConversations');
    if (!cont) return;
    cont.innerHTML = '';
    const list = (data?.data?.conversations || data?.conversations || []);
    const uniq = [];
    const seen = new Set();
    list.forEach(c => { if (c.id && !seen.has(c.id)) { uniq.push(c); seen.add(c.id); } });

    if (!uniq.length) {
      cont.appendChild(Object.assign(document.createElement('li'), {
        className: 'text-gray-500 text-center py-4',
        textContent: 'No conversations yet',
      }));
      return;
    }
    uniq.forEach(c => cont.appendChild(createConversationLI(c)));
  }

  function createConversationLI(item) {
    const li = document.createElement('li');
    li.className = 'p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer';
    const flex = Object.assign(document.createElement('div'), { className: 'flex flex-col' });

    /* header */
    const head = Object.assign(document.createElement('div'), { className: 'flex items-center justify-between' });
    const t = Object.assign(document.createElement('span'), { className: 'flex-1 truncate font-medium', textContent: item.title || `Conversation ${item.id}` });
    head.appendChild(t);

    /* star button */
    const b = document.createElement('button');
    updateStarBtn(b, isConversationStarred(item.id));
    b.addEventListener('click', e => {
      e.stopPropagation();
      const app = window.DependencySystem?.modules.get('app');
      if (!app?.state?.isAuthenticated) {
        app.showNotification('Login to star conversations.', 'warning');
        return;
      }
      const now = toggleStarConversation(item.id);
      updateStarBtn(b, now);
    });
    head.appendChild(b);

    /* sub-line */
    const sub = Object.assign(document.createElement('div'), { className: 'flex items-center text-xs text-gray-500 mt-1' });
    if (item.model_id) sub.appendChild(Object.assign(document.createElement('span'), { className: 'truncate', textContent: item.model_id }));
    if (item.project_id) {
      if (item.model_id) sub.appendChild(Object.assign(document.createElement('span'), { className: 'mx-1', textContent: '•' }));
      sub.appendChild(Object.assign(document.createElement('span'), { className: 'truncate', textContent: 'Project' }));
    }

    flex.append(head, sub);
    li.appendChild(flex);
    li.addEventListener('click', () => {
      const app = window.DependencySystem?.modules.get('app');
      if (!app?.state?.isAuthenticated) {
        app.showNotification('Sign in to view conversations.', 'warning');
        return;
      }
      const nav = window.DependencySystem?.modules.get('navigateToConversation');
      nav ? nav(item.id) : app.showNotification('Navigation unavailable.', 'error');
    });
    return li;
  }

  function updateStarBtn(btn, on) {
    btn.className = on ? 'ml-2 text-yellow-500' : 'ml-2 text-gray-300 hover:text-yellow-500';
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4"
           fill="${on ? 'currentColor' : 'none'}" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915
              c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c
              .3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976
              2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.783-.57-.38-1.81.588-1.81h4.914
              a1 1 0 00.951-.69l1.519-4.674z"/>
      </svg>`;
  }

  function renderProjects(projects) {
    const cont = document.getElementById('sidebarProjects');
    if (!cont) return;
    cont.innerHTML = '';
    if (!projects?.length) {
      cont.appendChild(Object.assign(document.createElement('li'), {
        className: 'text-center text-gray-500 py-4',
        textContent: 'No projects yet',
      }));
      return;
    }
    projects.forEach(p => {
      const li = Object.assign(document.createElement('li'), { className: 'p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer' });
      const tit = Object.assign(document.createElement('div'), { className: 'font-medium truncate', textContent: p.name || `Project ${p.id}` });
      const des = Object.assign(document.createElement('div'), { className: 'text-xs text-gray-500 mt-1', textContent: p.description || 'No description' });
      li.append(tit, des);
      li.addEventListener('click', () => {
        const app = window.DependencySystem?.modules.get('app');
        if (!app?.state?.isAuthenticated) {
          app.showNotification('Sign in to view projects.', 'warning');
          return;
        }
        const nav = window.DependencySystem?.modules.get('navigateToProject');
        nav ? nav(p.id) : app.showNotification('Navigation unavailable.', 'error');
      });
      cont.appendChild(li);
    });
  }

  /* ────────────────── helper dispatch ────────────────── */
  function dispatch(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  }

  /* ────────────────── exported API ────────────────── */
  return {
    init,
    /* visibility */
    toggleSidebar, closeSidebar, showSidebar,
    /* pin */
    togglePin,
    /* tabs */
    activateTab,
    /* star helpers (used by uiRenderer etc.) */
    isConversationStarred, toggleStarConversation,
    /* renderers */
    renderConversations, renderProjects,
  };
}

/* ───────────────── register singleton ───────────────── */
if (window.DependencySystem) {
  const instance = createSidebar();
  window.DependencySystem.register('sidebar', instance);
}
