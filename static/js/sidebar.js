/**
 * sidebar.js – single source-of-truth for all sidebar behaviour
 *
 * Remediated version with improved error handling, safer localStorage usage,
 * fallback checks for optional globals, and updated logic to render both
 * recent and starred conversations in corresponding <ul> elements.
 *
 * Expected DOM IDs (must be present):
 *   - #mainSidebar, #navToggleBtn, #closeSidebarBtn, #pinSidebarBtn
 *   - tab buttons: #recentChatsTab, #starredChatsTab, #projectsTab
 *   - tab panels/sections: #recentChatsSection, #starredChatsSection, #projectsSection
 *   - <ul id="sidebarConversations"> for “recent” conversations
 *   - <ul id="starredConversations"> for “starred” conversations
 *
 * Required or optional globals (via window or DependencySystem):
 *   - eventHandlers          : optional, or fallback to direct addEventListener
 *   - app                    : for checking user auth + notifications (app.state.isAuthenticated)
 *   - projectDashboard       : lazy-init on "projects" tab
 *   - projectManager         : for project lists
 *   - uiRenderer             : optional – for render helper reuse
 *   - DependencySystem       : for module registration (optional)
 */

/* ───────────────────────── helpers ───────────────────────── */

/**
 * Safely parse a JSON string from localStorage. Returns defaultVal if parsing fails.
 */
function safeParseJSON(jsonString, defaultVal) {
  if (typeof jsonString !== 'string') return defaultVal;
  try {
    return JSON.parse(jsonString);
  } catch (err) {
    console.warn('Failed to parse JSON from localStorage:', err);
    return defaultVal;
  }
}

/**
 * Retrieve a global module or object with a fallback.
 * @param {string} depName - The name in the DependencySystem
 * @param {string} fallback - The name in window if DependencySystem is not present or fails
 */
function getGlobalModule(depName, fallback) {
  const DS = window.DependencySystem;
  if (DS?.modules?.has(depName)) {
    return DS.modules.get(depName);
  }
  return window[fallback];
}

/* ───────────────────────── main factory ───────────────────────── */

export function createSidebar() {
  /* ───────────────────────── state ───────────────────────── */
  let el, btnToggle, btnClose, btnPin, backdrop;
  let pinned = false;  // stays open when true
  let visible = false; // current visual state

  // Safely parse starred conversation IDs from localStorage as an Array, then convert to Set
  const starred = new Set(
    safeParseJSON(localStorage.getItem('starredConversations'), [])
  );

  // Attempt to get eventHandlers from the global system or fallback
  const EH = getGlobalModule('eventHandlers', 'eventHandlers');
  if (!EH) {
    console.warn('[sidebar] No global "eventHandlers" found. Will bind listeners directly.');
  }

  /* ───────────────────────── init ───────────────────────── */
  async function init() {
    try {
      await findDom();
      restorePersistentState();
      bindDomEvents();
      const activeTab = localStorage.getItem('sidebarActiveTab') || 'recent';
      await activateTab(activeTab);
      console.log('[sidebar] initialized successfully');
      return true;
    } catch (err) {
      console.error('[sidebar] Initialization failed:', err);
      return false;
    }
  }

  /**
   * Attempts to locate necessary DOM nodes. Tries up to 6 times if missing.
   */
  async function findDom() {
    // Up to 6 attempts for critical nodes
    for (let i = 0; i < 6; i += 1) {
      el = document.getElementById('mainSidebar');
      btnToggle = document.getElementById('navToggleBtn');
      btnClose = document.getElementById('closeSidebarBtn');
      btnPin = document.getElementById('pinSidebarBtn');
      if (el && btnToggle) break;
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r => setTimeout(r, 300));
    }
    if (!el || !btnToggle) {
      throw new Error('sidebar: critical DOM nodes missing (#mainSidebar and/or #navToggleBtn)');
    }
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
    // If an eventHandlers system is available, register with it; otherwise use direct listeners.
    const addListener = (target, type, listenerObj) => {
      if (!target) return;
      const { handler, desc } = listenerObj;
      if (EH?.trackListener) {
        EH.trackListener(target, type, handler, { description: desc });
      } else {
        target.addEventListener(type, handler);
      }
    };

    addListener(btnToggle, 'click', {
      handler: () => toggleSidebar(),
      desc: 'Sidebar toggle',
    });
    addListener(btnClose, 'click', {
      handler: () => closeSidebar(),
      desc: 'Sidebar close',
    });
    addListener(btnPin, 'click', {
      handler: () => togglePin(),
      desc: 'Sidebar pin',
    });
    addListener(window, 'resize', {
      handler: handleResize,
      desc: 'Sidebar resize',
    });

    // Tab buttons
    [
      { name: 'recent', id: 'recentChatsTab' },
      { name: 'starred', id: 'starredChatsTab' },
      { name: 'projects', id: 'projectsTab' },
    ].forEach(({ name, id }) => {
      const btn = document.getElementById(id);
      addListener(btn, 'click', {
        handler: () => activateTab(name),
        desc: `Sidebar tab ${name}`,
      });
    });
  }

  /* ───────────────────── pin / unpin ───────────────────── */
  function togglePin(force) {
    pinned = (force !== undefined) ? !!force : !pinned;
    localStorage.setItem('sidebarPinned', pinned);
    el.classList.toggle('sidebar-pinned', pinned);
    updatePinButtonVisual();
    if (pinned) showSidebar(); // force sidebar open if pinned
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

    // Lazy init for the Projects tab if it's active
    setTimeout(() => {
      const activeTab = localStorage.getItem('sidebarActiveTab') || 'recent';
      if (activeTab === 'projects') {
        ensureProjectDashboard();
        // Safely focus the search input if present
        const projSearch = document.getElementById('sidebarProjectSearch');
        if (projSearch) projSearch.focus();
      }
    }, 10);

    dispatch('sidebarVisibilityChanged', { visible });
  }

  function closeSidebar() {
    // Don’t close if not visible or if pinned
    if (!visible || pinned) return;
    // Blur any focused element inside the sidebar to avoid ARIA issues
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
    // If user has resized to desktop, remove mobile-only backdrop
    if (window.innerWidth >= 1024) {
      removeBackdrop();
    }
  }

  /* ───────────────────── backdrop (mobile) ───────────────────── */
  function createBackdrop() {
    if (backdrop || window.innerWidth >= 1024) return;
    backdrop = Object.assign(document.createElement('div'), {
      className: 'fixed inset-0 bg-black bg-opacity-50 z-40',
      style: 'cursor:pointer',
    });

    const closeHandler = () => closeSidebar();
    if (EH?.trackListener) {
      EH.trackListener(backdrop, 'click', closeHandler, { description: 'Sidebar backdrop' });
    } else {
      backdrop.addEventListener('click', closeHandler);
    }

    document.body.appendChild(backdrop);
  }

  function removeBackdrop() {
    if (backdrop) {
      backdrop.remove();
      backdrop = null;
    }
  }

  /* ───────────────────── tabs ───────────────────── */
  async function activateTab(name = 'recent') {
    // Each tab is mapped to a button ID and a panel ID
    const map = {
      recent: { btn: 'recentChatsTab', panel: 'recentChatsSection' },
      starred: { btn: 'starredChatsTab', panel: 'starredChatsSection' },
      projects: { btn: 'projectsTab', panel: 'projectsSection' },
    };
    if (!map[name]) {
      name = 'recent'; // default fallback
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

        // If the active tab is 'projects' and the sidebar is visible, ensure loaded
        if (isActive && name === 'projects' && el.getAttribute('aria-hidden') === 'false') {
          ensureProjectDashboard();
        }
      }
    });

    localStorage.setItem('sidebarActiveTab', name);
    dispatch('sidebarTabChanged', { tab: name });

    // Call rendering logic for whichever tab was opened
    if (name === 'recent') {
      maybeRenderRecentConversations();
    } else if (name === 'starred') {
      maybeRenderStarredConversations();
    }
  }

  async function ensureProjectDashboard() {
    // Attempt to get projectDashboard from the global dependency system
    const DS = window.DependencySystem;
    let dash;
    if (DS?.waitFor) {
      try {
        dash = await DS.waitFor('projectDashboard', null, 5000);
      } catch (err) {
        console.warn('[sidebar] projectDashboard not found or timed out:', err);
        return;
      }
    } else {
      dash = getGlobalModule('projectDashboard', 'projectDashboard');
    }
    if (!dash) return;

    // If the DOM section is not yet initialized, call dashboard’s initialize()
    const section = document.getElementById('projectsSection');
    if (section && !section.dataset.initialised) {
      await dash.initialize?.();
      section.dataset.initialised = 'true';
    }

    // Optionally render project content if managers / renderers are present
    const pm = getGlobalModule('projectManager', 'projectManager');
    const uiR = getGlobalModule('uiRenderer', 'uiRenderer');
    if (pm?.projects && uiR?.renderProjects) {
      uiR.renderProjects(pm.projects);
    }
  }

  /* ───────────────────── conversation listing ───────────────────── */

  // Renders recent conversations if data is available
  function maybeRenderRecentConversations() {
    const uiR = getGlobalModule('uiRenderer', 'uiRenderer');
    // If conversation data is globally available, try rendering
    if (window.chatConfig?.conversations && uiR?.renderConversations) {
      // You can rely on the external uiRenderer if you prefer:
      // uiR.renderConversations(window.chatConfig);
      // OR use this built-in method:
      renderConversations(window.chatConfig);
    }
  }

  // Renders only starred conversations
  function maybeRenderStarredConversations() {
    // If conversation data is globally available, filter to starred only
    if (window.chatConfig?.conversations) {
      renderStarredConversations(window.chatConfig);
    }
  }

  /* ────────────────── star/unstar helpers ────────────────── */
  function isConversationStarred(id) {
    return starred.has(id);
  }

  function toggleStarConversation(id) {
    if (starred.has(id)) {
      starred.delete(id);
    } else {
      starred.add(id);
    }
    localStorage.setItem('starredConversations', JSON.stringify([...starred]));

    // Re-render starred conversations in case the tab is open
    maybeRenderStarredConversations();

    dispatch('sidebarStarredChanged', { id, starred: starred.has(id) });
    return starred.has(id);
  }

  /* ────────────────── built-in conversation rendering ────────────────── */

  /**
   * Renders ALL conversations into #sidebarConversations (the “recent” list).
   * In your environment, you might rely on external uiRenderer,
   * but this function is included if you want a fallback or minimal version.
   */
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

  /**
   * Renders only starred conversations into #starredConversations.
   */
  function renderStarredConversations(data) {
    const cont = document.getElementById('starredConversations');
    if (!cont) return;
    cont.innerHTML = '';

    const all = data?.data?.conversations || data?.conversations || [];
    // Filter to only those whose IDs are in `starred`
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

    // Header row
    const head = Object.assign(document.createElement('div'), {
      className: 'flex items-center justify-between',
    });
    const t = Object.assign(document.createElement('span'), {
      className: 'flex-1 truncate font-medium',
      textContent: item.title || `Conversation ${item.id}`,
    });
    head.appendChild(t);

    // Star button
    const b = document.createElement('button');
    updateStarBtn(b, isConversationStarred(item.id));
    b.addEventListener('click', e => {
      e.stopPropagation();
      const app = getGlobalModule('app', 'app');
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

    // Sub-line (model, project, etc.)
    const sub = Object.assign(document.createElement('div'), {
      className: 'flex items-center text-xs text-gray-500 mt-1',
    });
    if (item.model_id) {
      sub.appendChild(Object.assign(document.createElement('span'), {
        className: 'truncate',
        textContent: item.model_id,
      }));
    }
    if (item.project_id) {
      if (item.model_id) {
        sub.appendChild(Object.assign(document.createElement('span'), {
          className: 'mx-1',
          textContent: '•',
        }));
      }
      sub.appendChild(Object.assign(document.createElement('span'), {
        className: 'truncate',
        textContent: 'Project',
      }));
    }

    flex.append(head, sub);
    li.appendChild(flex);

    // Navigation on click
    li.addEventListener('click', () => {
      const app = getGlobalModule('app', 'app');
      if (!app?.state?.isAuthenticated) {
        app?.showNotification
          ? app.showNotification('Sign in to view conversations.', 'warning')
          : alert('Sign in to view conversations.');
        return;
      }
      // If a navigation module is present, use it
      const nav = getGlobalModule('navigateToConversation', 'navigateToConversation');
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

  /* ────────────────── helper custom event dispatch ────────────────── */
  function dispatch(name, detail) {
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent(name, { detail }));
    }
  }

  /* ────────────────── exported API ────────────────── */
  return {
    init,
    // visibility
    toggleSidebar,
    closeSidebar,
    showSidebar,
    // pin
    togglePin,
    // tabs
    activateTab,
    // star helpers
    isConversationStarred,
    toggleStarConversation,
    // rendering (fallback if no external uiRenderer)
    renderConversations,
    renderStarredConversations,
  };
}

/* ───────────────── register as a singleton (if available) ───────────────── */
if (window.DependencySystem) {
  try {
    const instance = createSidebar();
    // Register with the global DependencySystem so other modules can .get('sidebar')
    window.DependencySystem.register('sidebar', instance);
    // Optionally, auto-init the sidebar:
    // instance.init();
  } catch (err) {
    console.error('[sidebar] Failed to register with DependencySystem:', err);
  }
}
